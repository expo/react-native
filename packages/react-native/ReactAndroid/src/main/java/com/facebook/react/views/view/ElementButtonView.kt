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
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.InsetDrawable
import android.graphics.drawable.RippleDrawable
import android.util.TypedValue
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.ViewGroup
import com.facebook.react.uimanager.BackgroundStyleApplicator
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.PointerEvents
import com.facebook.react.uimanager.drawable.CompositeBackgroundDrawable

/**
 * The view backing `<button>`: a plain box whose press state is tracked by Android's own touch
 * dispatch rather than by the JavaScript responder system.
 *
 * The mechanism that matters is `ACTION_CANCEL`. When an ancestor scroll container decides the
 * gesture is a scroll it calls `onInterceptTouchEvent` and Android delivers `ACTION_CANCEL` here —
 * the exact analogue of `touchesCancelled:` on iOS. That is how a press releases the instant a
 * scroll claims the gesture, with no round trip through JS, and it is why this is worth doing
 * natively at all.
 *
 * The view is made clickable so that it consumes the stream after `ACTION_DOWN`; without that,
 * Android routes the remaining events to an ancestor and the press could never be seen to end. This
 * does not blind React Native's own touch handling: the root sees every event on the way down
 * through `onInterceptTouchEvent`, before any child consumes it.
 *
 * Activation is deliberately not emitted here — `click` already arrives through the pointer-event
 * path, and emitting it again would fire every handler twice.
 */
internal class ElementButtonView(context: Context) : ReactViewGroup(context) {

  /** Called with `true` on press-in and `false` on press-out, cancel, or release. */
  var onPressChange: ((Boolean) -> Unit)? = null

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

  private var hasRipple = false
  private var installedRippleRadius = Float.NaN

  /**
   * The platform prominence ('prominent' | 'neutral'), and whether the author has claimed the
   * surface — both computed in JavaScript (Button.js), where the semantics and the style prop
   * live. Chrome is drawn only for a button that has a prominence and no author surface.
   */
  var buttonStyle: String? = null
  var hasAuthorChrome: Boolean = false

  /**
   * Whether the author's own styles answer a press (an `:active` rule, or any declaration varying
   * with the interaction state). When they do, the ripple stays away: two feedbacks arrive on
   * different clocks — the ripple at once, the author's over its transition — and the pair reads
   * as a glitch rather than as a response.
   */
  var authorStatesPressFeedback: Boolean = false
    set(value) {
      if (field != value) {
        field = value
        updatePressFeedback()
      }
    }

  private var installedChrome = false
  private var installedChromeFill = 0

  init {
    isClickable = true
    // The user-agent accessibility default, matching what `ElementButtonProps`
    // sets for iOS. Android view props are applied by the ViewManager from the
    // JS payload rather than from the C++ props object, so the C++ default does
    // not reach this platform and has to be stated here as well.
    //
    // Both halves are needed: `getAccessibilityClassName()` only decides how the
    // node is *described*, and without being focusable and important the button
    // is not an accessibility node at all — TalkBack saw straight through it to
    // the `TextView` inside, which is how this was found.
    isFocusable = true
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
  }

  /**
   * Announce as a button to TalkBack, the counterpart of `UIAccessibilityTraitButton` on iOS.
   *
   * A `<button>` is a styled box rather than a `MaterialButton`, so nothing about the view itself
   * tells the accessibility framework what it is — without this it is read as a plain view and its
   * `disabled` state is not announced as a *button* being unavailable.
   */
  override fun getAccessibilityClassName(): CharSequence = "android.widget.Button"

  /**
   * The press-state rule Android's own widgets follow, restated here because the framework's copy
   * of it cannot run.
   *
   * `View.onTouchEvent` implements all of this already — but [ReactViewGroup.onTouchEvent], which
   * this class inherits, returns `true` without calling up to it, because React Native dispatches
   * touches in JavaScript instead. So `super.onTouchEvent` stops one level short of the framework
   * logic, and a `<button>` that waited for `setPressed` was never pressed at all: verified by
   * logging, where every `ACTION_DOWN`/`MOVE`/`UP` arrived and `setPressed` was never called once.
   *
   * What is reproduced is AOSP's rule, using the platform's own signals rather than invented ones —
   * [ViewGroup.shouldDelayChildPressedState] decides whether there is a delay, and the timings are
   * `ViewConfiguration`'s, not constants picked here:
   *
   *  - inside a scrolling container the press waits out [ViewConfiguration.getTapTimeout], so a
   *    finger on its way past a button never lights it up; outside one it presses immediately;
   *  - a touch that strays beyond the view's slop drops the press, and — unlike iOS — coming back
   *    does not restore it, which is what this platform does;
   *  - a tap quicker than the timeout still flashes the press for
   *    [ViewConfiguration.getPressedStateDuration], so the control does not look dead.
   *
   * iOS reaches the same behaviour from the other end, and there the platform really does do the
   * work: its scroll view delays *delivery* of the touch, so tracking touches in the view
   * suffices.
   */
  private val tapTimeout = ViewConfiguration.getTapTimeout().toLong()
  private val pressedStateDuration = ViewConfiguration.getPressedStateDuration().toLong()
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop

  private var pendingTap: Runnable? = null
  private var pendingUnpress: Runnable? = null

  /** True between touch-down and the tap timeout, while this may still become a scroll. */
  private var isPrepressed = false

  private fun setElementPressed(pressed: Boolean) {
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
   * `ReactViewGroup` answers no and the scroll views answer yes, so a `<button>` in a scroll view
   * delays and the same `<button>` in a plain view does not.
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

  @SuppressLint("ClickableViewAccessibility") // performClick is handled by the pointer-event path.
  override fun onTouchEvent(event: MotionEvent): Boolean {
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
        if (isInScrollingContainer()) {
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
            cancelPendingTap()
            setElementPressed(false)
          }
      MotionEvent.ACTION_UP -> {
        if (touchAction == "none") {
          parent?.requestDisallowInterceptTouchEvent(false)
        }
        if (isPrepressed) {
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
      }
      MotionEvent.ACTION_CANCEL -> {
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
  }

  /**
   * The platform's own press feedback: a ripple.
   *
   * Not decoration. On Android the ripple *is* what a press looks like — the framework's own
   * `Widget.Material.Button` background is literally `<ripple android:color="?attr/
   * colorControlHighlight">` wrapped around the button's shape — so a button without one does not
   * read as pressable no matter how it is coloured. Ours had none at all: the press state was
   * tracked, reported to JavaScript and used for `:active`, and nothing on screen moved.
   *
   * The colour is the theme's, not a constant, so it follows whatever the host app is themed with
   * — including a dark theme, where a fixed overlay would be invisible or garish.
   *
   * It goes in as a FEEDBACK UNDERLAY rather than as the background, which is the distinction that
   * makes it work with author styles. The box keeps drawing its own background and border, from the
   * user-agent sheet or from the author, and the ripple is composited above them. So
   * `<button style={{backgroundColor: 'red'}}>` is a red button that still ripples, not a red
   * button whose background has been replaced by a ripple or a rippling button that has lost its
   * colour.
   */
  private fun updatePressFeedback() {
    if (!ripplesEnabled) {
      return
    }
    if (buttonStyle != null && !hasAuthorChrome) {
      updateMaterialChrome()
      return
    }
    // The author owns the surface (or this box is not a chrome-wearing button
    // at all): the box draws its own background and border, and the ripple
    // composites above them, masked to whatever shape they draw.
    if (installedChrome) {
      setPlatformChrome(null)
      installedChrome = false
      hasRipple = false
    }
    if (authorStatesPressFeedback) {
      // The author is drawing the press themselves; adding a ripple on top puts two answers to
      // one touch on the screen.
      if (hasRipple) {
        BackgroundStyleApplicator.setFeedbackUnderlay(this, null)
        hasRipple = false
      }
      return
    }
    val radius = resolvedCornerRadius()
    if (installedRippleRadius == radius && hasRipple) {
      return
    }
    val highlight = resolveThemeColor(android.R.attr.colorControlHighlight) ?: return
    /*
     * The mask decides where the ripple is allowed to draw. A plain rectangle — which is what React
     * Native's own `android_ripple` uses — spills past rounded corners, and this element's corners
     * are rounded by default on both platforms, so the mask is shaped to match. The radius comes
     * from the background's own outline rather than from the props, so it is the shape actually
     * drawn rather than a second opinion about it.
     */
    val mask =
        GradientDrawable().apply {
          setColor(Color.WHITE)
          cornerRadius = radius
        }
    BackgroundStyleApplicator.setFeedbackUnderlay(
        this,
        RippleDrawable(ColorStateList.valueOf(highlight), null, mask),
    )
    installedRippleRadius = radius
    hasRipple = true
  }

  /**
   * The Material button construction, from the platform's own recipe.
   *
   * Material 3's button is not a coloured rectangle: it is a **pill inset 4dp top and bottom
   * inside a 48dp touch target** — the visible container is 40dp — with the ripple clipped to
   * that pill. CSS cannot inset a background from its own box, which is exactly why this is
   * drawn here rather than described in the user-agent stylesheet, and why the previous
   * CSS-described chrome was a Material-2-era 4dp rectangle filling the whole box.
   *
   * The colours are the theme's Material roles — filled is `colorPrimary`, tonal is
   * `colorSecondaryContainer` — resolved by NAME so this file takes no dependency on the
   * material library: the attributes exist in the app's merged resources whenever its theme is
   * a Material one, which is where they belong. A host app with no Material theme falls back
   * to the framework's own `colorButtonNormal`, which is that app's actual button colour.
   */
  private fun updateMaterialChrome() {
    val prominent = buttonStyle == "prominent"
    val fill =
        (if (prominent) resolveThemeColorByName("colorPrimary")
        else resolveThemeColorByName("colorSecondaryContainer"))
            ?: resolveThemeColor(android.R.attr.colorButtonNormal)
            ?: return
    if (installedChrome && installedChromeFill == fill) {
      return
    }
    val insetV = PixelUtil.toPixelFromDIP(4f).toInt()
    fun pill(color: Int): Drawable =
        InsetDrawable(
            GradientDrawable().apply {
              setColor(color)
              // A capsule at any height: the radius is clamped to half the bounds.
              cornerRadius = 1e4f
            },
            0,
            insetV,
            0,
            insetV,
        )
    setPlatformChrome(pill(fill))
    val highlight = resolveThemeColor(android.R.attr.colorControlHighlight)
    if (highlight != null) {
      BackgroundStyleApplicator.setFeedbackUnderlay(
          this,
          RippleDrawable(ColorStateList.valueOf(highlight), null, pill(Color.WHITE)),
      )
    }
    installedChrome = true
    installedChromeFill = fill
    hasRipple = highlight != null
  }

  /**
   * Install or remove this button's own platform chrome, UNDER everything React draws.
   *
   * Not `background = drawable`. React keeps the view's background colour, border, radii and
   * shadows inside one `CompositeBackgroundDrawable` held in that same slot, so assigning it
   * replaces all of them and assigning `null` destroys them — and nothing rebuilds them, because
   * no prop changed. The chrome belongs in the composite's own "background this view already had"
   * layer, which is exactly what it is.
   *
   * This is not hypothetical: a `<button>` whose fill comes from a stylesheet gets that fill a
   * render AFTER its first, so it wears the Material chrome briefly and then takes it off — and
   * taking it off used to take the author's fill with it. Every shadcn button rendered with no
   * background at all on Android while looking correct on iOS.
   */
  private fun setPlatformChrome(chrome: Drawable?) {
    val existing = background
    background =
        if (existing is CompositeBackgroundDrawable) existing.withNewOriginalBackground(chrome)
        else chrome
  }

  private fun resolveThemeColorByName(name: String): Int? {
    @SuppressLint("DiscouragedApi")
    val attr = context.resources.getIdentifier(name, "attr", context.packageName)
    if (attr == 0) {
      return null
    }
    return resolveThemeColor(attr)
  }

  /**
   * The corner radius the background is actually drawing, via its outline.
   *
   * `Outline.getRadius()` answers only for a simple round rect and returns [RADIUS_UNDEFINED] for
   * anything else — per-corner radii, for instance. A square mask is the right fallback there: it
   * over-covers rather than under-covers, and the alternative is guessing at a shape.
   */
  private fun resolvedCornerRadius(): Float {
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

  private fun resolveThemeColor(attr: Int): Int? {
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
  fun onPropsApplied() {
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
    isClickable = enabled
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
