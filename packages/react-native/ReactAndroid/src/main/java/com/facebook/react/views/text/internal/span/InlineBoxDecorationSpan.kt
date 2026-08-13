/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text.internal.span

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.text.Layout

/**
 * Paints an inline element's CSS box — padding, border, outline
 * (box-model-scope.md G4/G5).
 *
 * One box per line the element occupies, with the leading edge drawn only on
 * the first fragment and the trailing edge only on the last: CSS2 §8.6's
 * `box-decoration-break: slice`, which is the default.
 *
 * Block-axis padding and border deliberately overflow the line box rather than
 * growing it (CSS2 §10.6.1), matching the web and the iOS implementation.
 *
 * Drawn as a [CanvasEffectSpan] `onPreDraw`, so it lands beneath the glyphs
 * using the same seam text decorations and shadows already use — the run's
 * `Layout` is handed in, which is what makes the per-line geometry available.
 *
 * All values are in pixels: they are converted from points where the span is
 * constructed, because `Layout` works in pixels.
 *
 * Verified painting on device: with a decorated `<span>` whose computed box is
 * 361.8px wide, the border measured 361px on screen (teal band x=245..606) and
 * the outline 377px (x=237..613), a single box pair — the plain rectangle the
 * mounted view used to paint alongside it is gone, see
 * `TextShadowNode::getMountedLayoutMetrics`.
 *
 * The block-axis half works too: the box overflows the line box as CSS2
 * §10.6.1 requires. Measured on device for a box computed as 361.8x70px:
 * border 362x70 (y=2007..2076), outline 377x84 — the outline sitting
 * `outlineOffset + outlineWidth` outside the border box in both axes, as it
 * should. That ink escapes the text view's own bounds because the parent does
 * not clip its children, and is cut at the container's padding edge when the
 * container sets `overflow` — same as any other overflowing ink, and same as
 * iOS.
 */
internal class InlineBoxDecorationSpan(
    private val paddingLeft: Float,
    private val paddingTop: Float,
    private val paddingRight: Float,
    private val paddingBottom: Float,
    private val borderLeftWidth: Float,
    private val borderTopWidth: Float,
    private val borderRightWidth: Float,
    private val borderBottomWidth: Float,
    private val borderLeftColor: Int?,
    private val borderTopColor: Int?,
    private val borderRightColor: Int?,
    private val borderBottomColor: Int?,
    private val borderRadius: Float,
    private val outlineColor: Int?,
    private val outlineWidth: Float,
    private val outlineOffset: Float,
    private val marginLeft: Float,
    private val marginRight: Float,
) : CanvasEffectSpan() {

  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

  override fun onPreDraw(start: Int, end: Int, canvas: Canvas, layout: Layout) {
    if (end <= start) {
      return
    }
    val firstLine = layout.getLineForOffset(start)
    val lastLine = layout.getLineForOffset(end - 1)

    for (line in firstLine..lastLine) {
      val isFirst = line == firstLine
      val isLast = line == lastLine

      // Horizontal extent of *this element* on this line. `getPrimaryHorizontal`
      // is the pen position at an offset, so the element's own edges come from
      // its start/end offsets, and a line it spans entirely runs to the line's
      // own extent.
      val lineStart = layout.getLineStart(line)
      val lineEnd = layout.getLineEnd(line)
      val from = if (start > lineStart) start else lineStart
      val to = if (end < lineEnd) end else lineEnd
      if (to <= from) {
        continue
      }
      var left = layout.getPrimaryHorizontal(from)
      var right =
          if (to < lineEnd) layout.getPrimaryHorizontal(to) else layout.getLineRight(line)
      if (right <= left) {
        continue
      }

      // Both edges' space sits outside the element's own glyph extent and has
      // to be added back. `getPrimaryHorizontal` reports a cursor position, so
      // the leading space (kerning on the *preceding* character) is left of
      // `left`, and the trailing space is not included in `right` either — the
      // cursor at the element's end offset sits at the last glyph's edge.
      if (isFirst) {
        left -= paddingLeft + borderLeftWidth
      }
      if (isLast) {
        right += paddingRight + borderRightWidth
      }

      // Vertically the box is the line box grown outwards by padding and
      // border — never inwards, and never changing the line's height.
      val top = layout.getLineTop(line) - paddingTop - borderTopWidth
      val bottom = layout.getLineBottom(line) + paddingBottom + borderBottomWidth
      // Margins are outside the border box and are never painted.
      val boxLeft = left + if (isFirst) marginLeft else 0f
      val boxRight = right - if (isLast) marginRight else 0f

      drawEdges(canvas, boxLeft, top, boxRight, bottom, isFirst, isLast)
      drawOutline(canvas, boxLeft, top, boxRight, bottom)
    }
  }

  private fun drawEdges(
      canvas: Canvas,
      left: Float,
      top: Float,
      right: Float,
      bottom: Float,
      isFirst: Boolean,
      isLast: Boolean,
  ) {
    paint.style = Paint.Style.FILL
    // Edges are filled as solid rects rather than stroked: a stroke centres on
    // its path, so an edge drawn as a line lands half a width off.
    if (borderTopWidth > 0f && borderTopColor != null) {
      paint.color = borderTopColor
      canvas.drawRect(left, top, right, top + borderTopWidth, paint)
    }
    if (borderBottomWidth > 0f && borderBottomColor != null) {
      paint.color = borderBottomColor
      canvas.drawRect(left, bottom - borderBottomWidth, right, bottom, paint)
    }
    if (isFirst && borderLeftWidth > 0f && borderLeftColor != null) {
      paint.color = borderLeftColor
      canvas.drawRect(left, top, left + borderLeftWidth, bottom, paint)
    }
    if (isLast && borderRightWidth > 0f && borderRightColor != null) {
      paint.color = borderRightColor
      canvas.drawRect(right - borderRightWidth, top, right, bottom, paint)
    }
  }

  private fun drawOutline(
      canvas: Canvas,
      left: Float,
      top: Float,
      right: Float,
      bottom: Float,
  ) {
    val color = outlineColor ?: return
    if (outlineWidth <= 0f) {
      return
    }
    // The outline is the border box pushed out by `outline-offset`. Stroke
    // centres on the path, so offset by half the width to keep its inner edge
    // exactly `outlineOffset` away. It never affects layout.
    val inset = outlineOffset + outlineWidth / 2f
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = outlineWidth
    paint.color = color
    val rect = RectF(left - inset, top - inset, right + inset, bottom + inset)
    if (borderRadius > 0f) {
      canvas.drawRoundRect(rect, borderRadius, borderRadius, paint)
    } else {
      canvas.drawRect(rect, paint)
    }
  }
}
