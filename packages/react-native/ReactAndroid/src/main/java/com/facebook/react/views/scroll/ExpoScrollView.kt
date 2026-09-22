/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.scroll

import android.content.Context
import android.graphics.Rect
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import androidx.annotation.VisibleForTesting
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.widget.NestedScrollView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.StateWrapper
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import com.facebook.react.uimanager.events.EventDispatcherProvider
import com.facebook.react.views.keyboard.KeyboardDragger
import com.facebook.react.views.keyboard.KeyboardGeometryListener
import com.facebook.react.views.keyboard.KeyboardInsets

/**
 * The scroll view for `<native:scroll>`.
 *
 * A `NestedScrollView` rather than [ReactScrollView], whose `android.widget.ScrollView` base speaks
 * none of the nested-scrolling protocol that lets a list drive a collapsing toolbar or hand a fling
 * to a bottom sheet. Scrolling, flinging, edge effects and touch arbitration are the platform's.
 *
 * Insets are applied here on the UI thread in the frame they are computed, never through the shadow
 * tree, which would commit a layout per keyboard frame. The top displaces the content and the
 * bottom extends the scrollable range, see [applyInsets].
 */
public class ExpoScrollView(context: Context) :
    NestedScrollView(context),
    VirtualViewContainer,
    ReactScrollViewHelper.HasScrollEventThrottle,
    ReactScrollViewHelper.HasSmoothScroll {

  // The single content container React mounts into this
  private val contentView: View?
    get() = if (childCount > 0) getChildAt(0) else null

  /**
   * The state a `VirtualView` inside this scroll view attaches to; a `VirtualView` walks up to the
   * first [VirtualViewContainer]. Built on demand, and told to recompute on layout, size and
   * scroll.
   */
  private var _virtualViewContainerState: VirtualViewContainerState? = null

  override val virtualViewContainerState: VirtualViewContainerState
    get() =
        _virtualViewContainerState
            ?: VirtualViewContainerState.create(this).also { _virtualViewContainerState = it }

  // Not cleared on recycle because `ExpoScrollViewManager` does not opt into view recycling; if it
  // ever does, this is the field to clear

  // Sized by the mounting layer, not by measuring the child; `NestedScrollView` still computes the
  // scroll range from the child's height
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(
        MeasureSpec.getSize(widthMeasureSpec),
        MeasureSpec.getSize(heightMeasureSpec),
    )
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    // Not `super.onLayout`: the mounting layer positions the content
    if (changed) {
      updateAutomaticInsets()
    }
    if (pendingAnchorScroll && contentAnchor == "bottom") {
      val content = contentView
      if (content != null && content.height > 0) {
        pendingAnchorScroll = false
        scrollToBottom()
      }
    }
    _virtualViewContainerState?.updateState()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    _virtualViewContainerState?.updateState()
  }

  // The author's inset, added to what is reserved automatically rather than replacing it
  public var contentInset: Rect = Rect()
    set(value) {
      if (field == value) return
      field = Rect(value)
      applyInsets()
    }

  // Which edges get room made for them automatically
  public var automaticInsetTop: Boolean = true
    set(value) {
      if (field == value) return
      field = value
      updateAutomaticInsets()
    }

  public var automaticInsetBottom: Boolean = true
    set(value) {
      if (field == value) return
      field = value
      updateAutomaticInsets()
    }

  public var avoidsKeyboard: Boolean = true
    set(value) {
      if (field == value) return
      field = value
      updateKeyboardObservation()
      updateAutomaticInsets()
    }

  // The safe area's overlap with this view, recomputed when the view moves or the bars change
  private var safeAreaTop = 0
  private var safeAreaBottom = 0

  // The sides reach the scrollbar and nothing else, see [applyInsets]
  private var safeAreaLeft = 0
  private var safeAreaRight = 0

  // The keyboard's claim, as of the last frame it moved
  private var keyboardBottom = 0

  private var appliedTop = 0
  private var appliedBottom = 0

  // Called with the composed insets, the numbers in force, every time they change
  public var onInsetsChanged: ((top: Int, bottom: Int) -> Unit)? = null

  /**
   * Reserves room at both ends. The top displaces the content, the only way to move content the
   * mounting layer positioned; the bottom extends the scroll range so the last row is reachable
   * above the keyboard. The top's displacement is added to the range too, or it would push the same
   * amount off the far end.
   */
  private fun applyInsets() {
    val top = contentInset.top + if (automaticInsetTop) safeAreaTop else 0
    val bottom =
        contentInset.bottom + maxOf(if (automaticInsetBottom) safeAreaBottom else 0, keyboardBottom)

    if (
        top == appliedTop &&
            bottom == appliedBottom &&
            paddingLeft == safeAreaLeft &&
            paddingRight == safeAreaRight
    ) {
      return
    }

    // The remembered intent, asked before the inset moves: scrolling updates the intent and layout
    // changes enforce it, and a navigator may be resizing the screen at the same moment
    val followBottom =
        contentAnchor == "bottom" && (wasAtBottomBeforeGrowth || isAtBottom() || scrollingToLatest)

    appliedTop = top
    appliedBottom = bottom

    contentView?.translationY = top.toFloat()
    clipToPadding = false
    // Horizontal padding moves only the scrollbar, which the framework draws inside the padding
    // box; the mounting layer positions the content, hence the limitation below
    setPadding(safeAreaLeft, 0, safeAreaRight, top + bottom)
    if (followBottom) {
      scrollToBottom()
    }
    keepFocusedChildVisible()
    onInsetsChanged?.invoke(top, bottom)
    emitInsetChange()
  }

  /*
   * DOM-CSS-LIMITATION: the left and right insets are not delivered on Android.
   *
   * Both mechanisms here are vertical: displacing the content sideways pushes it out of a viewport
   * Yoga sized it to fill, and a vertical scroll view has no horizontal range to extend. Delivering
   * them means making the content narrower, a layout decision for the shadow tree. iOS takes all
   * four edges; an author who needs the sides puts the padding on `contentContainerStyle`.
   */

  /**
   * The system bars' overlap with this view, not the insets themselves: a scroll view that stops
   * above a bar needs nothing reserved there. A collapsing toolbar wants the opposite at the top,
   * since its content scrolls under the status bar while the toolbar owns the safe area, which is
   * why `automaticInsets` names edges: such an app sets `automaticInsets={{top: false}}`.
   */
  private fun updateAutomaticInsets() {
    val root = rootView
    val insets = ViewCompat.getRootWindowInsets(this)
    if (root == null || insets == null || width == 0 || height == 0) {
      return
    }
    val bars =
        insets.getInsets(
            WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
        )
    val location = IntArray(2)
    getLocationInWindow(location)
    // This view's own top, which does not move when it reserves; measuring against the displaced
    // content would make the reservation re-earn itself
    safeAreaTop = maxOf(bars.top - location[1], 0)
    safeAreaBottom = maxOf((location[1] + height) - (root.height - bars.bottom), 0)
    safeAreaLeft = maxOf(bars.left - location[0], 0)
    safeAreaRight = maxOf((location[0] + width) - (root.width - bars.right), 0)
    applyInsets()
  }

  private var observedKeyboardInsets: KeyboardInsets? = null

  private val keyboardListener = KeyboardGeometryListener { geometry ->
    val insets = observedKeyboardInsets ?: return@KeyboardGeometryListener
    val location = IntArray(2)
    getLocationInWindow(location)
    val viewBottom = (location[1] + height).toFloat()
    // The obstruction is the keyboard and anything docked on top of it
    val obstructionTop = insets.obstructionTopPx(PixelUtil.toPixelFromDIP(geometry.height))
    keyboardBottom = maxOf(viewBottom - obstructionTop, 0f).toInt()
    applyInsets()
  }

  private fun updateKeyboardObservation() {
    observedKeyboardInsets?.removeListener(keyboardListener)
    observedKeyboardInsets = null
    if (!avoidsKeyboard || !isAttachedToWindow) {
      keyboardBottom = 0
      return
    }
    val root = rootView ?: return
    observedKeyboardInsets =
        KeyboardInsets.forRootView(root).also { it.addListener(keyboardListener) }
  }

  // Where this view sat when the safe area was last computed. A `CoordinatorLayout` collapsing a
  // toolbar moves its child with `offsetTopAndBottom`, which fires no layout pass, so the
  // position is watched before each draw.
  private var lastLocationY = Int.MIN_VALUE

  private val locationWatcher =
      android.view.ViewTreeObserver.OnPreDrawListener {
        val location = IntArray(2)
        getLocationInWindow(location)
        if (location[1] != lastLocationY) {
          lastLocationY = location[1]
          updateAutomaticInsets()
        }
        true
      }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    viewTreeObserver.addOnPreDrawListener(locationWatcher)
    updateKeyboardObservation()
    updateAutomaticInsets()
    // The anchor helper listens to the UI manager, which outlives this view
    anchorHelper?.start()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    viewTreeObserver.removeOnPreDrawListener(locationWatcher)
    lastLocationY = Int.MIN_VALUE
    observedKeyboardInsets?.removeListener(keyboardListener)
    observedKeyboardInsets = null
    anchorHelper?.stop()
  }

  // Keeps the focused child above the obstruction as it arrives; the platform's own
  // scroll-into-view runs on focus, before the keyboard has moved
  private fun keepFocusedChildVisible() {
    val focused = findFocus() ?: return
    var parent: View? = focused.parent as? View
    while (parent != null && parent !== this) {
      parent = parent.parent as? View
    }
    if (parent !== this) return

    val rect = Rect()
    focused.getDrawingRect(rect)
    offsetDescendantRectToMyCoords(focused, rect)

    // The visible window in the content's coordinates, which `offsetDescendantRectToMyCoords`
    // reports: content draws at `contentY - scrollY + top` in a band from `top` to
    // `height - bottom`, so the displacement cancels at the top edge
    val visibleTop = scrollY
    val visibleBottom = scrollY + height - paddingBottom
    val delta =
        when {
          rect.bottom > visibleBottom -> rect.bottom - visibleBottom
          rect.top < visibleTop -> rect.top - visibleTop
          else -> 0
        }
    if (delta != 0) {
      scrollBy(0, delta)
    }
  }

  init {
    // A bare NestedScrollView has its scroll bar disabled, and an unset `@ReactProp` never reaches
    // the setter, so the default is written on the view
    isVerticalScrollBarEnabled = true
  }

  // Whether the content rubber-bands past its ends; `OVER_SCROLL_ALWAYS` is the platform default
  public var bounces: Boolean = true
    set(value) {
      if (field == value) return
      field = value
      overScrollMode = if (value) OVER_SCROLL_ALWAYS else OVER_SCROLL_NEVER
    }

  // What a drag does to the keyboard; `interactive` drags it with the finger through
  // `WindowInsetsAnimationController`, which [KeyboardDragger] drives
  public var keyboardDismissMode: String = "interactive"

  // Which end the content holds on to, `"top"` or `"bottom"`. A bottom-anchored list stays at the
  // newest message when one arrives, but only if the reader was already there.
  public var contentAnchor: String = "top"
    set(value) {
      if (field == value) return
      field = value
      if (value == "bottom") {
        pendingAnchorScroll = true
        requestLayout()
      }
      updateAnchorHelper()
    }

  /**
   * Holds the content still, not the offset: anything that changes the content above the viewport
   * would otherwise move what the reader is looking at. [MaintainVisibleScrollPositionHelper] is
   * React Native's own answer and is reused; it is turned on by the anchor rather than a prop.
   */
  private var anchorHelper: MaintainVisibleScrollPositionHelper<ExpoScrollView>? = null

  private fun updateAnchorHelper() {
    val wanted = contentAnchor == "bottom"
    if (wanted && anchorHelper == null) {
      anchorHelper =
          MaintainVisibleScrollPositionHelper(this, false).also {
            // Every row counts and there is no auto-scroll to the top; built directly rather than
            // through `Config.fromReadableMap`, which loads the bridge's native library
            it.config = MaintainVisibleScrollPositionHelper.Config(0, null)
            // Started only if the view is already attached; the window callbacks start and stop it
            if (isAttachedToWindow) {
              it.start()
            }
          }
    } else if (!wanted && anchorHelper != null) {
      anchorHelper?.stop()
      anchorHelper = null
    }
  }

  // Required of anything [MaintainVisibleScrollPositionHelper] anchors; this element does not
  // throttle its events
  override var scrollEventThrottle: Int = 0
  override var lastScrollDispatchTime: Long = 0

  override fun reactSmoothScrollTo(x: Int, y: Int) {
    smoothScrollTo(x, y)
  }

  override fun scrollToPreservingMomentum(x: Int, y: Int) {
    scrollTo(x, y)
  }

  // Set when the anchor is asked for before there is any content to anchor to
  private var pendingAnchorScroll = false

  // Whether the view is at the end, read before the content grows
  private fun isAtBottom(): Boolean {
    return scrollY >= maxScrollY() - ANCHOR_TOLERANCE_PX
  }

  // The furthest this can scroll, zero while the content fits, which is what makes a short chat
  // start at the top
  private fun maxScrollY(): Int {
    val content = contentView ?: return 0
    return maxOf(content.height + paddingBottom - height, 0)
  }

  // Set while an animated scroll to the newest content is in flight. It counts as being at the
  // bottom, or a send during a keyboard rise loses the anchor mid-animation.
  private var scrollingToLatest = false

  // Jumps to the newest content without animating
  public fun scrollToBottom() {
    scrollTo(scrollX, maxScrollY())
  }

  // Scrolls to the newest content, what an app calls after sending a message
  public fun scrollToLatest(animated: Boolean) {
    if (animated) {
      scrollingToLatest = true
      smoothScrollTo(scrollX, maxScrollY())
    } else {
      scrollingToLatest = false
      scrollToBottom()
    }
  }

  // Scrolls to the earliest loaded content
  public fun scrollToTop(animated: Boolean) {
    if (animated) {
      smoothScrollTo(scrollX, 0)
    } else {
      scrollTo(scrollX, 0)
    }
  }

  public var scrollEnabled: Boolean = true

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    if (!scrollEnabled) return false
    if (ev.actionMasked == MotionEvent.ACTION_DOWN) {
      // A finger on the list outranks a scroll the app asked for a moment ago
      scrollingToLatest = false
    }
    val intercepted = super.onInterceptTouchEvent(ev)
    // `interactive` is handled in onTouchEvent, where the drag is offered to the keyboard frame
    // by frame
    if (intercepted && keyboardDismissMode == "on-drag") {
      // The moment the scroll takes the gesture, not touch-down, which a tap also produces
      dismissKeyboard()
      emitScroll(ScrollEventType.BEGIN_DRAG)
    }
    return intercepted
  }

  private fun dismissKeyboard() {
    val focused = findFocus() ?: return
    val imm =
        context.getSystemService(Context.INPUT_METHOD_SERVICE)
            as? android.view.inputmethod.InputMethodManager ?: return
    imm.hideSoftInputFromWindow(focused.windowToken, 0)
    focused.clearFocus()
  }

  // The element's own payload, the fields `ExpoScrollEvent` carries on iOS, so a handler written
  // against one platform reads the other
  private fun emitScroll(type: ScrollEventType) {
    dispatch(ScrollEventType.getJSEventName(type))
  }

  private fun emitInsetChange() {
    dispatch(INSET_CHANGE_EVENT)
  }

  private fun dispatch(eventName: String) {
    val reactContext = context as? ReactContext ?: return
    // Checked first, because `UIManagerHelper.getEventDispatcher` casts rather than checks; a view
    // under test or one whose surface has gone mid-fling has no dispatcher
    val provider = (reactContext as? ThemedReactContext)?.reactApplicationContext ?: reactContext
    if (provider !is EventDispatcherProvider) {
      return
    }
    val payload = eventPayload() ?: return
    val dispatcher = UIManagerHelper.getEventDispatcher(reactContext) ?: return
    dispatcher.dispatchEvent(
        ExpoScrollViewEvent(UIManagerHelper.getSurfaceId(reactContext), id, eventName, payload)
    )
  }

  /**
   * The offset is iOS's: where the viewport's top edge falls in content that rests at minus the top
   * inset. Android scrolls from zero and displaces the content, so the displacement is taken back
   * out, and `contentShift` is that displacement, since the tree is told the scroll position alone.
   * The side insets are zero, see the limitation above.
   */
  @VisibleForTesting
  internal fun eventPayload(): ExpoScrollPayload? {
    val content = contentView ?: return null
    val offsetY = dp(scrollY - appliedTop)
    return ExpoScrollPayload(
        offsetX = dp(scrollX),
        offsetY = offsetY,
        insetTop = dp(appliedTop),
        insetBottom = dp(appliedBottom),
        contentWidth = dp(content.width),
        contentHeight = dp(content.height),
        containerWidth = dp(width),
        containerHeight = dp(height),
        shiftY = -dp(appliedTop),
        // Nothing here moves the offset over time, so where it is is where it rests
        restOffset = offsetY,
        timestamp = SystemClock.uptimeMillis().toDouble(),
    )
  }

  private fun dp(pixels: Int): Double = PixelUtil.toDIPFromPixel(pixels.toFloat()).toDouble()

  // Follows the content when it grows if the reader was at the end, judged from the state sampled
  // before the growth
  private val contentGrowthWatcher =
      OnLayoutChangeListener { _, _, top, _, bottom, _, oldTop, _, oldBottom ->
        val grew = (bottom - top) > (oldBottom - oldTop)
        if (grew && contentAnchor == "bottom" && (wasAtBottomBeforeGrowth || scrollingToLatest)) {
          post { scrollToBottom() }
        }
      }

  // Sampled every scroll, so it is the state before any growth
  private var wasAtBottomBeforeGrowth = true

  override fun onScrollChanged(l: Int, t: Int, oldl: Int, oldt: Int) {
    wasAtBottomBeforeGrowth = isAtBottom()
    if (scrollingToLatest && wasAtBottomBeforeGrowth) {
      scrollingToLatest = false
    }
    updateStateWithScrollPosition()
    super.onScrollChanged(l, t, oldl, oldt)
    emitScroll(ScrollEventType.SCROLL)
    _virtualViewContainerState?.updateState()
  }

  // The scroll position told to the shadow tree, which `ExpoScrollViewShadowNode::
  // getContentOriginOffset` subtracts from every descendant's position so measurements answer
  // where a thing is. Deduped, since a state update crosses JNI on every scroll frame; in DIP.
  private var lastPushedScroll: Pair<Int, Int>? = null

  internal var stateWrapper: StateWrapper? = null

  private fun updateStateWithScrollPosition() {
    val wrapper = stateWrapper ?: return
    val current = Pair(scrollX, scrollY)
    if (lastPushedScroll == current) {
      return
    }
    lastPushedScroll = current
    val data = WritableNativeMap()
    data.putDouble("contentOffsetLeft", PixelUtil.toDIPFromPixel(scrollX.toFloat()).toDouble())
    data.putDouble("contentOffsetTop", PixelUtil.toDIPFromPixel(scrollY.toFloat()).toDouble())
    wrapper.updateState(data)
  }

  private val keyboardDragger: KeyboardDragger by lazy { KeyboardDragger(this) }
  private var lastDragY = 0f

  // Whether this touch is over the keyboard or whatever is docked on top of it
  private fun isOverObstruction(ev: MotionEvent): Boolean {
    val insets = observedKeyboardInsets ?: return false
    val obstructionTop = insets.obstructionTopPx(PixelUtil.toPixelFromDIP(insets.geometry.height))
    val location = IntArray(2)
    getLocationInWindow(location)
    return location[1] + ev.y >= obstructionTop
  }

  override fun onTouchEvent(ev: MotionEvent): Boolean {
    if (!scrollEnabled) return false

    if (keyboardDismissMode == "interactive") {
      when (ev.actionMasked) {
        MotionEvent.ACTION_DOWN -> lastDragY = ev.y
        MotionEvent.ACTION_MOVE -> {
          val delta = ev.y - lastDragY
          lastDragY = ev.y
          // The finger has to be on the obstruction, UIKit's rule from
          // `UIKeyboardLayoutGuide.keyboardDismissPadding`: the gesture waits to start the dismiss
          // until it intersects the keyboard, and a docked composer counts as part of it
          if (keyboardDragger.onDrag(ev.y, delta, !isOverObstruction(ev))) {
            return true
          }
        }
        MotionEvent.ACTION_UP,
        MotionEvent.ACTION_CANCEL -> {
          if (keyboardDragger.isControlling) {
            keyboardDragger.onRelease(0f)
            return true
          }
        }
      }
    }
    return super.onTouchEvent(ev)
  }

  // A container mounted after the insets were computed still gets them; `NestedScrollView` already
  // asserts there is only one child
  override fun addView(child: View, index: Int, params: ViewGroup.LayoutParams?) {
    super.addView(child, index, params)
    child.translationY = appliedTop.toFloat()
    child.addOnLayoutChangeListener(contentGrowthWatcher)
    if (contentAnchor == "bottom") {
      pendingAnchorScroll = true
    }
  }

  override fun removeView(child: View) {
    child.removeOnLayoutChangeListener(contentGrowthWatcher)
    super.removeView(child)
  }

  private companion object {
    // Slack for "at the bottom", in pixels: a settled fling can land a pixel short
    const val ANCHOR_TOLERANCE_PX = 8
  }
}

// What every event of `<native:scroll>` reports, in dp; see `ExpoScrollEvent` for the fields
internal data class ExpoScrollPayload(
    val offsetX: Double,
    val offsetY: Double,
    val insetTop: Double,
    val insetBottom: Double,
    val contentWidth: Double,
    val contentHeight: Double,
    val containerWidth: Double,
    val containerHeight: Double,
    val shiftY: Double,
    val restOffset: Double,
    val timestamp: Double,
) {
  fun toWritableMap(): WritableMap =
      Arguments.createMap().apply {
        putMap("contentOffset", point(offsetX, offsetY))
        putMap(
            "inset",
            Arguments.createMap().apply {
              putDouble("top", insetTop)
              putDouble("left", 0.0)
              putDouble("bottom", insetBottom)
              putDouble("right", 0.0)
            },
        )
        putMap("contentSize", size(contentWidth, contentHeight))
        putMap("containerSize", size(containerWidth, containerHeight))
        putMap("contentShift", point(0.0, shiftY))
        putDouble("restOffset", restOffset)
        putDouble("timestamp", timestamp)
      }

  private fun point(x: Double, y: Double): WritableMap =
      Arguments.createMap().apply {
        putDouble("x", x)
        putDouble("y", y)
      }

  private fun size(width: Double, height: Double): WritableMap =
      Arguments.createMap().apply {
        putDouble("width", width)
        putDouble("height", height)
      }
}

// One event of this element; a newer scroll or inset change replaces one not yet delivered
private class ExpoScrollViewEvent(
    surfaceId: Int,
    viewTag: Int,
    private val name: String,
    private val payload: ExpoScrollPayload,
) : Event<ExpoScrollViewEvent>(surfaceId, viewTag) {
  override fun getEventName(): String = name

  override fun canCoalesce(): Boolean = name == "topScroll" || name == INSET_CHANGE_EVENT

  override fun getEventData(): WritableMap = payload.toWritableMap()
}

internal const val INSET_CHANGE_EVENT: String = "topInsetChange"
