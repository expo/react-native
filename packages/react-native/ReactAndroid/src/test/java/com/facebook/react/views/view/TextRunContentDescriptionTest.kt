/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.app.Activity
import android.content.Context
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import com.facebook.react.uimanager.DisplayMetricsHolder
import org.assertj.core.api.Assertions.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

/**
 * A box's accessible name follows the text it paints.
 *
 * Text children are *drawn* by the box rather than mounted as views, so nothing in the view tree
 * carries the string and the box publishes it as its own `contentDescription`. That worked once and
 * then never again: the guard protecting an author-supplied description compared by reference, and
 * the string handed to `setContentDescription` is not the object `getContentDescription` returns —
 * so from the second update onwards the guard was false and the name froze.
 *
 * It was invisible in every way that usually catches a bug. The button repainted correctly, so a
 * screenshot was right; only a screen reader, or a dump of the accessibility tree, said `(24)` on a
 * button that plainly read `(25)`.
 */
@RunWith(RobolectricTestRunner::class)
class TextRunContentDescriptionTest {

  private lateinit var context: Context

  @Before
  fun setUp() {
    ReactNativeFeatureFlagsForTests.setUp()
    context = Robolectric.buildActivity(Activity::class.java).create().get()
    DisplayMetricsHolder.initDisplayMetrics(context)
  }

  private fun runsFor(text: String): List<ReactViewGroup.TextRunLayout> {
    @Suppress("DEPRECATION")
    val layout: Layout = StaticLayout(text, TextPaint(), 1000, Layout.Alignment.ALIGN_NORMAL, 1f, 0f, false)
    return listOf(ReactViewGroup.TextRunLayout(layout, 0f, 0f, 0))
  }

  @Test
  fun `painted text becomes the box's accessible name`() {
    val view = ReactViewGroup(context)
    view.setTextRunLayouts(runsFor("Add a row (24)"))

    assertThat(view.contentDescription.toString()).isEqualTo("Add a row (24)")
  }

  @Test
  fun `the name follows the text when it changes`() {
    // The regression. Two updates, not one: the first always worked.
    val view = ReactViewGroup(context)
    view.setTextRunLayouts(runsFor("Add a row (24)"))
    view.setTextRunLayouts(runsFor("Add a row (25)"))

    assertThat(view.contentDescription.toString()).isEqualTo("Add a row (25)")
  }

  @Test
  fun `the name still follows the text after a re-layout that changed nothing`() {
    /*
     * The case that actually shipped, and it needs THREE updates to show.
     *
     * `View.setContentDescription` returns early when the new value equals the
     * old one, keeping the object it already had. So a re-layout with unchanged
     * text — which happens on any re-render — leaves the view holding the first
     * string while this class records the second, and from then on a guard
     * written as `===` compares two equal strings that are not the same object
     * and is false forever. The name freezes at whatever was painted first.
     *
     * Two updates are not enough to catch it: the redundant middle one is what
     * splits the identities. A first version of this test had two and passed
     * with the defect present.
     */
    val view = ReactViewGroup(context)
    view.setTextRunLayouts(runsFor("Add a row (24)"))
    view.setTextRunLayouts(runsFor("Add a row (24)"))

    view.setTextRunLayouts(runsFor("Add a row (25)"))

    assertThat(view.contentDescription.toString()).isEqualTo("Add a row (25)")
  }

  @Test
  fun `an author's own description is never clobbered`() {
    // The other half, and the reason the guard exists at all. A description the
    // author stated outranks the painted text, and keeps outranking it.
    val view = ReactViewGroup(context)
    view.contentDescription = "Add one more row to the list"
    view.setTextRunLayouts(runsFor("Add a row (24)"))
    view.setTextRunLayouts(runsFor("Add a row (25)"))

    assertThat(view.contentDescription.toString()).isEqualTo("Add one more row to the list")
  }

  @Test
  fun `a box that paints no text has no description of its own`() {
    val view = ReactViewGroup(context)
    view.setTextRunLayouts(runsFor("Add a row (24)"))
    view.setTextRunLayouts(null)

    assertThat(view.contentDescription).isNull()
  }
}
