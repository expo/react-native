/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text.internal.span

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Paint.FontMetricsInt
import android.text.style.ReplacementSpan

/**
 * TextInlineViewPlaceholderSpan is a span for inlined views that are inside <Text></Text>. It
 * computes its size based on the input size. It contains no draw logic, just positioning logic.
 */
/**
 * @param baselineFromTop where the box's OWN baseline sits, measured from its
 *   top (CSS2 §10.8.1). Equal to `height` for a box with no line boxes of its
 *   own, which is the synthesized bottom-edge baseline and the only case the
 *   old fixed `ascent = -height, descent = 0` got right: a box with text in it
 *   was hung entirely above the line's baseline, so its own text floated above
 *   the surrounding text instead of sitting on the same line.
 */
internal class TextInlineViewPlaceholderSpan(
    val reactTag: Int,
    val width: Int,
    val height: Int,
    val baselineFromTop: Int = height,
) : ReplacementSpan(), ReactSpan {
  override fun getSize(
      paint: Paint,
      text: CharSequence?,
      start: Int,
      end: Int,
      fm: FontMetricsInt?,
  ): Int {
    // NOTE: This getSize code is copied from DynamicDrawableSpan and modified to not use a Drawable
    if (fm != null) {
      // The box's own baseline goes on the line's, so it reaches
      // `baselineFromTop` above and whatever remains below.
      fm.ascent = -baselineFromTop
      fm.descent = height - baselineFromTop
      fm.top = fm.ascent
      fm.bottom = fm.descent
    }
    return width
  }

  override fun draw(
      canvas: Canvas,
      text: CharSequence?,
      start: Int,
      end: Int,
      x: Float,
      top: Int,
      y: Int,
      bottom: Int,
      paint: Paint,
  ): Unit = Unit
}
