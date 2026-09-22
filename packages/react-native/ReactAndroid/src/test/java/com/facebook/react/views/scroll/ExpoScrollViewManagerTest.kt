/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.scroll

import android.graphics.Rect
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.ThemedReactContext
import org.assertj.core.api.Assertions.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * The defaults are the element, so this asks a view nobody has configured. Checked here because
 * Fabric sends the mounting layer only the props that were set, so a default nobody overrode never
 * reaches JavaScript. Android has two sources of default, this manager's `@ReactProp` and the C++
 * props struct, and the manager's applies on a bare view, so these also pin the two against each
 * other.
 */
@RunWith(RobolectricTestRunner::class)
class ExpoScrollViewManagerTest {

  private lateinit var manager: ExpoScrollViewManager
  private lateinit var context: ThemedReactContext

  @Before
  fun setUp() {
    ReactNativeFeatureFlagsForTests.setUp()
    DisplayMetricsHolder.initDisplayMetricsIfNotInitialized(RuntimeEnvironment.getApplication())
    manager = ExpoScrollViewManager()
    context =
        ThemedReactContext(
            BridgeReactContext(RuntimeEnvironment.getApplication()),
            RuntimeEnvironment.getApplication(),
            null,
            -1,
        )
  }

  // A view with nothing applied to it, which is the whole question
  private fun bareView(): ExpoScrollView = ExpoScrollView(context)

  @Test
  fun `a view nobody configured avoids the keyboard`() {
    // Off in ScrollView, where the prop exists and nobody finds it
    assertThat(bareView().avoidsKeyboard).isTrue()
  }

  @Test
  fun `a view nobody configured reserves the safe area at both ends`() {
    val view = bareView()
    assertThat(view.automaticInsetTop).isTrue()
    assertThat(view.automaticInsetBottom).isTrue()
  }

  @Test
  fun `a view nobody configured scrolls, and shows that it can`() {
    val view = bareView()
    assertThat(view.scrollEnabled).isTrue()
    assertThat(view.isVerticalScrollBarEnabled).isTrue()
  }

  @Test
  fun `the author's inset starts at nothing, and is added rather than substituted`() {
    // Zero, so the automatic reservation is the whole story until an author adds to it
    assertThat(bareView().contentInset).isEqualTo(Rect())
  }

  @Test
  fun `naming one edge switches off that edge and no other`() {
    val view = bareView()
    manager.setAutomaticInsets(view, JavaOnlyMap.of("bottom", false))

    // An edge left out keeps the default
    assertThat(view.automaticInsetBottom).isFalse()
    assertThat(view.automaticInsetTop).isTrue()
  }

  @Test
  fun `every default can be overruled`() {
    val view = bareView()
    manager.setAvoidsKeyboard(view, false)
    manager.setScrollEnabled(view, false)
    manager.setShowsScrollIndicator(view, false)

    // Defaults, not decisions: every one can be overruled
    assertThat(view.avoidsKeyboard).isFalse()
    assertThat(view.scrollEnabled).isFalse()
    assertThat(view.isVerticalScrollBarEnabled).isFalse()
  }

  @Test
  fun `a view nobody configured holds the top of its content`() {
    // The ordinary list; a chat asks for the other one
    assertThat(bareView().contentAnchor).isEqualTo("top")
  }

  @Test
  fun `the anchor can be moved to the bottom, which is what a chat asks for`() {
    val view = bareView()
    manager.setContentAnchor(view, "bottom")

    assertThat(view.contentAnchor).isEqualTo("bottom")
  }

  @Test
  fun `keyboard dismissal is interactive unless the author says otherwise`() {
    // The keyboard comes down with the finger by default
    assertThat(bareView().keyboardDismissMode).isEqualTo("interactive")

    val view = bareView()
    manager.setKeyboardDismissMode(view, "none")
    assertThat(view.keyboardDismissMode).isEqualTo("none")
  }

  @Test
  fun `it bounces, which is what a native list does`() {
    assertThat(bareView().bounces).isTrue()
  }

  @Test
  fun `a null prop falls back to the default rather than to nothing`() {
    // Fabric sends null when an author removes a prop, and the element returns to its default
    val view = bareView()
    manager.setContentAnchor(view, "bottom")
    manager.setContentAnchor(view, null)
    assertThat(view.contentAnchor).isEqualTo("top")

    manager.setKeyboardDismissMode(view, "none")
    manager.setKeyboardDismissMode(view, null)
    assertThat(view.keyboardDismissMode).isEqualTo("interactive")

    manager.setContentInset(view, null)
    assertThat(view.contentInset).isEqualTo(Rect())
  }

  // The commands: with content taller than the viewport, `scrollToLatest` lands at the far end
  // and `scrollToTop` at zero
  private fun viewWithContent(): ExpoScrollView {
    val view = bareView()
    val content = android.view.View(context)
    view.addView(content)
    view.layout(0, 0, 1080, 1000)
    content.layout(0, 0, 1080, 3000)
    return view
  }

  @Test
  fun `scrollToLatest goes to the end and scrollToTop comes back`() {
    val view = viewWithContent()

    manager.receiveCommand(view, "scrollToLatest", JavaOnlyArray.of(false))
    assertThat(view.scrollY).isEqualTo(2000)

    manager.receiveCommand(view, "scrollToTop", JavaOnlyArray.of(false))
    assertThat(view.scrollY).isEqualTo(0)
  }

  @Test
  fun `a command with no arguments still works`() {
    val view = viewWithContent()

    // As `scrollToLatest()` is called from JavaScript, with nothing passed; the absent argument
    // must not drop the command
    manager.receiveCommand(view, "scrollToLatest", null)
    manager.receiveCommand(view, "scrollToLatest", JavaOnlyArray.of())
    assertThat(view.scrollY).isGreaterThan(0)
  }

  @Test
  fun `scrolling to the end of content that fits stays at the top`() {
    val view = bareView()
    val content = android.view.View(context)
    view.addView(content)
    view.layout(0, 0, 1080, 1000)
    content.layout(0, 0, 1080, 400)

    manager.receiveCommand(view, "scrollToLatest", JavaOnlyArray.of(false))

    // With content that fits, the bottom and the top are the same place
    assertThat(view.scrollY).isEqualTo(0)
  }

  @Test
  fun `it takes exactly one content container`() {
    val view = bareView()
    view.addView(android.view.View(context))

    // NestedScrollView refuses a second child, which is why this view adds no check of its own
    val second = android.view.View(context)
    val failure = runCatching { view.addView(second) }.exceptionOrNull()
    assertThat(failure).isInstanceOf(IllegalStateException::class.java)
    assertThat(failure?.message).contains("only one direct child")
  }

  @Test
  fun `its events are the element's, under the names the element maps`() {
    // An event under a name the manager has not exported is dropped silently
    val events = manager.exportedCustomDirectEventTypeConstants
    assertThat(events["topInsetChange"]).isEqualTo(mapOf("registrationName" to "onInsetChange"))
    assertThat(events["topScroll"]).isEqualTo(mapOf("registrationName" to "onScroll"))
  }

  @Test
  fun `an event carries iOS's payload, with the offset resting at minus the top inset`() {
    val view = bareView()
    val content = android.view.View(context)
    view.addView(content)
    view.layout(0, 0, 1080, 1000)
    content.layout(0, 0, 1080, 3000)
    manager.setAutomaticInsets(view, JavaOnlyMap.of("top", false, "bottom", false))
    view.contentInset = Rect(0, 100, 0, 50)
    view.scrollTo(0, 300)

    val payload = requireNotNull(view.eventPayload())
    fun dp(px: Int) = PixelUtil.toDIPFromPixel(px.toFloat()).toDouble()

    assertThat(payload.insetTop).isEqualTo(dp(100))
    assertThat(payload.insetBottom).isEqualTo(dp(50))
    assertThat(payload.containerHeight).isEqualTo(dp(1000))
    assertThat(payload.contentHeight).isEqualTo(dp(3000))
    // Scrolled 300px with the content displaced 100px: the viewport's top edge is 200px into it.
    assertThat(payload.offsetY).isEqualTo(dp(200))
    assertThat(payload.restOffset).isEqualTo(dp(200))
    assertThat(payload.shiftY).isEqualTo(-dp(100))
  }
}
