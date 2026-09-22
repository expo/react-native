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
 * How much of the window's bottom edge is obstructed, in density-independent pixels; the platform
 * reports physical pixels and the conversion happens here, once.
 *
 * [height] is the whole obstruction: the IME when one is up, the navigation bar and gesture area
 * when it is not, one quantity as iOS's keyboard layout guide treats it. [safeArea] is the part
 * that is always there; a consumer already inset for the system bars wants `height - safeArea`.
 * There is no separate keyboard height, since mid-flight iOS gives no honest answer to it.
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
 * How far a docked view has to rise to clear the obstruction, in pixels: the overlap, not the
 * obstruction's height, so a view the keyboard cannot reach does not move. [viewBottomPx] must have
 * any offset already applied taken back out, since `getLocationInWindow` includes it.
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
 * Room a scroll view must reserve at its edges, in pixels: the overlap with the bars, so a view
 * that stops above the navigation bar reserves nothing. [bottomAlready] is the keyboard's claim;
 * the larger wins rather than the sum, since the keyboard is drawn over the navigation bar.
 *
 * The top and bottom, not the sides: a vertical scroll view can displace its content down and
 * extend its range, but has no horizontal range to extend, so a cutout beside it is
 * DOM-CSS-LIMITATION. [viewTop] is the view's own top, which does not move when it reserves.
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
 * A view that sits on top of the obstruction and so becomes part of it: a composer bar docked to
 * the keyboard covers the keyboard's pixels plus its own height.
 */
public fun interface KeyboardObstructingView {
  /**
   * Where this view's top edge ends up once docked against an obstruction [obstructionPx] tall, in
   * window pixels. Derived from the obstruction rather than read off the view, so the answer does
   * not depend on which listener the producer called first.
   */
  public fun topPxForObstructionPx(obstructionPx: Float): Float
}

// The top edge of everything obstructing the bottom of the window: the keyboard's own top or the
// top of whatever is docked above it
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
 * Reports the bottom obstruction every frame it moves. `onApplyWindowInsets` fires once with the
 * destination before the IME has moved; `WindowInsetsAnimationCompat.Callback.onProgress` is the
 * per-frame value, already interpolated by the platform. The compat callback, because
 * `WindowInsetsAnimation` is API 30 and this module supports API 24.
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

  // The top edge of the keyboard and of anything resting on it, in window pixels
  public fun obstructionTopPx(obstructionPx: Float): Float =
      bottomObstructionTopPx(
          root.height,
          obstructionPx,
          obstructingViews.map { it.topPxForObstructionPx(obstructionPx) },
      )

  // The insets last applied, the answer between animations
  private var settled: KeyboardGeometry = KeyboardGeometry.ZERO

  init {
    ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
      applyInsets(insets)
      insets
    }

    ViewCompat.setWindowInsetsAnimationCallback(
        root,
        object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {

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
        },
    )
  }

  private var animating = false

  // While an animation runs this carries the destination, so it is recorded and not published
  public fun applyInsets(insets: WindowInsetsCompat) {
    settled = geometryFrom(insets)
    if (!animating) {
      publish(settled)
    }
  }

  // One frame of a running animation: what is on screen now
  public fun applyProgress(insets: WindowInsetsCompat) {
    publish(geometryFrom(insets))
  }

  public fun beginAnimation() {
    animating = true
  }

  // Published on end because a cancelled animation's last frame is not the destination
  public fun endAnimation() {
    animating = false
    publish(settled)
  }

  private fun geometryFrom(insets: WindowInsetsCompat): KeyboardGeometry {
    val ime: Insets = insets.getInsets(WindowInsetsCompat.Type.ime())
    // What the window reserves with no keyboard, the floor the obstruction never drops below
    val bars: Insets =
        insets.getInsets(
            WindowInsetsCompat.Type.navigationBars() or WindowInsetsCompat.Type.displayCutout()
        )

    return KeyboardGeometry(
        // The IME draws over the bars, so the greater of the two and never their sum
        height = PixelUtil.toDIPFromPixel(maxOf(ime.bottom, bars.bottom).toFloat()),
        safeArea = PixelUtil.toDIPFromPixel(bars.bottom.toFloat()),
    )
  }

  private fun publish(next: KeyboardGeometry) {
    if (next == geometry) {
      return
    }
    geometry = next
    // Over a copy: a listener may remove itself in response
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

    // The observer for a root view, created on first use
    @JvmStatic
    public fun forRootView(root: View): KeyboardInsets =
        attached.getOrPut(root) { KeyboardInsets(root) }

    @JvmStatic
    public fun detach(root: View) {
      attached.remove(root)
    }
  }
}
