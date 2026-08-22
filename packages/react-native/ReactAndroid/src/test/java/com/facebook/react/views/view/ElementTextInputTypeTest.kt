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
 * How the field's props become an Android input type.
 *
 * One computation carries several attributes at once — the keyboard from `type`/`inputMode`,
 * masking from `password`, and both text-correction attributes — so what a single prop actually
 * costs is only visible in the flags that come out the other end. Kept apart from
 * [ElementTextInputSelectionTest], which is about where the caret goes.
 */
@RunWith(RobolectricTestRunner::class)
class ElementTextInputTypeTest {

  /**
   * Counts what the platform actually gets told, because that is where the cost is.
   *
   * `TextView.setInputType` has no early-out and ends with `imm.restartInput(this)` on every call,
   * which discards the IME's composing region. Nothing observable in the view records that, so the
   * call itself is what has to be asserted.
   */
  private class CountingInput(context: android.content.Context) : ElementTextInputView(context) {
    var setInputTypeCalls: Int = 0

    override fun setInputType(type: Int) {
      setInputTypeCalls++
      super.setInputType(type)
    }
  }

  private fun countingView(): CountingInput {
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    return CountingInput(activity)
  }

  @Test
  fun `an unchanged input type is not re-applied, so the IME is not restarted`() {
    val input = countingView()
    input.propValue = "a"
    input.commitProps()
    val afterFirst = input.setInputTypeCalls
    assertThat(afterFirst).isGreaterThan(0)

    // Three more commits with the type computation unchanged — the shape of every keystroke of a
    // controlled field, where only `value` moves.
    for (text in listOf("ab", "abc", "abcd")) {
      input.propValue = text
      input.commitProps()
    }

    assertThat(input.setInputTypeCalls).isEqualTo(afterFirst)
  }

  @Test
  fun `a changed input type is applied`() {
    val input = countingView()
    input.propValue = "a"
    input.commitProps()
    val afterFirst = input.setInputTypeCalls

    // The guard must not be a mute button: a real change still reaches the widget.
    input.propType = "email"
    input.commitProps()

    assertThat(input.setInputTypeCalls).isGreaterThan(afterFirst)
    assertThat(input.inputType and android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
        .isNotEqualTo(0)
  }

  @Test
  fun `a recycled view re-applies its type`() {
    val input = countingView()
    input.propType = "email"
    input.propValue = "a"
    input.commitProps()

    // Recycling hands the view to a different element. The remembered type belongs to the old one.
    input.resetForRecycle()
    val beforeReuse = input.setInputTypeCalls
    input.propType = "email"
    input.propValue = "b"
    input.commitProps()

    assertThat(input.setInputTypeCalls).isGreaterThan(beforeReuse)
  }

  /*
   * `spellcheck` and `autocorrect` are separate attributes in HTML (§6.8.5 and §6.8.8), and Android
   * has one flag covering both — see DOM-CSS-LIMITATION(android-spellcheck-implies-autocorrect).
   * These pin what the platform is actually told, including the part that cannot be honoured, so
   * the limitation is a recorded behaviour rather than an accident nobody noticed.
   */

  private fun view(): ElementTextInputView {
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    return ElementTextInputView(activity)
  }

  private fun inputWith(spellCheck: Boolean, autoCorrect: Boolean): ElementTextInputView {
    val input = view()
    input.propSpellCheck = spellCheck
    input.propAutoCorrect = autoCorrect
    input.propValue = "text"
    input.commitProps()
    return input
  }

  @Test
  fun `autocorrect on sets the platform's autocorrect flag`() {
    val input = inputWith(spellCheck = true, autoCorrect = true)
    assertThat(input.inputType and android.text.InputType.TYPE_TEXT_FLAG_AUTO_CORRECT)
        .isNotEqualTo(0)
  }

  @Test
  fun `autocorrect off leaves the spell checker alone`() {
    // The half Android CAN express, and the one that was wrong before: turning off correction must
    // not turn off checking.
    val input = inputWith(spellCheck = true, autoCorrect = false)
    assertThat(input.inputType and android.text.InputType.TYPE_TEXT_FLAG_AUTO_CORRECT).isEqualTo(0)
    assertThat(input.inputType and android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS).isEqualTo(0)
  }

  @Test
  fun `spellcheck false takes autocorrect with it, which is the limitation`() {
    // NOT the behaviour HTML asks for. `TYPE_TEXT_FLAG_NO_SUGGESTIONS` is the only lever and
    // `isSuggestionsEnabled()` gates the checker and the suggestion strip together, so honouring
    // the attribute the author named costs the one they did not. Asserted rather than hidden: if
    // Android ever grows a check-only flag, this test is where the news arrives.
    val input = inputWith(spellCheck = false, autoCorrect = true)
    assertThat(input.inputType and android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS)
        .isNotEqualTo(0)
    assertThat(input.inputType and android.text.InputType.TYPE_TEXT_FLAG_AUTO_CORRECT).isEqualTo(0)
  }
}
