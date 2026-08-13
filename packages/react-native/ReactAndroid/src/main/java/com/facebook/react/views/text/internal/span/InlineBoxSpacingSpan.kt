/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text.internal.span

import android.graphics.Canvas
import android.graphics.Paint
import android.text.Spanned
import android.text.TextPaint
import android.text.style.CharacterStyle
import android.text.style.ReplacementSpan

/**
 * THE INLINE RESERVE MODEL — the one model every consumer of an inline
 * element's inline-axis space must share. `InlineBoxDecorationSpan` (box
 * painting) and the published-rect query in `TextLayoutManager` are written
 * against it; change it here and they are wrong.
 *
 * An inline element's inline-axis margin + border + padding (its *reserve*,
 * box-model-scope.md G3) becomes text ADVANCE, never characters — the string
 * backing a run is also what accessibility and clipboard copy read, so a
 * zero-width spacer inserted for layout would leak into text the user reads
 * and copies.
 *
 * Placement, and the order of the parts inside the reserved advance:
 *
 *  - LEADING reserve: rides the character *preceding* the element, drawn after
 *    that character's glyph in outermost-first order — margin, border,
 *    padding — so the padding ends up adjacent to the element's first glyph.
 *  - TRAILING reserve: rides the element's own last character, drawn after its
 *    glyph innermost-first — padding, border, margin.
 *  - An element that STARTS THE TEXT has no preceding character; its leading
 *    reserve is a `LeadingMarginSpan` instead (it necessarily starts the first
 *    line, and a leading edge applies once no matter how often the box wraps).
 *  - An element PRECEDED BY AN ATTACHMENT cannot ride the attachment's
 *    character (the placeholder is a `ReplacementSpan` that owns that advance
 *    outright; two on one character fight and the attachment loses its
 *    width). The reserve rides the element's own FIRST character, drawn
 *    before its glyph — margin, border, padding, glyph.
 *
 * Consequence for pen positions (`getPrimaryHorizontal`), which include every
 * consumed advance: at an element's start offset the pen sits at the CONTENT
 * left edge (its leading reserve was consumed by the preceding character);
 * at its end offset the pen sits at the MARGIN's outer right edge (the
 * trailing reserve was consumed by the last character). The attachment-
 * preceded exception shifts the start pen to the margin's outer LEFT edge.
 *
 * Painting: backgrounds cover content and PADDING only (css-backgrounds-3
 * §2.2) — never the border region (the border is painted beneath the glyph
 * pass by `InlineBoxDecorationSpan`, and background drawn later in the
 * TextLine pass would cover it) and never the margin.
 *
 * ## Why this is a ReplacementSpan and not `letterSpacing`
 *
 * It was `letterSpacing`, and the advances were right while the *drawing* was
 * wrong: Minikin splits letter spacing half before and half after the glyph,
 * so covering one character with `spacingPx / textSize` put half an inline
 * box's padding *inside* the word (`decorated inlin e`, `the las t`). A
 * `ReplacementSpan` is the only way on Android to say "reserve this advance
 * and draw the glyph at its left edge". The total advance is identical to the
 * letter-spacing version; only where the glyph sits inside it changed. The
 * cost is that this one character is shaped in isolation, losing a kern or
 * ligature with its neighbour — one character at the edge of an inline box,
 * against a gap in the middle of a word. iOS has the same seam
 * (`NSKernAttributeName` on exactly this character).
 *
 * A ReplacementSpan takes its whole range away from TextLine:
 * `handleReplacement` applies the metric-affecting spans and calls [draw] — it
 * never runs the character styles, never paints `bgColor`, never draws
 * decorations. So the styling the rest of the line gets for free is
 * reproduced here, or the LAST character of every inline element carrying
 * trailing padding renders bare — which is how this was found:
 * `<code style={{backgroundColor}}>…background</code>` drew its final "d" on
 * the page background.
 */
internal class InlineBoxSpacingSpan(
    private val marginPx: Float,
    private val borderPx: Float,
    private val paddingPx: Float,
    private val spaceBefore: Boolean = false,
    private val spacingTakesFollowingBackground: Boolean = false,
) : ReplacementSpan(), ReactSpan {

  private val spacingPx: Float
    get() = marginPx + borderPx + paddingPx

  override fun getSize(
      paint: Paint,
      text: CharSequence,
      start: Int,
      end: Int,
      fm: Paint.FontMetricsInt?,
  ): Int {
    // A ReplacementSpan owns its line metrics. Without this the line collapses to the span's
    // defaults and every line carrying an inline box loses its height.
    if (fm != null) {
      paint.getFontMetricsInt(fm)
    }
    val natural = paint.measureText(text, start, end)
    if (spacingPx.isNaN()) {
      return Math.round(natural)
    }
    return Math.round(natural + spacingPx)
  }

  override fun draw(
      canvas: Canvas,
      text: CharSequence,
      start: Int,
      end: Int,
      x: Float,
      top: Int,
      y: Int,
      bottom: Int,
      paint: Paint,
  ) {
    val spacing = if (spacingPx.isNaN()) 0f else spacingPx
    val padding = if (paddingPx.isNaN()) 0f else paddingPx
    // The glyph sits at the LEFT of the reserved advance, except in the
    // attachment-preceded placement where the reserve precedes it (see the
    // model above).
    val glyphLeft = x + if (spaceBefore) spacing else 0f

    val tp = TextPaint(paint)
    applyCoveringStyles(text, start, end, tp)
    val natural = tp.measureText(text, start, end)

    // The glyph region carries the range's own background.
    if (tp.bgColor != 0) {
      drawBackground(canvas, tp.bgColor, glyphLeft, top, glyphLeft + natural, bottom)
    }

    // Background covers padding but not border or margin (see the model
    // above), so only the PADDING portion of the reserve is painted — the part
    // adjacent to the element's glyphs. Whose background depends on the
    // placement: the leading reserve's padding belongs to the FOLLOWING
    // element (the glyph this span shares an advance with is outside it).
    if (padding > 0f) {
      val paddingLeft =
          when {
            // [margin][border][padding][glyph]: padding ends where the glyph starts.
            spaceBefore -> glyphLeft - padding
            // [glyph][margin][border][padding]: padding is the reserve's far end.
            spacingTakesFollowingBackground -> x + natural + spacing - padding
            // [glyph][padding][border][margin]: padding starts at the glyph's end.
            else -> x + natural
          }
      val paddingBg =
          if (spacingTakesFollowingBackground) backgroundAt(text, end) else tp.bgColor
      if (paddingBg != 0) {
        drawBackground(canvas, paddingBg, paddingLeft, top, paddingLeft + padding, bottom)
      }
    }

    canvas.drawText(text, start, end, glyphLeft, y.toFloat(), tp)
  }

  private fun drawBackground(
      canvas: Canvas,
      color: Int,
      left: Float,
      top: Int,
      right: Float,
      bottom: Int,
  ) {
    val bg = Paint()
    bg.color = color
    canvas.drawRect(left, top.toFloat(), right, bottom.toFloat(), bg)
  }

  /** The background colour the character at [index] would be painted with, or 0 for none. */
  private fun backgroundAt(text: CharSequence, index: Int): Int {
    val probe = TextPaint()
    applyCoveringStyles(text, index, index + 1, probe)
    return probe.bgColor
  }

  /**
   * Applies to [tp] exactly the character styles that COVER `[start, end)` — the styling TextLine
   * itself would have used for those characters.
   *
   * Not `getSpans(start, end, …)` alone: `Spanned` implementations differ on whether spans that
   * merely *touch* the query range (`spanEnd == start` or `spanStart == end`) are returned. This
   * span sits on the character *preceding* an inline element, and the element's own spans start
   * exactly where that character ends — a touch-inclusive implementation hands the element's
   * styling to the preceding glyph. The covering check makes the answer implementation-independent.
   */
  private fun applyCoveringStyles(text: CharSequence, start: Int, end: Int, tp: TextPaint) {
    val spanned = text as? Spanned ?: return
    if (start >= spanned.length) {
      return
    }
    for (style in spanned.getSpans(start, end, CharacterStyle::class.java)) {
      if (style !== this &&
          spanned.getSpanStart(style) <= start &&
          spanned.getSpanEnd(style) >= end) {
        style.updateDrawState(tp)
      }
    }
  }
}
