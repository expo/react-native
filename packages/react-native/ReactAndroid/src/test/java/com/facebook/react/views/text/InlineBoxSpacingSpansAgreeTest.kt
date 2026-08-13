/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.text

import android.text.Spanned
import android.text.style.LeadingMarginSpan
import com.facebook.react.common.mapbuffer.MapBuffer
import com.facebook.react.common.mapbuffer.WritableMapBuffer
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsDefaults
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.facebook.react.views.text.internal.span.InlineBoxSpacingSpan
import com.facebook.react.views.text.internal.span.TextInlineViewPlaceholderSpan
import org.assertj.core.api.Assertions.assertThat
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * The two Spannable construction paths must place an inline element's inline-axis space
 * identically.
 *
 * There are two of them — `createSpannableFromAttributedString` and
 * `buildSpannableFromFragmentsOptimized`, selected by
 * `enableAndroidTextMeasurementOptimizations`. The flag defaults to false, so every screenshot,
 * every conformance run and every device check exercises only the first. Its `expectedReleaseValue`
 * is true, which means the *unexercised* path is the one that eventually ships.
 *
 * That is exactly how this went wrong. An attachment's own [TextInlineViewPlaceholderSpan] already
 * builds its leading and trailing space into its advance, and both paths were *also* adding an
 * [InlineBoxSpacingSpan] for the same space. It stayed invisible while that span was a
 * `MetricAffectingSpan`, because a ReplacementSpan's size wins and the duplicate was simply
 * discarded. Once it became a ReplacementSpan the two collided and an attachment 40 wide measured
 * 6 — caught on the default path, and it would have sat undisturbed in the other one until the flag
 * flipped.
 *
 * So these assert agreement rather than coordinates: whatever the rule is, both paths follow it.
 */
@RunWith(RobolectricTestRunner::class)
class InlineBoxSpacingSpansAgreeTest {

  @Before
  fun setUp() {
    // `leadingInlineSpace` converts DIP to px, which needs the display metrics — and the init must
    // be UNCONDITIONAL. Robolectric reuses one sandbox classloader for every test class with the
    // same config, so `DisplayMetricsHolder`'s static survives from class to class, and two
    // property tests in this suite leave it holding a bare `DisplayMetrics()` — density zero —
    // with no teardown. `initDisplayMetricsIfNotInitialized` sees non-null and keeps the garbage,
    // and every font size in this file multiplies to 0. Passed alone, failed in the full suite.
    DisplayMetricsHolder.initDisplayMetrics(RuntimeEnvironment.getApplication())
  }

  @After
  fun tearDown() {
    // The good citizenship the classes above skipped: leave nothing for the next class to inherit.
    DisplayMetricsHolder.setScreenDisplayMetrics(null)
  }

  /** margin 4 + border 1 + padding 5 on each inline edge, as `leadingInlineSpace` reads them. */
  private fun inlineBox(): WritableMapBuffer =
      WritableMapBuffer().apply {
        put(TextLayoutManager.IB_KEY_MARGIN_LEFT, 4.0)
        put(TextLayoutManager.IB_KEY_MARGIN_RIGHT, 4.0)
        put(TextLayoutManager.IB_KEY_PADDING_LEFT, 5.0)
        put(TextLayoutManager.IB_KEY_PADDING_RIGHT, 5.0)
        put(TextLayoutManager.IB_KEY_BORDER_LEFT_WIDTH, 1.0)
        put(TextLayoutManager.IB_KEY_BORDER_RIGHT_WIDTH, 1.0)
      }

  private fun fragment(
      text: String,
      isAttachment: Boolean = false,
      withBox: Boolean = false,
  ): WritableMapBuffer =
      WritableMapBuffer().apply {
        put(TextLayoutManager.FR_KEY_STRING, text)
        // A real font size: `TextAttributeProps` rejects the -1 an empty map would leave.
        put(
            TextLayoutManager.FR_KEY_TEXT_ATTRIBUTES,
            WritableMapBuffer().apply { put(TextAttributeProps.TA_KEY_FONT_SIZE, 16.0) },
        )
        if (isAttachment) {
          put(TextLayoutManager.FR_KEY_REACT_TAG, 42)
          put(TextLayoutManager.FR_KEY_IS_ATTACHMENT, true)
          put(TextLayoutManager.FR_KEY_WIDTH, 40.0)
          put(TextLayoutManager.FR_KEY_HEIGHT, 40.0)
        }
        if (withBox) {
          put(TextLayoutManager.FR_KEY_INLINE_BOX, inlineBox())
          put(TextLayoutManager.FR_KEY_IS_INLINE_BOX_START, true)
          put(TextLayoutManager.FR_KEY_IS_INLINE_BOX_END, true)
        }
      }

  private fun attributedString(vararg fragments: WritableMapBuffer): MapBuffer {
    val list = WritableMapBuffer()
    fragments.forEachIndexed { i, f -> list.put(i, f) }
    return WritableMapBuffer().apply {
      put(TextLayoutManager.AS_KEY_FRAGMENTS, list)
    }
  }

  private fun buildSpannable(attributed: MapBuffer, optimized: Boolean): Spanned {
    // setUp() first: the accessor refuses a second override once flags have been read.
    ReactNativeFeatureFlagsForTests.setUp()
    ReactNativeFeatureFlags.override(
        object : ReactNativeFeatureFlagsDefaults() {
          override fun enableAndroidTextMeasurementOptimizations(): Boolean = optimized
        }
    )
    return TextLayoutManager.getOrCreateSpannableForText(
        RuntimeEnvironment.getApplication().assets,
        attributed,
        null,
    ) as Spanned
  }

  /** Every inline-box spacing span as `kind(start,end)` — the placement, not the identity. */
  private fun spacingSpans(attributed: MapBuffer, optimized: Boolean): List<String> {
    val spanned = buildSpannable(attributed, optimized)
    return spanned
        .getSpans(0, spanned.length, Any::class.java)
        .filter { it is InlineBoxSpacingSpan || it is LeadingMarginSpan.Standard }
        .map {
          val kind = if (it is InlineBoxSpacingSpan) "InlineBoxSpacing" else "LeadingMargin"
          "$kind(${spanned.getSpanStart(it)},${spanned.getSpanEnd(it)})"
        }
        .sorted()
  }

  private fun assertPathsAgree(attributed: MapBuffer) {
    val plain = spacingSpans(attributed, optimized = false)
    val optimized = spacingSpans(attributed, optimized = true)
    assertThat(optimized)
        .withFailMessage(
            "The two Spannable construction paths placed inline-box spacing differently.\n" +
                "  createSpannableFromAttributedString:   %s\n" +
                "  buildSpannableFromFragmentsOptimized: %s\n" +
                "Only the first runs by default, so a difference here is a bug that ships " +
                "silently the day enableAndroidTextMeasurementOptimizations is turned on.",
            plain,
            optimized,
        )
        .isEqualTo(plain)
  }

  @Test
  fun `agree for a decorated inline between two text runs`() {
    assertPathsAgree(
        attributedString(fragment("before"), fragment("SPAN", withBox = true), fragment("after"))
    )
  }

  @Test
  fun `agree when the decorated inline starts the text`() {
    // No preceding character to hang the leading space on: a LeadingMarginSpan is used instead.
    assertPathsAgree(attributedString(fragment("SPAN", withBox = true), fragment("after")))
  }

  @Test
  fun `agree when a decorated inline follows an attachment`() {
    // The preceding character is an attachment placeholder and cannot carry the span.
    assertPathsAgree(
        attributedString(
            fragment("before"),
            fragment("I", isAttachment = true),
            fragment("SPAN", withBox = true),
        )
    )
  }

  @Test
  fun `an attachment gets no spacing span of its own on either path`() {
    val attributed =
        attributedString(fragment("before"), fragment("I", isAttachment = true, withBox = true))

    for (optimized in listOf(false, true)) {
      val spanned = buildSpannable(attributed, optimized)

      assertThat(spanned.getSpans(0, spanned.length, TextInlineViewPlaceholderSpan::class.java))
          .withFailMessage("optimized=%s: the attachment lost its placeholder span", optimized)
          .hasSize(1)

      val spacing = spanned.getSpans(0, spanned.length, InlineBoxSpacingSpan::class.java)
      assertThat(spacing)
          .withFailMessage(
              "optimized=%s: an attachment character carries %s InlineBoxSpacingSpan(s) on top " +
                  "of its placeholder, which already includes that same space. Two " +
                  "ReplacementSpans on one character fight, and the attachment loses its width.",
              optimized,
              spacing.size,
          )
          .isEmpty()
    }
  }
}
