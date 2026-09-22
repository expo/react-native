/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.keyboard

import android.content.Context
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.ViewConfiguration
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.EventDispatcherProvider
import com.facebook.react.views.view.ReactViewGroup
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * The view behind `<native:keyboardaccessory>` on Android. The IME is another application's window
 * and nothing here can be attached to it, so being part of the keyboard is built in two halves:
 * position, following the bottom obstruction frame by frame, and gesture, offering drags on the bar
 * itself to [KeyboardDragger].
 */
public class ExpoKeyboardAccessoryView(context: Context) : ReactViewGroup(context) {

  private val dragger = KeyboardDragger(this)
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private var velocityTracker: VelocityTracker? = null

  private var downY = 0f
  private var dragging = false

  // The last reserve announced; seeded to a value no reserve can take, since zero is a real state
  private var emittedReserve = -1f

  // The bar's drawn top and height last announced, in DIPs; NaN until the first
  private var emittedTop = Float.NaN
  private var emittedHeight = Float.NaN

  private val dockListener = KeyboardGeometryListener { geometry ->
    dockToKeyboard(geometry)
    emitDock(geometry)
  }
  private var dockInsets: KeyboardInsets? = null

  // `addListener` calls back with the geometry it already has, so a bar that has just been
  // attached announces where it is
  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    dockInsets = rootView?.let { KeyboardInsets.forRootView(it) }
    dockInsets?.addListener(dockListener)
    // An obstruction as well as a listener: this bar covers whatever scrolls behind it
    dockInsets?.addObstructingView(obstructingView)
  }

  // A bar that grows moves its top without the keyboard moving
  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    dockInsets?.let { emitDock(it.geometry) }
  }

  // How far the bar is translated up to clear the obstruction, in pixels: the overlap with it,
  // not its height, so a bar the keyboard cannot reach does not move
  private var dockOffsetPx = 0f

  // The author's own translation, kept apart from the dock offset: React writes `translationY`
  // from the `transform` style and resets it to zero, so the two are composed
  private var authoredTranslationY = 0f

  override fun setTranslationY(translationY: Float) {
    authoredTranslationY = translationY
    super.setTranslationY(translationY - dockOffsetPx)
  }

  private fun applyDockOffsetPx(offsetPx: Float) {
    if (offsetPx == dockOffsetPx) {
      return
    }
    dockOffsetPx = offsetPx
    super.setTranslationY(authoredTranslationY - offsetPx)
  }

  // Where the bar's bottom edge sits with no dock offset applied, in window pixels;
  // `getLocationInWindow` includes the previous frame's offset, which is taken back out
  private fun bottomWithoutDockPx(): Float {
    val location = IntArray(2)
    getLocationInWindow(location)
    return location[1] + height + dockOffsetPx
  }

  // Moves the bar so it sits on top of the obstruction
  private fun dockToKeyboard(geometry: KeyboardGeometry) {
    val root = rootView
    if (root == null) {
      applyDockOffsetPx(0f)
      return
    }
    applyDockOffsetPx(
        keyboardOverlapPx(
            bottomWithoutDockPx(),
            root.height,
            PixelUtil.toPixelFromDIP(geometry.height),
        )
    )
  }

  // This bar's contribution to the bottom obstruction, computed from the obstruction rather than
  // read off the view so the answer does not depend on which listener the producer called first
  private val obstructingView = KeyboardObstructingView { obstructionPx ->
    val root = rootView
    if (root == null) {
      Float.MAX_VALUE
    } else {
      val bottom = bottomWithoutDockPx()
      bottom - keyboardOverlapPx(bottom, root.height, obstructionPx) - height
    }
  }

  // Publishes how docked this bar is and where it is drawn whenever either changes by a quarter
  // DIP; see [ExpoKeyboardDockEvent]. The top and height are in the payload because Android's
  // animated-event driver throws on a key the payload lacks.
  private fun emitDock(geometry: KeyboardGeometry) {
    val safeArea = geometry.safeArea
    val keysBelow = max(geometry.height - safeArea, 0f)
    val reserve = min(max(safeArea - keysBelow, 0f), safeArea)
    // Where the bar is drawn, after this frame's dock offset
    val location = IntArray(2)
    getLocationInWindow(location)
    val top = PixelUtil.toDIPFromPixel(location[1].toFloat())
    val barHeight = PixelUtil.toDIPFromPixel(height.toFloat())
    if (
        abs(reserve - emittedReserve) < 0.25f &&
            abs(top - emittedTop) < 0.25f &&
            abs(barHeight - emittedHeight) < 0.25f
    ) {
      return
    }
    emittedReserve = reserve
    emittedTop = top
    emittedHeight = barHeight

    val reactContext = context as? ReactContext ?: return
    // Checked first, because `UIManagerHelper.getEventDispatcher` casts rather than checks
    val provider = (reactContext as? ThemedReactContext)?.reactApplicationContext ?: reactContext
    if (provider !is EventDispatcherProvider) {
      return
    }
    val dispatcher = UIManagerHelper.getEventDispatcher(reactContext) ?: return
    // A safe area of zero is a device with no gesture strip: docked or not, with no strip to
    // measure the transition against
    val docked = if (safeArea > 0f) reserve / safeArea else if (reserve > 0f) 1f else 0f
    dispatcher.dispatchEvent(
        ExpoKeyboardDockEvent(
            UIManagerHelper.getSurfaceId(reactContext),
            id,
            docked,
            // Already DIPs: `KeyboardGeometry` converts once
            reserve,
            top,
            barHeight,
        )
    )
  }

  /**
   * Keeps watching a gesture a child asked to keep to itself: a text field calls
   * `requestDisallowInterceptTouchEvent(true)` when a drag begins on it, which would hide every
   * MOVE from this view. Not honoured, as `ReactRootView` does, and still propagated upwards. The
   * cost is a downward drag inside a multi-line composer while a keyboard is up, which dismisses
   * rather than scrolls the field.
   */
  override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
    parent?.requestDisallowInterceptTouchEvent(disallowIntercept)
  }

  // Watches every touch in the bar without taking it; a drag is recognised once past the slop, and
  // only then taken from the child receiving it
  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downY = ev.rawY
        dragging = false
        velocityTracker?.recycle()
        velocityTracker = VelocityTracker.obtain()
        velocityTracker?.addMovement(ev)
      }
      MotionEvent.ACTION_MOVE -> {
        velocityTracker?.addMovement(ev)
        // Downward only, and only with a keyboard up: an upward drag scrolls a multi-line field.
        // Claimed on the slop rather than on the dragger having control, since taking control of
        // the IME's animation is asynchronous and the gesture would otherwise never be claimed.
        if (!dragging && ev.rawY - downY > touchSlop && dragger.isKeyboardVisible()) {
          dragging = true
          dragger.onDrag(ev.rawY, ev.rawY - downY, scrollCanConsume = false)
          return true
        }
      }
      MotionEvent.ACTION_UP,
      MotionEvent.ACTION_CANCEL -> releaseTracker(ev)
    }
    return false
  }

  override fun onTouchEvent(ev: MotionEvent): Boolean {
    when (ev.actionMasked) {
      MotionEvent.ACTION_MOVE -> {
        velocityTracker?.addMovement(ev)
        if (dragging || (ev.rawY - downY > touchSlop && dragger.isKeyboardVisible())) {
          dragging = true
          // Offered on every move: the dragger places the keyboard by hand on each one
          dragger.onDrag(ev.rawY, ev.rawY - downY, scrollCanConsume = false)
          return true
        }
      }
      MotionEvent.ACTION_UP,
      MotionEvent.ACTION_CANCEL -> {
        releaseTracker(ev)
        return true
      }
    }
    return super.onTouchEvent(ev)
  }

  private fun releaseTracker(ev: MotionEvent) {
    velocityTracker?.addMovement(ev)
    velocityTracker?.computeCurrentVelocity(UNITS_PER_SECOND)
    val velocityY = velocityTracker?.yVelocity ?: 0f
    velocityTracker?.recycle()
    velocityTracker = null
    if (dragging) {
      dragger.onRelease(velocityY)
    } else {
      dragger.cancel()
    }
    dragging = false
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    dragger.cancel()
    velocityTracker?.recycle()
    velocityTracker = null
    dockInsets?.removeListener(dockListener)
    dockInsets?.removeObstructingView(obstructingView)
    dockInsets = null
    // Nothing recomputes these until the keyboard next moves, so a bar that leaves the window
    // mid-transition would come back displaced and having told nobody
    applyDockOffsetPx(0f)
    emittedReserve = -1f
  }

  private companion object {
    // `computeCurrentVelocity` reports per this many milliseconds; the dragger wants per second
    const val UNITS_PER_SECOND = 1000
  }
}
