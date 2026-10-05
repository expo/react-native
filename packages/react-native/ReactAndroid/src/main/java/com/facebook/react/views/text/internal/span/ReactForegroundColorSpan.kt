/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text.internal.span

import android.os.Build
import android.text.Spanned
import android.text.TextPaint
import android.text.style.CharacterStyle
import android.text.style.UpdateAppearance
import androidx.annotation.ColorLong

/**
 * Draws its run in [foregroundColor]. A color in its own space also carries its color long, which
 * the paint takes where the OS can; [foregroundColor] stays its sRGB approximation.
 */
internal class ReactForegroundColorSpan(
    val foregroundColor: Int,
    @ColorLong val colorLong: Long? = null,
    // The `dynamic-range-limit` the text inherits; null with color spaces off
    val dynamicRangeLimit: String? = null,
) : CharacterStyle(), UpdateAppearance, ReactSpan {

  internal companion object {
    fun hasColorLong(text: CharSequence): Boolean =
        text is Spanned &&
            text.getSpans(0, text.length, ReactForegroundColorSpan::class.java).any {
              it.colorLong != null
            }
  }

  override fun updateDrawState(textPaint: TextPaint) {
    textPaint.color = foregroundColor
    if (colorLong != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      textPaint.setColor(colorLong)
    }
  }
}
