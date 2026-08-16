/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.app.Activity
import android.content.Context
import android.os.Looper
import android.os.SystemClock
import android.text.SpannableString
import android.text.StaticLayout
import android.text.TextPaint
import android.view.MotionEvent
import android.view.ViewConfiguration
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import org.assertj.core.api.Assertions.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/**
 * `user-select` on the text a View paints itself (text-children / expo-intrinsics).
 *
 * Two things are worth pinning. The text Copy produces is composed from the runs by document order,
 * so a View whose text is interrupted by a child view still copies in reading order — the bug would
 * be copying in run-construction order instead, which looks right whenever there is only one run.
 * And the long press that offers Copy is timed by hand, because `ReactViewGroup.onTouchEvent`
 * consumes unconditionally and View's own long-press detection therefore never runs on a React
 * view; a View that has not opted in must not arm that timer at all, or every View in the app pays
 * for a feature it did not ask for.
 */
@RunWith(RobolectricTestRunner::class)
class ReactViewGroupTextSelectionTest {

  private val width = 200
  private lateinit var context: Context

  @Before
  fun setUp() {
    ReactNativeFeatureFlagsForTests.setUp()
    context = Robolectric.buildActivity(Activity::class.java).create().get()
  }

  @Test
  fun copiesEveryRunInReadingOrderNotConstructionOrder() {
    val view = ReactViewGroup(context)
    // Deliberately handed over out of order: the later run first.
    view.setTextRunLayouts(
        listOf(
            runLayout("after the box", documentOrder = 1),
            runLayout("before the box", documentOrder = 0),
        ))

    assertThat(view.selectableText().toString()).isEqualTo("before the box\nafter the box")
  }

  @Test
  fun copiesNothingWhenThereIsNoText() {
    val view = ReactViewGroup(context)
    assertThat(view.selectableText()).isNull()

    view.setTextRunLayouts(listOf(runLayout("", documentOrder = 0)))
    assertThat(view.selectableText()).isNull()
  }

  @Test
  fun aLongPressOnSelectableTextOffersCopy() {
    val view = viewWithText()
    view.textIsSelectable = true

    view.onTouchEvent(motionEvent(MotionEvent.ACTION_DOWN, 5f, 5f))
    idlePastLongPressTimeout()

    assertThat(view.textSelectionActionMode).isNotNull()
  }

  @Test
  fun aLongPressOnTextThatDidNotOptInOffersNothing() {
    val view = viewWithText()

    view.onTouchEvent(motionEvent(MotionEvent.ACTION_DOWN, 5f, 5f))
    idlePastLongPressTimeout()

    assertThat(view.textSelectionActionMode).isNull()
  }

  @Test
  fun movingAFingerAwayCancelsTheLongPress() {
    val view = viewWithText()
    view.textIsSelectable = true

    val beyondSlop = ViewConfiguration.get(context).scaledTouchSlop + 1f
    view.onTouchEvent(motionEvent(MotionEvent.ACTION_DOWN, 5f, 5f))
    view.onTouchEvent(motionEvent(MotionEvent.ACTION_MOVE, 5f, 5f + beyondSlop))
    idlePastLongPressTimeout()

    assertThat(view.textSelectionActionMode).isNull()
  }

  @Test
  fun liftingAFingerCancelsTheLongPress() {
    val view = viewWithText()
    view.textIsSelectable = true

    view.onTouchEvent(motionEvent(MotionEvent.ACTION_DOWN, 5f, 5f))
    view.onTouchEvent(motionEvent(MotionEvent.ACTION_UP, 5f, 5f))
    idlePastLongPressTimeout()

    assertThat(view.textSelectionActionMode).isNull()
  }

  @Test
  fun recyclingClearsTheOptIn() {
    val view = viewWithText()
    view.textIsSelectable = true

    view.recycleView()

    assertThat(view.textIsSelectable).isFalse()
  }

  /**
   * Attached to a real window on purpose: `View.postDelayed` only reaches the looper once the view
   * has an AttachInfo — before that it parks the callback in the view's own run queue — and a view
   * receiving touches is by definition attached.
   */
  private fun viewWithText(): ReactViewGroup {
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    val view = ReactViewGroup(activity)
    activity.setContentView(view)
    view.setTextRunLayouts(listOf(runLayout("copy me", documentOrder = 0)))
    return view
  }

  private fun idlePastLongPressTimeout() {
    shadowOf(Looper.getMainLooper())
        .idleFor(java.time.Duration.ofMillis(ViewConfiguration.getLongPressTimeout() + 50L))
  }

  private fun motionEvent(action: Int, x: Float, y: Float): MotionEvent {
    val now = SystemClock.uptimeMillis()
    return MotionEvent.obtain(now, now, action, x, y, 0)
  }

  private fun runLayout(text: String, documentOrder: Int): ReactViewGroup.TextRunLayout {
    val spannable = SpannableString(text)
    val layout =
        StaticLayout.Builder.obtain(spannable, 0, spannable.length, TextPaint(), width).build()
    return ReactViewGroup.TextRunLayout(layout, 0f, 0f, documentOrder)
  }
}
