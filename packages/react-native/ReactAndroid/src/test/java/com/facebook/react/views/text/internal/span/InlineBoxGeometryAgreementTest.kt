/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text.internal.span

import android.graphics.Canvas
import android.graphics.Paint
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextPaint
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.within
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.kotlin.any
import org.mockito.kotlin.argumentCaptor
import org.mockito.kotlin.atLeast
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify
import org.robolectric.RobolectricTestRunner

/**
 * THE INLINE RESERVE MODEL has two independent consumers of the same geometry:
 * [InlineBoxSpacingSpan] turns an element's margin + border + padding into
 * reserved text advance, and [InlineBoxDecorationSpan] paints the border box
 * back out of the pen positions that advance produced. Each can be
 * unit-correct while they disagree — which is exactly what shipped once: the
 * painter still assumed the pre-ReplacementSpan pen semantics and re-added
 * padding + border on the right edge, so every decorated element showed ~2×
 * the trailing padding inside its border ("an added trailing space after the
 * last word").
 *
 * This test holds the two to ONE model through a real [StaticLayout]: the
 * advance comes from the real spacing spans, the painter draws from the real
 * pen positions, and the border box must land exactly where the model says —
 * `pen(start) - (border + padding)` to `pen(end) - margin`.
 */
@RunWith(RobolectricTestRunner::class)
class InlineBoxGeometryAgreementTest {

  private val margin = 4f
  private val border = 2f
  private val padding = 8f

  @Test
  fun `the box painter and the pen positions agree on the reserve model`() {
    // "before WORD after" with WORD as the element, range [7, 11).
    val text = SpannableStringBuilder("before WORD after")
    text.setSpan(
        InlineBoxSpacingSpan(margin, border, padding, spacingTakesFollowingBackground = true),
        6,
        7,
        Spanned.SPAN_EXCLUSIVE_INCLUSIVE,
    )
    text.setSpan(
        InlineBoxSpacingSpan(margin, border, padding),
        10,
        11,
        Spanned.SPAN_EXCLUSIVE_INCLUSIVE,
    )
    val paint = TextPaint().apply { textSize = 20f }
    val layout = StaticLayout.Builder.obtain(text, 0, text.length, paint, 10_000).build()

    val penStart = layout.getPrimaryHorizontal(7)
    val penEnd = layout.getPrimaryHorizontal(11)

    // The advance side of the model: both reserves are inside the pens.
    val glyphs = paint.measureText(text, 7, 11)
    assertThat(penEnd - penStart)
        .describedAs("pen(end) - pen(start) = glyphs + trailing reserve")
        .isCloseTo(glyphs + margin + border + padding, within(1.5f))

    val decoration =
        InlineBoxDecorationSpan(
            paddingLeft = padding,
            paddingTop = 0f,
            paddingRight = padding,
            paddingBottom = 0f,
            borderLeftWidth = border,
            borderTopWidth = border,
            borderRightWidth = border,
            borderBottomWidth = border,
            borderLeftColor = 0xFF000000.toInt(),
            borderTopColor = 0xFF000000.toInt(),
            borderRightColor = 0xFF000000.toInt(),
            borderBottomColor = 0xFF000000.toInt(),
            borderRadius = 0f,
            outlineColor = null,
            outlineWidth = 0f,
            outlineOffset = 0f,
            marginLeft = margin,
            marginRight = margin,
        )
    val canvas = mock<Canvas>()
    decoration.onPreDraw(7, 11, canvas, layout)

    val lefts = argumentCaptor<Float>()
    val rights = argumentCaptor<Float>()
    verify(canvas, atLeast(4))
        .drawRect(lefts.capture(), any(), rights.capture(), any(), any<Paint>())

    // The painting side of the model: the border box the edges outline.
    assertThat(lefts.allValues.min())
        .describedAs("border-box left = pen(start) - (border + padding)")
        .isEqualTo(penStart - (border + padding))
    assertThat(rights.allValues.max())
        .describedAs("border-box right = pen(end) - margin")
        .isEqualTo(penEnd - margin)
  }
}
