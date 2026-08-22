/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.bridge

import android.graphics.Color
import org.assertj.core.api.Assertions.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/*
 * Tests for [ColorPropConverter], in particular for theme attributes backed by a
 * ColorStateList: `Theme.resolveAttribute` leaves a colour in `TypedValue.data`
 * only when the attribute is a literal colour; for a ColorStateList `data` holds
 * a resource ID, which must not be read as ARGB.
 */
@RunWith(RobolectricTestRunner::class)
class ColorPropConverterTest {

  private val context: android.content.Context = RuntimeEnvironment.getApplication()

  /**
   * The attribute names the user-agent stylesheet ships, kept in step with `CANVAS_TEXT` and
   * `DISABLED_TEXT_COLOR` in `expo-intrinsics`: `ThemedDefaults-itest` asserts the stylesheet hands
   * these names down, this asserts the platform accepts them
   */
  @Test
  fun theAttributesTheUserAgentStylesheetAsksForAllResolve() {
    for (attribute in listOf("?android:attr/textColorPrimary", "?android:attr/textColorTertiary")) {
      val result = ColorPropConverter.resolveResourcePath(context, attribute)

      assertThat(result).describedAs("%s resolved to nothing", attribute).isNotNull
      // Opacity is the assertion: a wrong value reads as invisible text
      assertThat(Color.alpha(checkNotNull(result)))
          .describedAs("%s resolved to a transparent colour", attribute)
          .isEqualTo(255)
    }
  }

  @Test
  fun themeAttributeBackedByAColorStateListResolvesToAnOpaqueColor() {
    // `textColorPrimary` is a ColorStateList on every platform theme
    val result = ColorPropConverter.resolveResourcePath(context, "?android:attr/textColorPrimary")

    assertThat(result).isNotNull
    // Any real text colour is opaque; asserting on the alpha rather than an
    // exact colour keeps this true across themes and platform versions
    assertThat(Color.alpha(checkNotNull(result))).isEqualTo(255)
  }

  @Test
  fun aLiteralColorAttributeStillResolves() {
    // An attribute holding a colour directly comes back from `TypedValue.data`
    // untouched
    val result = ColorPropConverter.resolveResourcePath(context, "?android:attr/colorBackground")

    assertThat(result).isNotNull
    assertThat(Color.alpha(checkNotNull(result))).isEqualTo(255)
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
}
