/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.keyboard

import android.app.Activity
import android.view.View
import android.widget.FrameLayout
import androidx.core.graphics.Insets
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import com.facebook.react.uimanager.DisplayMetricsHolder
import org.assertj.core.api.Assertions.assertThat
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.android.controller.ActivityController

@RunWith(RobolectricTestRunner::class)
class ExpoKeyboardAccessoryViewTest {
  private lateinit var controller: ActivityController<Activity>
  private lateinit var screen: FrameLayout
  private lateinit var page: FrameLayout
  private lateinit var bar: ExpoKeyboardAccessoryView
  private lateinit var root: View
  private lateinit var insets: KeyboardInsets

  @Before
  fun setUp() {
    ReactNativeFeatureFlagsForTests.setUp()
    controller = Robolectric.buildActivity(Activity::class.java).setup()
    val activity = controller.get()
    DisplayMetricsHolder.initDisplayMetrics(activity)
    screen = FrameLayout(activity)
    page = FrameLayout(activity)
    bar = ExpoKeyboardAccessoryView(activity)
    page.addView(bar)
    screen.addView(page)
    activity.setContentView(screen)
    root = screen.rootView
    root.measure(
        View.MeasureSpec.makeMeasureSpec(400, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY),
    )
    root.layout(0, 0, 400, 800)
    screen.layout(0, 0, 400, 800)
    insets = KeyboardInsets.forRootView(root)
    // Insets arrive before the long conversation has its final layout.
    insets.applyInsets(
        WindowInsetsCompat.Builder()
            .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.of(0, 0, 0, 24))
            .build()
    )
    page.layout(0, 0, 400, 3000)
    bar.layout(0, 2900, 400, 3000)
  }

  @After
  fun tearDown() {
    controller.pause().stop().destroy()
    KeyboardInsets.detach(root)
    DisplayMetricsHolder.setScreenDisplayMetrics(null)
  }

  private fun drawnBottom(): Int {
    val location = IntArray(2)
    bar.getLocationInWindow(location)
    return location[1] + bar.height
  }

  private fun draw() {
    root.viewTreeObserver.dispatchOnPreDraw()
  }

  @Test
  fun lateConversationLayoutKeepsTheComposerOnScreen() {
    draw()

    assertThat(drawnBottom()).isEqualTo(root.height - 24)
  }

  @Test
  fun scrollingTheConversationLeavesTheComposerDocked() {
    draw()
    page.translationY = -250f
    draw()

    assertThat(drawnBottom()).isEqualTo(root.height - 24)
  }

  @Test
  fun growingComposerUpdatesTheSpaceReservedByTheTranscript() {
    var obstructionTop = Float.NaN
    insets.addListener { obstructionTop = insets.obstructionTopPx(24f) }
    draw()
    bar.layout(0, 2800, 400, 3000)
    draw()

    assertThat(obstructionTop).isEqualTo((root.height - 24 - 200).toFloat())
  }
}
