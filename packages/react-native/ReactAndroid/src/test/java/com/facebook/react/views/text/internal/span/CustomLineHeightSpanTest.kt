/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text.internal.span

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
  fun tightLineHeightStillGrowsForAnAtomicInlineOnTheLine() {
    /*
     * `line-height` is the strut, and the line box is the UNION of the strut
     * and every inline-level box on the line (CSS2 §10.8). The clamp used to
     * flatten that union: a 56px placeholder on a 24px line-height stayed a
     * 24px line, and the box painted over the line above it — visible in the
     * embedded-content demo as a red block covering its own paragraph.
     * Safari, probed on the same markup, grows only the line that carries the
     * box.
     */
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

  private fun buildStaticLayout(text: String, lineHeight: Int): StaticLayout {
    val spannable = SpannableString(text)
    spannable.setSpan(
        CustomLineHeightSpan(lineHeight.toFloat()),
        0,
        text.length,
        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
    )

    return StaticLayout.Builder.obtain(
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
  }
}
