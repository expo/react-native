/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.common

import android.app.Activity
import android.util.DisplayMetrics
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import androidx.core.content.res.ResourcesCompat.ID_NULL
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.ReactTestHelper.createMockCatalystInstance
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.views.textinput.ReactEditText
import com.facebook.react.views.view.ElementTextInputView
import org.assertj.core.api.Assertions.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * `autoFocus` focuses a field that is being rendered when it arrives, and no other: a field inside
 * a closed dialog, which `display: none` mounts as an INVISIBLE ancestor, stays unfocused, where
 * Android itself would focus it and bring up the keyboard for it. Both text fields take it: React
 * Native's `TextInput`, which the Astryx runtime renders `<input>` with, and the `<input>` element.
 */
@RunWith(RobolectricTestRunner::class)
class AutoFocusCandidateTest {

  private lateinit var activity: Activity

  @Before
  fun setUp() {
    ReactNativeFeatureFlagsForTests.setUp()
    DisplayMetricsHolder.setScreenDisplayMetrics(DisplayMetrics())
    activity = Robolectric.buildActivity(Activity::class.java).setup().get()
  }

  private fun textInput(): EditText {
    val context = BridgeReactContext(RuntimeEnvironment.getApplication())
    context.initializeWithInstance(createMockCatalystInstance())
    return ReactEditText(ThemedReactContext(context, activity, null, ID_NULL)).apply {
      setAutoFocus(true)
    }
  }

  private fun inputElement(): EditText = ElementTextInputView(activity).apply { autoFocus = true }

  private class Mounted(val container: FrameLayout, val field: EditText)

  // The field inside a container with the given visibility, attached to a window
  private fun mount(field: EditText, containerVisibility: Int): Mounted {
    val container = FrameLayout(activity)
    container.visibility = containerVisibility
    container.addView(field)
    activity.setContentView(container)
    return Mounted(container, field)
  }

  private fun draw(mounted: Mounted) {
    mounted.container.viewTreeObserver.dispatchOnPreDraw()
  }

  private fun forEachField(test: (() -> EditText) -> Unit) {
    test(::textInput)
    test(::inputElement)
  }

  @Test
  fun `a field that is being rendered is focused at the first draw`() = forEachField { field ->
    val mounted = mount(field(), View.VISIBLE)
    assertThat(mounted.field.isFocused).isFalse()
    draw(mounted)
    assertThat(mounted.field.isFocused).isTrue()
  }

  @Test
  fun `a field under an invisible ancestor is not focused`() = forEachField { field ->
    val mounted = mount(field(), View.INVISIBLE)
    draw(mounted)
    assertThat(mounted.field.isFocused).isFalse()
  }

  @Test
  fun `the candidate is dropped, so showing the field later does not focus it`() = forEachField {
      field ->
    val mounted = mount(field(), View.INVISIBLE)
    draw(mounted)
    mounted.container.visibility = View.VISIBLE
    draw(mounted)
    assertThat(mounted.field.isFocused).isFalse()
  }

  @Test
  fun `a field shown before the first draw is focused`() = forEachField { field ->
    // A mount attaches a field before the layout that hides or shows its ancestors
    val mounted = mount(field(), View.INVISIBLE)
    mounted.container.visibility = View.VISIBLE
    draw(mounted)
    assertThat(mounted.field.isFocused).isTrue()
  }
}
