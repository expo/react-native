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

  /*
   * The two above are about a field being GIVEN a value from empty, where there
   * is no caret worth preserving. These are about the write a controlled field
   * actually makes on every keystroke: a handler clamps or transforms a few
   * characters, and the rest of the buffer — including whatever is under the
   * caret — does not move.
   *
   * Parking the caret at the end on those writes is what makes a controlled
   * field feel foreign: type into the middle of `slice(0, 10)`-capped text and
   * the caret leaves with each keystroke. iOS answers this with
   * `replaceRange:withText:` (`EXPWriteTextPreservingCaret`); this is the same
   * rule through `Editable.replace`, so both platforms keep the cursor stable
   * for the same reason — nothing under it changed.
   */

  private fun focusedWith(text: String): ElementTextInputView {
    val input = view()
    input.requestFocus()
    input.propValue = text
    input.commitProps()
    return input
  }

  @Test
  fun `a clamp after the caret leaves the caret where it was`() {
    val input = focusedWith("0123456789X")
    input.setSelection(3)

    // The eleventh character is refused by the author's state; everything
    // before the caret is untouched, so the caret must not move.
    input.propValue = "0123456789"
    input.commitProps()

    assertThat(input.text?.toString()).isEqualTo("0123456789")
    assertThat(input.selectionStart).isEqualTo(3)
  }

  @Test
  fun `an edit before the caret carries it along`() {
    val input = focusedWith("abcdef")
    input.setSelection(6)

    input.propValue = "XXabcdef"
    input.commitProps()

    assertThat(input.text?.toString()).isEqualTo("XXabcdef")
    assertThat(input.selectionStart).isEqualTo(8)
  }

  @Test
  fun `an unchanged value is not written at all`() {
    val input = focusedWith("0123456789")
    input.setSelection(4)

    // The common case for a controlled field: the author echoes the value back
    // unchanged on every keystroke.
    input.propValue = "0123456789"
    input.commitProps()

    assertThat(input.selectionStart).isEqualTo(4)
  }

  @Test
  fun `a surrogate pair is not split`() {
    val input = focusedWith("a\uD83D\uDC4Db")
    input.setSelection(1)

    // The differing span is found in UTF-16 units, and a naive scan would cut
    // between the high and low surrogate and write half an emoji.
    input.propValue = "a\uD83D\uDC4Dc"
    input.commitProps()

    assertThat(input.text?.toString()).isEqualTo("a\uD83D\uDC4Dc")
  }

  @Test
  fun `two code points that share a surrogate are not treated as common text`() {
    val input = focusedWith("𝑍")

    // U+1D44D and U+1F44D (thumbs up) are different characters that END in the
    // same low surrogate — one pair of code points in every 1024 does. A naive
    // scan reports a one-unit "common suffix" that is really half a character
    // the two strings do NOT share, so the boundary sits inside a pair. The
    // snap has to move it OUT of that pair, and in the direction that shrinks
    // the common run: the loops proved a run common by comparing it, and a snap
    // that grew one would claim an equality nobody checked.
    input.propValue = "👍"
    input.commitProps()

    assertThat(input.text?.toString()).isEqualTo("👍")
  }

  @Test
  fun `a whole emoji in the common suffix is not dragged into the replaced span`() {
    val input = focusedWith("a👍")
    input.setSelection(1)

    // Only the first character changes; the emoji is common and the caret sits
    // between the two. The replaced span is therefore exactly that character,
    // and the caret — sitting at its far edge, not inside it — does not move.
    //
    // This is the case a boundary snapped the wrong way gets wrong. The common
    // suffix begins ON the emoji's high surrogate, which is a whole pair
    // already inside the suffix and needs no adjustment; nudging the boundary
    // there splits the very pair the snap exists to protect, stretches the span
    // over the caret, and collapses the caret to 0. The final text is right
    // either way, which is exactly why the SELECTION is what is asserted.
    input.propValue = "b👍"
    input.commitProps()

    assertThat(input.text?.toString()).isEqualTo("b👍")
    assertThat(input.selectionStart).isEqualTo(1)
  }

  @Test
  fun `replacing the whole value still works`() {
    val input = focusedWith("entirely different")
    // No common prefix or suffix: the span that differs is everything, which
    // has to stay a correct write rather than an edge case that falls through.
    input.propValue = "nothing alike"
    input.commitProps()
    assertThat(input.text?.toString()).isEqualTo("nothing alike")
  }
}
