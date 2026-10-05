/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text.internal.span

import android.annotation.SuppressLint
import android.graphics.Paint
import android.text.Layout
import android.text.SpannableString
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextPaint
import org.assertj.core.api.Assertions.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

@SuppressLint("NewApi")
@RunWith(RobolectricTestRunner::class)
class CustomLineHeightSpanTest {

  @Test
  fun tightLineHeightDoesNotClipFirstOrLastLineFontBounds() {
    val span = CustomLineHeightSpan(16f)
    val fm =
        Paint.FontMetricsInt().apply {
          top = -18
          ascent = -14
          descent = 6
          bottom = 8
        }

    span.chooseHeight("gjpqy", 0, 5, 0, 0, fm)

    assertThat(fm.ascent).isEqualTo(-12)
    assertThat(fm.descent).isEqualTo(4)
    assertThat(fm.top).isEqualTo(-12)
    assertThat(fm.bottom).isEqualTo(4)
  }

  @Test
  fun looseLineHeightStillExpandsFirstAndLastLineBounds() {
    val span = CustomLineHeightSpan(24f)
    val fm =
        Paint.FontMetricsInt().apply {
          top = -18
          ascent = -14
          descent = 6
          bottom = 8
        }

    span.chooseHeight("gjpqy", 0, 5, 0, 0, fm)

    assertThat(fm.ascent).isEqualTo(-16)
    assertThat(fm.descent).isEqualTo(8)
    assertThat(fm.top).isEqualTo(-16)
    assertThat(fm.bottom).isEqualTo(8)
  }

  @Test
  fun tightLineHeightDoesNotExpandStaticLayoutHeightWithFontPadding() {
    val layout = buildStaticLayout("gjpqy\ngjpqy\ngjpqy", lineHeight = 24)

    assertThat(layout.lineCount).isEqualTo(3)
    assertThat(layout.height).isEqualTo(72)
  }

  @Test
  fun tightLineHeightDoesNotExpandSingleLineStaticLayoutHeightWithFontPadding() {
    val layout = buildStaticLayout("gjpqy", lineHeight = 24)

    assertThat(layout.lineCount).isEqualTo(1)
    assertThat(layout.height).isEqualTo(24)
  }

  @Test
  fun fractionalLineHeightRoundsUpToWholePixels() {
    assertThat(CustomLineHeightSpan(42.5f).lineHeight).isEqualTo(43)
    assertThat(CustomLineHeightSpan(44.01f).lineHeight).isEqualTo(45)
  }

  @Test
  fun lineHeightFloatingPointErrorAboveWholePixelsDoesNotRoundUp() {
    assertThat(CustomLineHeightSpan(Math.nextUp(44f)).lineHeight).isEqualTo(44)
    assertThat(CustomLineHeightSpan(44.0004f).lineHeight).isEqualTo(44)
  }

  @Test
  fun inlineViewTallerThanLineHeightGrowsLineBoxAroundTextAndView() {
    val layout = buildStaticLayout("ab\uFFFC", lineHeight = 24, inlineViewHeight = 40)

    assertThat(layout.lineCount).isEqualTo(1)
    assertThat(layout.getLineBaseline(0) - layout.getLineTop(0)).isEqualTo(40)
    assertThat(layout.getLineBottom(0) - layout.getLineBaseline(0))
        .isEqualTo(maxOf(textDescent(lineHeight = 24), 0))
  }

  @Test
  fun inlineViewShorterThanLineHeightKeepsLineHeight() {
    val layout = buildStaticLayout("ab\uFFFC", lineHeight = 24, inlineViewHeight = 10)

    assertThat(layout.lineCount).isEqualTo(1)
    assertThat(layout.height).isEqualTo(24)
  }

  @Test
  fun inlineViewGrowsLineWithSeveralLineHeightSpans() {
    val text = SpannableString("abcd\uFFFC")
    text.setLineHeightSpan(24, 0, 2)
    text.setLineHeightSpan(24, 2, 4)
    text.setInlineView(height = 40, 4)

    val layout = staticLayout(text)

    assertThat(layout.lineCount).isEqualTo(1)
    assertThat(layout.getLineBaseline(0) - layout.getLineTop(0)).isEqualTo(40)
    assertThat(layout.getLineBottom(0) - layout.getLineBaseline(0))
        .isEqualTo(maxOf(textDescent(lineHeight = 24), 0))
  }

  @Test
  fun lastLineHeightSpanInParagraphSetsLineHeight() {
    val text = SpannableString("abcd\uFFFC")
    text.setLineHeightSpan(60, 0, 2)
    text.setLineHeightSpan(24, 2, 4)
    text.setInlineView(height = 10, 4)

    val layout = staticLayout(text)

    assertThat(layout.lineCount).isEqualTo(1)
    assertThat(layout.height).isEqualTo(24)
  }

  @Test
  fun eachParagraphGrowsToFitItsInlineView() {
    val text = SpannableString("ab\uFFFC\ncd\uFFFC")
    text.setLineHeightSpan(24, 0, 2)
    text.setInlineView(height = 40, 2)
    text.setLineHeightSpan(24, 4, 6)
    text.setInlineView(height = 40, 6)

    val layout = staticLayout(text)

    assertThat(layout.lineCount).isEqualTo(2)
    for (line in 0 until layout.lineCount) {
      assertThat(layout.getLineBaseline(line) - layout.getLineTop(line)).isEqualTo(40)
      assertThat(layout.getLineBottom(line) - layout.getLineBaseline(line))
          .isEqualTo(maxOf(textDescent(lineHeight = 24), 0))
    }
  }

  @Test
  @GraphicsMode(GraphicsMode.Mode.NATIVE)
  fun linesWrappedAfterTallInlineViewKeepLineHeight() {
    val layout =
        buildStaticLayout(
            "\uFFFC" + "gjpqy ".repeat(20).trim(),
            lineHeight = 24,
            inlineViewHeight = 40,
            inlineViewAtStart = true,
            width = 100,
        )

    assertThat(layout.lineCount).isGreaterThan(2)
    assertThat(layout.getLineBaseline(0) - layout.getLineTop(0)).isEqualTo(40)
    for (line in 1 until layout.lineCount) {
      assertThat(layout.getLineBaseline(line) - layout.getLineTop(line))
          .isEqualTo(textAscent(lineHeight = 24))
      assertThat(layout.getLineBottom(line) - layout.getLineBaseline(line))
          .isEqualTo(textDescent(lineHeight = 24))
    }
  }

  @Test
  fun lineWithOnlyAnInlineViewGrowsToFitIt() {
    val span = CustomLineHeightSpan(60f, inlineViews = InlineViewHeights())
    val text = SpannableString("ab\uFFFC")
    text.setSpan(span, 0, 2, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    text.setSpan(
        TextInlineViewPlaceholderSpan(reactTag = 1, width = 80, height = 80),
        2,
        3,
        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
    )
    val fm = inlineViewMetrics(height = 80)

    span.chooseHeight(text, 2, 3, 0, 0, fm, TextPaint())

    assertThat(fm.ascent).isEqualTo(-80)
    assertThat(fm.descent).isGreaterThanOrEqualTo(0)
    assertThat(fm.bottom).isEqualTo(fm.descent)
  }

  @Test
  fun inlineViewStartingBeforeTheLineStillGrowsIt() {
    val span = CustomLineHeightSpan(24f, inlineViews = InlineViewHeights())
    val text = SpannableString("abc\uFFFC\uFFFC")
    text.setSpan(span, 0, 3, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    text.setSpan(
        TextInlineViewPlaceholderSpan(reactTag = 1, width = 40, height = 40),
        3,
        5,
        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
    )
    val fm = inlineViewMetrics(height = 40)

    span.chooseHeight(text, 4, 5, 0, 0, fm, TextPaint())

    assertThat(fm.ascent).isEqualTo(-40)
    assertThat(fm.descent).isGreaterThanOrEqualTo(0)
  }

  @Test
  fun viewLineWhoseMergedMetricsAddUpToLineHeightIsRemeasured() {
    val fontMetrics = textPaint().fontMetricsInt
    val inlineViewHeight = -fontMetrics.ascent + 6
    val lineHeight = inlineViewHeight + fontMetrics.descent
    val span = CustomLineHeightSpan(lineHeight.toFloat(), inlineViews = InlineViewHeights())
    val text = SpannableString("ab\uFFFC")
    text.setSpan(span, 0, 2, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    text.setInlineView(height = inlineViewHeight, 2)
    val fm =
        Paint.FontMetricsInt().apply {
          top = -inlineViewHeight
          ascent = -inlineViewHeight
          descent = fontMetrics.descent
          bottom = fontMetrics.descent
        }

    span.chooseHeight(text, 0, text.length, 0, 0, fm, textPaint())

    assertThat(fm.ascent).isEqualTo(-inlineViewHeight)
    assertThat(fm.descent).isEqualTo(fontMetrics.descent + 3)
  }

  @Test
  fun withoutInlineViewsTheLineStillGrowsForItsAtomicInline() {
    // Without `inlineViews` the paint-carrying overload re-admits the
    // placeholder's box after clamping to the line height, so the line reaches
    // the top of the 80px box that sits on its baseline.
    val text = SpannableString("ab\uFFFC")
    val span = CustomLineHeightSpan(60f)
    text.setSpan(span, 0, 2, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    text.setSpan(
        TextInlineViewPlaceholderSpan(reactTag = 1, width = 80, height = 80),
        2,
        3,
        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
    )
    val fm = inlineViewMetrics(height = 80)

    span.chooseHeight(text, 0, 3, 0, 0, fm, TextPaint())

    assertThat(fm.ascent).isEqualTo(-80)
  }

  @Test
  fun tightLineHeightStillGrowsForAnAtomicInlineOnTheLine() {
    // `line-height` is the strut, and the line box is the union of the strut
    // and every inline-level box on the line (CSS2 §10.8): Safari grows only
    // the line that carries a 56px box on a 24px line-height
    val text = "gjpqy\u200B after"
    val spannable = SpannableString(text)
    spannable.setSpan(
        CustomLineHeightSpan(24f),
        0,
        text.length,
        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
    )
    val boxIndex = text.indexOf('\u200B')
    spannable.setSpan(
        TextInlineViewPlaceholderSpan(reactTag = 1, width = 56, height = 56),
        boxIndex,
        boxIndex + 1,
        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
    )

    val layout =
        StaticLayout.Builder.obtain(
                spannable,
                0,
                spannable.length,
                TextPaint().apply { textSize = 24f },
                400,
            )
            .setAlignment(Layout.Alignment.ALIGN_NORMAL)
            .setIncludePad(true)
            .setLineSpacing(0f, 1f)
            .build()

    val line = layout.getLineForOffset(boxIndex)
    val lineHeightPx = layout.getLineBottom(line) - layout.getLineTop(line)
    // The union: at least the box, sitting on the baseline, plus the strut's
    // descent below it. Not exactly-56 — that would be the old substitution
    // bug this span's placeholder partner fixed separately.
    assertThat(lineHeightPx).isGreaterThanOrEqualTo(56)
  }

  @Test
  fun aLineWithoutTheAtomicInlineStaysClamped() {
    // The growth is per-line: only the line CARRYING the box escapes the
    // clamp, exactly as in a browser.
    val text = "first\ngjpqy\u200Bx"
    val spannable = SpannableString(text)
    spannable.setSpan(
        CustomLineHeightSpan(24f),
        0,
        text.length,
        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
    )
    val boxIndex = text.indexOf('\u200B')
    spannable.setSpan(
        TextInlineViewPlaceholderSpan(reactTag = 1, width = 56, height = 56),
        boxIndex,
        boxIndex + 1,
        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
    )
    val layout =
        StaticLayout.Builder.obtain(
                spannable,
                0,
                spannable.length,
                TextPaint().apply { textSize = 24f },
                400,
            )
            .setAlignment(Layout.Alignment.ALIGN_NORMAL)
            .setIncludePad(true)
            .setLineSpacing(0f, 1f)
            .build()

    assertThat(layout.getLineBottom(0) - layout.getLineTop(0)).isEqualTo(24)
    val boxLine = layout.getLineForOffset(boxIndex)
    assertThat(layout.getLineBottom(boxLine) - layout.getLineTop(boxLine))
        .isGreaterThanOrEqualTo(56)
  }

  private fun textPaint(): TextPaint = TextPaint().apply { textSize = 24f }

  private fun textAscent(lineHeight: Int): Int {
    val fontMetrics = textPaint().fontMetricsInt
    val leading = lineHeight - (-fontMetrics.ascent + fontMetrics.descent)
    return -fontMetrics.ascent + (leading + 1).floorDiv(2)
  }

  private fun textDescent(lineHeight: Int): Int {
    val fontMetrics = textPaint().fontMetricsInt
    val leading = lineHeight - (-fontMetrics.ascent + fontMetrics.descent)
    return fontMetrics.descent + leading.floorDiv(2)
  }

  private fun SpannableString.setLineHeightSpan(lineHeight: Int, start: Int, end: Int) {
    setSpan(
        CustomLineHeightSpan(lineHeight.toFloat(), inlineViews = InlineViewHeights()),
        start,
        end,
        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
    )
  }

  private fun SpannableString.setInlineView(height: Int, position: Int) {
    setSpan(
        TextInlineViewPlaceholderSpan(reactTag = 1, width = 10, height = height),
        position,
        position + 1,
        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
    )
  }

  private fun inlineViewMetrics(height: Int): Paint.FontMetricsInt =
      Paint.FontMetricsInt().apply {
        top = -height
        ascent = -height
        descent = 0
        bottom = 0
      }

  private fun buildStaticLayout(
      text: String,
      lineHeight: Int,
      inlineViewHeight: Int? = null,
      inlineViewAtStart: Boolean = false,
      width: Int = 400,
  ): StaticLayout {
    val spannable = SpannableString(text)
    val inlineViewStart = if (inlineViewAtStart) 0 else text.length - 1
    val (textStart, textEnd) =
        when {
          inlineViewHeight == null -> 0 to text.length
          inlineViewAtStart -> 1 to text.length
          else -> 0 to text.length - 1
        }
    spannable.setSpan(
        CustomLineHeightSpan(
            lineHeight.toFloat(),
            inlineViews = inlineViewHeight?.let { InlineViewHeights() },
        ),
        textStart,
        textEnd,
        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
    )
    if (inlineViewHeight != null) {
      spannable.setSpan(
          TextInlineViewPlaceholderSpan(reactTag = 1, width = 10, height = inlineViewHeight),
          inlineViewStart,
          inlineViewStart + 1,
          Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
      )
    }

    return staticLayout(spannable, width)
  }

  private fun staticLayout(text: Spanned, width: Int = 400): StaticLayout =
      StaticLayout.Builder.obtain(text, 0, text.length, textPaint(), width)
          .setAlignment(Layout.Alignment.ALIGN_NORMAL)
          .setIncludePad(true)
          .setLineSpacing(0f, 1f)
          .build()
}
