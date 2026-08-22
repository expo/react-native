/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.bridge

import android.content.Context
import android.graphics.Color
import android.view.ContextThemeWrapper
import org.assertj.core.api.Assertions.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/** Tests for [ColorPropConverter] */
@RunWith(RobolectricTestRunner::class)
class ColorPropConverterTest {

  private lateinit var context: Context

  @Before
  fun setUp() {
    context =
        ContextThemeWrapper(
            RuntimeEnvironment.getApplication(),
            androidx.appcompat.R.style.Theme_AppCompat,
        )
  }

  @Test
  fun themeAttributeResolvesColor() {
    val result = ColorPropConverter.resolveResourcePath(context, "?android:attr/colorAccent")

    assertThat(result).isEqualTo(themeColor(android.R.attr.colorAccent))
  }

  @Test
  fun themeAttributeResolvesColorStateListToDefaultColor() {
    val result = ColorPropConverter.resolveResourcePath(context, "?attr/textColorPrimary")

    assertThat(result).isEqualTo(themeColor(android.R.attr.textColorPrimary))
  }

  /**
   * The attribute names the user-agent stylesheet ships, kept in step with `CANVAS_TEXT` and
   * `DISABLED_TEXT_COLOR` in `expo-intrinsics`: `ThemedDefaults-itest` asserts the stylesheet hands
   * these names down, this asserts the platform accepts them
   */
  @Test
  fun theAttributesTheUserAgentStylesheetAsksForAllResolve() {
    for ((path, attribute) in
        listOf(
            "?android:attr/textColorPrimary" to android.R.attr.textColorPrimary,
            "?android:attr/textColorTertiary" to android.R.attr.textColorTertiary,
        )) {
      val result = ColorPropConverter.resolveResourcePath(context, path)

      assertThat(result).describedAs(path).isEqualTo(themeColor(attribute))
    }
  }

  @Test
  fun colorResourcesStillResolve() {
    val result = ColorPropConverter.resolveResourcePath(context, "@android:color/black")

    assertThat(result).isEqualTo(Color.BLACK)
  }

  @Test
  fun anUnknownAttributeIsNullRatherThanAThrow() {
    val result = ColorPropConverter.resolveResourcePath(context, "?android:attr/notAnAttribute")

    assertThat(result).isNull()
  }

  @Test
  fun emptyAndNullPathsAreNull() {
    assertThat(ColorPropConverter.resolveResourcePath(context, null)).isNull()
    assertThat(ColorPropConverter.resolveResourcePath(context, "")).isNull()
  }

  private fun themeColor(attr: Int): Int {
    val typedArray = context.obtainStyledAttributes(intArrayOf(attr))
    val color = typedArray.getColor(0, 0)
    typedArray.recycle()
    return color
  }
}
