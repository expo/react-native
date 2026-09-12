/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.scroll

import android.content.Context
import android.graphics.Rect
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.widget.NestedScrollView
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.StateWrapper
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.EventDispatcherProvider
import com.facebook.react.views.keyboard.KeyboardDragger
import com.facebook.react.views.keyboard.KeyboardGeometryListener
import com.facebook.react.views.keyboard.KeyboardInsets

/**
 * The scroll view for `<native:scroll>`.
 *
 * ## Why it is not [ReactScrollView]
 *
 * [ReactScrollView] extends `android.widget.ScrollView`, which implements none of the platform's
 * nested-scrolling protocol — no `NestedScrollingChild3`, no `NestedScrollingParent3`. Grep it and
 * the word does not appear. That protocol is how scrolling containers cooperate on Android: it is
 * what lets a list drive a collapsing toolbar, hand a fling to a bottom sheet when it reaches its
 * top, or sit inside anything built on `CoordinatorLayout`. A scroll view that does not speak it
 * cannot take part in those interfaces at all, which is a different thing from doing them badly.
 *
 * This extends `NestedScrollView`, which is the platform's own answer and implements both halves.
 * Everything below is what has to be added back on top of it for a React-mounted subtree, and the
 * list is deliberately short — the scrolling, the fling, the edge effects, the nested-scroll
 * cooperation and the touch arbitration are all the platform's, not ours.
 *
 * ## Insets
 *
 * Insets are applied here, on the UI thread, in the frame they are computed. They never travel
 * through the shadow tree: a keyboard animation would otherwise commit a layout per frame to move
 * content whose size has not changed. The top is applied by displacing the content and the bottom
 * by extending the scrollable range, because those are the two different things "reserve room"
 * means at the two ends — see [applyInsets].
 */
public class ExpoScrollView(context: Context) :
    NestedScrollView(context), VirtualViewContainer, ReactScrollViewHelper.HasSmoothScroll {

  /** The single content container React mounts into this. */
  private val contentView: View?
    get() = if (childCount > 0) getChildAt(0) else null

  // ------------------------------------------------------- virtualization

  /**
   * The state a `VirtualView` inside this scroll view attaches itself to.
   *
   * A `VirtualView` walks up its parents for the first one that is a
   * [VirtualViewContainer]; implementing this is the whole of being a virtualization container. The
   * state does the rest, computing each virtual view's mode from this view's scroll position and
   * bounds, and it is told to recompute at the three places below.
   *
   * Built on demand, so a scroll view with nothing virtualized in it never makes one.
   */
  private var _virtualViewContainerState: VirtualViewContainerState? = null

  override val virtualViewContainerState: VirtualViewContainerState
    get() =
        _virtualViewContainerState
            ?: VirtualViewContainerState.create(this).also { _virtualViewContainerState = it }

  /*
   * There is no recycle path to clear this on, and that is deliberate rather than missed:
   * `ExpoScrollViewManager` does not call `setupViewRecycling()`, so a `<native:scroll>` view is
   * dropped rather than reused and the state goes with it. `RCTScrollViewComponentView` and
   * `ReactScrollView` both nil theirs because both ARE recycled — if this manager ever opts in,
   * this is the field that has to be cleared there.
   */

  // ---------------------------------------------------------------- layout

  /**
   * Sized by the mounting layer, not by measurement.
   *
   * Yoga has already decided how big this view and its content are, so measuring the child here
   * would be asking a second time and getting a worse answer. The scroll range still comes out
   * right because `NestedScrollView` computes it from the child's height, which the mounting layer
   * sets.
   */
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(
        MeasureSpec.getSize(widthMeasureSpec),
        MeasureSpec.getSize(heightMeasureSpec),
    )
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    // Deliberately not `super.onLayout`: the mounting layer positions the content, and letting
    // FrameLayout place it as well would fight over the same pixels.
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
    // A row's distance from the viewport is a function of the layout, so this is one of the three
    // places it can change. The others are `onSizeChanged` and `onScrollChanged`.
    _virtualViewContainerState?.updateState()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    _virtualViewContainerState?.updateState()
  }

  // ---------------------------------------------------------------- insets

  /**
   * The author's own inset, added to whatever is reserved automatically rather than replacing it.
   *
   * An author asking for eight points of breathing room at the bottom means eight more than the
   * keyboard needs, not eight instead of it.
   */
  public var contentInset: Rect = Rect()
    set(value) {
      if (field == value) return
      field = Rect(value)
      applyInsets()
    }

  /** Which edges get room made for them automatically. */
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

  /** What the safe area asked for, recomputed when the view moves or the bars change. */
  private var safeAreaTop = 0
  private var safeAreaBottom = 0

  /** The sides, which reach the scrollbar and nothing else. See [applyInsets]. */
  private var safeAreaLeft = 0
  private var safeAreaRight = 0

  /** What the keyboard is asking for, as of the last frame it moved. */
  private var keyboardBottom = 0

  private var appliedTop = 0
  private var appliedBottom = 0

  /**
   * Called by whoever wants to know the composed insets, every time they change.
   *
   * The composed total, not the request: a caller tracking the keyboard needs the number actually
   * in force, and needs it in the same message as the offset it belongs to.
   */
  public var onInsetsChanged: ((top: Int, bottom: Int) -> Unit)? = null

  /**
   * Reserve room at both ends, by the two different mechanisms the two ends need.
   *
   * The top DISPLACES the content: the first row has to start below the status bar, and the only
   * way to move content the mounting layer has positioned is to move the view holding it.
   *
   * The bottom EXTENDS THE RANGE: the last row has to be reachable above the keyboard, which is a
   * question of how far the view can scroll rather than of where anything is drawn.
   *
   * The top's displacement is added to the range as well, or pushing the content down by it would
   * push the same amount off the far end.
   */
  private fun applyInsets() {
    val top = contentInset.top + if (automaticInsetTop) safeAreaTop else 0
    val bottom =
        contentInset.bottom + maxOf(if (automaticInsetBottom) safeAreaBottom else 0, keyboardBottom)

    if (top == appliedTop && bottom == appliedBottom && paddingLeft == safeAreaLeft &&
        paddingRight == safeAreaRight) {
      return
    }

    /*
     * Asked BEFORE the inset moves, because the inset moving is what makes the answer change.
     *
     * This is the case a native transcript models with a scroll intent that its composer can update: focusing
     * the composer brings up the keyboard, and typing a second line makes the composer taller, and
     * both change how much of the transcript is covered. A reader at the newest message expects to
     * still be at the newest message afterwards — without this the content stays where it was and
     * the last row slides behind the composer.
     */
    /*
     * The remembered intent, not a measurement taken now.
     *
     * `wasAtBottomBeforeGrowth` is what the view was the last time it scrolled, which is the native
     * transcript's model: the scroll INTENT is state the user's scrolling updates, and layout changes ENFORCE
     * it. Asking "am I at the bottom" at the moment an inset changes looks equivalent and is not —
     * with a native navigator resizing the screen at the same time, the question gets answered
     * against a view that is briefly neither where it was nor where it is going.
     */
    val followBottom =
        contentAnchor == "bottom" &&
            (wasAtBottomBeforeGrowth || isAtBottom() || scrollingToLatest)

    appliedTop = top
    appliedBottom = bottom

    contentView?.translationY = top.toFloat()
    clipToPadding = false
    /*
     * Horizontal padding, for the SCROLLBAR alone.
     *
     * It cannot move the content — the mounting layer positions that, which is why the left and
     * right insets are a limitation here — but it does move the scrollbar, which the framework
     * draws inside the padding box. So the one thing horizontal padding can still do is the one
     * thing that is wanted: keep the indicator out of a display cutout in landscape while the
     * content goes edge to edge on purpose.
     *
     * Which is the native transcript's behaviour, read rather than reasoned:
     * its collection view's `setScrollIndicatorInsets:` override passes the caller's top and bottom
     * through and replaces left and right with the safe area's.
     */
    setPadding(safeAreaLeft, 0, safeAreaRight, top + bottom)
    if (followBottom) {
      scrollToBottom()
    }
    keepFocusedChildVisible()
    onInsetsChanged?.invoke(top, bottom)
  }

  /*
   * DOM-CSS-LIMITATION: the left and right insets are not delivered on Android.
   *
   * Both mechanisms this view has are vertical. Displacing the content sideways would push it out
   * of a viewport it exactly fills, because Yoga sized it to the viewport's width, and there is no
   * horizontal scroll range to extend in a vertical scroll view. Delivering them properly means
   * making the CONTENT narrower, which is a layout decision and so belongs in the shadow tree
   * rather than here.
   *
   * iOS has no such limit — `UIScrollView.contentInset` takes all four edges — so a side cutout is
   * reserved there and not here. Until this is fixed, an author who needs it should put the
   * padding on `contentContainerStyle`, where it is a layout decision and behaves the same on both.
   */

  /**
   * What the system bars leave for this view, measured as the OVERLAP with them.
   *
   * ## The collapsing-toolbar conflict, and why `automaticInsets` names edges
   *
   * A collapsing toolbar wants the opposite of this at the top. Its pattern is that content
   * scrolls UNDER the status bar while the toolbar, drawn over it with a scrim, owns the safe
   * area. This rule says the view overlaps the status bar and so must reserve for it.
   *
   * Measured in the demo app: with the toolbar expanded the scroll view starts at y=168 and
   * overlaps nothing, so the reservation is correctly zero. With it collapsed the view sits at
   * y=0, the reservation becomes the status bar's 136px, and switching `automaticInsets.top` off
   * shifts the content back up by exactly that. So the two are visibly fighting during the
   * collapse, and neither is wrong — they are answering different questions.
   *
   * This is why `automaticInsets` names edges rather than being a boolean. An app with a
   * collapsing toolbar sets `automaticInsets={{top: false}}` and hands the top to the toolbar; an
   * app without one — the common case, and so the default — keeps it.
   *
   * Not the inset itself: a scroll view that already stops above the navigation bar needs nothing
   * reserved there, and one running to the window's edge needs all of it. Asking how far this view
   * extends past each bar answers both without knowing anything about how the app is laid out —
   * which matters because an app drawing edge to edge and one whose window is already inset need
   * the same code to do different things.
   */
  private fun updateAutomaticInsets() {
    val root = rootView
    val insets = ViewCompat.getRootWindowInsets(this)
    if (root == null || insets == null || width == 0 || height == 0) {
      return
    }
    val bars =
        insets.getInsets(
            WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
    val location = IntArray(2)
    getLocationInWindow(location)
    // This view's own top, which does not move when it reserves — what the top reservation
    // displaces is the content inside it. Measuring against the displaced position instead makes
    // the reservation keep re-earning itself.
    safeAreaTop = maxOf(bars.top - location[1], 0)
    safeAreaBottom = maxOf((location[1] + height) - (root.height - bars.bottom), 0)
    safeAreaLeft = maxOf(bars.left - location[0], 0)
    safeAreaRight = maxOf((location[0] + width) - (root.width - bars.right), 0)
    applyInsets()
  }

  // -------------------------------------------------------------- keyboard

  private var observedKeyboardInsets: KeyboardInsets? = null

  private val keyboardListener = KeyboardGeometryListener { geometry ->
    val insets = observedKeyboardInsets ?: return@KeyboardGeometryListener
    val location = IntArray(2)
    getLocationInWindow(location)
    val viewBottom = (location[1] + height).toFloat()
    // The obstruction is the keyboard AND anything docked on top of it: a composer bar covers the
    // rows behind it exactly as the keyboard does.
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

  /**
   * Where this view sat when the safe area was last computed.
   *
   * The overlap with a bar depends on where the view IS, and it can move without being laid out
   * again: a `CoordinatorLayout` collapsing a toolbar offsets its scrolling child with
   * `offsetTopAndBottom`, which changes the view's position and fires no layout pass. Watching for
   * that in a pre-draw listener is what keeps the reservation honest while the toolbar moves —
   * which is exactly when the view is sliding under the status bar.
   */
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
    // The anchor helper listens to the UI manager, which outlives this view — so
    // its listening is scoped to being in a window rather than to existing.
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

  /**
   * Keep whatever is focused above the obstruction as it arrives.
   *
   * The platform scrolls a child into view when it GAINS focus, but that runs before the keyboard
   * has moved: the delta is computed against the viewport as it was, so a field near the bottom is
   * scrolled to a position the keyboard then covers.
   */
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

    /*
     * The visible window in the CONTENT's own coordinates, which is what
     * `offsetDescendantRectToMyCoords` reports — it walks left/top and ignores the displacement.
     *
     * Derived rather than guessed. Content is drawn at `contentY - scrollY + top`, and the visible
     * band of the screen is `top` to `height - bottom`, so the visible content is
     * `scrollY` to `scrollY + height - top - bottom`. The displacement cancels at the top edge,
     * which is the step that is easy to get wrong: subtracting it there moves the window up by the
     * status bar's height and scrolls fields that were already visible.
     */
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

  // ----------------------------------------------------------- interaction

  init {
    /*
     * Stated, not inherited. A bare NestedScrollView comes with its scroll bar DISABLED — asserted
     * in ExpoScrollViewManagerTest — and the manager's `@ReactProp` default cannot fix that,
     * because an unset prop never reaches the setter at all. The default has to be written on the
     * view or it is not a default, it is a hope.
     */
    isVerticalScrollBarEnabled = true
  }

  /**
   * Whether the content rubber-bands past its ends.
   *
   * Android calls it over-scroll and expresses it as a mode rather than a flag, which is the only
   * difference: `ALWAYS` is the platform's own default and what a native list does.
   */
  public var bounces: Boolean = true
    set(value) {
      if (field == value) return
      field = value
      overScrollMode = if (value) OVER_SCROLL_ALWAYS else OVER_SCROLL_NEVER
    }

  /**
   * What a drag does to the keyboard.
   *
   * `interactive` is iOS's word for dragging the keyboard down with the finger and back up again,
   * and it is the default. Android expresses the same thing through
   * `WindowInsetsAnimationController`, which [KeyboardDragger] drives; the drag is offered to it
   * only once the scroll itself has nowhere left to go, so a pull that could still scroll does.
   */
  public var keyboardDismissMode: String = "interactive"

  /**
   * Which end of the content this view holds on to: `"top"` or `"bottom"`.
   *
   * `bottom` is a chat. It starts at the newest message and stays there when one arrives — but only
   * if the reader was already there. Someone who has scrolled up to read something older is not
   * moved, because moving them would be the bug rather than the feature.
   */
  /** `"top"` by default, which is what both platforms do. See the C++ enum. */
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

  // ------------------------------------------- holding the content still

  /**
   * A bottom-anchored list holds the CONTENT still, not the offset.
   *
   * The offset is measured from the top, so anything that changes the content ABOVE the viewport —
   * older messages loaded in, a row measured for the first time, an edit far back in the history —
   * moves everything the reader is looking at down by however much it added. Following the end when
   * the reader is AT the end is only half of what the anchor means, and the missing half is the
   * half a reader notices.
   *
   * [MaintainVisibleScrollPositionHelper] is React Native's own answer to exactly this and is
   * reused rather than reimplemented: it listens to the UI manager, remembers the first
   * partially-visible row before items are mounted and moves the offset by however far that row
   * travelled afterwards. It needs no estimate of what changed and no cooperation from whatever
   * changed it.
   *
   * Turned on by the ANCHOR rather than by a prop of its own. `contentAnchor="bottom"` is a
   * statement about which end is fixed; a reader who has to be told twice to keep their place has
   * been told once too often.
   */
  private var anchorHelper: MaintainVisibleScrollPositionHelper<ExpoScrollView>? = null

  private fun updateAnchorHelper() {
    val wanted = contentAnchor == "bottom"
    if (wanted && anchorHelper == null) {
      anchorHelper =
          MaintainVisibleScrollPositionHelper(this, false).also {
            /*
             * Every row counts, and there is no auto-scroll to the top: this element's own
             * `scrollToTop()` is how an app asks for that, deliberately.
             *
             * Built DIRECTLY rather than through `Config.fromReadableMap`. The map was made here
             * only to be read back on the next line, and making one loads the bridge's native
             * library — which a JVM unit test does not have, so two of
             * `ExpoScrollViewManagerTest`'s cases died inside `Arguments.createMap` with an
             * `ExceptionInInitializerError` that said nothing about anchors.
             */
            it.config = MaintainVisibleScrollPositionHelper.Config(0, null)
            /*
             * Started only if the view is already up. The helper listens to the UI manager, which
             * is a thing a detached view has no business holding — `onAttachedToWindow` starts it
             * and `onDetachedFromWindow` stops it, and this line existed only to cover the case
             * where the prop arrives after the view is on screen.
             *
             * It also made two unit tests fail for a reason that had nothing to do with anchors:
             * a JVM test sets the prop on a view that is never attached, and `start()` asserts a
             * UI manager it cannot have.
             */
            if (isAttachedToWindow) {
              it.start()
            }
          }
    } else if (!wanted && anchorHelper != null) {
      anchorHelper?.stop()
      anchorHelper = null
    }
  }

  override fun reactSmoothScrollTo(x: Int, y: Int) {
    smoothScrollTo(x, y)
  }

  override fun scrollToPreservingMomentum(x: Int, y: Int) {
    scrollTo(x, y)
  }

  /** Set when the anchor is asked for before there is any content to anchor to. */
  private var pendingAnchorScroll = false

  /**
   * Whether the view is at the end, within a tolerance.
   *
   * Read BEFORE the content grows, because afterwards the question is unanswerable: every scroll
   * position looks "not at the bottom" once something has been added below it.
   */
  private fun isAtBottom(): Boolean {
    // A few pixels of slack: a fling that has settled can land a pixel short, and a chat that stops
    // following after one such landing reads as broken.
    return scrollY >= maxScrollY() - ANCHOR_TOLERANCE_PX
  }

  /**
   * The furthest this can scroll, which is zero while the content still fits.
   *
   * That zero is what makes a chat start at the TOP. A conversation with three messages shows them
   * from the top of the screen, as it should; only once the content outgrows the viewport does
   * "the bottom" become a different place from "the top", and only then does anchoring to it mean
   * anything. Nothing has to special-case the short case — it falls out of the clamp.
   */
  private fun maxScrollY(): Int {
    val content = contentView ?: return 0
    return maxOf(content.height + paddingBottom - height, 0)
  }

  /**
   * Set while an animated scroll to the newest content is in flight.
   *
   * It counts as being at the bottom. Without that, sending a message while the keyboard is still
   * rising loses the anchor: the animated scroll aims at the maximum as it was when it started, the
   * inset keeps growing underneath it, and the checks that would re-target see a view that is
   * mid-animation and therefore "not at the bottom". Measured as a sent message overlapping the
   * composer by 48px, which only happens when the send is quick enough to race the keyboard —
   * which is to say, whenever anyone actually uses it.
   */
  private var scrollingToLatest = false

  /** Jump to the newest content, without animating. */
  public fun scrollToBottom() {
    scrollTo(scrollX, maxScrollY())
  }

  /**
   * Scroll to the newest content, animated — what an app calls after sending a message.
   *
   * Animated because it is a response to something the user just did: a message they sent should
   * be seen to arrive, where the same jump on someone else's message would be a lurch.
   */
  public fun scrollToLatest(animated: Boolean) {
    if (animated) {
      scrollingToLatest = true
      smoothScrollTo(scrollX, maxScrollY())
    } else {
      scrollingToLatest = false
      scrollToBottom()
    }
  }

  /** Scroll to the earliest loaded content. */
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
      // A finger on the list outranks a scroll the app asked for a moment ago.
      scrollingToLatest = false
    }
    val intercepted = super.onInterceptTouchEvent(ev)
    // `interactive` is handled in onTouchEvent, where the drag can be offered to the keyboard
    // frame by frame. Dismissing here as well would put it away before the finger had a say.
    if (intercepted && keyboardDismissMode == "on-drag") {
      // The moment the scroll takes the gesture, which is what "on drag" means — not touch-down,
      // which would dismiss the keyboard on a tap that was never a drag.
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

  // ------------------------------------------------------------------ events

  /**
   * Reported through the platform's own scroll event rather than a new one.
   *
   * The payload a scroll reports is the same whichever view produced it — offset, content size,
   * viewport — and React Native's `ScrollEvent` already carries exactly that under the names this
   * element's view config maps (`topScroll` and friends). Inventing a parallel event would have
   * meant a second shape for the same information.
   */
  private fun emitScroll(type: ScrollEventType) {
    val reactContext = context as? ReactContext ?: return
    val content = contentView ?: return
    /*
     * Checked before asking, because `UIManagerHelper.getEventDispatcher` CASTS rather than checks:
     * a context that cannot provide a dispatcher throws from inside a scroll, which is the worst
     * place to find out. Reached by a view under test, and by a view whose surface has gone while a
     * fling is still running.
     */
    val provider = (reactContext as? ThemedReactContext)?.reactApplicationContext ?: reactContext
    if (provider !is EventDispatcherProvider) {
      return
    }
    val dispatcher = UIManagerHelper.getEventDispatcher(reactContext) ?: return
    dispatcher.dispatchEvent(
        ScrollEvent.obtain(
            UIManagerHelper.getSurfaceId(reactContext),
            id,
            type,
            scrollX.toFloat(),
            scrollY.toFloat(),
            0f,
            0f,
            content.width,
            content.height,
            width,
            height,
        )
    )
  }

  /**
   * Follow the content when it grows, if the reader was at the end.
   *
   * The check has to happen BEFORE the new height is adopted, which is why it hangs off the content
   * view's layout rather than off a size observer: by the time a size change has been applied,
   * every position looks like "not at the bottom".
   */
  private val contentGrowthWatcher =
      OnLayoutChangeListener { _, _, top, _, bottom, _, oldTop, _, oldBottom ->
        val grew = (bottom - top) > (oldBottom - oldTop)
        if (grew && contentAnchor == "bottom" && (wasAtBottomBeforeGrowth || scrollingToLatest)) {
          post { scrollToBottom() }
        }
      }

  /** Sampled every scroll, so that it is the state BEFORE any growth. */
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

  /**
   * Where the content has been scrolled to, told to the shadow tree.
   *
   * `ExpoScrollViewShadowNode::getContentOriginOffset` subtracts this from every descendant's
   * position, and it is what makes a measurement of something inside a scroll view answer where
   * that thing actually is rather than where it sits in the content. Nothing wrote it until now, so
   * the offset was zero for the life of the element: on iOS a balloon measured 109 points above
   * where it drew, and a send animation that starts from a measurement flew in from the wrong
   * place.
   *
   * Deduped against the last value pushed, because this runs on every frame of every scroll and a
   * state update crosses JNI. In DIP, which is the unit the shadow tree keeps.
   */
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

  /** Whether this touch is over the keyboard, or over whatever is docked on top of it. */
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
          /*
           * The finger has to be ON the obstruction, which is iOS's rule rather than a guess.
           * UIKit states it on `UIKeyboardLayoutGuide.keyboardDismissPadding`: "the gesture waits
           * to start the dismiss until it intersects with the keyboard", and that property exists
           * to start it earlier. The native chat app sets one.
           *
           * The first rule written here was "once the scroll has nowhere left to go", which is a
           * different interaction: it only works at the very top of a list, so the common case —
           * dragging down over the keyboard in the middle of a conversation — did nothing.
           *
           * The obstruction rather than the keyboard alone, so a composer docked on top of it
           * counts too. That is what `keyboardDismissPadding` is for on iOS, and here it falls out
           * of already knowing where the whole obstruction starts.
           */
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

  /**
   * A container mounted after the insets were computed still gets them.
   *
   * No check that this is the only child, though it must be: `NestedScrollView` already asserts
   * that, and gets there first — its own `addView` overloads throw "ScrollView can host only one
   * direct child" before this override is reached. A second check here would be unreachable code
   * claiming to protect something.
   */
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
    /** Slack for "at the bottom", in pixels. A settled fling can land a pixel short. */
    const val ANCHOR_TOLERANCE_PX = 8
  }
}
