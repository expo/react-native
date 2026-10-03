/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text

import org.assertj.core.api.Assertions.assertThat
import org.junit.Test

/**
 * An atomic inline's placeholder must cover the pixels its box was laid out at.
 *
 * The placeholder's size comes back as the attachment's frame and its run's width, and the box is
 * laid out again at it. A size a hair under a whole pixel after the dp -> px conversion was
 * truncated, so a `<button>` was laid out a pixel narrower than its content and its label wrapped.
 */
class TextInlinePlaceholderSizeTest {

  @Test
  fun `a size a hair under a whole pixel covers that pixel`() {
    // A 202px `<button>` at 2.625 is 76.952377dp, which converts back a hair under 202
    val roundTripped = 76.952377f * 2.625f

    assertThat(roundTripped).isLessThan(202f)
    assertThat(TextLayoutManager.wholePixelsCovering(roundTripped)).isEqualTo(202)
  }

  @Test
  fun `a fractional size is never shrunk`() {
    assertThat(TextLayoutManager.wholePixelsCovering(201.4f)).isEqualTo(202)
    assertThat(TextLayoutManager.wholePixelsCovering(202f)).isEqualTo(202)
  }
}
