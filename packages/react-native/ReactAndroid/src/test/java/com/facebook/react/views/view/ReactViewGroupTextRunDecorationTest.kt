/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.text.Layout
import android.text.SpannableString
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextPaint
import android.view.View
import androidx.core.graphics.createBitmap
import androidx.core.graphics.get
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import com.facebook.react.views.text.internal.span.CanvasEffectSpan
import org.assertj.core.api.Assertions.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

/**
 * Regression test for the text-children (expo-intrinsics) bug where an inline `<u>` (or `<s>`, or a
 * text shadow) rendered in a View's anonymous inline formatting context flowed inline but showed no
 * decoration. Text-decoration on Android is a [CanvasEffectSpan] (e.g. `ReactUnderlineSpan`): it
 * paints itself in `onDraw`, NOT during `Layout.draw`. The IFC paint path in
 * [ReactViewGroup.drawTextRun] originally only called `Layout.draw`, so it skipped the effect-span
 * pass entirely and no decoration appeared (while bold/italic, which are real character spans applied
 * by `Layout.draw`, did).
 *
 * This asserts the exact contract that was missing: a [CanvasEffectSpan] on a painted text run has
 * its `onDraw` invoked. The span paints a solid black block (independent of font/AA quirks, mirroring
 * the paint-order test's `SolidBlockSpan`). Pre-fix the block is never drawn and [effectSpanIsDrawn]
 * fails; post-fix the bitmap contains black ink.
 */
@RunWith(RobolectricTestRunner::class)
class ReactViewGroupTextRunDecorationTest {

  private val size = 40
  private lateinit var context: Context

  @Before
  fun setUp() {
    ReactNativeFeatureFlagsForTests.setUp()
    context = Robolectric.buildActivity(Activity::class.java).create().get()
  }

  @Test
  fun effectSpanIsDrawn() {
    assertThat(hasBlackInk(render())).isTrue()
  }

  private fun render(): Bitmap {
    val rvg = ReactViewGroup(context)
    rvg.setTextRunLayouts(
        listOf(ReactViewGroup.TextRunLayout(runWithEffectSpan(), 0f, 0f, documentOrder = 0)))
    measureAndLayout(rvg)
    return createBitmap(size, size).also { rvg.draw(Canvas(it)) }
  }

  private fun measureAndLayout(view: View) {
    val spec = View.MeasureSpec.makeMeasureSpec(size, View.MeasureSpec.EXACTLY)
    view.measure(spec, spec)
    view.layout(0, 0, size, size)
  }

  private fun runWithEffectSpan(): StaticLayout {
    val text = SpannableString("x")
    text.setSpan(SolidBlockEffectSpan(size), 0, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    // Transparent glyphs: `Layout.draw` leaves no ink, so the only thing that can produce black is
    // the effect span's `onDraw`. Otherwise the default-black "x" glyph would pass the test even
    // with the effect-span pass removed, making it vacuous.
    val paint = TextPaint().apply { color = Color.TRANSPARENT }
    return StaticLayout.Builder.obtain(text, 0, text.length, paint, size).build()
  }

  /** True if any pixel is black-ish (only the effect span can produce that). */
  private fun hasBlackInk(bitmap: Bitmap): Boolean {
    for (y in 0 until bitmap.height) {
      for (x in 0 until bitmap.width) {
        val color = bitmap[x, y]
        if (Color.alpha(color) != 0 &&
            Color.red(color) < 80 &&
            Color.green(color) < 80 &&
            Color.blue(color) < 80) {
          return true
        }
      }
    }
    return false
  }

  /** A [CanvasEffectSpan] (the family text-decoration/shadow belong to) that paints a solid block. */
  private class SolidBlockEffectSpan(private val size: Int) : CanvasEffectSpan() {
    override fun onDraw(start: Int, end: Int, canvas: Canvas, layout: Layout) {
      canvas.drawRect(
          0f, 0f, size.toFloat(), size.toFloat(), Paint().apply { color = Color.BLACK })
    }
  }
}
