/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text.internal.span

import android.text.TextPaint
import android.text.style.MetricAffectingSpan

/**
 * Adds an inline element's inline-axis margin/border/padding to the advance of a single character
 * (box-model-scope.md G3).
 *
 * Applied to the character *preceding* an inline box for its leading space, and to the box's own
 * last character for its trailing space — never to a character added for the purpose. The string
 * backing a text run is also what accessibility and clipboard copy read, so a zero-width spacer
 * inserted for layout would leak into text the user reads and copies.
 *
 * `letterSpacing` is em-relative and Android applies it after every character in the span's range,
 * so covering exactly one character with `spacingPx / textSize` yields exactly `spacingPx` of extra
 * advance. It is *added* to whatever spacing is already on the paint so an authored `letterSpacing`
 * survives.
 */
internal class InlineBoxSpacingSpan(private val spacingPx: Float) : MetricAffectingSpan(), ReactSpan {
  override fun updateDrawState(paint: TextPaint) {
    apply(paint)
  }

  override fun updateMeasureState(paint: TextPaint) {
    apply(paint)
  }

  private fun apply(paint: TextPaint) {
    if (spacingPx.isNaN() || paint.textSize <= 0f) {
      return
    }
    paint.letterSpacing += spacingPx / paint.textSize
  }
}
