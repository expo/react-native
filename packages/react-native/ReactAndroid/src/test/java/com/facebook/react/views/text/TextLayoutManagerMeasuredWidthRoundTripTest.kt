/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text

import android.annotation.SuppressLint
import android.text.BoringLayout
import android.text.Layout
import android.text.SpannableString
import android.text.TextPaint
import android.text.TextUtils
import com.facebook.yoga.YogaMeasureMode
import kotlin.math.ceil
import org.assertj.core.api.Assertions.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Text measured at the width it reported must fit on the same line again. A measured width leaves
 * the text engine as whole pixels over the density and returns a hair short (330px at 2.625 is
 * 125.714286dp, which comes back as 329.99997px); flooring that AT_MOST width loses the pixel the
 * text was measured at and wraps it.
 */
@RunWith(RobolectricTestRunner::class)
class TextLayoutManagerMeasuredWidthRoundTripTest {

  @Test
  fun `AT_MOST at a measured width short by float error keeps the text on its line`() {
    val text = SpannableString("Enabled compare")
    val paint = TextPaint(TextPaint.ANTI_ALIAS_FLAG).apply { textSize = 16f }
    val measuredPixels = ceil(Layout.getDesiredWidth(text, paint))
    val density = 2.625f
    val roundTripped = (measuredPixels / density) * density - 0.00003f

    val layout = invokeCreateLayout(text, roundTripped, paint, YogaMeasureMode.AT_MOST)

    assertThat(layout.lineCount).isEqualTo(1)
    assertThat(layout.width.toFloat()).isGreaterThanOrEqualTo(layout.getLineWidth(0))
  }

  @Test
  fun `AT_MOST a whole pixel short stays a pixel short`() {
    val text = SpannableString("Enabled compare")
    val paint = TextPaint(TextPaint.ANTI_ALIAS_FLAG).apply { textSize = 16f }
    val measuredPixels = ceil(Layout.getDesiredWidth(text, paint))

    val layout = invokeCreateLayout(text, measuredPixels - 1f, paint, YogaMeasureMode.AT_MOST)

    assertThat(layout.width.toFloat()).isEqualTo(measuredPixels - 1f)
  }

  @SuppressLint("InlinedApi")
  private fun invokeCreateLayout(
      text: SpannableString,
      width: Float,
      paint: TextPaint,
      mode: YogaMeasureMode,
  ): Layout {
    val boring: BoringLayout.Metrics? = BoringLayout.isBoring(text, paint)
    val method =
        TextLayoutManager::class
            .java
            .getDeclaredMethod(
                "createLayout",
                android.text.Spannable::class.java,
                BoringLayout.Metrics::class.java,
                java.lang.Float.TYPE,
                YogaMeasureMode::class.java,
                java.lang.Boolean.TYPE,
                java.lang.Integer.TYPE,
                java.lang.Integer.TYPE,
                Layout.Alignment::class.java,
                java.lang.Integer.TYPE,
                TextUtils.TruncateAt::class.java,
                java.lang.Integer.TYPE,
                TextPaint::class.java,
                FloatArray::class.java,
            )
            .apply { isAccessible = true }

    return method.invoke(
        TextLayoutManager,
        text,
        boring,
        width,
        mode,
        /* includeFontPadding = */ false,
        /* textBreakStrategy = */ Layout.BREAK_STRATEGY_HIGH_QUALITY,
        /* hyphenationFrequency = */ Layout.HYPHENATION_FREQUENCY_NONE,
        Layout.Alignment.ALIGN_NORMAL,
        /* justificationMode = */ 0,
        /* ellipsizeMode = */ null,
        /* maxNumberOfLines = */ 2,
        paint,
        /* floatExclusionsDip = */ null,
    ) as Layout
  }
}
