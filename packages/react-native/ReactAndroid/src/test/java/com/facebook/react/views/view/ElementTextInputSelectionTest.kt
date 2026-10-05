/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.app.Activity
import org.assertj.core.api.Assertions.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

/**
 * Where the caret lands when a value is WRITTEN decides what an overflowing
 * field shows: on an unfocused EditText the selection also sets the scroll
 * position, so a caret parked at the end scrolled every long value to its TAIL
 * — `<input readOnly value="You can select this, not edit it"/>` rendered as
 * ":an select this, not edit it" while a browser, a UITextField and Android's
 * own unfocused fields all show the START. The caret belongs at the end only
 * once the field is focused.
 */
@RunWith(RobolectricTestRunner::class)
class ElementTextInputSelectionTest {

  private fun view(): ElementTextInputView {
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    return ElementTextInputView(activity)
  }

  @Test
  fun `an unfocused write parks the caret at the start, so the value shows its head`() {
    val input = view()
    input.propValue = "You can select this, not edit it"
    input.commitProps()
    assertThat(input.isFocused).isFalse()
    assertThat(input.selectionStart).isEqualTo(0)
    assertThat(input.selectionEnd).isEqualTo(0)
  }

  @Test
  fun `a focused write parks the caret at the end, where a replaced value leaves it`() {
    val input = view()
    input.requestFocus()
    input.propValue = "You can select this, not edit it"
    input.commitProps()
    assertThat(input.isFocused).isTrue()
    assertThat(input.selectionEnd).isEqualTo(input.text?.length ?: -1)
  }

  @Test
  fun `the unfocused default-value seed also shows its head`() {
    val input = view()
    input.propDefaultValue = "a default long enough to overflow a narrow field"
    input.commitProps()
    assertThat(input.selectionStart).isEqualTo(0)
  }
}
