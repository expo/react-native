/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.uiapp.component

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.view.View

/**
 * Draws one vector path, for the `<svg>` intrinsics.
 *
 * The geometry arrives already parsed, flattened and scaled by
 * `js/astryx/svg/pathData.js`, so there is no SVG knowledge here — only
 * "replay these moves, lines and curves". That is deliberate: `androidx`
 * ships a path-data parser, but using it would mean Android and iOS parsed the
 * same string with different code and could disagree.
 */
internal class AstryxVectorShapeView(context: Context) : View(context) {

  private val path = Path()
  private val fillPaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val strokePaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }

  private var hasFill = false
  private var hasStroke = false

  /** Opcodes, matching js/astryx/svg/pathData.js. */
  private companion object {
    const val OP_MOVE = 0
    const val OP_LINE = 1
    const val OP_CUBIC = 2
    const val OP_CLOSE = 3
  }

  /**
   * Rebuilds the path from the flat command list.
   *
   * Bounds are checked before every read: a truncated list should draw what it
   * can, which is far better than walking off the end of the array.
   */
  fun setCommands(commands: FloatArray) {
    path.reset()
    var i = 0
    while (i < commands.size) {
      when (commands[i].toInt()) {
        OP_CLOSE -> {
          path.close()
          i += 1
        }
        OP_MOVE -> {
          if (i + 2 >= commands.size) break
          path.moveTo(commands[i + 1], commands[i + 2])
          i += 3
        }
        OP_LINE -> {
          if (i + 2 >= commands.size) break
          path.lineTo(commands[i + 1], commands[i + 2])
          i += 3
        }
        OP_CUBIC -> {
          if (i + 6 >= commands.size) break
          path.cubicTo(
              commands[i + 1],
              commands[i + 2],
              commands[i + 3],
              commands[i + 4],
              commands[i + 5],
              commands[i + 6],
          )
          i += 7
        }
        else -> break // unrecognised opcode: keep what has been built
      }
    }
    invalidate()
  }

  fun setFillColor(argb: Int) {
    // Fully transparent means "do not paint this", which is how `fill="none"`
    // reaches here.
    hasFill = argb != 0
    fillPaint.color = argb
    invalidate()
  }

  fun setStrokeColor(argb: Int) {
    hasStroke = argb != 0
    strokePaint.color = argb
    invalidate()
  }

  fun setStrokeWidth(width: Float) {
    strokePaint.strokeWidth = width
    invalidate()
  }

  fun setStrokeLinecap(cap: String?) {
    strokePaint.strokeCap =
        when (cap) {
          "round" -> Paint.Cap.ROUND
          "square" -> Paint.Cap.SQUARE
          else -> Paint.Cap.BUTT
        }
    invalidate()
  }

  fun setStrokeLinejoin(join: String?) {
    strokePaint.strokeJoin =
        when (join) {
          "round" -> Paint.Join.ROUND
          "bevel" -> Paint.Join.BEVEL
          else -> Paint.Join.MITER
        }
    invalidate()
  }

  fun setFillRule(rule: String?) {
    // Android names these the other way round from SVG: WINDING is nonzero.
    path.fillType = if (rule == "evenodd") Path.FillType.EVEN_ODD else Path.FillType.WINDING
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (path.isEmpty) {
      return
    }
    if (hasFill) {
      canvas.drawPath(path, fillPaint)
    }
    // Stroke after fill, as SVG paints it (§11.3): the outline sits on top.
    if (hasStroke && strokePaint.strokeWidth > 0f) {
      canvas.drawPath(path, strokePaint)
    }
  }
}
