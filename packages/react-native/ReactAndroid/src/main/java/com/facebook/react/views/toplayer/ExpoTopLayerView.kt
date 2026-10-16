/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.toplayer

import android.annotation.SuppressLint
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.config.ReactFeatureFlags
import com.facebook.react.uimanager.JSPointerDispatcher
import com.facebook.react.uimanager.JSTouchDispatcher
import com.facebook.react.uimanager.PixelUtil.pxToDp
import com.facebook.react.uimanager.RootView
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import com.facebook.react.views.view.ReactViewGroup

/**
 * The view behind `<native:toplayer>`, HTML's top layer: an empty handle where React renders the
 * element, whose children are added to an overlay on the activity's window instead, above every
 * other view there, at the handle's place in the window. The overlay takes no touch that lands
 * outside its children; a touch that begins there is reported as `onOutsidePress`, with where it
 * began in the window, and goes on to whatever is under it.
 */
public class ExpoTopLayerView(private val reactContext: ThemedReactContext) :
    ReactViewGroup(reactContext) {

  private val overlay: TopLayerRootView = TopLayerRootView(reactContext, this)

  // Keeps the container at the handle's place in the window while the layer is up, so the layer
  // moves with the page under it as an anchored popover does
  private val followHandle =
      ViewTreeObserver.OnPreDrawListener {
        followHandle()
        true
      }
  private var following = false

  /** Whether the layer is up; a closed popover keeps its handle. */
  public var active: Boolean = false
    set(value) {
      field = value
      updateOverlay()
    }

  // React's children go into the overlay's container; this view is an empty handle
  override fun addView(child: View?, index: Int) {
    overlay.container.addView(child, index)
  }

  override fun getChildCount(): Int = overlay.container.childCount

  override fun getChildAt(index: Int): View? = overlay.container.getChildAt(index)

  override fun removeView(child: View?) {
    overlay.container.removeView(child)
  }

  override fun removeViewAt(index: Int) {
    overlay.container.removeViewAt(index)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    updateOverlay()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    updateOverlay()
  }

  // Up while the layer is active and the handle is on screen: the overlay last in the window's
  // decor view, so above everything there and above every layer already up, as the top layer is a
  // stack; down otherwise
  private fun updateOverlay() {
    val decor = reactContext.currentActivity?.window?.decorView as? ViewGroup
    if (!active || !isAttachedToWindow || decor == null) {
      (overlay.parent as? ViewGroup)?.removeView(overlay)
      if (following) {
        viewTreeObserver.removeOnPreDrawListener(followHandle)
        following = false
      }
      return
    }
    if (overlay.parent !== decor) {
      (overlay.parent as? ViewGroup)?.removeView(overlay)
      decor.addView(
          overlay,
          ViewGroup.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT,
              ViewGroup.LayoutParams.MATCH_PARENT,
          ),
      )
    }
    if (!following) {
      viewTreeObserver.addOnPreDrawListener(followHandle)
      following = true
    }
    followHandle()
  }

  private fun followHandle() {
    val handle = IntArray(2)
    getLocationInWindow(handle)
    val origin = IntArray(2)
    overlay.getLocationInWindow(origin)
    overlay.container.translationX = (handle[0] - origin[0]).toFloat()
    overlay.container.translationY = (handle[1] - origin[1]).toFloat()
  }

  internal fun reportOutsidePress(x: Float, y: Float) {
    val dispatcher = UIManagerHelper.getEventDispatcherForReactTag(reactContext, id) ?: return
    dispatcher.dispatchEvent(
        OutsidePressEvent(UIManagerHelper.getSurfaceId(this), id, x.pxToDp(), y.pxToDp()))
  }
}

/**
 * The overlay on the window: as large as the window and transparent to every touch that does not
 * land on what it holds. It is a React root for touches, as a modal's is, since it is outside the
 * surface's hierarchy. Its one child, the container, sits at the handle's place, so the children
 * keep the frames layout gave them relative to the handle.
 */
@SuppressLint("ViewConstructor")
internal class TopLayerRootView(
    private val reactContext: ThemedReactContext,
    private val handle: ExpoTopLayerView,
) : ReactViewGroup(reactContext), RootView {

  val container: ReactViewGroup = ReactViewGroup(reactContext)

  private val jsTouchDispatcher: JSTouchDispatcher = JSTouchDispatcher(this)
  private val jsPointerDispatcher: JSPointerDispatcher? =
      if (ReactFeatureFlags.dispatchPointerEvents) JSPointerDispatcher(this) else null

  init {
    clipChildren = false
    container.clipChildren = false
    super.addView(container, 0)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    container.layout(0, 0, right - left, bottom - top)
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (event.actionMasked == MotionEvent.ACTION_DOWN && !landsOnContent(event.x, event.y)) {
      // Outside everything in the layer: the touch goes on to whatever is under it, and a touch
      // that is beginning light-dismisses. The overlay covers the window from its origin.
      handle.reportOutsidePress(event.x, event.y)
      return false
    }
    return super.dispatchTouchEvent(event)
  }

  private fun landsOnContent(x: Float, y: Float): Boolean {
    val localX = x - container.translationX
    val localY = y - container.translationY
    for (index in 0 until container.childCount) {
      val child = container.getChildAt(index)
      if (child.visibility == View.VISIBLE &&
          localX >= child.left &&
          localX < child.right &&
          localY >= child.top &&
          localY < child.bottom) {
        return true
      }
    }
    return false
  }

  override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
    UIManagerHelper.getEventDispatcherForReactTag(reactContext, handle.id)?.let { dispatcher ->
      jsTouchDispatcher.handleTouchEvent(event, dispatcher, reactContext)
      jsPointerDispatcher?.handleMotionEvent(event, dispatcher, true)
    }
    return super.onInterceptTouchEvent(event)
  }

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(event: MotionEvent): Boolean {
    UIManagerHelper.getEventDispatcherForReactTag(reactContext, handle.id)?.let { dispatcher ->
      jsTouchDispatcher.handleTouchEvent(event, dispatcher, reactContext)
      jsPointerDispatcher?.handleMotionEvent(event, dispatcher, false)
    }
    super.onTouchEvent(event)
    // The touch began on the layer's content: keep receiving the rest of its gesture
    return true
  }

  @OptIn(UnstableReactNativeAPI::class)
  override fun onChildStartedNativeGesture(childView: View?, ev: MotionEvent) {
    UIManagerHelper.getEventDispatcherForReactTag(reactContext, handle.id)?.let { dispatcher ->
      jsTouchDispatcher.onChildStartedNativeGesture(ev, dispatcher, reactContext)
      jsPointerDispatcher?.onChildStartedNativeGesture(childView, ev, dispatcher)
    }
  }

  override fun onChildEndedNativeGesture(childView: View, ev: MotionEvent) {
    UIManagerHelper.getEventDispatcherForReactTag(reactContext, handle.id)?.let {
      jsTouchDispatcher.onChildEndedNativeGesture(ev, it)
    }
    jsPointerDispatcher?.onChildEndedNativeGesture()
  }

  override fun handleException(t: Throwable) {
    reactContext.reactApplicationContext.handleException(RuntimeException(t))
  }

  override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
    // Still receives `onInterceptTouchEvent` when a child asks otherwise, as a root does
  }
}

private class OutsidePressEvent(
    surfaceId: Int,
    viewTag: Int,
    private val x: Float,
    private val y: Float,
) : Event<OutsidePressEvent>(surfaceId, viewTag) {
  override fun getEventName(): String = OUTSIDE_PRESS_EVENT

  override fun getEventData(): WritableMap =
      Arguments.createMap().apply {
        putDouble("x", x.toDouble())
        putDouble("y", y.toDouble())
      }
}

internal const val OUTSIDE_PRESS_EVENT: String = "topOutsidePress"
