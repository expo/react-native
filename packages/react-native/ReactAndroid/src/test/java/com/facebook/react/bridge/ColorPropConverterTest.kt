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

/**
 * Tests for [ColorPropConverter], and in particular for theme attributes.
 *
 * `PlatformColor('?android:attr/textColorTertiary')` used to come back as an
 * almost fully transparent colour, so text painted with it laid out correctly
 * and was invisible. `Theme.resolveAttribute` had been trusted to leave a colour
 * in `TypedValue.data`, which it only does when the attribute IS a literal
 * colour; the platform's text colours are ColorStateLists, and for those `data`
 * holds a resource ID that was being reinterpreted as ARGB.
 */
@RunWith(RobolectricTestRunner::class)
class ColorPropConverterTest {

  private val context: android.content.Context = RuntimeEnvironment.getApplication()

  /**
   * The attribute names the user-agent stylesheet actually ships.
   *
   * Kept in step with `CANVAS_TEXT` and `DISABLED_TEXT_COLOR` in
   * `expo-intrinsics`. That side asserts the stylesheet hands these exact names
   * down (`ThemedDefaults-itest`); this side asserts the platform accepts them.
   * Neither test is sufficient alone — one would pass on a typo, the other
   * would not notice the stylesheet asking for something else.
   */
  @Test
  fun theAttributesTheUserAgentStylesheetAsksForAllResolve() {
    for (attribute in
        listOf("?android:attr/textColorPrimary", "?android:attr/textColorTertiary")) {
      val result = ColorPropConverter.resolveResourcePath(context, attribute)

      assertThat(result).describedAs("%s resolved to nothing", attribute).isNotNull
      // Invisible text is what the bug looked like, so opacity is the assertion.
      assertThat(Color.alpha(checkNotNull(result)))
          .describedAs("%s resolved to a transparent colour", attribute)
          .isEqualTo(255)
    }
  }

  @Test
  fun themeAttributeBackedByAColorStateListResolvesToAnOpaqueColor() {
    // `textColorPrimary` is a ColorStateList on every platform theme, which is
    // the case that used to return a resource ID dressed up as a colour.
    val result =
        ColorPropConverter.resolveResourcePath(context, "?android:attr/textColorPrimary")

    assertThat(result).isNotNull
    // The bug produced a value whose alpha was ~0. Any real text colour is
    // opaque, and asserting on the alpha rather than an exact colour keeps this
    // true across themes and platform versions.
    assertThat(Color.alpha(checkNotNull(result))).isEqualTo(255)
  }

  @Test
  fun aLiteralColorAttributeStillResolves() {
    // The path that always worked: an attribute holding a colour directly must
    // keep coming back from `TypedValue.data` untouched.
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
