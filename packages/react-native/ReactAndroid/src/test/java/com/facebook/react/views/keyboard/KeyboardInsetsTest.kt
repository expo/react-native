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
 * describe where the keyboard is GOING, and the animation callback describes where it IS.
 * A test that only feeds applied insets would pass against an implementation that jumps
 * straight to the destination — which is the bug.
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
    // Every assertion here is in dips, so the px<->dip conversion has to be real.
    // Robolectric shares this static across same-config classes and a predecessor may
    // leave it zeroed, so it is set unconditionally.
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

    // Exactly this, in this order. `containsSubsequence` would also pass against an
    // implementation that published the destination up front and then animated back down
    // to it — which is the precise artefact this class exists to prevent, so the assertion
    // has to be able to see it.
    assertThat(seen.map { it.height })
        .containsExactly(0f, 24f, 38f, 170f, 260f, 295f, 300f)
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

  /**
   * The offset a docked view rises by. These guard overshoot: lifting by the
   * obstruction's height rather than the overlap sent a composer halfway down
   * the screen to the top of it on iOS, and the same arithmetic is here.
   */
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

  /**
   * Room reserved at the bottom for the safe area.
   *
   * The case that matters is the difference between an app drawing edge to edge
   * and one whose window is already inset: the same code must reserve room in
   * the first and nothing in the second, and it can only tell them apart by
   * where the view sits.
   */
  @Test
  fun `a view already inside the bars reserves nothing`() {
    // Starts below the status bar and stops above the navigation bar.
    assertThat(
            reservedInsetsPx(
                viewTop = 100, viewHeight = 2100, rootHeight = 2400,
                barsTop = 100, barsBottom = 200, bottomAlready = 0))
        .isEqualTo(ReservedInsets(top = 0, bottom = 0))
  }

  @Test
  fun `an edge-to-edge view reserves both bars`() {
    // Fills the window, so it runs under both.
    assertThat(
            reservedInsetsPx(
                viewTop = 0, viewHeight = 2400, rootHeight = 2400,
                barsTop = 100, barsBottom = 200, bottomAlready = 0))
        .isEqualTo(ReservedInsets(top = 100, bottom = 200))
  }

  @Test
  fun `the keyboard and the navigation bar do not both get the bottom`() {
    // The IME is drawn OVER the navigation bar. Summing them would reserve the
    // same pixels twice and leave a gap under the keyboard.
    val r =
        reservedInsetsPx(
            viewTop = 0, viewHeight = 2400, rootHeight = 2400,
            barsTop = 0, barsBottom = 200, bottomAlready = 880)

    assertThat(r.bottom).isEqualTo(880)
    assertThat(r.bottom).isNotEqualTo(880 + 200)
  }

  /**
   * The top is measured against the view's OWN position, which does not move
   * when it reserves — the reservation displaces the content inside it. Asking
   * the question against the displaced position instead reserved 272 against a
   * 136px status bar, and the doubling repeated on every pass.
   */
  @Test
  fun `reserving the top does not change what the top reservation should be`() {
    val first =
        reservedInsetsPx(
            viewTop = 0, viewHeight = 2280, rootHeight = 2400,
            barsTop = 136, barsBottom = 63, bottomAlready = 0)
    assertThat(first.top).isEqualTo(136)

    // Same view, same position, asked again after the reservation was applied.
    val second =
        reservedInsetsPx(
            viewTop = 0, viewHeight = 2280, rootHeight = 2400,
            barsTop = 136, barsBottom = 63, bottomAlready = 0)
    assertThat(second).isEqualTo(first)
  }

  /**
   * The top and the sides are deliberately absent, and this is the measurement
   * that says why.
   *
   * Reserving room means padding the scroll view, and under Fabric that only
   * extends the scrollable range — the content view is placed by the mounting
   * layer, and `ReactScrollView.onLayout` never touches it. So a top reservation
   * does not move the first row down; it adds that many pixels of empty space
   * after the LAST row.
   *
   * Measured in the chat-demo app on a 1080x2400 window with a 136px status
   * bar: with the top reserved, scrolling to the end left the content ending
   * 136px above the bottom of the scroll view, and row 1 stayed under the status
   * bar where it started. Both halves of that were wrong, which is why the
   * function takes no top.
   */
  /**
   * The two edges are delivered by different means and this is the one that
   * needed proving: the top displaces the content, the bottom extends the range.
   *
   * Measured in the chat-demo app, 1080x2400 window, 136px status bar,
   * scroll view [0,0][1080,2280]. Before: row 1 at y=39, under the bar, and the
   * content stopped 136px short of the bottom at full scroll — the top
   * reservation had become dead scroll range. After: row 1 at y=175, which is
   * 136 + its own 39, and the content flush with the bottom at full scroll.
   */
  @Test
  fun `an edge-to-edge scroll view reserves the status bar it runs under`() {
    val r =
        reservedInsetsPx(
            viewTop = 0, viewHeight = 2280, rootHeight = 2400,
            barsTop = 136, barsBottom = 63, bottomAlready = 0)

    assertThat(r.top).isEqualTo(136)
    // Its bottom stops above the navigation bar, so there is nothing to reserve
    // there — the two edges are answered independently.
    assertThat(r.bottom).isEqualTo(0)
  }

  /**
   * What obstructs the bottom is the keyboard AND whatever rides on it.
   *
   * Measured in the chat-demo app on a 1080x2400 window: keyboard top at
   * y=1517, a 120px composer bar docked on it occupying 1397..1517. Clearing
   * only the keyboard put the focused field's bottom at 1517 — underneath the
   * bar, invisible. Counting the bar moved it to 1397, flush with the bar's top.
   * That is the ordinary chat layout, not an exotic one.
   */
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
    // Reports a top BELOW the keyboard's, so it is already covered and adds
    // nothing. Taking the minimum is what makes this self-correcting rather
    // than needing to ask whether each view is docked.
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
