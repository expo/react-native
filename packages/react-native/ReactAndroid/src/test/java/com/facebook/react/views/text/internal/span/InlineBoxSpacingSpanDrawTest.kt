/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text.internal.span

import android.graphics.Canvas
import android.graphics.Paint
import android.text.SpannableString
import android.text.Spanned
import android.text.TextPaint
import android.text.style.ForegroundColorSpan
import android.text.style.UnderlineSpan
import org.assertj.core.api.Assertions.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.kotlin.any
import org.mockito.kotlin.anyOrNull
import org.mockito.kotlin.argumentCaptor
import org.mockito.kotlin.eq
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify
import org.robolectric.RobolectricTestRunner

/**
 * What a `ReplacementSpan` takes away, this span must give back.
 *
 * Android's `TextLine.handleReplacement` never runs the character styles for a
 * replacement's range — no `bgColor` rect, no colours, no decoration flags —
 * which is how the trailing-padding span made the LAST character of every
 * padded inline element render bare: `<code style={{backgroundColor}}>…d</code>`
 * drew its final "d" on the page background. These tests pin the give-back:
 * the glyph region is painted with the range's own background, the spacing
 * region with the background of whichever element owns that padding, and the
 * glyph is drawn with the character styles applied.
 */
@RunWith(RobolectricTestRunner::class)
class InlineBoxSpacingSpanDrawTest {

  private val bg = 0xFFDDDDDD.toInt()
  private val fg = 0xFFFF3B30.toInt()

  private fun spannedWord(span: InlineBoxSpacingSpan, spanStart: Int, spanEnd: Int): Spanned {
    val text = SpannableString("word after")
    // The element is "word": background + colour + underline over it, the
    // spacing span where the caller placed it.
    text.setSpan(ReactBackgroundColorSpan(bg), 0, 4, Spanned.SPAN_INCLUSIVE_EXCLUSIVE)
    text.setSpan(ForegroundColorSpan(fg), 0, 4, Spanned.SPAN_INCLUSIVE_EXCLUSIVE)
    text.setSpan(UnderlineSpan(), 0, 4, Spanned.SPAN_INCLUSIVE_EXCLUSIVE)
    text.setSpan(span, spanStart, spanEnd, Spanned.SPAN_INCLUSIVE_EXCLUSIVE)
    return text
  }

  private fun draw(span: InlineBoxSpacingSpan, text: Spanned, start: Int, end: Int): Canvas {
    val canvas = mock<Canvas>()
    span.draw(canvas, text, start, end, /* x = */ 100f, /* top = */ 0, /* y = */ 20, /* bottom = */ 24, TextPaint())
    return canvas
  }

  @Test
  fun `trailing placement paints the element's background over glyph AND spacing`() {
    val span = InlineBoxSpacingSpan(8f)
    val text = spannedWord(span, 3, 4) // the element's own last character
    val canvas = draw(span, text, 3, 4)

    val paints = argumentCaptor<Paint>()
    val lefts = argumentCaptor<Float>()
    val rights = argumentCaptor<Float>()
    verify(canvas, org.mockito.kotlin.times(2))
        .drawRect(lefts.capture(), any(), rights.capture(), any(), paints.capture())
    // Both rects carry the element's background…
    assertThat(paints.allValues.map { it.color }).containsOnly(bg)
    // …and together they span from the glyph's left edge to the end of the
    // reserved spacing, with no gap between them.
    assertThat(lefts.allValues.min()).isEqualTo(100f)
    assertThat(rights.allValues.max() - lefts.allValues.min())
        .isEqualTo(span.getSize(TextPaint(), text, 3, 4, null).toFloat())
    assertThat(lefts.allValues.max()).isEqualTo(rights.allValues.min())
  }

  @Test
  fun `the glyph is drawn with the character styles the replacement bypassed`() {
    val span = InlineBoxSpacingSpan(8f)
    val text = spannedWord(span, 3, 4)
    val canvas = draw(span, text, 3, 4)

    val paint = argumentCaptor<Paint>()
    verify(canvas)
        .drawText(eq(text), eq(3), eq(4), any(), any(), paint.capture())
    assertThat(paint.firstValue.color).isEqualTo(fg)
    assertThat(paint.firstValue.isUnderlineText).isTrue()
  }

  @Test
  fun `leading placement on the preceding character gives the SPACING the element's background`() {
    // "d word": the span rides the space before "word" — a character OUTSIDE
    // the element — so its glyph has no background, while the spacing after it
    // is the element's padding and takes the element's.
    val text = SpannableString("d word")
    val span = InlineBoxSpacingSpan(8f, spacingTakesFollowingBackground = true)
    text.setSpan(ReactBackgroundColorSpan(bg), 2, 6, Spanned.SPAN_INCLUSIVE_EXCLUSIVE)
    text.setSpan(span, 1, 2, Spanned.SPAN_INCLUSIVE_EXCLUSIVE)

    val canvas = draw(span, text, 1, 2)

    val paints = argumentCaptor<Paint>()
    val lefts = argumentCaptor<Float>()
    verify(canvas)
        .drawRect(lefts.capture(), any(), any<Float>(), any(), paints.capture())
    // Exactly one background rect — the spacing's, in the element's colour —
    // because the preceding character itself has none.
    assertThat(paints.firstValue.color).isEqualTo(bg)
    val natural = TextPaint().measureText(text, 1, 2)
    assertThat(lefts.firstValue).isEqualTo(100f + natural)
  }

  @Test
  fun `no styles means no background rects, just the glyph`() {
    val text = SpannableString("xy")
    val span = InlineBoxSpacingSpan(8f)
    text.setSpan(span, 0, 1, Spanned.SPAN_INCLUSIVE_EXCLUSIVE)
    val canvas = draw(span, text, 0, 1)
    verify(canvas, org.mockito.kotlin.never())
        .drawRect(any<Float>(), any(), any(), any(), any())
    verify(canvas).drawText(eq(text), eq(0), eq(1), any(), any(), anyOrNull())
  }
}
