/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.common.assets

import android.graphics.Typeface
import org.assertj.core.api.Assertions.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ReactFontManagerTest {

  @Test
  fun aGenericFamilyStandsForThePlatformsOwn() {
    val manager = ReactFontManager.getInstance()
    assertThat(manager.firstAvailableFontFamily("system-ui", null)).isEqualTo("sans-serif")
    assertThat(manager.firstAvailableFontFamily("-apple-system", null)).isEqualTo("sans-serif")
    assertThat(manager.firstAvailableFontFamily("ui-monospace", null)).isEqualTo("monospace")
    assertThat(manager.firstAvailableFontFamily("serif", null)).isEqualTo("serif")
  }

  @Test
  fun aListTakesTheFirstFamilyTheAppHas() {
    val manager = ReactFontManager.getInstance()
    manager.addCustomFont("Figtree", Typeface.DEFAULT)
    assertThat(manager.firstAvailableFontFamily("Figtree, -apple-system, sans-serif", null))
        .isEqualTo("Figtree")
    // Quotes come off, as CSS reads them
    assertThat(manager.firstAvailableFontFamily("'Figtree', \"Segoe UI\", sans-serif", null))
        .isEqualTo("Figtree")
    // A generic family is always had
    assertThat(manager.firstAvailableFontFamily("monospace, Figtree", null))
        .isEqualTo("monospace")
  }

  @Test
  fun aPlainNameIsLeftAsItIs() {
    val manager = ReactFontManager.getInstance()
    assertThat(manager.firstAvailableFontFamily("Roboto", null)).isEqualTo("Roboto")
  }
}
