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
 * A box's accessible name follows the text it paints: text children are drawn by the box rather
 * than mounted as views, so the box publishes the string as its own `contentDescription`. The guard
 * that protects an author-supplied description must compare by value, since the string handed to
 * `setContentDescription` is not the object `getContentDescription` returns.
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
    val layout: Layout =
        StaticLayout(text, TextPaint(), 1000, Layout.Alignment.ALIGN_NORMAL, 1f, 0f, false)
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
    // Two updates: the first always works
    val view = ReactViewGroup(context)
    view.setTextRunLayouts(runsFor("Add a row (24)"))
    view.setTextRunLayouts(runsFor("Add a row (25)"))

    assertThat(view.contentDescription.toString()).isEqualTo("Add a row (25)")
  }

  @Test
  fun `the name still follows the text after a re-layout that changed nothing`() {
    /*
     * Three updates: `View.setContentDescription` returns early when the new value equals the old
     * one, keeping the object it had, so a re-layout with unchanged text leaves the view holding the
     * first string while this class records the second. The redundant middle update is what splits
     * the identities a `===` guard would then compare forever.
     */
    val view = ReactViewGroup(context)
    view.setTextRunLayouts(runsFor("Add a row (24)"))
    view.setTextRunLayouts(runsFor("Add a row (24)"))

    view.setTextRunLayouts(runsFor("Add a row (25)"))

    assertThat(view.contentDescription.toString()).isEqualTo("Add a row (25)")
  }

  @Test
  fun `an author's own description is never clobbered`() {
    // A description the author stated outranks the painted text, and keeps outranking it
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

  @Test
  fun `a run with an accessibility model is named by its leaves, not by a description`() {
    // The host's virtual leaves carry the text; a description would be read on top of them
    val view = ReactViewGroup(context)
    view.setTextRunLayouts(runsFor("Save", listOf(staticText("Save"))))

    assertThat(view.contentDescription).isNull()
    assertThat(view.childCount).isEqualTo(1)
  }

  @Test
  fun `a model that exposes nothing names nothing`() {
    // Entirely hidden text must not leak out as a description
    val view = ReactViewGroup(context)
    view.setTextRunLayouts(runsFor("secret", emptyList()))

    assertThat(view.contentDescription).isNull()
    assertThat(view.childCount).isZero()
  }

  private fun runsFor(
      text: String,
      accessibilityItems: List<InlineAccessibilityItem>,
  ): List<ReactViewGroup.TextRunLayout> =
      listOf(
          ReactViewGroup.TextRunLayout(runsFor(text).single().layout, 0f, 0f, 0, accessibilityItems)
      )

  private fun staticText(label: String): InlineAccessibilityItem =
      InlineAccessibilityItem(
          kind = InlineAccessibilityItem.KIND_STATIC_TEXT,
          tag = 0,
          label = label,
          role = "text",
          hint = "",
          language = "",
          disabled = false,
          selected = false,
          checked = InlineAccessibilityItem.CHECKED_NONE,
          fragmentIndices = intArrayOf(0),
          liveRegion = 0,
          busy = false,
          expanded = null,
          valueMin = null,
          valueMax = null,
          valueNow = null,
          valueText = null,
          actions = emptyList(),
      )
}
