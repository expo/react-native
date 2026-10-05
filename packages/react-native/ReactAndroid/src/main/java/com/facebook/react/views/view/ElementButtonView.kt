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
 * The view backing `<button>`, whose press state Android's own touch dispatch tracks: an ancestor
 * scroll container that claims the gesture delivers `ACTION_CANCEL` here, so the press releases
 * with no round trip through JavaScript. The view is clickable so it consumes the stream after
 * `ACTION_DOWN`; the root still sees every event in `onInterceptTouchEvent`. `click` arrives
 * through the pointer-event path and is not emitted here.
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

  // Tied to the press tracking's flag: the ripple is what the tracked state looks like
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

  // Whether the author's styles answer a press (`:active` or any state-varying declaration); the
  // ripple then stays away, since two feedbacks on different clocks read as a glitch
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
    // The accessibility default `ElementButtonProps` sets for iOS, restated because Android view
    // props come from the JS payload rather than the C++ props. Without being focusable and
    // important the button is not an accessibility node; `getAccessibilityClassName()` only
    // decides how the node is described
    isFocusable = true
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
  }

  // The counterpart of `UIAccessibilityTraitButton`; a styled box tells TalkBack nothing by itself
  override fun getAccessibilityClassName(): CharSequence = "android.widget.Button"

  /**
   * `View.onTouchEvent`'s press-state rule, restated because [ReactViewGroup.onTouchEvent] returns
   * `true` without calling up to it. The signals and timings are the platform's: inside a
   * scrolling container ([ViewGroup.shouldDelayChildPressedState]) the press waits out
   * [ViewConfiguration.getTapTimeout]; a touch beyond the slop drops the press and coming back does
   * not restore it; a tap quicker than the timeout still shows the press for
   * [ViewConfiguration.getPressedStateDuration].
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

  // The walk `View.isInScrollingContainer` does, which is not public API; the signal it reads is
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
   * The ripple is what a press looks like on Android: `Widget.Material.Button`'s background is a
   * `<ripple android:color="?attr/colorControlHighlight">`. Installed as a feedback underlay rather
   * than as the background, so the box keeps drawing its own background and border and
   * `<button style={{backgroundColor: 'red'}}>` is a red button that ripples.
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
    // A rectangular mask spills past rounded corners, so the mask takes the radius the background
    // draws, read from its outline
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
   * Material 3's button: a 40dp pill inset 4dp top and bottom inside the 48dp touch target, with
   * the ripple clipped to it. Drawn here because CSS cannot inset a background from its own box.
   * The colours are the theme's roles (`colorPrimary` filled, `colorSecondaryContainer` tonal),
   * resolved by name so this file takes no dependency on the material library; a host with no
   * Material theme falls back to `colorButtonNormal`.
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
   * Installs or removes the platform chrome under everything React draws. Not `background =
   * drawable`: React keeps the background colour, border, radii and shadows in one
   * `CompositeBackgroundDrawable` in that slot, and assigning it would replace them with nothing
   * to rebuild them. The chrome goes in the composite's own original-background layer.
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

  // `Outline.getRadius()` answers only for a simple round rect; a square mask over-covers
  // per-corner radii rather than guessing
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
    // A disabled control is not an event target, and `click` is dispatched by the pointer path,
    // so the view leaves touch targeting. Saved and restored rather than forced to `AUTO`, since
    // `pointerEvents` is an author prop
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
