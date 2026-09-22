/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.scroll

import android.graphics.Rect
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.ReactStylesDiffMap
import com.facebook.react.uimanager.StateWrapper
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewGroupManager
import com.facebook.react.uimanager.annotations.ReactProp

// View manager for `<native:scroll>`; every default is what a well-built native app does
@ReactModule(name = ExpoScrollViewManager.REACT_CLASS)
public class ExpoScrollViewManager : ViewGroupManager<ExpoScrollView>() {

  public companion object {
    // Matches `ExpoScrollViewComponentName` in C++
    public const val REACT_CLASS: String = "native-scroll"
  }

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): ExpoScrollView =
      ExpoScrollView(context)

  // Hands the view its state, so it can tell the tree where it is scrolled to, which
  // `ExpoScrollViewShadowNode::getContentOriginOffset` subtracts from every descendant's position
  override fun updateState(
      view: ExpoScrollView,
      props: ReactStylesDiffMap,
      stateWrapper: StateWrapper?,
  ): Any? {
    view.stateWrapper = stateWrapper
    return null
  }

  // The events this element sends; an event dispatched under an unexported name is dropped silently
  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
      mutableMapOf(
          "topScroll" to mapOf("registrationName" to "onScroll"),
          "topScrollBeginDrag" to mapOf("registrationName" to "onScrollBeginDrag"),
          "topScrollEndDrag" to mapOf("registrationName" to "onScrollEndDrag"),
          "topMomentumScrollBegin" to mapOf("registrationName" to "onMomentumScrollBegin"),
          "topMomentumScrollEnd" to mapOf("registrationName" to "onMomentumScrollEnd"),
          INSET_CHANGE_EVENT to mapOf("registrationName" to "onInsetChange"),
      )

  // Commands rather than props, because these are events, not states
  override fun receiveCommand(view: ExpoScrollView, commandId: String, args: ReadableArray?) {
    when (commandId) {
      "scrollToLatest" -> view.scrollToLatest(args?.takeIf { it.size() > 0 }?.getBoolean(0) ?: true)
      "scrollToTop" -> view.scrollToTop(args?.takeIf { it.size() > 0 }?.getBoolean(0) ?: true)
      else -> super.receiveCommand(view, commandId, args)
    }
  }

  @ReactProp(name = "scrollEnabled", defaultBoolean = true)
  public fun setScrollEnabled(view: ExpoScrollView, value: Boolean) {
    view.scrollEnabled = value
  }

  @ReactProp(name = "showsScrollIndicator", defaultBoolean = true)
  public fun setShowsScrollIndicator(view: ExpoScrollView, value: Boolean) {
    view.isVerticalScrollBarEnabled = value
  }

  @ReactProp(name = "bounces", defaultBoolean = true)
  public fun setBounces(view: ExpoScrollView, value: Boolean) {
    view.bounces = value
  }

  @ReactProp(name = "keyboardDismissMode")
  public fun setKeyboardDismissMode(view: ExpoScrollView, value: String?) {
    view.keyboardDismissMode = value ?: "interactive"
  }

  @ReactProp(name = "contentAnchor")
  public fun setContentAnchor(view: ExpoScrollView, value: String?) {
    view.contentAnchor = value ?: "top"
  }

  @ReactProp(name = "avoidsKeyboard", defaultBoolean = true)
  public fun setAvoidsKeyboard(view: ExpoScrollView, value: Boolean) {
    view.avoidsKeyboard = value
  }

  // The prop arrives in DIPs and the view works in pixels; this boundary converts
  @ReactProp(name = "contentInset")
  public fun setContentInset(view: ExpoScrollView, value: ReadableMap?) {
    view.contentInset =
        if (value == null) {
          Rect()
        } else {
          Rect(
              PixelUtil.toPixelFromDIP(value.getDouble("left")).toInt(),
              PixelUtil.toPixelFromDIP(value.getDouble("top")).toInt(),
              PixelUtil.toPixelFromDIP(value.getDouble("right")).toInt(),
              PixelUtil.toPixelFromDIP(value.getDouble("bottom")).toInt(),
          )
        }
  }

  @ReactProp(name = "automaticInsets")
  public fun setAutomaticInsets(view: ExpoScrollView, value: ReadableMap?) {
    // An edge left out keeps the default, which is on
    view.automaticInsetTop =
        if (value != null && value.hasKey("top")) value.getBoolean("top") else true
    view.automaticInsetBottom =
        if (value != null && value.hasKey("bottom")) value.getBoolean("bottom") else true
  }
}
