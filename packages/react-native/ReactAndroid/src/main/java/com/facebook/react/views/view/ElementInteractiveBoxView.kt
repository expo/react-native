/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Outline
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.util.TypedValue
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.HapticFeedbackConstants
import android.widget.PopupMenu
import android.text.SpannableString
import android.text.style.ForegroundColorSpan
import com.facebook.react.uimanager.BackgroundStyleApplicator
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.PointerEvents
import com.facebook.react.uimanager.style.BorderRadiusProp

/**
 * A box whose press state is tracked by Android's own touch dispatch, and which draws the
 * platform's press feedback while it is held.
 *
 * Extracted from `<button>`, which had all of this to itself, when `<a display:block>` turned out
 * to need exactly the same behaviour. Sharing it is not tidiness: the state machine below is a
 * restatement of AOSP's press rules — tap timeout, scrolling-container delay, slop, minimum flash
 * — and a second copy would drift from the first in ways nobody would notice until a press felt
 * subtly wrong on one element and not the other.
 *
 * ## Inert unless [interactive]
 *
 * This is the base for `element-box`, which backs EVERY block element: every `<div>`, every `<p>`.
 * Almost none of them are interactive, and a page full of clickable, focusable, ripple-bearing
 * boxes would be a serious regression — so nothing here engages until a subclass says the element
 * really is interactive. While it is false this behaves exactly as [ReactViewGroup] does, touch
 * dispatch included.
 *
 * ## Why the press is tracked natively at all
 *
 * `ACTION_CANCEL`. When an ancestor scroll container decides the gesture is a scroll it calls
 * `onInterceptTouchEvent` and Android delivers `ACTION_CANCEL` here — the exact analogue of
 * `touchesCancelled:` on iOS. That is how a press releases the instant a scroll claims the gesture,
 * with no round trip through JavaScript.
 *
 * The view is made clickable so it consumes the stream after `ACTION_DOWN`; without that, Android
 * routes the remaining events to an ancestor and the press could never be seen to end. This does
 * not blind React Native's own touch handling: the root sees every event on the way down through
 * `onInterceptTouchEvent`, before any child consumes it.
 *
 * Activation is deliberately not emitted here — `click` already arrives through the pointer-event
 * path, and emitting it again would fire every handler twice.
 */
internal open class ElementInteractiveBoxView(context: Context) : ReactViewGroup(context) {

  /**
   * One command of a `<menu>` child, flattened in JavaScript.
   *
   * Data rather than content, on both platforms: a platform menu is drawn by the platform, so
   * there is nothing for child shadow nodes to lay out.
   */
  data class MenuCommand(
      val id: String,
      val label: String,
      val disabled: Boolean,
      val destructive: Boolean
  )

  /**
   * A `<menu>`, as the platform's own — one builder, for every element that opens one.
   *
   * HTML's list of commands is the same list whoever presents it: a `<button>` opens it on a TAP
   * and a box on a HOLD, and what differs between them is only who opens it. Shared for the reason
   * the iOS side is shared (`EXPElementMenu.h`): two copies of a menu builder disagree, and the
   * disagreement shows up as the same markup drawing differently on two elements.
   *
   * Anchored on the view, so Android places it the way it places every other menu — above or below
   * by the room available, which is the same judgement UIKit makes and the reason neither platform
   * needs to be told where the keyboard is.
   */
  protected fun presentElementMenu(commands: List<MenuCommand>, onChoose: (String) -> Unit) {
    if (commands.isEmpty()) {
      return
    }
    val popup = PopupMenu(context, this)
    commands.forEachIndexed { index, command ->
      val title =
          if (command.destructive) {
            /*
             * Destructive is a COLOUR here and an attribute on iOS, because that is how each
             * platform says it. `colorError` is the theme's, so it follows a dark theme and an
             * author's own without being told.
             */
            val error = resolveThemeColor(android.R.attr.colorError)
            if (error == null) {
              SpannableString(command.label)
            } else {
              SpannableString(command.label).apply {
                setSpan(ForegroundColorSpan(error), 0, length, 0)
              }
            }
          } else {
            SpannableString(command.label)
          }
      popup.menu.add(0, index, index, title).isEnabled = !command.disabled
    }
    popup.setOnMenuItemClickListener { item ->
      val command = commands.getOrNull(item.itemId)
      if (command == null) {
        false
      } else {
        // The command's `id`, not its index: a list that reorders between the render that built
        // the menu and the tap that chose from it would otherwise report the wrong command, and a
        // menu is open for as long as someone is reading it.
        onChoose(command.id)
        true
      }
    }
    popup.show()
  }

  /** Called with `true` on press-in and `false` on press-out, cancel, or release. */
  var onPressChange: ((Boolean) -> Unit)? = null

  /**
   * Whether this box behaves as something that can be pressed.
   *
   * A `<button>` always is. A box is only interactive when it is a link, which is a question about
   * props rather than about the element, so it can change over the view's life and is applied
   * rather than assumed.
   */
  protected var interactive: Boolean = false
    set(value) {
      if (field == value) {
        return
      }
      field = value
      isClickable = value
      if (!value) {
        cancelPendingTap()
        cancelPendingUnpress()
        setElementPressed(false)
        clearPressFeedback()
      } else {
        updatePressFeedback()
      }
    }

  /**
   * Whether a HOLD on this box means something — `contextmenu`, the event a browser fires when a
   * finger rests on an element.
   *
   * Separate from [interactive], and it has to be: interactive means PRESSABLE, which on this
   * platform means clickable and a ripple, and a box that can be held is not a box that can be
   * tapped. Every `<div>` on the page would grow a ripple it never asked for.
   *
   * The timeout, the slop and the release on a scroll are all the platform's below — but the
   * platform's own `setOnLongClickListener` cannot be used, because [ReactViewGroup.onTouchEvent]
   * returns `true` without calling up to `View.onTouchEvent`, so the framework's long-press check
   * never runs. That is the same reason the press state machine here is hand-rolled, and the hold
   * is scheduled on the same clock: [ViewConfiguration.getLongPressTimeout].
   */
  protected var holdable: Boolean = false
    set(value) {
      if (field == value) {
        return
      }
      field = value
      if (!value) {
        cancelPendingHold()
      }
    }

  private var pendingHold: Runnable? = null

  private fun cancelPendingHold() {
    pendingHold?.let { removeCallbacks(it) }
    pendingHold = null
  }

  private fun scheduleHold() {
    cancelPendingHold()
    val hold = Runnable {
      pendingHold = null
      // The platform's own long-press haptic, which `View.performLongClick` would have played.
      performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
      onHeld()
    }
    pendingHold = hold
    postDelayed(hold, ViewConfiguration.getLongPressTimeout().toLong())
  }

  /** The hold completed. Nothing by default; a box that wants one overrides it. */
  protected open fun onHeld() {}

  /**
   * The hold is tracked in DISPATCH, not in `onTouchEvent`, and that is the whole of why it works.
   *
   * Every React Native view returns `true` from [ReactViewGroup.onTouchEvent] — touches are
   * dispatched in JavaScript, so the view consumes the stream and answers nothing — which means
   * the FIRST view under the finger takes it and no ancestor's `onTouchEvent` is ever called. A
   * box with a child filling it, which a chat balloon is, would never see one.
   *
   * `dispatchTouchEvent` runs on the way DOWN, before any child, on every event of the gesture
   * including the `ACTION_CANCEL` an ancestor scroll delivers when it takes over. So it sees
   * exactly what the hold needs to know, and it changes nothing: the event is passed straight on.
   * This is the same place UIKit's own recognisers sit relative to a subview's touches.
   */
  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (holdable) {
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> scheduleHold()
        MotionEvent.ACTION_MOVE -> if (!isInside(event)) cancelPendingHold()
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> cancelPendingHold()
      }
    }
    return super.dispatchTouchEvent(event)
  }

  /**
   * CSS `touch-action`. `none` means a gesture starting on this element belongs to it, so an
   * ancestor scroll container must not intercept it.
   *
   * The Android mechanism is `requestDisallowInterceptTouchEvent`, asserted on touch-down; iOS
   * reaches the same rule by answering `-[UIScrollView touchesShouldCancelInContentView:]`. Same
   * semantics, different plumbing — which is the point of expressing it as the CSS property rather
   * than as either platform's API.
   */
  var touchAction: String? = null

  private var elementPressed = false

  /**
   * Whether this element draws the platform's press feedback.
   *
   * Tied to the same flag as the press tracking itself. The two are one feature: the ripple is what
   * the tracked press state *looks like*, so a build with the recognizers off must not grow a
   * ripple that nothing drives.
   */
  var ripplesEnabled: Boolean = false
    set(value) {
      field = value
      if (value) {
        updatePressFeedback()
      }
    }

  protected var hasRipple: Boolean = false
  private var installedRippleRadii: FloatArray? = null

  private val tapTimeout = ViewConfiguration.getTapTimeout().toLong()
  private val pressedStateDuration = ViewConfiguration.getPressedStateDuration().toLong()
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop

  private var pendingTap: Runnable? = null
  private var pendingUnpress: Runnable? = null

  /** True between touch-down and the tap timeout, while this may still become a scroll. */
  private var isPrepressed = false

  protected fun setElementPressed(pressed: Boolean) {
    if (elementPressed == pressed) {
      return
    }
    elementPressed = pressed
    // The view's own pressed state as well as the element's, so backgrounds and ripples that key
    // off it draw the way any other pressed view on this platform does.
    isPressed = pressed
    onPressChange?.invoke(pressed)
  }

  /**
   * Whether an ancestor wants child presses delayed — the same walk `View.isInScrollingContainer`
   * does. That method is not public API, but the signal it reads is:
   * `ReactViewGroup` answers no and the scroll views answer yes, so a pressable box in a scroll
   * view delays and the same box in a plain view does not.
   */
  private fun isInScrollingContainer(): Boolean {
    var ancestor = parent
    while (ancestor is ViewGroup) {
      if (ancestor.shouldDelayChildPressedState()) {
        return true
      }
      ancestor = ancestor.parent
    }
    return false
  }

  private fun isInside(event: MotionEvent): Boolean {
    val x = event.x
    val y = event.y
    return x >= -touchSlop && y >= -touchSlop && x < width + touchSlop && y < height + touchSlop
  }

  private fun cancelPendingTap() {
    pendingTap?.let { removeCallbacks(it) }
    pendingTap = null
    isPrepressed = false
  }

  private fun cancelPendingUnpress() {
    pendingUnpress?.let { removeCallbacks(it) }
    pendingUnpress = null
  }

  /**
   * The press-state rule Android's own widgets follow, restated here because the framework's copy
   * of it cannot run.
   *
   * `View.onTouchEvent` implements all of this already — but [ReactViewGroup.onTouchEvent], which
   * this class inherits, returns `true` without calling up to it, because React Native dispatches
   * touches in JavaScript instead. So `super.onTouchEvent` stops one level short of the framework
   * logic, and an element that waited for `setPressed` was never pressed at all: verified by
   * logging, where every `ACTION_DOWN`/`MOVE`/`UP` arrived and `setPressed` was never called once.
   *
   * What is reproduced is AOSP's rule, using the platform's own signals rather than invented ones —
   * [ViewGroup.shouldDelayChildPressedState] decides whether there is a delay, and the timings are
   * `ViewConfiguration`'s, not constants picked here:
   *
   *  - inside a scrolling container the press waits out [ViewConfiguration.getTapTimeout], so a
   *    finger on its way past never lights it up; outside one it presses immediately;
   *  - a touch that strays beyond the view's slop drops the press, and — unlike iOS — coming back
   *    does not restore it, which is what this platform does;
   *  - a tap quicker than the timeout still flashes the press for
   *    [ViewConfiguration.getPressedStateDuration], so the control does not look dead.
   *
   * iOS reaches the same behaviour from the other end, and there the platform really does do the
   * work: its scroll view delays *delivery* of the touch, so tracking touches in the view suffices.
   */
  @SuppressLint("ClickableViewAccessibility") // performClick is handled by the pointer-event path.
  override fun onTouchEvent(event: MotionEvent): Boolean {
    // A box that is neither pressable nor holdable is a plain `ReactViewGroup` and must dispatch
    // like one.
    if (!interactive && !holdable) {
      return super.onTouchEvent(event)
    }
    if (!isEnabled) {
      return false
    }
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        // Where the ripple starts. `View.onTouchEvent` normally does this, and this view overrides
        // it without calling through for the press logic (see the class comment), so without this
        // line every ripple would expand from wherever the last one did rather than from the
        // finger — the tell-tale of a hand-rolled ripple.
        drawableHotspotChanged(event.x, event.y)
        if (touchAction == "none") {
          // Claim the gesture for its whole duration. Asserted on DOWN because that is the only
          // point before an ancestor scroll container decides to intercept.
          parent?.requestDisallowInterceptTouchEvent(true)
        }
        cancelPendingUnpress()
        if (!interactive) {
          // Holdable only: no press state, no ripple, nothing that says "tappable".
        } else if (isInScrollingContainer()) {
          isPrepressed = true
          val tap = Runnable {
            isPrepressed = false
            pendingTap = null
            setElementPressed(true)
          }
          pendingTap = tap
          postDelayed(tap, tapTimeout)
        } else {
          setElementPressed(true)
        }
      }
      MotionEvent.ACTION_MOVE ->
          if (!isInside(event)) {
            // A finger that has strayed is no longer holding this box either.
            cancelPendingHold()
            cancelPendingTap()
            setElementPressed(false)
          }
      MotionEvent.ACTION_UP -> {
        cancelPendingHold()
        if (touchAction == "none") {
          parent?.requestDisallowInterceptTouchEvent(false)
        }
        if (!interactive) {
          // Holdable only: a release is the end of a hold that did not complete, and nothing else.
        } else if (isPrepressed) {
          // Released before the delay had run: show the press anyway, briefly, so a quick tap does
          // not look like nothing happened. This is what the framework does in the same case.
          cancelPendingTap()
          setElementPressed(true)
          val unpress = Runnable {
            pendingUnpress = null
            setElementPressed(false)
          }
          pendingUnpress = unpress
          postDelayed(unpress, pressedStateDuration)
        } else {
          setElementPressed(false)
        }
        if (interactive && isInside(event)) {
          onActivated()
        }
      }
      MotionEvent.ACTION_CANCEL -> {
        // An ancestor scroll container claimed the gesture: the hold is off, which is the whole
        // reason the press is tracked natively rather than in JavaScript.
        cancelPendingHold()
        if (touchAction == "none") {
          parent?.requestDisallowInterceptTouchEvent(false)
        }
        // An ancestor scroll container claimed the gesture. The press must release, and must not
        // activate.
        cancelPendingTap()
        setElementPressed(false)
      }
    }
    super.onTouchEvent(event)
    // Consume so the rest of the gesture is delivered here. An ancestor scroll can still take it
    // away by intercepting, which is precisely the handover this relies on.
    return true
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    // A posted callback that outlives the view would press an element that is no longer on screen.
    cancelPendingTap()
    cancelPendingUnpress()
    cancelPendingHold()
  }

  /**
   * The platform's own press feedback: a ripple.
   *
   * Not decoration. On Android the ripple *is* what a press looks like — the framework's own
   * `Widget.Material.Button` background is literally `<ripple android:color="?attr/
   * colorControlHighlight">` wrapped around the button's shape — so a pressable box without one
   * does not read as pressable no matter how it is coloured.
   *
   * The colour is the theme's, not a constant, so it follows whatever the host app is themed with
   * — including a dark theme, where a fixed overlay would be invisible or garish.
   *
   * It goes in as a FEEDBACK UNDERLAY rather than as the background, which is the distinction that
   * makes it work with author styles. The box keeps drawing its own background and border, from the
   * user-agent sheet or from the author, and the ripple is composited above them.
   */
  /**
   * A tap that completed on this view.
   *
   * Not the same thing as `click`: that is synthesised by the pointer system and dispatched to
   * JavaScript, and this is for what the PLATFORM has to do with a tap in the view itself — a
   * subclass opening its own menu, for instance, where waiting for JavaScript to come back would
   * put a round trip between the finger and the menu.
   *
   * Called only when the release was inside; a finger that wandered off the view before lifting
   * has cancelled the tap, which is the framework's rule and the DOM's.
   */
  protected open fun onActivated() {}

  protected open fun updatePressFeedback() {
    if (!interactive || !ripplesEnabled) {
      return
    }
    installPlainRipple()
  }

  /**
   * The ripple, masked to the shape the background is actually drawing.
   *
   * A plain rectangular mask — which is what React Native's own `android_ripple` and the theme's
   * `selectableItemBackground` both use — SPILLS PAST ROUNDED CORNERS. Measured on a rounded box:
   * a pixel outside the corner radius went `#FFFFFF` at rest to `#E1E1E1` held, so the feedback
   * drew square corners over a rounded element. The radius comes from the background's own outline
   * rather than from the props, so it is the shape actually drawn rather than a second opinion
   * about it.
   *
   * The alternative, `clipToOutline`, also fixes the corners and is wrong: it clips CHILDREN too,
   * and `overflow: visible` is CSS's default, so content deliberately overflowing the box would be
   * cut. A mask clips the ripple alone.
   */
  protected fun installPlainRipple() {
    val radii = rippleMaskRadii()
    if (hasRipple && installedRippleRadii.contentEquals(radii)) {
      return
    }
    val highlight = resolveThemeColor(android.R.attr.colorControlHighlight) ?: return
    val mask =
        GradientDrawable().apply {
          setColor(Color.WHITE)
          if (radii != null) {
            cornerRadii = radii
          }
        }
    BackgroundStyleApplicator.setFeedbackUnderlay(
        this,
        RippleDrawable(ColorStateList.valueOf(highlight), null, mask),
    )
    installedRippleRadii = radii
    hasRipple = true
  }

  /**
   * The eight corner radii the mask needs, in pixels, or null for a square mask.
   *
   * **`Outline.getRadius()` is not enough, and trusting it is a silent failure.**
   * [CompositeBackgroundDrawable] — the background React Native gives every view — describes
   * itself with a *path* rather than a round rect, and an `Outline` built from a path answers
   * `RADIUS_UNDEFINED`. So the outline route quietly reported "no radius", the mask came out
   * square, and the ripple painted over the rounded corners of a box that plainly had them.
   * Caught on the emulator: a pixel outside the anchor's 12dp radius went `#FFFFFF` at rest to
   * `#EDEDED` held. Nothing in the code looked wrong; only the screen said so.
   *
   * The radii therefore come from the same place the background got them —
   * [BackgroundStyleApplicator.getBorderRadius] — with each physical corner falling back to the
   * `borderRadius` shorthand. The outline is still consulted first, because a view that sets its
   * own simple background (a `<button>`'s pill) answers correctly there and knows its shape better
   * than the props do.
   *
   * Logical corners (`borderStartStartRadius` and friends) are not resolved here: they depend on
   * layout direction, and a square mask over-covers rather than under-covers, which is the safer
   * way to be wrong.
   */
  private fun rippleMaskRadii(): FloatArray? {
    val simple = resolvedCornerRadius()
    if (simple > 0f) {
      return FloatArray(8) { simple }
    }
    val w = width.toFloat()
    val h = height.toFloat()
    if (w <= 0f || h <= 0f) {
      return null
    }
    val shorthand = BackgroundStyleApplicator.getBorderRadius(this, BorderRadiusProp.BORDER_RADIUS)
    fun corner(prop: BorderRadiusProp, reference: Float): Float {
      val value = BackgroundStyleApplicator.getBorderRadius(this, prop) ?: shorthand ?: return 0f
      return PixelUtil.toPixelFromDIP(value.resolve(reference))
    }
    val topLeftH = corner(BorderRadiusProp.BORDER_TOP_LEFT_RADIUS, w)
    val topLeftV = corner(BorderRadiusProp.BORDER_TOP_LEFT_RADIUS, h)
    val topRightH = corner(BorderRadiusProp.BORDER_TOP_RIGHT_RADIUS, w)
    val topRightV = corner(BorderRadiusProp.BORDER_TOP_RIGHT_RADIUS, h)
    val bottomRightH = corner(BorderRadiusProp.BORDER_BOTTOM_RIGHT_RADIUS, w)
    val bottomRightV = corner(BorderRadiusProp.BORDER_BOTTOM_RIGHT_RADIUS, h)
    val bottomLeftH = corner(BorderRadiusProp.BORDER_BOTTOM_LEFT_RADIUS, w)
    val bottomLeftV = corner(BorderRadiusProp.BORDER_BOTTOM_LEFT_RADIUS, h)
    if (topLeftH <= 0f &&
        topLeftV <= 0f &&
        topRightH <= 0f &&
        topRightV <= 0f &&
        bottomRightH <= 0f &&
        bottomRightV <= 0f &&
        bottomLeftH <= 0f &&
        bottomLeftV <= 0f) {
      return null
    }
    return floatArrayOf(
        topLeftH,
        topLeftV,
        topRightH,
        topRightV,
        bottomRightH,
        bottomRightV,
        bottomLeftH,
        bottomLeftV,
    )
  }

  /** Takes the feedback underlay back off, for a box that has stopped being interactive. */
  protected fun clearPressFeedback() {
    if (!hasRipple) {
      return
    }
    BackgroundStyleApplicator.setFeedbackUnderlay(this, null)
    hasRipple = false
    installedRippleRadii = null
  }

  /**
   * The corner radius the background is actually drawing, via its outline.
   *
   * `Outline.getRadius()` answers only for a simple round rect and returns a negative radius for
   * anything else — per-corner radii, for instance. A square mask is the right fallback there: it
   * over-covers rather than under-covers, and the alternative is guessing at a shape.
   */
  protected fun resolvedCornerRadius(): Float {
    val background = background ?: return 0f
    val outline = Outline()
    return try {
      background.getOutline(outline)
      if (outline.radius >= 0f) outline.radius else 0f
    } catch (e: IllegalStateException) {
      // A drawable with no bounds yet cannot describe its outline.
      0f
    }
  }

  protected fun resolveThemeColor(attr: Int): Int? {
    val value = TypedValue()
    if (!context.theme.resolveAttribute(attr, value, true)) {
      return null
    }
    return if (value.resourceId != 0) {
      context.resources.getColor(value.resourceId, context.theme)
    } else {
      value.data
    }
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    // The outline's radius depends on the box, so a capsule's radius is only knowable once there
    // is a height to halve.
    updatePressFeedback()
  }

  /** Called by the view manager once every prop in a transaction has been applied. */
  open fun onPropsApplied() {
    updatePressFeedback()
  }

  /**
   * The author's `pointerEvents` while this view is disabled, so enabling it again restores what
   * they asked for instead of forcing `AUTO`.
   */
  private var pointerEventsWhenEnabled: PointerEvents? = null

  override fun setEnabled(enabled: Boolean) {
    super.setEnabled(enabled)
    // A disabled control must stop consuming touches entirely, so a gesture an ancestor wants is
    // not swallowed on its way past.
    isClickable = enabled && interactive
    // Suppressing the press is not enough: `click` is dispatched by React Native's own pointer
    // path, which knows nothing about this element's `disabled` prop, so a disabled button still
    // fired onClick — observed on the emulator. Taking the view out of touch targeting is the
    // Android counterpart of clearing `userInteractionEnabled` on iOS, and matches the DOM, where
    // a disabled control is not an event target at all.
    //
    // Saved and restored rather than forced back to `AUTO`, because `pointerEvents` is also an
    // author-settable prop: a `<button pointerEvents="none">` that is disabled and then enabled
    // again must not silently become interactive.
    if (!enabled) {
      if (pointerEventsWhenEnabled == null) {
        pointerEventsWhenEnabled = pointerEvents
      }
      pointerEvents = PointerEvents.NONE
      setElementPressed(false)
    } else {
      pointerEventsWhenEnabled?.let { pointerEvents = it }
      pointerEventsWhenEnabled = null
    }
  }
}
