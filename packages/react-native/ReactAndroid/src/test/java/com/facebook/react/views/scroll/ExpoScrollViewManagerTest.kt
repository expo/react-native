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
import com.facebook.react.uimanager.ThemedReactContext
import org.assertj.core.api.Assertions.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * The defaults ARE the element, so this asks a view that nobody has configured.
 *
 * `<native:scroll>` mounts a scroll view an author could have configured by hand; what it
 * contributes is which behaviour you get for typing it. If one of these were quietly dropped the
 * element would still render and still scroll, and the only symptom would be a keyboard covering a
 * field on someone else's device.
 *
 * They are checked here, on a bare view, because there is nowhere else on Android that can see
 * them. Fabric sends the mounting layer only the props that were SET, so a default nobody overrode
 * never reaches JavaScript — probed through Fantom, where a `<native:scroll>` with no props reports
 * `props: {}`.
 *
 * Note that Android has two sources of default for a prop: this manager's `@ReactProp` and the C++
 * props struct. The manager's is the one that applies here, because an unset prop never reaches
 * `setX` at all — so these also pin the two against each other, since a disagreement would show up
 * as one platform behaving differently from the other for the same markup.
 */
@RunWith(RobolectricTestRunner::class)
class ExpoScrollViewManagerTest {

  private lateinit var manager: ExpoScrollViewManager
  private lateinit var context: ThemedReactContext

  @Before
  fun setUp() {
    ReactNativeFeatureFlagsForTests.setUp()
    manager = ExpoScrollViewManager()
    context = ThemedReactContext(
        BridgeReactContext(RuntimeEnvironment.getApplication()),
        RuntimeEnvironment.getApplication(),
        null,
        -1,
    )
  }

  /** A view with nothing applied to it, which is the whole question. */
  private fun bareView(): ExpoScrollView = ExpoScrollView(context)

  @Test
  fun `a view nobody configured avoids the keyboard`() {
    // Off in ScrollView, which is why so many apps put a focused field behind the keyboard: the
    // prop exists there, and nobody finds it.
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
    // Zero, so that the automatic reservation is the whole story until an author says otherwise —
    // and when they do, their eight points mean eight MORE than the keyboard needs.
    assertThat(bareView().contentInset).isEqualTo(Rect())
  }

  @Test
  fun `naming one edge switches off that edge and no other`() {
    val view = bareView()
    manager.setAutomaticInsets(view, JavaOnlyMap.of("bottom", false))

    // "Not that one", not "only that one": an edge left out keeps the default.
    assertThat(view.automaticInsetBottom).isFalse()
    assertThat(view.automaticInsetTop).isTrue()
  }

  @Test
  fun `every default can be overruled`() {
    val view = bareView()
    manager.setAvoidsKeyboard(view, false)
    manager.setScrollEnabled(view, false)
    manager.setShowsScrollIndicator(view, false)

    // Defaults, not decisions. An element that could not be overruled would be a worse scroll view
    // rather than a better default.
    assertThat(view.avoidsKeyboard).isFalse()
    assertThat(view.scrollEnabled).isFalse()
    assertThat(view.isVerticalScrollBarEnabled).isFalse()
  }

  @Test
  fun `a view nobody configured holds the top of its content`() {
    // The ordinary list. A chat asks for the other one; everything else would be surprised by it.
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
    // The default an app should not have to ask for: the keyboard comes down with the finger.
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
    // Fabric sends null when an author REMOVES a prop, and the element has to return to its
    // default rather than to an empty string or zero — otherwise removing `contentAnchor` would
    // leave a chat anchored to a mode that does not exist.
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

  /**
   * The commands, which are the imperative half of the element.
   *
   * They are events rather than states — "go there now", not "be there" — so they arrive as
   * commands rather than props. Given content taller than the viewport, routing and effect can
   * both be asserted here: `scrollToLatest` lands at the far end and `scrollToTop` at zero.
   */
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

    // As `scrollToLatest()` is called from JavaScript, with nothing passed. The animated default
    // matters — a sent message should be seen to arrive rather than jump — but what is asserted
    // here is only that the absent argument does not drop the command.
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

    // The clamp is what makes a short chat start at the top and stay there: with content that
    // fits, "the bottom" and "the top" are the same place, and asking for one must not invent
    // scroll range that does not exist.
    assertThat(view.scrollY).isEqualTo(0)
  }

  @Test
  fun `it takes exactly one content container`() {
    val view = bareView()
    view.addView(android.view.View(context))

    // A second child would scroll only the first, and the symptom — content that is simply missing
    // — gives no clue why. NestedScrollView already refuses, which is why this view does not add a
    // check of its own; this pins that the platform's refusal is what actually happens.
    val second = android.view.View(context)
    val failure = runCatching { view.addView(second) }.exceptionOrNull()
    assertThat(failure).isInstanceOf(IllegalStateException::class.java)
    assertThat(failure?.message).contains("only one direct child")
  }
}
