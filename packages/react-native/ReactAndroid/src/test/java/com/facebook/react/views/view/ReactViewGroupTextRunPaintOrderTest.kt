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
import android.text.SpannableString
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextPaint
import android.text.style.ReplacementSpan
import android.view.View
import androidx.core.graphics.createBitmap
import androidx.core.graphics.get
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import org.assertj.core.api.Assertions.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

/**
 * Regression test for the text-children (expo-intrinsics) paint-order bug where a View's bare-text
 * runs were painted on top of ALL of its child views instead of interleaved by document order — so
 * text placed *before* an absolutely-positioned box showed through the box instead of being hidden
 * under it (the demo's "UNDER"/"OVER" case).
 *
 * Renders a [ReactViewGroup] with one opaque box child covering the whole area and one text run, and
 * asserts real pixels (Robolectric native graphics): a run with documentOrder 0 (before the box) is
 * occluded; a run with documentOrder 1 (after the box) is visible. The run paints a solid black
 * block via a [ReplacementSpan] so the assertion does not depend on font glyph rasterization.
 *
 * With the pre-fix behavior (all runs drawn after all children) the documentOrder-0 case would
 * incorrectly show the run, failing [textRunBeforeBlockChildIsPaintedUnderIt].
 */
@RunWith(RobolectricTestRunner::class)
class ReactViewGroupTextRunPaintOrderTest {

  private val size = 40
  private lateinit var context: Context

  @Before
  fun setUp() {
    ReactNativeFeatureFlagsForTests.setUp()
    context = Robolectric.buildActivity(Activity::class.java).create().get()
  }

  @Test
  fun textRunBeforeBlockChildIsPaintedUnderIt() {
    // documentOrder 0: the run paints before the box, which then occludes it -> no run ink.
    assertThat(hasRunInk(render(documentOrder = 0))).isFalse()
  }

  @Test
  fun textRunAfterBlockChildIsPaintedOverIt() {
    // documentOrder 1: the run paints after the box -> run ink is visible over it.
    assertThat(hasRunInk(render(documentOrder = 1))).isTrue()
  }

  private fun render(documentOrder: Int): Bitmap {
    val rvg = ReactViewGroup(context)

    val box = View(context)
    box.setBackgroundColor(Color.RED)
    rvg.addView(box)
    measureAndLayout(box)

    rvg.setTextRunLayouts(
        listOf(ReactViewGroup.TextRunLayout(solidBlackRunLayout(), 0f, 0f, documentOrder)))

    measureAndLayout(rvg)
    return createBitmap(size, size).also { rvg.draw(Canvas(it)) }
  }

  private fun measureAndLayout(view: View) {
    val spec = View.MeasureSpec.makeMeasureSpec(size, View.MeasureSpec.EXACTLY)
    view.measure(spec, spec)
    view.layout(0, 0, size, size)
  }

  private fun solidBlackRunLayout(): StaticLayout {
    val text = SpannableString("x")
    text.setSpan(SolidBlockSpan(size), 0, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    return StaticLayout.Builder.obtain(text, 0, text.length, TextPaint(), size).build()
  }

  /** True if any pixel is black-ish (the run) rather than red (the box) or transparent. */
  private fun hasRunInk(bitmap: Bitmap): Boolean {
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

  /** A replacement glyph that paints a solid black [size]x[size] block, independent of any font. */
  private class SolidBlockSpan(private val size: Int) : ReplacementSpan() {
    override fun getSize(
        paint: Paint,
        text: CharSequence,
        start: Int,
        end: Int,
        fm: Paint.FontMetricsInt?,
    ): Int {
      fm?.ascent = -size
      fm?.top = -size
      fm?.descent = 0
      fm?.bottom = 0
      return size
    }

    override fun draw(
        canvas: Canvas,
        text: CharSequence,
        start: Int,
        end: Int,
        x: Float,
        top: Int,
        y: Int,
        bottom: Int,
        paint: Paint,
    ) {
      canvas.drawRect(x, top.toFloat(), x + size, bottom.toFloat(), Paint().apply { color = Color.BLACK })
    }
  }
}
