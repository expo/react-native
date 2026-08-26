/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.app.Activity
import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import com.facebook.react.uimanager.BackgroundStyleApplicator
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.facebook.react.uimanager.drawable.CompositeBackgroundDrawable
import com.facebook.react.uimanager.style.BorderRadiusProp
import com.facebook.react.uimanager.LengthPercentage
import com.facebook.react.uimanager.LengthPercentageType
import org.assertj.core.api.Assertions.assertThat
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

/**
 * `element-box` backs EVERY block element, and is interactive for exactly one of them.
 *
 * Two failures are guarded here, and they pull in opposite directions.
 *
 * The first is scope. This view class is what a `<div>`, a `<p>`, a `<section>` and an `<li>` all
 * mount, so anything it does unconditionally it does to the whole screen. A base class that made
 * every box clickable, focusable and ripple-bearing would be a serious regression and would look
 * fine in a screenshot of a page nobody was touching.
 *
 * The second is the ripple's SHAPE, which is the one that actually shipped broken. See
 * [ripple mask follows the border radius] — nothing about the code looked wrong, and only a pixel
 * on an emulator said otherwise.
 */
@RunWith(RobolectricTestRunner::class)
class ElementBoxRippleTest {

  private lateinit var context: Context

  @Before
  fun setUp() {
    ReactNativeFeatureFlagsForTests.setUp()
    context = Robolectric.buildActivity(Activity::class.java).create().get()
    // Robolectric shares this static across same-config test classes and a predecessor may leave
    // it zeroed; the radius conversion below is in dp, so it has to be real.
    DisplayMetricsHolder.initDisplayMetrics(context)
  }

  @After
  fun tearDown() {
    DisplayMetricsHolder.setScreenDisplayMetrics(null)
  }

  private fun rippleOf(view: ElementBoxView): RippleDrawable? =
      (view.background as? CompositeBackgroundDrawable)?.feedbackUnderlay as? RippleDrawable

  private fun maskOf(view: ElementBoxView): GradientDrawable? =
      rippleOf(view)?.findDrawableByLayerId(android.R.id.mask) as? GradientDrawable

  @Test
  fun `a box that is not a link is left completely alone`() {
    // The `<div>` case, which is almost every box on any screen.
    val view = ElementBoxView(context)
    view.ripplesEnabled = true
    view.onPropsApplied()

    assertThat(view.isClickable).isFalse()
    assertThat(rippleOf(view)).isNull()
  }

  @Test
  fun `a block link becomes pressable and draws the platform's ripple`() {
    val view = ElementBoxView(context)
    view.ripplesEnabled = true
    view.href = "https://reactnative.dev/"
    view.onPropsApplied()

    // Clickable so the gesture stream keeps arriving after ACTION_DOWN — without it the press
    // could never be seen to end, and ACTION_CANCEL from a scroll would never arrive.
    assertThat(view.isClickable).isTrue()
    // A feedback underlay, not the background: the box's own background and border keep drawing.
    assertThat(rippleOf(view)).isNotNull()
  }

  @Test
  fun `a recycled box stops being a link`() {
    // Views are pooled. One that was a block link and is handed to a `<div>` must not keep the
    // ripple, or a plain box grows feedback it never asked for.
    val view = ElementBoxView(context)
    view.ripplesEnabled = true
    view.href = "https://reactnative.dev/"
    view.onPropsApplied()
    assertThat(rippleOf(view)).isNotNull()

    view.href = null

    assertThat(view.isClickable).isFalse()
    assertThat(rippleOf(view)).isNull()
  }

  @Test
  fun `ripple mask follows the border radius`() {
    /*
     * The bug this exists for.
     *
     * The mask was derived from `Outline.getRadius()`, which sounds authoritative and is not:
     * `CompositeBackgroundDrawable` — the background React Native gives every view — describes
     * itself with a PATH, and an `Outline` built from a path answers `RADIUS_UNDEFINED`. So the
     * radius read as "none", the mask came out square, and the ripple painted over the rounded
     * corners of a box that plainly had them. Measured on the emulator: a pixel outside the
     * anchor's 12dp radius went #FFFFFF at rest to #EDEDED held.
     *
     * The radius now comes from the same place the background got it.
     */
    val view = ElementBoxView(context)
    BackgroundStyleApplicator.setBorderRadius(
        view,
        BorderRadiusProp.BORDER_RADIUS,
        LengthPercentage(12f, LengthPercentageType.POINT),
    )
    view.layout(0, 0, 600, 140)
    view.ripplesEnabled = true
    view.href = "https://reactnative.dev/"
    view.onPropsApplied()

    val radii = maskOf(view)?.cornerRadii
    assertThat(radii).isNotNull()
    assertThat(radii!!).hasSize(8)
    assertThat(radii.all { it > 0f })
        .describedAs("every corner of the mask must be rounded, not just the shorthand")
        .isTrue()
  }

  @Test
  fun `a square box gets a square mask`() {
    // The other half of the same rule: no radius means no rounding, rather than a guess.
    val view = ElementBoxView(context)
    view.layout(0, 0, 600, 140)
    view.ripplesEnabled = true
    view.href = "https://reactnative.dev/"
    view.onPropsApplied()

    assertThat(maskOf(view)?.cornerRadii).isNull()
  }

  @Test
  fun `no ripple while the gesture floor is off`() {
    // The ripple is what a tracked press looks like; with the recognizers disabled nothing drives
    // it, so it must not appear.
    val view = ElementBoxView(context)
    view.href = "https://reactnative.dev/"
    view.onPropsApplied()

    assertThat(rippleOf(view)).isNull()
  }
}
