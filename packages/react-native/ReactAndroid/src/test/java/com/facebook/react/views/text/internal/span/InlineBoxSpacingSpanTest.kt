/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text.internal.span

import android.graphics.Canvas
import android.text.TextPaint
import org.assertj.core.api.Assertions.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.kotlin.any
import org.mockito.kotlin.argumentCaptor
import org.mockito.kotlin.eq
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify
import org.robolectric.RobolectricTestRunner

/**
 * The advance an inline element's inline-axis space adds, and — the reason this file exists — where
 * the glyph sits inside it.
 *
 * This span was a `MetricAffectingSpan` that set `letterSpacing`, and the *advances* it produced
 * were correct: the conformance corpus agreed with real Safari on every case, on both platforms,
 * for as long as it was wrong. Android splits letter spacing half before and half after each glyph,
 * so covering one character put half an inline box's padding *inside* the word, and it rendered as
 * `decorated inlin e` and `befor e SPA N after`.
 *
 * No geometry assertion can catch that. The box's outer edges are in the right place either way —
 * only the glyph within them moves. So these tests assert the draw position directly, which is the
 * only place that bug was ever visible outside a screenshot.
 */
@RunWith(RobolectricTestRunner::class)
class InlineBoxSpacingSpanTest {

  private val paint = TextPaint().apply { textSize = 10f }

  @Test
  fun `reserves the natural advance plus the spacing`() {
    val text = "x"
    val natural = paint.measureText(text, 0, 1)

    val size = InlineBoxSpacingSpan(0f, 0f, 12f).getSize(paint, text, 0, 1, null)

    assertThat(size).isEqualTo(Math.round(natural + 12f))
  }

  @Test
  fun `draws the glyph at the left of the advance so the space falls after it`() {
    // The regression. Under `letterSpacing` the glyph was pushed right by half the spacing,
    // opening a gap between it and the character before it — inside the word.
    val canvas = mock<Canvas>()

    InlineBoxSpacingSpan(0f, 0f, 12f).draw(canvas, "x", 0, 1, 100f, 0, 10, 20, paint)

    val x = argumentCaptor<Float>()
    verify(canvas).drawText(eq("x" as CharSequence), eq(0), eq(1), x.capture(), any(), any())
    assertThat(x.firstValue).isEqualTo(100f)
  }

  @Test
  fun `spaceBefore draws the glyph at the right of the advance so the space falls before it`() {
    // Used only where the preceding character is an attachment placeholder and cannot carry the
    // span. The glyph must end up in the same place on screen as it would have with the space
    // hung off that preceding character — which means the far side of the reserved advance.
    val canvas = mock<Canvas>()

    InlineBoxSpacingSpan(0f, 0f, 12f, spaceBefore = true).draw(canvas, "x", 0, 1, 100f, 0, 10, 20, paint)

    val x = argumentCaptor<Float>()
    verify(canvas).drawText(eq("x" as CharSequence), eq(0), eq(1), x.capture(), any(), any())
    assertThat(x.firstValue).isEqualTo(112f)
  }

  @Test
  fun `keeps the line's own metrics rather than the span's defaults`() {
    // A ReplacementSpan owns the line metrics of the range it covers. Leaving these at zero
    // collapses the height of every line that carries an inline box.
    val fm = android.graphics.Paint.FontMetricsInt()

    InlineBoxSpacingSpan(0f, 0f, 12f).getSize(paint, "x", 0, 1, fm)

    val expected = android.graphics.Paint.FontMetricsInt()
    paint.getFontMetricsInt(expected)
    assertThat(fm.ascent).isEqualTo(expected.ascent)
    assertThat(fm.descent).isEqualTo(expected.descent)
  }

  @Test
  fun `a NaN spacing adds nothing and shifts nothing`() {
    val text = "x"
    val natural = paint.measureText(text, 0, 1)
    val canvas = mock<Canvas>()
    val span = InlineBoxSpacingSpan(0f, 0f, Float.NaN, spaceBefore = true)

    assertThat(span.getSize(paint, text, 0, 1, null)).isEqualTo(Math.round(natural))

    span.draw(canvas, text, 0, 1, 100f, 0, 10, 20, paint)
    val x = argumentCaptor<Float>()
    verify(canvas).drawText(eq(text as CharSequence), eq(0), eq(1), x.capture(), any(), any())
    assertThat(x.firstValue).isEqualTo(100f)
  }
}
