/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text.internal.span

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Paint.FontMetricsInt
import android.text.style.ReplacementSpan

/**
 * TextInlineViewPlaceholderSpan is a span for inlined views that are inside <Text></Text>. It
 * computes its size based on the input size. It contains no draw logic, just positioning logic.
 */
/**
 * @param baselineFromTop where the box's OWN baseline sits, measured from its
 *   top (CSS2 §10.8.1). Equal to `height` for a box with no line boxes of its
 *   own, which is the synthesized bottom-edge baseline and the only case the
 *   old fixed `ascent = -height, descent = 0` got right: a box with text in it
 *   was hung entirely above the line's baseline, so its own text floated above
 *   the surrounding text instead of sitting on the same line.
 */
/**
 * @param verticalAlign CSS `vertical-align` for this box: 0 baseline, 1 top,
 *   2 bottom, 3 middle. Where a box actually lands is decided when the line is
 *   positioned (see `TextLayoutManager.nextAttachmentMetrics`), because `top`
 *   and `bottom` are relative to the line box — which does not exist yet here.
 *   What this class must get right either way is the box's CONTRIBUTION to the
 *   line's height, below.
 */
internal class TextInlineViewPlaceholderSpan(
    val reactTag: Int,
    val width: Int,
    val height: Int,
    val baselineFromTop: Int = height,
    val verticalAlign: Int = 0,
    /**
     * The enclosing inline box's leading/trailing space, in px.
     *
     * It has to be folded into this span's advance rather than applied
     * alongside it: a character carrying a `ReplacementSpan` takes its whole
     * width from that span, so an `InlineBoxSpacingSpan` on the same character
     * is simply ignored and `<span style="padding-left:10px"><img></span>` lost
     * its padding entirely. The box is drawn inset by the leading edge — see
     * `TextLayoutManager.nextAttachmentMetrics`, which backs it out.
     */
    val leadingSpace: Int = 0,
    val trailingSpace: Int = 0,
) : ReplacementSpan(), ReactSpan {
  override fun getSize(
      paint: Paint,
      text: CharSequence?,
      start: Int,
      end: Int,
      fm: FontMetricsInt?,
  ): Int {
    // NOTE: This getSize code is copied from DynamicDrawableSpan and modified to not use a Drawable
    if (fm != null) {
      contributeToLineMetrics(paint, fm)
      fm.top = fm.ascent
      fm.bottom = fm.descent
    }
    return width + leadingSpace + trailingSpace
  }

  /**
   * This box's contribution to a line's metrics, per its `vertical-align` — the union step of
   * CSS2 §10.8's "the line box height is the distance between the uppermost box top and the
   * lowermost box bottom".
   *
   * Named and public-to-the-package because TWO places must apply it and they must agree:
   * [getSize], when Android first measures the run, and [CustomLineHeightSpan.chooseHeight],
   * which otherwise CLAMPS the line to the author's `line-height` after this span has already
   * spoken. `line-height` sizes the STRUT — text contributes exactly that much however tall its
   * glyphs — but an atomic inline contributes its own box, so the clamp has to re-admit these
   * boxes or a 56pt image on a 26pt line paints straight over the line above it. Which it did.
   */
  fun contributeToLineMetrics(paint: Paint, fm: FontMetricsInt) {
    run {
      when (verticalAlign) {
        0 -> {
          // The box's own baseline goes on the line's, so it reaches
          // `baselineFromTop` above and whatever remains below.
          //
          // Combined with, not substituted for, the metrics already in `fm` —
          // those are the font's, and they are the STRUT, which every line box
          // contains whether or not text is on it (CSS2 §10.8). Assigning over
          // them dropped the strut's descent, so a lone 40pt box made a 40pt
          // line where a browser makes it 44: the box sits ON the baseline and
          // the strut still hangs below it. That extra space under an image is
          // the familiar one authors reach for `vertical-align: top` to remove.
          fm.ascent = minOf(fm.ascent, -baselineFromTop)
          fm.descent = maxOf(fm.descent, height - baselineFromTop)
        }
        3 -> {
          // `middle`: centred on the baseline raised by half the parent's
          // x-height, so its contribution is exact — half the box above that
          // point and half below.
          val bounds = android.graphics.Rect()
          paint.getTextBounds("x", 0, 1, bounds)
          val xHeight = bounds.height()
          fm.ascent = minOf(fm.ascent, -(xHeight / 2 + height / 2))
          fm.descent = maxOf(fm.descent, height / 2 - xHeight / 2)
        }
        else -> {
          // `top`/`bottom`: positioned against the line's EDGES once it has been
          // laid out, so this box must not claim ascent — doing so drags the
          // baseline down, and the strut's descent then hangs below the box and
          // makes every line the font's descent too tall (measured: +4pt on
          // every case).
          //
          // `fm` arrives carrying the font's own metrics, which is the strut.
          // Reaching exactly that ascent and hanging the remainder below lets
          // the line grow to fit the box while the baseline stays put.
          val strutAscent = -fm.ascent
          fm.descent = maxOf(fm.descent, height - strutAscent)
        }
      }
    }
  }

  override fun draw(
      canvas: Canvas,
      text: CharSequence?,
      start: Int,
      end: Int,
      x: Float,
      top: Int,
      y: Int,
      bottom: Int,
      paint: Paint,
  ): Unit = Unit
}
