/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import org.assertj.core.api.Assertions.assertThat
import org.junit.Test

/**
 * The boundaries a controlled write replaces between. `current[..start) + next[start..endInNext) +
 * current[endInCurrent..)` spells `next` for many choices of boundary, so a test that reads the
 * text back (see [ElementTextInputSelectionTest]) cannot tell a boundary that splits a surrogate
 * pair from a right one; the boundaries are asserted directly.
 */
class DifferingSpanTest {

  /** What the span promises: replacing it turns `current` into `next`. */
  private fun assertReconstructs(current: String, next: String): DifferingSpan {
    val span = DifferingSpan.between(current, next)
    val rebuilt =
        current.substring(0, span.start) +
            next.substring(span.start, span.endInNext) +
            current.substring(span.endInCurrent)
    assertThat(rebuilt).isEqualTo(next)
    return span
  }

  @Test
  fun `it replaces only what differs`() {
    val span = assertReconstructs("0123456789X", "0123456789")
    assertThat(span.start).isEqualTo(10)
    assertThat(span.endInCurrent).isEqualTo(11)
    assertThat(span.endInNext).isEqualTo(10)
  }

  @Test
  fun `an insertion at the front replaces nothing`() {
    val span = assertReconstructs("abcdef", "XXabcdef")
    assertThat(span.start).isEqualTo(0)
    assertThat(span.endInCurrent).isEqualTo(0)
    assertThat(span.endInNext).isEqualTo(2)
  }

  @Test
  fun `nothing in common means everything is replaced`() {
    val span = assertReconstructs("entirely different", "nothing alike")
    assertThat(span.start).isEqualTo(0)
    assertThat(span.endInCurrent).isEqualTo(18)
  }

  @Test
  fun `two code points sharing a low surrogate are not common text`() {
    // U+1D44D and U+1F44D end in the same low surrogate, so a UTF-16 scan
    // reports a "common suffix" that is half a character the strings do not
    // share; extending it to the whole pair would leave an empty span
    val span = assertReconstructs("𝑍", "👍")
    assertThat(span.start).isEqualTo(0)
    assertThat(span.endInCurrent).isEqualTo(2)
    assertThat(span.endInNext).isEqualTo(2)
  }

  @Test
  fun `an emoji already inside the common suffix is left there`() {
    // Only the first character changes, so the span is that character and a
    // caret at offset 1 sits at its edge. The suffix boundary lands on the
    // emoji's high surrogate, a complete pair that needs no adjustment;
    // nudging it would split the pair and stretch the span across the caret
    val span = assertReconstructs("a👍", "b👍")
    assertThat(span.start).isEqualTo(0)
    assertThat(span.endInCurrent).isEqualTo(1)
    assertThat(span.endInNext).isEqualTo(1)
  }

  @Test
  fun `a surrogate pair is never cut in half`() {
    val span = assertReconstructs("a👍b", "a👍c")
    // Every boundary falls between code points, never between the halves of one.
    for (boundary in listOf(span.start, span.endInCurrent)) {
      if (boundary > 0 && boundary < 4) {
        assertThat(
                Character.isLowSurrogate("a👍b"[boundary]) &&
                    Character.isHighSurrogate("a👍b"[boundary - 1])
            )
            .isFalse()
      }
    }
  }

  @Test
  fun `a change inside one emoji replaces that code point`() {
    // A skin-tone modifier is its own code point, so the differing span lies
    // inside one grapheme cluster
    assertReconstructs("a👍🏻b", "a👍🏿b")
  }

  @Test
  fun `the promise holds for awkward pairs generally`() {
    val samples =
        listOf(
            "",
            "a",
            "ab",
            "abc",
            "👍",
            "a👍",
            "👍a",
            "𝑍",
            "a👍b",
            "👍👍",
            "é",
            "0123456789",
        )
    for (current in samples) {
      for (next in samples) {
        if (current.isEmpty() || next.isEmpty() || current == next) {
          // The empty cases never reach the span rule; [writeText] writes them
          // wholesale
          continue
        }
        assertReconstructs(current, next)
      }
    }
  }
}
