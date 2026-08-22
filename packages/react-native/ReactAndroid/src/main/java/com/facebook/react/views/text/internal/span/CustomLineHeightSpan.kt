/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text.internal.span

import android.graphics.Paint.FontMetricsInt
import android.text.Spanned
import android.text.TextPaint
import android.text.style.LineHeightSpan
import kotlin.math.ceil
import kotlin.math.floor

/**
 * Implements a [LineHeightSpan] which follows web-like behavior for line height, unlike
 * LineHeightSpan.Standard which only effects space between the baselines of adjacent line boxes
 * (does not impact space before the first line or after the last).
 */
internal class CustomLineHeightSpan(height: Float, private val expandOnly: Boolean = false) :
    LineHeightSpan.WithDensity, ReactSpan {
  val lineHeight: Int = ceil(height.toDouble()).toInt()

  override fun chooseHeight(
      text: CharSequence,
      start: Int,
      end: Int,
      spanstartv: Int,
      v: Int,
      fm: FontMetricsInt,
  ) {
    chooseHeight(text, start, end, spanstartv, v, fm, null)
  }

  override fun chooseHeight(
      text: CharSequence,
      start: Int,
      end: Int,
      spanstartv: Int,
      v: Int,
      fm: FontMetricsInt,
      paint: TextPaint?,
  ) {
    // https://www.w3.org/TR/css-inline-3/#inline-height
    // When its computed line-height is not normal, its layout bounds are derived solely from
    // metrics of its first available font (ignoring glyphs from other fonts), and leading is used
    // to adjust the effective A and D to add up to the used line-height. Calculate the leading L as
    // L = line-height - (A + D). Half the leading (its half-leading) is added above A of the first
    // available font, and the other half below D of the first available font, giving an effective
    // ascent above the baseline of A′ = A + L/2, and an effective descent of D′ = D + L/2. However,
    // if line-fit-edge is not leading and this is not the root inline box, if the half-leading is
    // positive, treat it as zero. The layout bounds exactly encloses this effective A′ and D′.

    val leading = lineHeight - ((-fm.ascent) + fm.descent)

    // `line-height` is the strut's height — a FLOOR on the line box, not a
    // ceiling (CSS2 §10.8). For text the two coincide, because the strut is the
    // tallest thing on the line, and shrinking to fit is the exact emulation
    // callers want. For a line carrying an atomic inline they do not: a 50pt
    // box on a 20pt line must make the line 50pt, and a negative leading here
    // would squeeze it back to 20 and let the box overflow the line it is
    // supposed to define.
    if (expandOnly && leading <= 0) {
      return
    }

    fm.ascent -= ceil(leading / 2.0f).toInt()
    fm.descent += floor(leading / 2.0f).toInt()

    /*
     * Re-admit the atomic inlines this clamp just squeezed out.
     *
     * `line-height` sizes the STRUT: text contributes exactly the used
     * line-height however tall its glyphs, and the negative-leading clamp above
     * is the correct emulation of that. But the line box is the UNION of the
     * strut and every inline-level box on the line (CSS2 §10.8), and an atomic
     * inline — an image, an inline-block — contributes its own box. The
     * placeholder span said so in `getSize`, and this span then flattened the
     * union back to the strut: a 56pt box on a 26pt line stayed a 26pt line
     * and the box painted straight over the line above. Safari, probed on the
     * same markup, grows the line to box + strut-descent.
     *
     * The same contribution logic the placeholder used is re-applied here, so
     * the two cannot disagree. `WithDensity` is implemented for the paint this
     * needs (the `middle` alignment measures an x-height); Android always
     * prefers the paint-carrying overload when a span offers it.
     */
    if (paint != null && text is Spanned) {
      for (placeholder in
          text.getSpans(start, end, TextInlineViewPlaceholderSpan::class.java)) {
        placeholder.contributeToLineMetrics(paint, fm)
      }
    }

    // The top of the first line, and the bottom of the last line, may influence bounds of the
    // paragraph, so we match them to the text ascent/descent. It is otherwise desirable to allow
    // line boxes to overlap (to allow too large glyphs to be drawn outside them), so we do not
    // adjust the top/bottom of interior line-boxes.
    if (start == 0) {
      fm.top = fm.ascent
    }
    if (end == text.length) {
      fm.bottom = fm.descent
    }
  }
}
