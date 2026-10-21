/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.uimanager.style

import android.content.Context
import android.graphics.Shader
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType

/**
 * Represents a single layer of a background image: a gradient, or an image named by its URL.
 *
 * This class encapsulates gradient definitions (linear or radial) that can be applied as background
 * layers to React Native views, and the URL of an image layer, which the background loads through
 * its [BackgroundImageProvider]. It provides parsing from React Native bridge data and shader
 * generation for rendering a gradient.
 *
 * @see LinearGradient
 * @see RadialGradient
 */
public class BackgroundImageLayer() {
  private var gradient: Gradient? = null

  /** The URL of an image layer, `url(…)`, empty for `none`; null for a gradient */
  public var uri: String? = null
    private set

  private constructor(gradient: Gradient) : this() {
    this.gradient = gradient
  }

  private constructor(uri: String) : this() {
    this.uri = uri
  }

  /** The stops in their own color space, as color longs */
  internal fun colorLongs(): List<Long> =
      when (val gradient = this.gradient) {
        is LinearGradient -> gradient.colorStops.mapNotNull { it.colorLong }
        is RadialGradient -> gradient.colorStops.mapNotNull { it.colorLong }
        else -> emptyList()
      }

  public companion object {
    /**
     * Parses a ReadableMap into a BackgroundImageLayer.
     *
     * The map should contain gradient configuration including a "type" key specifying either
     * "linear-gradient" or "radial-gradient", or an image's: a "type" of "url" and its "uri".
     *
     * @param gradientMap The map containing gradient configuration
     * @param context Android context for resource resolution
     * @return A BackgroundImageLayer instance, or null if parsing fails
     */
    public fun parse(gradientMap: ReadableMap?, context: Context): BackgroundImageLayer? {
      if (gradientMap == null) {
        return null
      }
      if (
          gradientMap.hasKey("type") &&
              gradientMap.getType("type") == ReadableType.String &&
              gradientMap.getString("type") == "url"
      ) {
        // No URL is a `none` layer, which draws nothing and keeps the layers after it at their
        // places in the size, position and repeat lists
        return BackgroundImageLayer(
            if (gradientMap.hasKey("uri")) gradientMap.getString("uri") ?: "" else ""
        )
      }
      val gradient = parseGradient(gradientMap, context) ?: return null
      return BackgroundImageLayer(gradient)
    }

    private fun parseGradient(gradientMap: ReadableMap, context: Context): Gradient? {
      if (!gradientMap.hasKey("type") || gradientMap.getType("type") != ReadableType.String) {
        return null
      }

      return when (gradientMap.getString("type")) {
        "linear-gradient" -> LinearGradient.parse(gradientMap, context)
        "radial-gradient" -> RadialGradient.parse(gradientMap, context)
        else -> null
      }
    }
  }

  /**
   * Creates a shader for rendering this background layer's gradient; an image layer has none.
   *
   * @param width The width of the area to fill
   * @param height The height of the area to fill
   * @return A Shader instance for rendering the gradient
   */
  public fun getShader(width: Float, height: Float): Shader =
      checkNotNull(gradient) { "An image layer, url($uri), has no shader" }.getShader(width, height)
}
