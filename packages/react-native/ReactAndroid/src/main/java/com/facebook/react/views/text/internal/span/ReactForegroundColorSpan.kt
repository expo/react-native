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
import android.text.style.ForegroundColorSpan
import androidx.annotation.ColorLong

/**
 * Wraps [ForegroundColorSpan] as a [ReactSpan]. A color written in its own color space also
 * carries its color long, which the paint takes where the OS can draw one; [getForegroundColor]
 * stays its sRGB approximation for everything that reads the integer.
 */
internal class ReactForegroundColorSpan(
    color: Int,
    @ColorLong val colorLong: Long? = null,
) : ForegroundColorSpan(color), ReactSpan {

  internal companion object {
    // Whether the text draws a color written in its own color space
    fun hasColorLong(text: CharSequence): Boolean =
        text is Spanned &&
            text.getSpans(0, text.length, ReactForegroundColorSpan::class.java).any {
              it.colorLong != null
            }
  }

  override fun updateDrawState(textPaint: TextPaint) {
    super.updateDrawState(textPaint)
    if (colorLong != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      textPaint.setColor(colorLong)
    }
  }
}
