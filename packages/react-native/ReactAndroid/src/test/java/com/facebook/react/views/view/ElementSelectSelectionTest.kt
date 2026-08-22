/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.app.Activity
import android.content.Context
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import org.assertj.core.api.Assertions.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/**
 * `<select>` announces a choice — which, inside React, takes a layout pass nobody else asks for.
 *
 * `AdapterView` fires `onItemSelected` from `onLayout`, and `setSelection` only calls
 * `requestLayout`; React Native lays views out itself from the shadow tree, so the view's own
 * request goes nowhere. On a device that read as a `<select>` that opened, could be picked from,
 * and never changed: the selection moved and no event was ever sent.
 *
 * What Robolectric cannot answer, and what the emulator had to: whether the posted layout makes
 * the view report the app's OWN value back as a choice. Here it does — the synthetic layout
 * delivers a notification for the position the view is leaving — and on a device it does not: the
 * demo's `<select>` counted ZERO change events through an open and exactly one per pick. So the
 * `programmaticSelection` guard is left to the device rather than asserted against a fiction.
 */
@RunWith(RobolectricTestRunner::class)
class ElementSelectSelectionTest {

  private lateinit var context: Context
  private lateinit var activity: Activity

  @Before
  fun setUp() {
    ReactNativeFeatureFlagsForTests.setUp()
    activity =
        Robolectric.buildActivity(Activity::class.java).create().start().resume().visible().get()
    context = activity
  }

  @Test
  fun `a chosen option is announced`() {
    val view = ElementSelectView(context)
    view.propOptions =
        listOf(
            ElementSelectOption(value = "0", label = "0", disabled = false),
            ElementSelectOption(value = "3", label = "3", disabled = false),
            ElementSelectOption(value = "3000", label = "3000", disabled = false),
        )
    view.propValue = "3"
    /*
     * ATTACHED, because `View.post` on a detached view queues into the view's own action list
     * rather than onto the looper, and the assertion below would then be about Robolectric rather
     * than about this view. In an app the `<select>` is in the hierarchy.
     */
    activity.setContentView(view)
    view.commitProps()
    // And sized, so the posted measure is the size React gave it.
    view.layout(0, 0, 200, 100)
    shadowOf(context.mainLooper).idle()

    var chosen: Pair<String, Int>? = null
    view.onOptionChosen = { value, index -> chosen = value to index }

    // What the dropdown does when a row is tapped.
    view.setSelection(2)

    /*
     * The POST is the fix, and it is what this asserts.
     *
     * Robolectric lays a view out when it is asked to, so the announcement arrives with or without
     * the remedy — a test that only checked the callback passed against the broken code and proved
     * nothing. On a device the layout never comes, so what has to be true is that the view queued
     * one of its own.
     */
    assertThat(shadowOf(context.mainLooper).isIdle)
        .describedAs("a choice must queue the layout pass its announcement rides")
        .isFalse()

    shadowOf(context.mainLooper).idle()
    assertThat(chosen).isEqualTo("3000" to 2)
    assertThat(view.selectedItemPosition).isEqualTo(2)
  }
}
