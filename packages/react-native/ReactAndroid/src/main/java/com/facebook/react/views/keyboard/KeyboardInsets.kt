/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.keyboard

import android.view.View
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.uimanager.PixelUtil

/**
 * How much of the window's bottom edge is obstructed, in **density-independent pixels**.
 *
 * The platform reports insets in physical pixels; everything above this layer — Yoga, the
 * shadow tree, author styles — is in DIPs, which is the same number iOS calls a point. The
 * conversion happens here, once, so that no consumer has to remember which side of the
 * boundary it is on.
 *
 * [height] is the whole obstruction: the IME when one is up, the navigation bar and gesture
 * area when it is not. They are one quantity, the same way iOS's keyboard layout guide rests
 * on the bottom safe area when the keyboard is gone.
 *
 * [safeArea] is the part of that which is always there. A consumer that already insets for
 * the system bars wants `height - safeArea`; one that insets for nothing wants [height].
 *
 * Deliberately no third "keyboard height" field: the platforms cannot agree on what it would
 * mean. iOS slides a guide that IS the safe area once the keyboard has gone, so mid-flight
 * there is no honest answer to how tall the keyboard is.
 */
public data class KeyboardGeometry(
    val height: Float,
    val safeArea: Float,
) {
  public companion object {
    @JvmField public val ZERO: KeyboardGeometry = KeyboardGeometry(0f, 0f)
  }
}

/**
 * How far a docked view has to rise to clear the obstruction, in pixels.
 *
 * The OVERLAP, not the obstruction's height: lifting by the height is right only
 * for a view already sitting on the bottom edge, and anywhere else it overshoots
 * by however far up the view already was. Self-correcting in both directions — a
 * view the keyboard cannot reach does not move at all.
 *
 * [viewBottomPx] must be the view's position with any offset already applied
 * taken back out. `getLocationInWindow` reports where a view is DRAWN, which
 * includes the last frame's offset, and feeding that straight back in makes the
 * two wind each other up.
 */
public fun keyboardOverlapPx(
    viewBottomPx: Float,
    rootHeightPx: Int,
    obstructionPx: Float,
): Float {
  val obstructionTop = rootHeightPx - maxOf(obstructionPx, 0f)
  return maxOf(viewBottomPx - obstructionTop, 0f)
}

/**
 * Room a scroll view must reserve at its bottom edge, in pixels.
 *
 * The OVERLAP with the obstruction, not the obstruction itself: a scroll view
 * that already stops above the navigation bar needs nothing reserved, and one
 * running to the window's edge needs all of it. Asking how far the view extends
 * past the obstruction answers both without knowing anything about how the app
 * is laid out — which is the point, because an app drawing edge to edge and one
 * whose window is already inset need the same code to do different things.
 *
 * [bottomAlready] is the room the keyboard has already claimed on that edge. The
 * larger of the two wins rather than their sum: the keyboard is drawn OVER the
 * navigation bar, so reserving for both would reserve the same pixels twice.
 *
 * **The top and bottom, not the sides.** The two edges reach the view by
 * different means — the top displaces the content, the bottom extends the
 * scrollable range — but both are available to a vertical scroll view. A side
 * inset is not: reserving it would mean displacing the content horizontally and
 * extending a horizontal range this view does not have, so a cutout beside a
 * vertical scroll view is DOM-CSS-LIMITATION. See docs/keyboard-in-css.md.
 *
 * [viewTop] is the scroll view's own top, which does not move when it reserves:
 * what the top reservation displaces is the CONTENT inside it. Subtracting the
 * displacement here would double the reservation on the next pass — measured at
 * 272px against a 136px status bar before that was corrected.
 */
public data class ReservedInsets(val top: Int, val bottom: Int)

public fun reservedInsetsPx(
    viewTop: Int,
    viewHeight: Int,
    rootHeight: Int,
    barsTop: Int,
    barsBottom: Int,
    bottomAlready: Int,
): ReservedInsets =
    ReservedInsets(
        top = maxOf(barsTop - viewTop, 0),
        bottom = maxOf(bottomAlready, maxOf((viewTop + viewHeight) - (rootHeight - barsBottom), 0)),
    )

public fun interface KeyboardGeometryListener {
  public fun onKeyboardGeometryChanged(geometry: KeyboardGeometry)
}

/**
 * A view that sits on top of the obstruction and so becomes part of it.
 *
 * A composer bar docked to the keyboard covers the same pixels the keyboard does, plus its own
 * height. Anything scrolling behind it has to clear both or the focused field lands underneath
 * the bar — which is the ordinary chat layout, not an exotic one.
 */
public fun interface KeyboardObstructingView {
  /**
   * Where this view's top edge ends up once docked against an obstruction [obstructionPx] tall,
   * in window pixels.
   *
   * Derived from the obstruction rather than read off the view, because both this and the
   * consumers are answering the same frame: reading the view's current position would make the
   * answer depend on which listener the producer happened to call first.
   */
  public fun topPxForObstructionPx(obstructionPx: Float): Float
}

/**
 * The top edge of everything obstructing the bottom of the window.
 *
 * The keyboard's own top, or the top of whatever is docked above it, whichever is higher. A view
 * that is not resting on the obstruction reports a top below it and so changes nothing.
 */
public fun bottomObstructionTopPx(
    rootHeight: Int,
    obstructionPx: Float,
    dockedTops: List<Float>,
): Float {
  var top = rootHeight - maxOf(obstructionPx, 0f)
  for (dockedTop in dockedTops) {
    top = minOf(top, dockedTop)
  }
  return top
}

/**
 * Reports the bottom obstruction every frame it moves.
 *
 * Android describes the IME two ways and, as on iOS, only one of them is the truth on screen.
 * `onApplyWindowInsets` fires once when the transition is scheduled and carries the
 * destination — measured, it reports the full 883px inset before the IME has moved at all. A
 * consumer reading the applied insets is therefore aiming at the end state, and will either
 * jump there immediately or start its own animation towards it. That second animation is the
 * bug this whole change exists to remove.
 *
 * `WindowInsetsAnimationCompat.Callback.onProgress` is the per-frame value, and it arrives
 * already interpolated by the platform's own `PathInterpolator`. There is nothing to
 * reconstruct and nothing to guess.
 *
 * The compat callback is used rather than the framework one because `WindowInsetsAnimation`
 * is API 30 and this module supports API 24.
 */
public class KeyboardInsets private constructor(private val root: View) {

  private val listeners = mutableListOf<KeyboardGeometryListener>()
  private val obstructingViews = mutableListOf<KeyboardObstructingView>()

  public var geometry: KeyboardGeometry = KeyboardGeometry.ZERO
    private set

  public fun addObstructingView(view: KeyboardObstructingView) {
    if (!obstructingViews.contains(view)) {
      obstructingViews.add(view)
    }
  }

  public fun removeObstructingView(view: KeyboardObstructingView) {
    obstructingViews.remove(view)
  }

  /** The top edge of the keyboard and of anything resting on it, in window pixels. */
  public fun obstructionTopPx(obstructionPx: Float): Float =
      bottomObstructionTopPx(
          root.height, obstructionPx, obstructingViews.map { it.topPxForObstructionPx(obstructionPx) })

  /**
   * The insets last applied, used to answer between animations. During one, [onProgress]
   * overrides this on every frame.
   */
  private var settled: KeyboardGeometry = KeyboardGeometry.ZERO

  init {
    ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
      applyInsets(insets)
      insets
    }

    ViewCompat.setWindowInsetsAnimationCallback(
        root,
        object :
            WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {

          override fun onPrepare(animation: WindowInsetsAnimationCompat) {
            if (animation.typeMask and WindowInsetsCompat.Type.ime() != 0) {
              beginAnimation()
            }
          }

          override fun onProgress(
              insets: WindowInsetsCompat,
              running: MutableList<WindowInsetsAnimationCompat>,
          ): WindowInsetsCompat {
            applyProgress(insets)
            return insets
          }

          override fun onEnd(animation: WindowInsetsAnimationCompat) {
            if (animation.typeMask and WindowInsetsCompat.Type.ime() != 0) {
              endAnimation()
            }
          }
        })
  }

  private var animating = false

  /**
   * The window's insets have changed.
   *
   * While an animation is running this carries the DESTINATION, not the present, so it is
   * recorded and not published — [applyProgress] speaks for those frames instead.
   */
  public fun applyInsets(insets: WindowInsetsCompat) {
    settled = geometryFrom(insets)
    if (!animating) {
      publish(settled)
    }
  }

  /** One frame of a running animation: what is on screen right now. */
  public fun applyProgress(insets: WindowInsetsCompat) {
    publish(geometryFrom(insets))
  }

  public fun beginAnimation() {
    animating = true
  }

  /**
   * Publishing the settled value on end matters even though the last frame usually equals
   * it: an animation can be cancelled part-way, and the final frame is then not the
   * destination at all.
   */
  public fun endAnimation() {
    animating = false
    publish(settled)
  }

  private fun geometryFrom(insets: WindowInsetsCompat): KeyboardGeometry {
    val ime: Insets = insets.getInsets(WindowInsetsCompat.Type.ime())
    // What the window would reserve with no keyboard: the navigation bar and the gesture
    // area. This is the floor the obstruction never drops below, and the counterpart of
    // iOS's bottom safe area.
    val bars: Insets =
        insets.getInsets(
            WindowInsetsCompat.Type.navigationBars() or WindowInsetsCompat.Type.displayCutout())

    return KeyboardGeometry(
        // The IME draws OVER the bars, so this is the greater of the two and never
        // their sum: adding them would reserve the space twice and leave a visible
        // gap beneath the keyboard.
        height = PixelUtil.toDIPFromPixel(maxOf(ime.bottom, bars.bottom).toFloat()),
        safeArea = PixelUtil.toDIPFromPixel(bars.bottom.toFloat()),
    )
  }

  private fun publish(next: KeyboardGeometry) {
    if (next == geometry) {
      return
    }
    geometry = next
    // Iterated over a copy: a listener is allowed to remove itself in response.
    for (listener in listeners.toList()) {
      listener.onKeyboardGeometryChanged(next)
    }
  }

  public fun addListener(listener: KeyboardGeometryListener) {
    listeners.add(listener)
    listener.onKeyboardGeometryChanged(geometry)
  }

  public fun removeListener(listener: KeyboardGeometryListener) {
    listeners.remove(listener)
  }

  public companion object {
    private val attached = mutableMapOf<View, KeyboardInsets>()

    /** The observer for a root view, created on first use. */
    @JvmStatic
    public fun forRootView(root: View): KeyboardInsets =
        attached.getOrPut(root) { KeyboardInsets(root) }

    @JvmStatic
    public fun detach(root: View) {
      attached.remove(root)
    }
  }
}
