/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text

import android.text.Layout
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.common.mapbuffer.MapBuffer
import com.facebook.react.common.mapbuffer.WritableMapBuffer
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.facebook.yoga.YogaMeasureMode
import org.assertj.core.api.Assertions.assertThat
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.GraphicsMode
import kotlin.math.ceil

/**
 * The measure pass parks a run's layout for the mounting layer along with the spannable it was
 * built from. A run under a line limit (`line-clamp`, `text-overflow`) is laid out with an ellipsis,
 * and such a layout's `text` is the platform's ellipsizer over the spannable rather than the
 * spannable itself, so the spannable has to be handed off as well as the layout: read back from
 * the layout, it crashed the mount of every truncated run.
 */
@OptIn(UnstableReactNativeAPI::class)
@RunWith(RobolectricTestRunner::class)
// Real text metrics, without which nothing wraps and nothing is cut short
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class TextLayoutManagerRunHandoffTest {
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
  fun `a truncated run hands off the spannable its layout was built from`() {
    measure(runAttributedString(TEXT), paragraphAttributes(maximumNumberOfLines = 1))

    val entry = checkNotNull(RunLayoutHandoff.take(RUN_TAG))
    // The premise: the layout was cut short with an ellipsis
    assertThat(entry.layout.getEllipsisCount(0)).isGreaterThan(0)
    assertThat(entry.spannable.toString()).isEqualTo(TEXT)
  }

  @Test
  fun `a run measured on one line is not reused in a box its line does not fit`() {
    // The measurement a max-content probe makes, which can be the last one before the mount
    measure(runAttributedString(TEXT), paragraphAttributes(), YogaMeasureMode.UNDEFINED)

    val entry = checkNotNull(RunLayoutHandoff.take(RUN_TAG))
    // The premise: one line, broken nowhere
    assertThat(entry.layout.lineCount).isEqualTo(1)
    assertThat(entry.notSoftWrapped).isTrue()
    val fits = ceil(entry.longestLine).toInt()
    assertThat(entry.paintsAsRebuiltAt(fits / 2, Layout.Alignment.ALIGN_NORMAL, 0, false))
        .isFalse()
    assertThat(entry.paintsAsRebuiltAt(fits, Layout.Alignment.ALIGN_NORMAL, 0, false)).isTrue()
    assertThat(entry.paintsAsRebuiltAt(fits * 2, Layout.Alignment.ALIGN_NORMAL, 0, false))
        .isTrue()
  }

  @Test
  fun `a run that does not wrap is reused in a box its line overflows`() {
    measure(runAttributedString(TEXT), paragraphAttributes(), YogaMeasureMode.UNDEFINED)

    val entry = checkNotNull(RunLayoutHandoff.take(RUN_TAG))
    val fits = ceil(entry.longestLine).toInt()
    assertThat(entry.paintsAsRebuiltAt(fits / 2, Layout.Alignment.ALIGN_NORMAL, 0, true)).isTrue()
  }

  @Test
  fun `a run with no line limit hands off the spannable its layout was built from`() {
    measure(runAttributedString(TEXT), paragraphAttributes())

    val entry = checkNotNull(RunLayoutHandoff.take(RUN_TAG))
    assertThat(entry.layout.lineCount).isGreaterThan(1)
    assertThat(entry.spannable.toString()).isEqualTo(TEXT)
  }

  private fun runAttributedString(text: String): MapBuffer {
    val fragment =
        WritableMapBuffer().apply {
          put(TextLayoutManager.FR_KEY_STRING, text)
          put(TextLayoutManager.FR_KEY_TEXT_ATTRIBUTES, textAttributes())
        }
    return WritableMapBuffer().apply {
      put(TextLayoutManager.AS_KEY_FRAGMENTS, WritableMapBuffer().apply { put(0, fragment) })
      put(TextLayoutManager.AS_KEY_BASE_ATTRIBUTES, textAttributes())
      put(TextLayoutManager.AS_KEY_RUN_TAG, RUN_TAG)
    }
  }

  // A real font size: `TextAttributeProps` rejects the -1 an empty map would leave
  private fun textAttributes(): WritableMapBuffer =
      WritableMapBuffer().apply { put(TextAttributeProps.TA_KEY_FONT_SIZE, 16.0) }

  // The two keys the layout reads without a presence check, and the line limit with its ellipsis
  private fun paragraphAttributes(maximumNumberOfLines: Int = 0): WritableMapBuffer =
      WritableMapBuffer().apply {
        put(TextLayoutManager.PA_KEY_TEXT_BREAK_STRATEGY, "highQuality")
        put(TextLayoutManager.PA_KEY_HYPHENATION_FREQUENCY, "none")
        if (maximumNumberOfLines > 0) {
          put(TextLayoutManager.PA_KEY_MAX_NUMBER_OF_LINES, maximumNumberOfLines)
          put(TextLayoutManager.PA_KEY_ELLIPSIZE_MODE, "tail")
        }
      }

  // By default narrow enough that the text wraps, which a line limit of one then cuts short
  private fun measure(
      attributed: MapBuffer,
      paragraph: MapBuffer,
      widthMode: YogaMeasureMode = YogaMeasureMode.AT_MOST,
  ): Long =
      TextLayoutManager.measureText(
          RuntimeEnvironment.getApplication().assets,
          0,
          attributed,
          paragraph,
          120f,
          widthMode,
          0f,
          YogaMeasureMode.UNDEFINED,
          null,
          null,
      )

  private companion object {
    const val RUN_TAG = 4242
    const val TEXT = "A run long enough to be cut short by its line limit"
  }
}
