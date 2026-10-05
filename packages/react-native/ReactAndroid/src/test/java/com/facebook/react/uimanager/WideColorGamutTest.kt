/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.uimanager

import android.graphics.Color
import android.graphics.ColorSpace
import org.assertj.core.api.Assertions.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Tests that a color brighter than SDR white is told apart from one that isn't */
@RunWith(RobolectricTestRunner::class)
class WideColorGamutTest {

  private fun inSpace(named: ColorSpace.Named, r: Float, g: Float, b: Float): Long =
      Color.pack(r, g, b, 1f, ColorSpace.get(named))

  @Test
  fun anIntegerColorIsNeverHDR() {
    assertThat(WideColorGamut.isHighDynamicRange(Color.WHITE.toLong() shl 32)).isFalse()
    assertThat(WideColorGamut.isHighDynamicRange(Color.RED.toLong() shl 32)).isFalse()
  }

  @Test
  fun whiteAndAWideSaturatedColorStayWithinSDR() {
    assertThat(WideColorGamut.isHighDynamicRange(inSpace(ColorSpace.Named.SRGB, 1f, 1f, 1f)))
        .isFalse()
    assertThat(WideColorGamut.isHighDynamicRange(inSpace(ColorSpace.Named.DISPLAY_P3, 1f, 1f, 1f)))
        .isFalse()
    // P3 red exceeds 1 only in sRGB's terms; it is inside linear Rec. 2020's unit cube
    assertThat(WideColorGamut.isHighDynamicRange(inSpace(ColorSpace.Named.DISPLAY_P3, 1f, 0f, 0f)))
        .isFalse()
    assertThat(WideColorGamut.isHighDynamicRange(inSpace(ColorSpace.Named.BT2020, 1f, 0f, 0f)))
        .isFalse()
  }

  @Test
  fun aLinearValueAboveOneIsHDR() {
    // A red four times sRGB's: dimmer than white, but beyond any SDR display's red
    assertThat(
            WideColorGamut.isHighDynamicRange(
                inSpace(ColorSpace.Named.LINEAR_EXTENDED_SRGB, 4f, 0f, 0f)
            )
        )
        .isTrue()
    assertThat(
            WideColorGamut.isHighDynamicRange(
                inSpace(ColorSpace.Named.LINEAR_EXTENDED_SRGB, 2f, 2f, 2f)
            )
        )
        .isTrue()
    assertThat(
            WideColorGamut.isHighDynamicRange(
                inSpace(ColorSpace.Named.LINEAR_EXTENDED_SRGB, 0.5f, 0.5f, 0.5f)
            )
        )
        .isFalse()
  }
}
