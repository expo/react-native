/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.RippleDrawable
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import com.facebook.react.uimanager.BackgroundStyleApplicator
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.facebook.react.uimanager.drawable.CompositeBackgroundDrawable
import org.assertj.core.api.Assertions.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

/**
 * `<button>`'s press feedback on Android is the platform's own ripple.
 *
 * The framework's `Widget.Material.Button` background is literally a `<ripple
 * android:color="?attr/colorControlHighlight">` wrapped around the button's shape, so a button
 * without one does not read as pressable however it is coloured. This element tracked and reported
 * its press state long before it drew anything — the state was live, `:active` worked, and nothing
 * on screen moved — which is precisely the kind of regression a screenshot suite misses and this
 * asserts structurally: the ripple must exist, as a feedback underlay, so the box's own background
 * and border keep drawing beneath it.
 */
@RunWith(RobolectricTestRunner::class)
class ElementButtonRippleTest {

  private lateinit var context: Context

  @Before
  fun setUp() {
    ReactNativeFeatureFlagsForTests.setUp()
    context = Robolectric.buildActivity(Activity::class.java).create().get()
    // The chrome inset converts dp; unconditional because Robolectric shares this static across
    // same-config test classes and predecessors may leave it zeroed — see
    // InlineBoxSpacingSpansAgreeTest, where that cost an afternoon.
    DisplayMetricsHolder.initDisplayMetrics(context)
  }

  @org.junit.After
  fun tearDown() {
    DisplayMetricsHolder.setScreenDisplayMetrics(null)
  }

  private fun rippleOf(view: ElementButtonView): RippleDrawable? =
      (view.background as? CompositeBackgroundDrawable)?.feedbackUnderlay as? RippleDrawable

  @Test
  fun `installs a ripple as the feedback underlay when enabled`() {
    val view = ElementButtonView(context)

    view.ripplesEnabled = true

    // An underlay, not the background: the box's own background colour and border — the
    // user-agent's or the author's — keep drawing, and the ripple composites above them.
    assertThat(rippleOf(view)).isNotNull()
  }

  @Test
  fun `draws no ripple while the gesture floor is off`() {
    // The ripple is what the tracked press state looks like; a build with the recognizers
    // disabled must not grow feedback that nothing drives.
    val view = ElementButtonView(context)

    assertThat(view.background as? CompositeBackgroundDrawable).isNull()
  }

  @Test
  fun `the ripple survives a size change rather than being reinstalled`() {
    // `onSizeChanged` re-derives the mask radius (a capsule's radius depends on the height), and
    // an unchanged radius must not tear the drawable down mid-animation.
    val view = ElementButtonView(context)
    view.ripplesEnabled = true
    val before = rippleOf(view)

    view.layout(0, 0, 200, 48)

    assertThat(rippleOf(view)).isSameAs(before)
  }

  @Test
  fun `a prominence installs the Material chrome as the view s background`() {
    // Material 3's construction: a pill inset 4dp top and bottom inside the 48dp touch box, so
    // the visible container is the platform's 40dp. CSS cannot inset a background from its own
    // box, which is why this is drawn here and asserted structurally.
    val view = ElementButtonView(context)
    view.buttonStyle = "neutral"
    view.ripplesEnabled = true
    view.onPropsApplied()

    // The background may be wrapped by the applicator once the ripple is installed; the chrome
    // itself is the inset pill either way.
    val background = view.background
    val chrome =
        (background as? CompositeBackgroundDrawable)?.originalBackground ?: background
    assertThat(chrome).isInstanceOf(android.graphics.drawable.InsetDrawable::class.java)
    assertThat(rippleOf(view)).isNotNull()
  }

  @Test
  fun `the chrome's pill fits the box the author sized`() {
    /*
     * Material's 4dp inset is the gap between its 48dp touch target and the 40dp container inside
     * it. A composer's `+` is 40dp all over, and insetting that leaves a lozenge 40 wide and 32
     * tall where the platform's own icon button is a circle.
     */
    val inset = { view: ElementButtonView ->
      val background = view.background
      val chrome =
          (background as? CompositeBackgroundDrawable)?.originalBackground ?: background
      (chrome as android.graphics.drawable.InsetDrawable).let { drawable ->
        val bounds = android.graphics.Rect()
        drawable.getPadding(bounds)
        bounds
      }
    }
    val four = com.facebook.react.uimanager.PixelUtil.toPixelFromDIP(4f).toInt()
    val forty = com.facebook.react.uimanager.PixelUtil.toPixelFromDIP(40f).toInt()

    val target = ElementButtonView(context)
    target.buttonStyle = "neutral"
    target.ripplesEnabled = true
    target.layout(0, 0, forty, forty + 2 * four)
    target.onPropsApplied()
    assertThat(inset(target).top).describedAs("a 48dp box gives 4dp away").isEqualTo(four)
    assertThat(inset(target).left)
        .describedAs("a wide button is a text button: its container is the box's width")
        .isEqualTo(0)

    val icon = ElementButtonView(context)
    icon.buttonStyle = "neutral"
    icon.ripplesEnabled = true
    icon.layout(0, 0, forty, forty)
    icon.onPropsApplied()
    assertThat(inset(icon).top).describedAs("a 40dp box has nothing to spare").isEqualTo(0)

    /*
     * And a SQUARE button is an icon button, whose container is 40dp on both axes inside the
     * 48dp target — so the pill it leaves is a circle rather than a lozenge 48 wide and 40 tall.
     */
    val square = ElementButtonView(context)
    square.buttonStyle = "neutral"
    square.ripplesEnabled = true
    square.layout(0, 0, forty + 2 * four, forty + 2 * four)
    square.onPropsApplied()
    assertThat(inset(square).left).describedAs("a square box insets its width too").isEqualTo(four)
    assertThat(inset(square).top).isEqualTo(four)
  }

  @Test
  fun `an author surface dismisses the chrome but keeps the ripple`() {
    val view = ElementButtonView(context)
    view.buttonStyle = "neutral"
    view.hasAuthorChrome = true
    view.ripplesEnabled = true
    view.onPropsApplied()

    val background = view.background
    val original = (background as? CompositeBackgroundDrawable)?.originalBackground ?: background
    // No pill: the author's background/border draws through the normal box path...
    assertThat(original).isNotInstanceOf(android.graphics.drawable.InsetDrawable::class.java)
    // ...and the press still ripples above whatever they drew.
    assertThat(rippleOf(view)).isNotNull()
  }

  @Test
  fun `the press-feedback flag is exposed under the name JavaScript sends`() {
    /*
     * The wire, which the other guards cannot see.
     *
     * Everything else about this behaviour is asserted through the Kotlin
     * PROPERTY — here, on iOS, and in `pressFeedbackOwnership-test.js`. The prop
     * actually travels as a STRING, and renaming it on either side leaves every
     * one of those green while the flag silently stops arriving. That is the
     * exact shape of the bug this whole contract exists for, so the name is
     * pinned rather than assumed.
     */
    assertThat(ElementButtonViewManager().nativeProps)
        .containsKey("authorStatesPressFeedback")
  }

  @Test
  fun `an author who answers the press gets no ripple`() {
    /*
     * The platform and the author must never both answer one touch. They arrive
     * on different clocks — the ripple at once, the author's colour over its
     * transition — and a device showed that as a button going one colour on
     * press and a second on hold. Reported twice, because the first fix computed
     * this signal from a place the information had already been dropped.
     *
     * The signal is now decided in `propsWithState` (see
     * `pressFeedbackOwnership-test.js`) and arrives here as a prop. This is the
     * other end of that contract: given it, this view draws nothing.
     */
    val view = ElementButtonView(context)
    view.ripplesEnabled = true
    assertThat(rippleOf(view)).describedAs("precondition: a ripple exists to remove").isNotNull()

    view.authorStatesPressFeedback = true

    assertThat(rippleOf(view))
        .describedAs("the author draws the press, so the platform must not")
        .isNull()
  }

  @Test
  fun `withdrawing the author's press feedback gives the ripple back`() {
    // The other direction, so the suppression cannot be a one-way latch: a
    // button that stops styling its press is an ordinary button again.
    val view = ElementButtonView(context)
    view.ripplesEnabled = true
    view.authorStatesPressFeedback = true
    assertThat(rippleOf(view)).isNull()

    view.authorStatesPressFeedback = false

    assertThat(rippleOf(view)).isNotNull()
  }

  @Test
  fun `taking the chrome off keeps the author's background`() {
    /*
     * The ORDER is the whole test, and the reason the case above missed this.
     *
     * A button whose fill comes from a stylesheet does not have it on its first render: the
     * rules resolve a render later. So the button wears the platform chrome first and takes it
     * off afterwards — and taking it off used to be `background = null`, which does not remove
     * a pill, it removes the `CompositeBackgroundDrawable` holding the author's colour, border,
     * radii and shadows. Nothing rebuilds them, because no prop changed after that.
     *
     * On screen: every shadcn button on Android had no fill at all — `Default` and
     * `Destructive` invisible, the rest passing for correct — while iOS drew all six. Found by
     * putting the two platforms' screenshots side by side, not by any suite.
     */
    val view = ElementButtonView(context)
    view.buttonStyle = "neutral"
    view.ripplesEnabled = true
    view.onPropsApplied()
    assertThat(
            (view.background as? CompositeBackgroundDrawable)?.originalBackground
                ?: view.background)
        .describedAs("precondition: the chrome is on")
        .isInstanceOf(android.graphics.drawable.InsetDrawable::class.java)

    // The stylesheet resolves and paints the button, exactly as the box path would.
    BackgroundStyleApplicator.setBackgroundColor(view, Color.RED)

    // ...and only now does the element learn the author owns the surface.
    view.hasAuthorChrome = true
    view.onPropsApplied()

    val composite = view.background as? CompositeBackgroundDrawable
    assertThat(composite).describedAs("React's background layers must survive").isNotNull()
    assertThat(composite?.background?.backgroundColor)
        .describedAs("the author's fill must survive the chrome coming off")
        .isEqualTo(Color.RED)
    assertThat(composite?.originalBackground)
        .describedAs("and the chrome itself must be gone")
        .isNull()
  }
}
