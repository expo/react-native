/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.uimanager.style

import android.content.Context
import android.graphics.drawable.Drawable
import java.io.Closeable

/**
 * Loads and draws the images `background-image: url()` names.
 *
 * A view's background hands its provider each URL it names and draws what comes back as CSS lays it
 * out: sized, placed and repeated, clipped to the view's corners and stacked with its gradients. How
 * an image is fetched, decoded and drawn is the provider's. React Native's own loads through Fresco,
 * as `<Image>` does, and is installed with Fresco (`FrescoModule`); a framework may set its own as
 * [current], which the backgrounds that load after that use.
 */
public interface BackgroundImageProvider {

  /** An image a `background-image: url()` layer names, as its provider loaded it. */
  public interface Image {
    /** The image's natural width in dp, which `background-size: auto`, `cover` and `contain` measure. */
    public val naturalWidth: Float

    /** The image's natural height in dp. */
    public val naturalHeight: Float

    /**
     * A new drawable that draws the image scaled to its bounds. The background gives it its size and
     * place, and repeats it, for as long as the load that brought the image stays open.
     */
    public fun newDrawable(): Drawable
  }

  /**
   * Starts loading the image at [uri], a URL or the name of a bundled resource. [onLoad] is called
   * once, on the main thread, with the image, or with null when it cannot be loaded. Closing the
   * returned handle cancels the load and lets the image go.
   */
  public fun requestImage(context: Context, uri: String, onLoad: (Image?) -> Unit): Closeable

  public companion object {
    /** What backgrounds load their images with; with none, a `url()` layer draws nothing. */
    @JvmStatic public var current: BackgroundImageProvider? = null
  }
}
