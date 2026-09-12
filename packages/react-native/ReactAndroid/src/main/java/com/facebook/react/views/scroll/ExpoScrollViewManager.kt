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

/**
 * View manager for `<native:scroll>`.
 *
 * Every default here is stated rather than inherited, because the defaults are the point of the
 * element: what you get for typing it is the behaviour a well-built native app has, and a prop is
 * how you say something unusual.
 */
@ReactModule(name = ExpoScrollViewManager.REACT_CLASS)
public class ExpoScrollViewManager : ViewGroupManager<ExpoScrollView>() {

  public companion object {
    /** Matches `ExpoScrollViewComponentName` in C++; see there for why it is spelled this way. */
    public const val REACT_CLASS: String = "native-scroll"
  }

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): ExpoScrollView =
      ExpoScrollView(context)

  /**
   * Hand the view its state, so it can say where it has been scrolled to.
   *
   * `ExpoScrollViewShadowNode::getContentOriginOffset` subtracts that offset from every
   * descendant's position, which is what makes a measurement of something inside a scroll view
   * answer where that thing actually is. Nothing wrote it until now, so the offset was always zero
   * and every measurement inside a list was short by however far the list had been scrolled.
   */
  override fun updateState(
      view: ExpoScrollView,
      props: ReactStylesDiffMap,
      stateWrapper: StateWrapper?,
  ): Any? {
    view.stateWrapper = stateWrapper
    return null
  }

  /**
   * The events this element sends, under the names its view config maps.
   *
   * Declared here as well as in JavaScript because Android checks: an event dispatched under a name
   * the manager has not exported is dropped silently, which is the kind of failure that looks like
   * the event never fired.
   */
  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
      mutableMapOf(
          "topScroll" to mapOf("registrationName" to "onScroll"),
          "topScrollBeginDrag" to mapOf("registrationName" to "onScrollBeginDrag"),
          "topScrollEndDrag" to mapOf("registrationName" to "onScrollEndDrag"),
          "topMomentumScrollBegin" to mapOf("registrationName" to "onMomentumScrollBegin"),
          "topMomentumScrollEnd" to mapOf("registrationName" to "onMomentumScrollEnd"),
      )

  /**
   * The imperative half: what an app calls after sending a message.
   *
   * A command rather than a prop because it is an event, not a state — "go there now", not "be
   * there". Expressing it as a prop would mean inventing a token to change so the same request
   * could be made twice.
   */
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

  /**
   * Points, not pixels.
   *
   * The prop arrives in the same unit the author wrote it in — the renderer's float, which is the
   * Android DIP and the iOS point — and the view works in device pixels. Converting at this
   * boundary is the only place that has to know.
   */
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
    // An edge left out keeps the default, which is on: naming an edge is how an author says "not
    // that one", not "only that one".
    view.automaticInsetTop =
        if (value != null && value.hasKey("top")) value.getBoolean("top") else true
    view.automaticInsetBottom =
        if (value != null && value.hasKey("bottom")) value.getBoolean("bottom") else true
  }
}
