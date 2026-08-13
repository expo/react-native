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
 * Adds an inline element's inline-axis margin/border/padding to the advance of a single character
 * (box-model-scope.md G3).
 *
 * Applied to the character *preceding* an inline box for its leading space, and to the box's own
 * last character for its trailing space — never to a character added for the purpose. The string
 * backing a text run is also what accessibility and clipboard copy read, so a zero-width spacer
 * inserted for layout would leak into text the user reads and copies.
 *
 * ## Why this is not `letterSpacing`
 *
 * It was, and the advances were right while the *drawing* was wrong. Android does not add letter
 * spacing after a glyph — Minikin splits it, half before the glyph and half after — so covering one
 * character with `spacingPx / textSize` put half an inline box's padding *inside* the word. It
 * rendered as `decorated inlin e`, `befor e SPA N after`, `the las t`: a gap before the final
 * character of every run carrying inline-box padding. The comment here used to assert the opposite,
 * that Android "applies it after every character", and that assumption was the whole bug.
 *
 * A `ReplacementSpan` is the only way on Android to say "reserve this advance and draw the glyph at
 * the left of it". The total advance is deliberately identical to the `letterSpacing` version —
 * natural width plus `spacingPx` — because the geometry was already right: the conformance corpus
 * agrees with real Safari on `inline-with-padding-around-box`, and that has to stay true. What
 * changes is only where the glyph sits inside its own advance.
 *
 * The cost is that this one character is shaped in isolation, so a kern or ligature it would have
 * formed with its neighbour is lost. That is one character at the edge of an inline box, weighed
 * against a gap in the middle of a word — and iOS has the same seam, since `NSKernAttributeName` is
 * applied to exactly this character there.
 */
/**
 * @param spacingTakesFollowingBackground The one placement whose spacing belongs to a DIFFERENT
 *   element than its glyph: leading space hung off the character *preceding* an inline box. That
 *   character is outside the element, but the space after it is the element's own padding, and CSS
 *   paints an inline box's background across its padding (css-backgrounds-3 §2.2) — so the spacing
 *   region takes the background of the character at the span's END index (the element's first),
 *   not of the glyph it shares an advance with.
 */
internal class InlineBoxSpacingSpan(
    private val spacingPx: Float,
    private val spaceBefore: Boolean = false,
    private val spacingTakesFollowingBackground: Boolean = false,
) : ReplacementSpan(), ReactSpan {

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
    // Normally at the LEFT of the reserved advance, so the extra space falls AFTER the character —
    // what the caller means by "leading space hung off the preceding character" and by "trailing
    // space hung off the box's own last character".
    //
    // `spaceBefore` is for the one case that cannot use the preceding character: when it belongs to
    // an attachment, which already owns a ReplacementSpan of its own. Two on one character fight,
    // and the attachment loses its width. There the span goes on the box's FIRST character instead
    // and the space is drawn ahead of the glyph, which puts it in the same place on screen.
    val spacing = if (spacingPx.isNaN()) 0f else spacingPx
    val offset = if (spaceBefore) spacing else 0f

    /*
     * A ReplacementSpan takes its whole range away from TextLine: `handleReplacement` applies the
     * metric-affecting spans and calls this method — it never runs the character styles, never
     * paints `bgColor`, never draws decorations. So the styling the rest of the line gets for free
     * has to be reproduced here, or the LAST character of every inline element carrying trailing
     * padding renders bare — which is exactly how this was found: `<code
     * style={{backgroundColor}}>…background</code>` drew its final "d" on the page background.
     */
    val tp = TextPaint(paint)
    (text as? Spanned)?.let { spanned ->
      for (style in spanned.getSpans(start, end, CharacterStyle::class.java)) {
        if (style !== this) {
          style.updateDrawState(tp)
        }
      }
    }

    val natural = tp.measureText(text, start, end)
    val glyphLeft = x + offset
    // The glyph region carries the range's own background.
    if (tp.bgColor != 0) {
      drawBackground(canvas, tp.bgColor, glyphLeft, top, glyphLeft + natural, bottom)
    }
    // The spacing region is an inline box's padding, and background covers padding
    // (css-backgrounds-3 §2.2). Whose background depends on the placement — see the
    // constructor doc.
    if (spacing > 0f) {
      val spacingLeft = if (spaceBefore) x else x + natural
      val spacingBg =
          if (spacingTakesFollowingBackground) backgroundAt(text, end) else tp.bgColor
      if (spacingBg != 0) {
        drawBackground(canvas, spacingBg, spacingLeft, top, spacingLeft + spacing, bottom)
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
    val spanned = text as? Spanned ?: return 0
    if (index >= spanned.length) {
      return 0
    }
    val probe = TextPaint()
    for (style in spanned.getSpans(index, index + 1, CharacterStyle::class.java)) {
      if (style !== this) {
        style.updateDrawState(probe)
      }
    }
    return probe.bgColor
  }
}
