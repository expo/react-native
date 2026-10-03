/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text

import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.common.mapbuffer.MapBuffer
import com.facebook.react.common.mapbuffer.WritableMapBuffer
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.facebook.yoga.YogaMeasureMode
import com.facebook.yoga.YogaMeasureOutput
import org.assertj.core.api.Assertions.assertThat
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * A run with no characters has no line box, so it measures as nothing — as it does on iOS, whose
 * measurer returns a zero size for an empty string. StaticLayout lays "" out as one line of the
 * paint's font metrics, which is where an empty `<span>` beside its `<div>` got a line of height on
 * Android alone.
 */
@OptIn(UnstableReactNativeAPI::class)
@RunWith(RobolectricTestRunner::class)
class TextLayoutManagerEmptyRunTest {
  @Before
  fun setUp() {
    ReactNativeFeatureFlagsForTests.setUp()
    DisplayMetricsHolder.initDisplayMetrics(RuntimeEnvironment.getApplication())
  }

  @After
  fun tearDown() {
    DisplayMetricsHolder.setScreenDisplayMetrics(null)
  }

  @Test
  fun `a run with no characters measures as nothing`() {
    val size = measure(attributedString())
    assertThat(YogaMeasureOutput.getWidth(size)).isEqualTo(0f)
    assertThat(YogaMeasureOutput.getHeight(size)).isEqualTo(0f)
  }

  @Test
  fun `an empty run keeps the dimensions the caller fixed`() {
    val size =
        measure(
            attributedString(),
            widthMode = YogaMeasureMode.EXACTLY,
            width = 120f,
            heightMode = YogaMeasureMode.EXACTLY,
            height = 30f,
        )
    assertThat(YogaMeasureOutput.getWidth(size)).isEqualTo(120f)
    assertThat(YogaMeasureOutput.getHeight(size)).isEqualTo(30f)
  }

  @Test
  fun `one character is a line tall`() {
    val size = measure(attributedString(fragment("x")))
    assertThat(YogaMeasureOutput.getHeight(size)).isGreaterThan(0f)
  }

  private fun fragment(text: String): WritableMapBuffer =
      WritableMapBuffer().apply {
        put(TextLayoutManager.FR_KEY_STRING, text)
        put(TextLayoutManager.FR_KEY_TEXT_ATTRIBUTES, textAttributes())
      }

  // A real font size: `TextAttributeProps` rejects the -1 an empty map would leave
  private fun textAttributes(): WritableMapBuffer =
      WritableMapBuffer().apply { put(TextAttributeProps.TA_KEY_FONT_SIZE, 16.0) }

  private fun attributedString(vararg fragments: WritableMapBuffer): MapBuffer {
    val list = WritableMapBuffer()
    fragments.forEachIndexed { i, f -> list.put(i, f) }
    return WritableMapBuffer().apply {
      put(TextLayoutManager.AS_KEY_FRAGMENTS, list)
      put(TextLayoutManager.AS_KEY_BASE_ATTRIBUTES, textAttributes())
    }
  }

  // The two keys the layout reads without a presence check
  private fun paragraphAttributes(): WritableMapBuffer =
      WritableMapBuffer().apply {
        put(TextLayoutManager.PA_KEY_TEXT_BREAK_STRATEGY, "highQuality")
        put(TextLayoutManager.PA_KEY_HYPHENATION_FREQUENCY, "none")
      }

  // Robolectric's display density is 1, so the pixels in and the points out agree
  private fun measure(
      attributed: MapBuffer,
      width: Float = 300f,
      widthMode: YogaMeasureMode = YogaMeasureMode.AT_MOST,
      height: Float = 0f,
      heightMode: YogaMeasureMode = YogaMeasureMode.UNDEFINED,
  ): Long =
      TextLayoutManager.measureText(
          RuntimeEnvironment.getApplication().assets,
          0,
          attributed,
          paragraphAttributes(),
          width,
          widthMode,
          height,
          heightMode,
          null,
          null,
      )
}
