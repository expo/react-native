/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.bridge

import android.graphics.Color
import android.graphics.ColorSpace
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.data.Offset
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** A color in its own space becomes a color long whose platform conversion agrees with CSS */
@RunWith(RobolectricTestRunner::class)
class ColorSpaceColorsTest {

  private val extendedSRGB = ColorSpace.get(ColorSpace.Named.EXTENDED_SRGB)

  private fun rgb(space: String, r: Double, g: Double, b: Double): ReadableMap =
      JavaOnlyMap.of("space", space, "r", r, "g", g, "b", b, "alpha", 1.0)

  // The color as extended sRGB, converted by the platform
  private fun inSRGB(color: Long?): List<Float> {
    val converted = Color.convert(checkNotNull(color), extendedSRGB)
    return listOf(Color.red(converted), Color.green(converted), Color.blue(converted))
  }

  private fun assertSRGBRed(color: Long?) {
    val (r, g, b) = inSRGB(color)
    assertThat(r).isCloseTo(1f, Offset.offset(0.01f))
    assertThat(g).isCloseTo(0f, Offset.offset(0.01f))
    assertThat(b).isCloseTo(0f, Offset.offset(0.01f))
  }

  @Test
  fun aDisplayP3ColorIsPackedInThePlatformsDisplayP3() {
    val color = ColorSpaceColors.toColorLong(rgb("display-p3", 1.0, 0.0, 0.0))

    assertThat(Color.colorSpace(checkNotNull(color)))
        .isEqualTo(ColorSpace.get(ColorSpace.Named.DISPLAY_P3))
    assertThat(Color.red(color)).isEqualTo(1f)
    // P3's red is outside sRGB, so in extended sRGB it is redder than 1 (CSS Color 4 §10.4)
    assertThat(inSRGB(color)[0]).isGreaterThan(1.05f)
  }

  @Test
  fun everySpellingOfSRGBRedIsSRGBRed() {
    assertSRGBRed(ColorSpaceColors.toColorLong(rgb("srgb", 1.0, 0.0, 0.0)))
    assertSRGBRed(ColorSpaceColors.toColorLong(rgb("srgb-linear", 1.0, 0.0, 0.0)))
    assertSRGBRed(
        ColorSpaceColors.toColorLong(
            JavaOnlyMap.of("space", "oklch", "l", 0.62796, "c", 0.25768, "h", 29.2339, "alpha", 1.0)
        )
    )
    assertSRGBRed(
        ColorSpaceColors.toColorLong(
            JavaOnlyMap.of("space", "oklab", "l", 0.62796, "a", 0.22486, "b", 0.12585, "alpha", 1.0)
        )
    )
    assertSRGBRed(
        ColorSpaceColors.toColorLong(
            JavaOnlyMap.of("space", "lab", "l", 54.2905, "a", 80.8049, "b", 69.891, "alpha", 1.0)
        )
    )
    assertSRGBRed(
        ColorSpaceColors.toColorLong(
            JavaOnlyMap.of("space", "lch", "l", 54.2905, "c", 106.8371, "h", 40.8526, "alpha", 1.0)
        )
    )
    assertSRGBRed(
        ColorSpaceColors.toColorLong(
            JavaOnlyMap.of(
                "space",
                "xyz-d65",
                "x",
                0.41239,
                "y",
                0.21264,
                "z",
                0.01933,
                "alpha",
                1.0,
            )
        )
    )
  }

  @Test
  fun aLinearSpaceAndItsEncodedSpaceAgreeAtTheirEnds() {
    val linear = inSRGB(ColorSpaceColors.toColorLong(rgb("display-p3-linear", 1.0, 0.0, 0.0)))
    val encoded = inSRGB(ColorSpaceColors.toColorLong(rgb("display-p3", 1.0, 0.0, 0.0)))
    for (index in 0..2) {
      assertThat(linear[index]).isCloseTo(encoded[index], Offset.offset(0.001f))
    }
  }

  @Test
  fun alphaIsReadFromAlphaOrFromAnRGBObjectsA() {
    val withAlpha =
        JavaOnlyMap.of("space", "display-p3", "r", 1.0, "g", 0.0, "b", 0.0, "alpha", 0.5)
    val withA = JavaOnlyMap.of("space", "display-p3", "r", 1.0, "g", 0.0, "b", 0.0, "a", 0.25)
    // A color long keeps alpha in 10 bits
    assertThat(Color.alpha(checkNotNull(ColorSpaceColors.toColorLong(withAlpha))))
        .isCloseTo(0.5f, Offset.offset(0.001f))
    assertThat(Color.alpha(checkNotNull(ColorSpaceColors.toColorLong(withA))))
        .isCloseTo(0.25f, Offset.offset(0.001f))
  }

  @Test
  fun inLabTheAChannelIsNeverAlpha() {
    val lab = JavaOnlyMap.of("space", "lab", "l", 50.0, "a", 0.25, "b", 0.0)
    assertThat(Color.alpha(checkNotNull(ColorSpaceColors.toColorLong(lab)))).isEqualTo(1f)
  }

  @Test
  fun aSpaceTheDeviceDoesntProvideIsNotShown() {
    assertThat(ColorSpaceColors.toColorLong(rgb("--gray-linear", 0.5, 0.5, 0.5))).isNull()
    assertThat(ColorSpaceColors.toColorLong(rgb("--nowhere", 1.0, 0.0, 0.0))).isNull()
    assertThat(ColorSpaceColors.toColorLong(JavaOnlyMap.of("r", 1.0))).isNull()
  }

  @Test
  fun everyColorLongIsInAnRGBSpaceAPaintCanDraw() {
    for (color in
        listOf(
            JavaOnlyMap.of("space", "lab", "l", 50.0, "a", 20.0, "b", -30.0),
            JavaOnlyMap.of("space", "oklch", "l", 0.7, "c", 0.2, "h", 30.0),
            JavaOnlyMap.of("space", "xyz-d50", "x", 0.2, "y", 0.3, "z", 0.4),
            rgb("display-p3-linear", 1.0, 0.0, 0.0),
        )) {
      val colorLong = checkNotNull(ColorSpaceColors.toColorLong(color))
      assertThat(Color.colorSpace(colorLong).model).isEqualTo(ColorSpace.Model.RGB)
    }
  }

  @Test
  fun labIsUnboundedAsCSSMakesIt() {
    // Beyond Android's CIE Lab range of ±128, which would clamp it
    val far =
        inSRGB(
            ColorSpaceColors.toColorLong(
                JavaOnlyMap.of("space", "lab", "l", 50.0, "a", 150.0, "b", 0.0)
            )
        )
    val near =
        inSRGB(
            ColorSpaceColors.toColorLong(
                JavaOnlyMap.of("space", "lab", "l", 50.0, "a", 120.0, "b", 0.0)
            )
        )
    assertThat(far[0]).isGreaterThan(near[0])
  }

  @Test
  fun anIntegerColorIsAnIntegerColorLong() {
    assertThat(ColorPropConverter.isIntegerColor(Color.pack(Color.RED))).isTrue()
    assertThat(
            ColorPropConverter.isIntegerColor(
                checkNotNull(ColorSpaceColors.toColorLong(rgb("display-p3", 1.0, 0.0, 0.0)))
            )
        )
        .isFalse()
  }
}
