/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.uimanager.style

import android.content.Context
import android.util.LayoutDirection
import androidx.annotation.ColorLong
import com.facebook.react.modules.i18nmanager.I18nUtil

/**
 * Represents resolved border colors for all four physical edges of a box.
 *
 * This data class contains the final computed color values after resolving logical properties based
 * on layout direction. Each is a color long, so a color written in its own color space keeps it.
 *
 * @property left Color for the left edge
 * @property top Color for the top edge
 * @property right Color for the right edge
 * @property bottom Color for the bottom edge
 */
internal data class ColorEdges(
    @param:ColorLong val left: Long = BLACK_COLOR_LONG,
    @param:ColorLong val top: Long = BLACK_COLOR_LONG,
    @param:ColorLong val right: Long = BLACK_COLOR_LONG,
    @param:ColorLong val bottom: Long = BLACK_COLOR_LONG,
)

/** Black as an sRGB color long */
@ColorLong internal const val BLACK_COLOR_LONG: Long = 0xff00_0000L shl 32

/**
 * Represents border colors using logical edge properties.
 *
 * This inline value class stores colors for all logical edges (start, end, block-start, block-end,
 * etc.) and resolves them to physical edges based on layout direction and RTL settings.
 *
 * @property edgeColors Array of color longs indexed by [LogicalEdge] ordinal values
 * @see LogicalEdge
 * @see ColorEdges
 */
@JvmInline
internal value class BorderColors(
    @param:ColorLong val edgeColors: Array<Long?> = arrayOfNulls<Long?>(LogicalEdge.values().size),
) {

  /**
   * Resolves logical edge colors to physical edge colors based on layout direction.
   *
   * This method handles RTL layout direction and the doLeftAndRightSwapInRTL setting to correctly
   * map logical properties (start, end, block-start, block-end) to physical edges (left, right,
   * top, bottom).
   *
   * @param layoutDirection The resolved layout direction (LTR or RTL)
   * @param context Android context for RTL swap preference
   * @return ColorEdges with resolved physical edge colors
   * @throws IllegalArgumentException if layoutDirection is not LTR or RTL
   */
  fun resolve(layoutDirection: Int, context: Context): ColorEdges {
    return when (layoutDirection) {
      LayoutDirection.LTR ->
          ColorEdges(
              edgeColors[LogicalEdge.START.ordinal]
                  ?: edgeColors[LogicalEdge.LEFT.ordinal]
                  ?: edgeColors[LogicalEdge.HORIZONTAL.ordinal]
                  ?: edgeColors[LogicalEdge.ALL.ordinal]
                  ?: BLACK_COLOR_LONG,
              edgeColors[LogicalEdge.BLOCK_START.ordinal]
                  ?: edgeColors[LogicalEdge.TOP.ordinal]
                  ?: edgeColors[LogicalEdge.BLOCK.ordinal]
                  ?: edgeColors[LogicalEdge.VERTICAL.ordinal]
                  ?: edgeColors[LogicalEdge.ALL.ordinal]
                  ?: BLACK_COLOR_LONG,
              edgeColors[LogicalEdge.END.ordinal]
                  ?: edgeColors[LogicalEdge.RIGHT.ordinal]
                  ?: edgeColors[LogicalEdge.HORIZONTAL.ordinal]
                  ?: edgeColors[LogicalEdge.ALL.ordinal]
                  ?: BLACK_COLOR_LONG,
              edgeColors[LogicalEdge.BLOCK_END.ordinal]
                  ?: edgeColors[LogicalEdge.BOTTOM.ordinal]
                  ?: edgeColors[LogicalEdge.BLOCK.ordinal]
                  ?: edgeColors[LogicalEdge.VERTICAL.ordinal]
                  ?: edgeColors[LogicalEdge.ALL.ordinal]
                  ?: BLACK_COLOR_LONG,
          )
      LayoutDirection.RTL ->
          if (I18nUtil.instance.doLeftAndRightSwapInRTL(context)) {
            ColorEdges(
                edgeColors[LogicalEdge.END.ordinal]
                    ?: edgeColors[LogicalEdge.RIGHT.ordinal]
                    ?: edgeColors[LogicalEdge.HORIZONTAL.ordinal]
                    ?: edgeColors[LogicalEdge.ALL.ordinal]
                    ?: BLACK_COLOR_LONG,
                edgeColors[LogicalEdge.BLOCK_START.ordinal]
                    ?: edgeColors[LogicalEdge.TOP.ordinal]
                    ?: edgeColors[LogicalEdge.BLOCK.ordinal]
                    ?: edgeColors[LogicalEdge.VERTICAL.ordinal]
                    ?: edgeColors[LogicalEdge.ALL.ordinal]
                    ?: BLACK_COLOR_LONG,
                edgeColors[LogicalEdge.START.ordinal]
                    ?: edgeColors[LogicalEdge.LEFT.ordinal]
                    ?: edgeColors[LogicalEdge.HORIZONTAL.ordinal]
                    ?: edgeColors[LogicalEdge.ALL.ordinal]
                    ?: BLACK_COLOR_LONG,
                edgeColors[LogicalEdge.BLOCK_END.ordinal]
                    ?: edgeColors[LogicalEdge.BOTTOM.ordinal]
                    ?: edgeColors[LogicalEdge.BLOCK.ordinal]
                    ?: edgeColors[LogicalEdge.VERTICAL.ordinal]
                    ?: edgeColors[LogicalEdge.ALL.ordinal]
                    ?: BLACK_COLOR_LONG,
            )
          } else {
            ColorEdges(
                edgeColors[LogicalEdge.END.ordinal]
                    ?: edgeColors[LogicalEdge.LEFT.ordinal]
                    ?: edgeColors[LogicalEdge.HORIZONTAL.ordinal]
                    ?: edgeColors[LogicalEdge.ALL.ordinal]
                    ?: BLACK_COLOR_LONG,
                edgeColors[LogicalEdge.BLOCK_START.ordinal]
                    ?: edgeColors[LogicalEdge.TOP.ordinal]
                    ?: edgeColors[LogicalEdge.BLOCK.ordinal]
                    ?: edgeColors[LogicalEdge.VERTICAL.ordinal]
                    ?: edgeColors[LogicalEdge.ALL.ordinal]
                    ?: BLACK_COLOR_LONG,
                edgeColors[LogicalEdge.START.ordinal]
                    ?: edgeColors[LogicalEdge.RIGHT.ordinal]
                    ?: edgeColors[LogicalEdge.HORIZONTAL.ordinal]
                    ?: edgeColors[LogicalEdge.ALL.ordinal]
                    ?: BLACK_COLOR_LONG,
                edgeColors[LogicalEdge.BLOCK_END.ordinal]
                    ?: edgeColors[LogicalEdge.BOTTOM.ordinal]
                    ?: edgeColors[LogicalEdge.BLOCK.ordinal]
                    ?: edgeColors[LogicalEdge.VERTICAL.ordinal]
                    ?: edgeColors[LogicalEdge.ALL.ordinal]
                    ?: BLACK_COLOR_LONG,
            )
          }
      else -> throw IllegalArgumentException("Expected resolved layout direction")
    }
  }
}
