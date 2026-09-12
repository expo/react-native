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
 * The view behind `<native:keyboardaccessory>` on Android.
 *
 * On iOS the same element hands its children to UIKit as an `inputAccessoryView`, so the bar
 * genuinely belongs to the keyboard and UIKit moves both together. Android has no such thing —
 * the IME is another application's window and nothing in this one can be attached to it — so the
 * two halves of "part of the keyboard" have to be built separately:
 *
 *  - **position**: this class follows the bottom obstruction frame by frame, translating
 *    itself up by however much of it the keyboard covers, and
 *  - **gesture**: this class, which offers drags on ITSELF to [KeyboardDragger].
 *
 * The second half is the one that is easy to leave out, and leaving it out is exactly what a user
 * notices: the bar follows the keyboard perfectly and then a finger placed on it does nothing,
 * because the drag was only ever being read by the scroll view underneath.
 */
public class ExpoKeyboardAccessoryView(context: Context) : ReactViewGroup(context) {

  private val dragger = KeyboardDragger(this)
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private var velocityTracker: VelocityTracker? = null

  private var downY = 0f
  private var dragging = false

  // --------------------------------------------------------------- docking

  /**
   * The last reserve announced, so the same answer is not sent twice.
   *
   * Seeded to a value no reserve can take, because ZERO is a real state — a bar
   * docked to the keys — and a fresh bar that started there would never say so.
   */
  private var emittedReserve = -1f

  private val dockListener =
      KeyboardGeometryListener { geometry ->
        dockToKeyboard(geometry)
        emitDock(geometry)
      }
  private var dockInsets: KeyboardInsets? = null

  /*
   * `addListener` calls back with the geometry it already has, so a bar that has
   * just been attached announces where it is rather than waiting for the
   * keyboard to move — which for a composer that opens docked is every frame it
   * will ever have.
   */
  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    dockInsets = rootView?.let { KeyboardInsets.forRootView(it) }
    dockInsets?.addListener(dockListener)
    // Registered as an obstruction as well as a listener: this bar covers whatever scrolls
    // behind it, and a scroll view that clears only the keyboard leaves the newest message
    // underneath the bar.
    dockInsets?.addObstructingView(obstructingView)
  }

  /**
   * How far the bar is translated up to clear the obstruction, in pixels.
   *
   * The OVERLAP with the obstruction, not its height: lifting by the whole thing is right only
   * for a bar already on the bottom edge, and anywhere else it overshoots by however far up the
   * bar already was. The overlap is self-correcting — a bar the keyboard cannot reach does not
   * move at all.
   */
  private var dockOffsetPx = 0f

  /**
   * The author's own translation, kept apart from the dock offset.
   *
   * Both are claims on one property: React writes `translationY` from the `transform` style and
   * resets it to zero when there is none, so a dock offset written straight to it would be erased
   * by the next props update. Recording the authored value here and composing the two means
   * neither can overwrite the other.
   */
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

  /**
   * Where the bar's bottom edge sits with no dock offset applied, in window pixels.
   *
   * `getLocationInWindow` reports where the view is DRAWN, which already includes the offset
   * applied on the previous frame, so that offset is taken back out. Feeding the drawn position
   * straight back in would wind the two up together.
   */
  private fun bottomWithoutDockPx(): Float {
    val location = IntArray(2)
    getLocationInWindow(location)
    return location[1] + height + dockOffsetPx
  }

  /** Move the bar so it sits on top of the obstruction. */
  private fun dockToKeyboard(geometry: KeyboardGeometry) {
    val root = rootView
    if (root == null) {
      applyDockOffsetPx(0f)
      return
    }
    applyDockOffsetPx(
        keyboardOverlapPx(
            bottomWithoutDockPx(), root.height, PixelUtil.toPixelFromDIP(geometry.height)))
  }

  /**
   * This bar's contribution to the bottom obstruction, for anything scrolling behind it.
   *
   * Computed from the obstruction rather than read off the view: a scroll view and this bar are
   * answering the same frame, and reading the drawn position would make the answer depend on
   * which of them the producer called first.
   */
  private val obstructingView = KeyboardObstructingView { obstructionPx ->
    val root = rootView
    if (root == null) {
      Float.MAX_VALUE
    } else {
      val bottom = bottomWithoutDockPx()
      bottom - keyboardOverlapPx(bottom, root.height, obstructionPx) - height
    }
  }

  /**
   * Publishes how docked this bar is, whenever the answer changes.
   *
   * See [ExpoKeyboardDockEvent] for the arithmetic and why it differs from the
   * iOS one while answering the same question.
   *
   * Guarded on a real change, and by more than an equality: the fraction moves
   * in hundredths across a third of a second and every send is a JavaScript
   * call. A quarter of a DIP is finer than anything an author can lay out
   * against and coarse enough to keep a transition to a couple of dozen
   * messages instead of one a frame.
   */
  private fun emitDock(geometry: KeyboardGeometry) {
    val safeArea = geometry.safeArea
    val keysBelow = max(geometry.height - safeArea, 0f)
    val reserve = min(max(safeArea - keysBelow, 0f), safeArea)
    if (abs(reserve - emittedReserve) < 0.25f) {
      return
    }
    emittedReserve = reserve

    val reactContext = context as? ReactContext ?: return
    /*
     * Checked before asking, because `UIManagerHelper.getEventDispatcher` CASTS
     * rather than checks — the same trap `ExpoScrollView.emitScroll` documents,
     * and this runs from a window-insets callback, which is just as bad a place
     * to throw from as a scroll.
     */
    val provider = (reactContext as? ThemedReactContext)?.reactApplicationContext ?: reactContext
    if (provider !is EventDispatcherProvider) {
      return
    }
    val dispatcher = UIManagerHelper.getEventDispatcher(reactContext) ?: return
    /*
     * A safe area of zero is a device with no gesture strip, and there the bar
     * is docked or it is not — there is no strip to measure the transition
     * against. Reporting 1 for "resting" rather than dividing by zero.
     */
    val docked = if (safeArea > 0f) reserve / safeArea else if (reserve > 0f) 1f else 0f
    dispatcher.dispatchEvent(
        ExpoKeyboardDockEvent(
            UIManagerHelper.getSurfaceId(reactContext),
            id,
            docked,
            // Already DIPs: `KeyboardGeometry` converts once, where the platform
            // reports pixels, so that no consumer has to know which side of that
            // boundary it is on.
            reserve,
        )
    )
  }

  /**
   * Keep watching a gesture a child has asked to keep to itself.
   *
   * The text field calls `requestDisallowInterceptTouchEvent(true)` the moment a drag begins on it
   * — that is how a field keeps a drag for selecting text — and the default behaviour is to honour
   * it, so this view saw the DOWN and then nothing at all. Measured: one `intercept DOWN` in the
   * log and not a single MOVE.
   *
   * Not honouring it is the same thing `ReactRootView` does, for the same reason, and the request
   * is still propagated upwards so nothing above is affected. What it costs is a vertical drag
   * inside a MULTI-LINE composer, which is now read as "put the keyboard away" rather than as
   * scrolling that field — but only while a keyboard is up, and only downwards. Horizontal
   * selection drags are untouched.
   */
  override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
    parent?.requestDisallowInterceptTouchEvent(disallowIntercept)
  }

  /**
   * Watch every touch that lands anywhere in the bar, without taking it.
   *
   * Watching rather than handling, because the bar is mostly made of things that want their own
   * touches — a text field to focus, a Send button to press. A drag is only recognised once it has
   * passed the slop, which is the same threshold every scrollable view uses to tell a press from a
   * drag, and only then is the gesture taken away from the child that was receiving it.
   */
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
        // Downward only. An upward drag on a composer is how a multi-line field is scrolled, and
        // the keyboard is already as far up as it goes.
        //
        // The gesture is claimed on the SLOP, not on the dragger reporting that it has control.
        // Taking control of the IME's animation is asynchronous — the request goes out on this
        // event and `onReady` arrives later — so waiting for a true answer means never claiming
        // the gesture: every subsequent move goes to the text field under the finger, and the
        // controller turns up with nothing driving it. That is exactly what happened, and it
        // looked like the drag handling was not wired up at all.
        //
        // Claiming it is safe because it is conditioned on there BEING a keyboard: with none up,
        // a downward drag on the composer is somebody scrolling a multi-line field and is left
        // alone.
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
          // Offered on EVERY move, not only the first: the dragger places the keyboard by hand on
          // each one, and the early ones are what the request for control was made from.
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
    // Nothing recomputes this until the keyboard next moves, so a bar that leaves the window
    // mid-transition would come back still displaced.
    applyDockOffsetPx(0f)
    // Nothing will recompute this until the keyboard next moves, so a bar that
    // leaves the window mid-transition would come back having told nobody.
    emittedReserve = -1f
  }

  private companion object {
    /** `computeCurrentVelocity` reports per this many milliseconds; the dragger wants per second. */
    const val UNITS_PER_SECOND = 1000
  }
}
