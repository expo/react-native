/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.keyboard

import android.app.Activity
import android.content.Context
import android.view.View
import androidx.core.graphics.Insets
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.facebook.react.uimanager.PixelUtil
import org.assertj.core.api.Assertions.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

/**
 * The behaviour these cover is the distinction the whole design turns on: the applied insets
 * describe where the keyboard is GOING, and the animation callback describes where it IS. A test
 * that only feeds applied insets would pass against an implementation that jumps straight to the
 * destination — which is the bug.
 */
@RunWith(RobolectricTestRunner::class)
class KeyboardInsetsTest {

  private lateinit var context: Context
  private lateinit var root: View
  private lateinit var insets: KeyboardInsets
  private val seen = mutableListOf<KeyboardGeometry>()

  private fun px(dip: Float): Int = PixelUtil.toPixelFromDIP(dip).toInt()

  private fun windowInsets(imeDip: Float, navDip: Float): WindowInsetsCompat =
      WindowInsetsCompat.Builder()
          .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, px(imeDip)))
          .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.of(0, 0, 0, px(navDip)))
          .build()

  @Before
  fun setUp() {
    context = Robolectric.buildActivity(Activity::class.java).create().get()
    // Every assertion is in dips, so the conversion has to be real; Robolectric
    // shares this static across same-config classes, so it is set unconditionally
    DisplayMetricsHolder.initDisplayMetrics(context)
    root = View(context)
    KeyboardInsets.detach(root)
    insets = KeyboardInsets.forRootView(root)
    seen.clear()
    insets.addListener { seen.add(it) }
  }

  @org.junit.After
  fun tearDown() {
    DisplayMetricsHolder.setScreenDisplayMetrics(null)
  }

  @Test
  fun `reports the navigation bar as the obstruction when no keyboard is up`() {
    insets.applyInsets(windowInsets(imeDip = 0f, navDip = 24f))

    assertThat(insets.geometry.safeArea).isEqualTo(24f)
    // One quantity: with no keyboard, what content must avoid is the navigation bar.
    assertThat(insets.geometry.height).isEqualTo(24f)
  }

  @Test
  fun `the obstruction is the keyboard once it exceeds the bars, not their sum`() {
    insets.applyInsets(windowInsets(imeDip = 300f, navDip = 24f))

    assertThat(insets.geometry.safeArea).isEqualTo(24f)
    // Not 324: the keyboard is drawn OVER the navigation bar, so adding them would
    // reserve space twice and leave a visible gap under the keyboard.
    assertThat(insets.geometry.height).isEqualTo(300f)
  }

  @Test
  fun `an animation reports every frame, not just the destination`() {
    // What the platform does: apply the destination up front...
    insets.beginAnimation()
    insets.applyInsets(windowInsets(imeDip = 300f, navDip = 24f))
    // ...then deliver the real positions frame by frame.
    for (dip in listOf(0f, 38f, 170f, 260f, 295f, 300f)) {
      insets.applyProgress(windowInsets(imeDip = dip, navDip = 24f))
    }

    // Exactly this, in this order: `containsSubsequence` would also pass against an
    // implementation that published the destination up front and animated back to it
    assertThat(seen.map { it.height }).containsExactly(0f, 24f, 38f, 170f, 260f, 295f, 300f)
  }

  @Test
  fun `identical geometry is not republished`() {
    insets.applyInsets(windowInsets(imeDip = 300f, navDip = 24f))
    val count = seen.size
    insets.applyInsets(windowInsets(imeDip = 300f, navDip = 24f))

    assertThat(seen.size).isEqualTo(count)
  }

  @Test
  fun `a listener may remove itself while being notified`() {
    lateinit var self: KeyboardGeometryListener
    var calls = 0
    self = KeyboardGeometryListener {
      calls++
      insets.removeListener(self)
    }
    insets.addListener(self)
    insets.applyInsets(windowInsets(imeDip = 100f, navDip = 24f))

    // Once for the current value on registration, and never again after removing itself.
    assertThat(calls).isEqualTo(1)
  }

  // The offset a docked view rises by: the overlap, not the obstruction's height
  @Test
  fun `a bar on the bottom edge rises by the whole obstruction`() {
    assertThat(keyboardOverlapPx(2400f, 2400, 880f)).isEqualTo(880f)
  }

  @Test
  fun `a bar the keyboard cannot reach does not move`() {
    assertThat(keyboardOverlapPx(1200f, 2400, 880f)).isEqualTo(0f)
  }

  @Test
  fun `a bar partly covered rises only by the overlap`() {
    // Bottom 200px above the window edge against an 880px keyboard: 680 covered.
    assertThat(keyboardOverlapPx(2200f, 2400, 880f)).isEqualTo(680f)
  }

  @Test
  fun `a negative obstruction is treated as none`() {
    assertThat(keyboardOverlapPx(2400f, 2400, -50f)).isEqualTo(0f)
  }

  // Room reserved at the bottom for the safe area: an app drawing edge to edge
  // and one whose window is already inset are told apart by where the view sits
  @Test
  fun `a view already inside the bars reserves nothing`() {
    // Starts below the status bar and stops above the navigation bar.
    assertThat(
            reservedInsetsPx(
                viewTop = 100,
                viewHeight = 2100,
                rootHeight = 2400,
                barsTop = 100,
                barsBottom = 200,
                bottomAlready = 0,
            )
        )
        .isEqualTo(ReservedInsets(top = 0, bottom = 0))
  }

  @Test
  fun `an edge-to-edge view reserves both bars`() {
    // Fills the window, so it runs under both.
    assertThat(
            reservedInsetsPx(
                viewTop = 0,
                viewHeight = 2400,
                rootHeight = 2400,
                barsTop = 100,
                barsBottom = 200,
                bottomAlready = 0,
            )
        )
        .isEqualTo(ReservedInsets(top = 100, bottom = 200))
  }

  @Test
  fun `the keyboard and the navigation bar do not both get the bottom`() {
    // The IME is drawn OVER the navigation bar. Summing them would reserve the
    // same pixels twice and leave a gap under the keyboard.
    val r =
        reservedInsetsPx(
            viewTop = 0,
            viewHeight = 2400,
            rootHeight = 2400,
            barsTop = 0,
            barsBottom = 200,
            bottomAlready = 880,
        )

    assertThat(r.bottom).isEqualTo(880)
    assertThat(r.bottom).isNotEqualTo(880 + 200)
  }

  // The top is measured against the view's own position, which does not move
  // when it reserves; against the displaced content the reservation would double
  @Test
  fun `reserving the top does not change what the top reservation should be`() {
    val first =
        reservedInsetsPx(
            viewTop = 0,
            viewHeight = 2280,
            rootHeight = 2400,
            barsTop = 136,
            barsBottom = 63,
            bottomAlready = 0,
        )
    assertThat(first.top).isEqualTo(136)

    // Same view, same position, asked again after the reservation was applied.
    val second =
        reservedInsetsPx(
            viewTop = 0,
            viewHeight = 2280,
            rootHeight = 2400,
            barsTop = 136,
            barsBottom = 63,
            bottomAlready = 0,
        )
    assertThat(second).isEqualTo(first)
  }

  // The two edges are delivered by different means: the top displaces the
  // content, since padding under Fabric only extends the scrollable range, and
  // the bottom extends the range
  @Test
  fun `an edge-to-edge scroll view reserves the status bar it runs under`() {
    val r =
        reservedInsetsPx(
            viewTop = 0,
            viewHeight = 2280,
            rootHeight = 2400,
            barsTop = 136,
            barsBottom = 63,
            bottomAlready = 0,
        )

    assertThat(r.top).isEqualTo(136)
    // Its bottom stops above the navigation bar, so there is nothing to reserve
    // there — the two edges are answered independently.
    assertThat(r.bottom).isEqualTo(0)
  }

  // What obstructs the bottom is the keyboard and whatever rides on it
  @Test
  fun `a bar docked on the keyboard is part of the obstruction`() {
    // 883px keyboard in a 2400 window, so its top is 1517; the bar sits on it.
    assertThat(bottomObstructionTopPx(2400, 883f, listOf(1397f))).isEqualTo(1397f)
  }

  @Test
  fun `with nothing docked the keyboard is the whole obstruction`() {
    assertThat(bottomObstructionTopPx(2400, 883f, emptyList())).isEqualTo(1517f)
  }

  @Test
  fun `a view that is not resting on the obstruction changes nothing`() {
    // Reports a top below the keyboard's, so it is already covered and adds
    // nothing; the minimum makes this self-correcting
    assertThat(bottomObstructionTopPx(2400, 883f, listOf(1900f))).isEqualTo(1517f)
  }

  @Test
  fun `the tallest of several docked bars is the one that counts`() {
    assertThat(bottomObstructionTopPx(2400, 883f, listOf(1450f, 1397f, 1500f))).isEqualTo(1397f)
  }

  @Test
  fun `with no keyboard a bar on the window edge is still an obstruction`() {
    // The keyboard is gone, so its top is the window bottom and the bar wins.
    assertThat(bottomObstructionTopPx(2400, 0f, listOf(2280f))).isEqualTo(2280f)
  }
}
