/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.uimanager.drawable

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorSpace
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.view.View
import com.facebook.react.uimanager.BackgroundStyleApplicator
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.facebook.react.uimanager.style.LogicalEdge
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.data.Offset
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.kotlin.any
import org.mockito.kotlin.doAnswer
import org.mockito.kotlin.mock
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.GraphicsMode

/**
 * Tests that a border color written in its own color space is painted in that space, edge by edge,
 * and that integer colors still paint as the integers they are.
 */
@RunWith(RobolectricTestRunner::class)
// Paint keeps a color long only with the platform's own graphics
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class BorderDrawableColorLongTest {

  private val p3Red = Color.pack(1f, 0f, 0f, 1f, ColorSpace.get(ColorSpace.Named.DISPLAY_P3))
  private val srgbBlue = Color.BLUE.toLong() shl 32

  @Before
  fun setUp() {
    DisplayMetricsHolder.initDisplayMetrics(RuntimeEnvironment.getApplication())
  }

  @Test
  fun aWideBorderPaintsItsColorLong() {
    val view = viewWithBorder()
    BackgroundStyleApplicator.setBorderColorLong(view, LogicalEdge.ALL, p3Red)

    assertThat(paintedColors(view)).isNotEmpty().allMatch { it == p3Red }
  }

  @Test
  fun anIntegerEdgeOverridesAWideColorOnItsEdgeOnly() {
    val view = viewWithBorder()
    BackgroundStyleApplicator.setBorderColorLong(view, LogicalEdge.ALL, p3Red)
    BackgroundStyleApplicator.setBorderColor(view, LogicalEdge.TOP, Color.BLUE)

    val colors = paintedColors(view)
    assertThat(colors).hasSize(4)
    assertThat(colors.count { it == srgbBlue }).isEqualTo(1)
    assertThat(colors.count { it == p3Red }).isEqualTo(3)
  }

  @Test
  fun anSRGBColorLongIsSetAsItsInteger() {
    val view = viewWithBorder()
    BackgroundStyleApplicator.setBorderColorLong(view, LogicalEdge.ALL, srgbBlue)

    assertThat(BackgroundStyleApplicator.getBorderColor(view, LogicalEdge.ALL))
        .isEqualTo(Color.BLUE)
    assertThat(paintedColors(view)).isNotEmpty().allMatch { it == srgbBlue }
  }

  @Test
  fun theDrawablesAlphaScalesAWideColorsAlpha() {
    val view = viewWithBorder()
    BackgroundStyleApplicator.setBorderColorLong(view, LogicalEdge.ALL, p3Red)
    border(view).alpha = 51

    val colors = paintedColors(view)
    assertThat(colors).isNotEmpty()
    for (color in colors) {
      assertThat(Color.colorSpace(color)).isEqualTo(ColorSpace.get(ColorSpace.Named.DISPLAY_P3))
      assertThat(Color.red(color)).isEqualTo(1f)
      assertThat(Color.alpha(color)).isCloseTo(0.2f, Offset.offset(0.01f))
    }
  }

  @Test
  fun aWideColorReadsBackAsItsSRGBApproximation() {
    val view = viewWithBorder()
    BackgroundStyleApplicator.setBorderColorLong(view, LogicalEdge.ALL, p3Red)

    assertThat(BackgroundStyleApplicator.getBorderColor(view, LogicalEdge.ALL))
        .isEqualTo(Color.toArgb(p3Red))
  }

  private fun viewWithBorder(): View {
    val view = View(RuntimeEnvironment.getApplication())
    BackgroundStyleApplicator.setBorderWidth(view, LogicalEdge.ALL, 4f)
    return view
  }

  private fun border(view: View): BorderDrawable =
      checkNotNull((view.background as CompositeBackgroundDrawable).border)

  // The paint's color at each path the border draws
  private fun paintedColors(view: View): List<Long> {
    val colors = mutableListOf<Long>()
    val canvas =
        mock<Canvas> {
          on { drawPath(any<Path>(), any<Paint>()) } doAnswer
              {
                colors.add((it.arguments[1] as Paint).colorLong)
                null
              }
        }
    val border = border(view)
    border.bounds = Rect(0, 0, 100, 100)
    border.draw(canvas)
    return colors
  }
}
