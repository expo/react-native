/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text

import com.facebook.react.uimanager.DisplayMetricsHolder
import com.facebook.react.uimanager.PixelUtil
import org.assertj.core.api.Assertions.assertThat
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * The theme's type scale, and the two numbers that have to agree.
 *
 * A heading takes its SIZE from the theme and its block MARGIN from the spec's `em` factor times
 * that size. The size therefore travels twice — once into the text and once into the layout layer —
 * and the failure this guards against is the two arriving different.
 *
 * A text appearance resolves to pixels with the user's font scale already applied, and since
 * Android 14 font scaling is non-linear, so dividing by `scaledDensity` is not the inverse.
 * Robolectric scales fonts linearly and cannot show that: these tests guard the inverse existing
 * and the two conversions agreeing, not the non-linear curve, which only a device or an API 34+
 * emulator exercises.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MaterialTypeScaleTest {

  private val context
    get() = RuntimeEnvironment.getApplication()

  @Before
  fun setUp() {
    // Unconditional, and required: another test class in this sandbox may have
    // left `DisplayMetricsHolder` holding a bare DisplayMetrics with density 0,
    // which turns every sp conversion here into zero.
    DisplayMetricsHolder.initDisplayMetrics(context)
    MaterialTypeScale.resetForTests()
  }

  @After
  fun tearDown() {
    MaterialTypeScale.resetForTests()
    DisplayMetricsHolder.setScreenDisplayMetrics(null)
  }

  private fun prime() {
    MaterialTypeScale.primeFrom(context, /* definitive */ true)
  }

  /** The eleven names the `dynamicTypeRamp` style property accepts. */
  private val ROLES =
      listOf(
          "caption2",
          "caption1",
          "footnote",
          "subheadline",
          "callout",
          "body",
          "headline",
          "title3",
          "title2",
          "title1",
          "largeTitle",
      )

  @Test
  fun `every role resolves to a usable size`() {
    /*
     * Not completeness for its own sake. The style property accepts all eleven
     * names, and naming one CLEARS the size the cascade would have carried, on
     * the promise that the platform supplies a replacement. A role that resolved
     * to nothing left text with no size at all, which surfaces as `FontSize
     * should be a positive value` from a letter-spacing calculation — a crash
     * reachable from a plain, valid stylesheet.
     */
    prime()
    for (role in ROLES) {
      val appearance = MaterialTypeScale.forRole(role)
      assertThat(appearance).describedAs("role %s resolved to nothing", role).isNotNull
      assertThat(appearance!!.textSizeSp).describedAs("role %s size", role).isGreaterThan(0f)
    }
  }

  @Test
  fun `an unknown role resolves to nothing rather than to something wrong`() {
    prime()
    assertThat(MaterialTypeScale.forRole("titleEnormous")).isNull()
    assertThat(MaterialTypeScale.forRole("")).isNull()
  }

  @Test
  fun `the resolved sizes do not depend on the user's font scale`() {
    /*
     * A text appearance resolves to already-scaled pixels, and React Native
     * scales again downstream, so what is stored here must be the `sp` figure
     * the theme states, the same number at every font scale. Linear scaling
     * here, so this catches the inverse being dropped, not the non-linear curve.
     */
    RuntimeEnvironment.setFontScale(1.0f)
    DisplayMetricsHolder.initDisplayMetrics(context)
    prime()
    val atOne = ROLES.associateWith { MaterialTypeScale.forRole(it)?.textSizeSp }

    MaterialTypeScale.resetForTests()
    RuntimeEnvironment.setFontScale(2.0f)
    DisplayMetricsHolder.initDisplayMetrics(context)
    prime()
    val atTwo = ROLES.associateWith { MaterialTypeScale.forRole(it)?.textSizeSp }

    for (role in ROLES) {
      assertThat(atTwo[role])
          .describedAs("role %s changed size when the user changed their font scale", role)
          .isEqualTo(atOne[role])
    }

    RuntimeEnvironment.setFontScale(1.0f)
  }

  @Test
  fun `the published dp is the same conversion the text goes through`() {
    /*
     * The invariant the margins rest on. `roleSizesDp` feeds the layout layer,
     * which multiplies it by the spec's `em` factor; the text goes through
     * `PixelUtil` independently. If the two conversions ever diverge, every
     * heading's margin belongs to type that is not on the screen — and it would
     * still look plausible, which is why this is asserted rather than assumed.
     */
    prime()
    val density = DisplayMetricsHolder.getScreenDisplayMetrics().density
    val published = MaterialTypeScale.roleSizesDp(context)
    assertThat(published).isNotEmpty

    for ((role, dp) in published) {
      val sizeSp = MaterialTypeScale.forRole(role)!!.textSizeSp
      assertThat(dp)
          .describedAs(
              "role %s: the margin would resolve against a size the text is not drawn at",
              role,
          )
          .isEqualTo(PixelUtil.toPixelFromSP(sizeSp) / density)
    }
  }

  @Test
  fun `the scale is a scale`() {
    /*
     * A guard against the whole thing collapsing onto one value, which is what
     * a failed resolution looks like when it still produces numbers — and which
     * every other assertion here would pass.
     *
     * MONOTONIC, with only one strict step, because this sandbox's theme is not
     * a Material one: it resolves through the framework fallback, where six
     * heading roles collapse onto `textAppearanceLarge/Medium/Small` and
     * ADJACENT ROLES ARE LEGITIMATELY EQUAL. Asserting `title3 > body` failed
     * here for exactly that reason — the fallback is coarser by design, and a
     * test that demands Material's resolution would be asserting the fixture
     * rather than the code.
     */
    prime()
    val sizes = ROLES.map { MaterialTypeScale.forRole(it)!!.textSizeSp }
    for (i in 1 until sizes.size) {
      assertThat(sizes[i])
          .describedAs("%s must not be smaller than %s", ROLES[i], ROLES[i - 1])
          .isGreaterThanOrEqualTo(sizes[i - 1])
    }
    // And at least one real step, so a scale that resolved to a single repeated
    // value cannot pass.
    assertThat(MaterialTypeScale.forRole("title1")!!.textSizeSp)
        .isGreaterThan(MaterialTypeScale.forRole("body")!!.textSizeSp)
  }
}
