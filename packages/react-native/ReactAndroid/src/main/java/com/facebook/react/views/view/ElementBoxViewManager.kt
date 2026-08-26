/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/**
 * View manager for `element-box`, the box a block-level element generates.
 *
 * `element-box` used to be mapped straight onto `RCTView`, which meant Android had no seam of its
 * own for it at all and `href` — carried natively on iOS since the anchor work — was dropped on
 * the floor here. This is that seam. It inherits everything from [ReactViewManager]: layout,
 * borders, backgrounds, clipping and every existing prop behave exactly as they did, because the
 * view is a [ReactViewGroup] until a prop says otherwise.
 */
@ReactModule(name = ElementBoxViewManager.REACT_CLASS)
internal class ElementBoxViewManager : ReactViewManager() {

  public companion object {
    public const val REACT_CLASS: String = "element-box"
  }

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): ReactViewGroup {
    val view = ElementBoxView(context)
    // Same gate as `<button>`: the ripple is what a tracked press *looks like*, so a build with
    // the recognizers off must not grow one that nothing drives.
    if (ReactNativeFeatureFlags.enableNativeGestureRecognizers()) {
      view.ripplesEnabled = true
    }
    return view
  }

  /**
   * The ripple's mask follows the background's shape, and the background is built from props — so
   * it can only be shaped once the whole transaction has been applied. Doing it per-prop would
   * rebuild the ripple several times per update and, worse, read a border radius that a later prop
   * in the same batch was about to change.
   */
  override fun onAfterUpdateTransaction(view: ReactViewGroup) {
    super.onAfterUpdateTransaction(view)
    (view as? ElementBoxView)?.onPropsApplied()
  }

  @ReactProp(name = "href")
  public fun setHref(view: ReactViewGroup, href: String?) {
    (view as? ElementBoxView)?.href = href
  }

  @ReactProp(name = "touchAction")
  public fun setTouchAction(view: ReactViewGroup, touchAction: String?) {
    (view as? ElementBoxView)?.touchAction = touchAction
  }
}
