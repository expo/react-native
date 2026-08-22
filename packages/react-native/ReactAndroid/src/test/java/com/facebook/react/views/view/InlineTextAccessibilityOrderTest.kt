/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.view

import android.app.Activity
import android.graphics.Rect
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.view.View
import android.widget.FrameLayout
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import org.assertj.core.api.Assertions.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * A sentence with an inline `<button>` and `<img>` is read in the order it is written.
 *
 * The attachments are mounted children and the text is virtual nodes of a private host, so left to
 * the platform the host came after every React child and TalkBack read the button and the image
 * before the sentence they sit inside. The run's model lists each attachment where it stands, and
 * [ReactViewGroup] lists hosts and attachment views for accessibility in that order.
 *
 * The geometry half: a static-text node used to be a 1×1 box at the run's origin whenever fragment
 * spans were missing (they exist only under `enablePreparedTextLayout`), so the bounds now come from
 * the painted run's own [Layout] over the leaf's fragment character ranges.
 */
// Native graphics, so text is measured by a real font engine and a leaf's rectangle is real
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@RunWith(RobolectricTestRunner::class)
class InlineTextAccessibilityOrderTest {

  private lateinit var activity: Activity

  @Before
  fun setUp() {
    ReactNativeFeatureFlagsForTests.setUp()
    activity = Robolectric.buildActivity(Activity::class.java).setup().get()
  }

  @Test
  fun `attachments are read where they stand in the sentence`() {
    val rvg = ReactViewGroup(activity)
    val button = accessibleView(BUTTON_TAG)
    val image = accessibleView(IMAGE_TAG)
    rvg.addView(button)
    rvg.addView(image)
    attach(rvg)

    rvg.setTextRunLayouts(
        listOf(
            ReactViewGroup.TextRunLayout(
                layoutOf("Read the terms, then . The end."),
                0f,
                0f,
                0,
                listOf(
                    item(InlineAccessibilityItem.KIND_STATIC_TEXT, 0, "Read the "),
                    item(InlineAccessibilityItem.KIND_ELEMENT, 7, "terms"),
                    item(InlineAccessibilityItem.KIND_STATIC_TEXT, 0, ", then "),
                    item(InlineAccessibilityItem.KIND_ATTACHMENT, BUTTON_TAG, "", BUTTON_TAG),
                    item(InlineAccessibilityItem.KIND_ATTACHMENT, IMAGE_TAG, "", IMAGE_TAG),
                    item(InlineAccessibilityItem.KIND_STATIC_TEXT, 0, ". The end."),
                ),
                accessibilityAttachmentTags = intArrayOf(BUTTON_TAG, IMAGE_TAG),
            )
        )
    )

    val order = ArrayList<View>().also { rvg.addChildrenForAccessibility(it) }

    assertThat(order).hasSize(4)
    assertThat(order[0]).isInstanceOf(InlineTextAccessibilityHost::class.java)
    assertThat(order[1]).isSameAs(button)
    assertThat(order[2]).isSameAs(image)
    assertThat(order[3]).isInstanceOf(InlineTextAccessibilityHost::class.java)
    assertThat(order[3]).isNotSameAs(order[0])
    // Both hosts stay out of React's child indices
    assertThat(ReactViewManager().getChildCount(rvg)).isEqualTo(2)
  }

  @Test
  fun `block children keep their place between runs`() {
    val rvg = ReactViewGroup(activity)
    val block = accessibleView(30)
    rvg.addView(block)
    attach(rvg)

    rvg.setTextRunLayouts(
        listOf(
            ReactViewGroup.TextRunLayout(
                layoutOf("after"),
                0f,
                0f,
                1,
                listOf(item(InlineAccessibilityItem.KIND_STATIC_TEXT, 0, "after"))),
            ReactViewGroup.TextRunLayout(
                layoutOf("before"),
                0f,
                0f,
                0,
                listOf(item(InlineAccessibilityItem.KIND_STATIC_TEXT, 0, "before"))),
        )
    )

    val order = ArrayList<View>().also { rvg.addChildrenForAccessibility(it) }

    assertThat(order).hasSize(3)
    assertThat(order[0]).isInstanceOf(InlineTextAccessibilityHost::class.java)
    assertThat(order[1]).isSameAs(block)
    assertThat(order[2]).isInstanceOf(InlineTextAccessibilityHost::class.java)
  }

  @Test
  fun `an attachment no leaf presents is not read`() {
    // Its element was hidden, so the model has no leaf for it; its mounted view must not surface
    val rvg = ReactViewGroup(activity)
    val hidden = accessibleView(IMAGE_TAG)
    rvg.addView(hidden)
    attach(rvg)

    rvg.setTextRunLayouts(
        listOf(
            ReactViewGroup.TextRunLayout(
                layoutOf("Visible text"),
                0f,
                0f,
                0,
                listOf(item(InlineAccessibilityItem.KIND_STATIC_TEXT, 0, "Visible text")),
                accessibilityAttachmentTags = intArrayOf(IMAGE_TAG),
            )
        )
    )

    val order = ArrayList<View>().also { rvg.addChildrenForAccessibility(it) }

    assertThat(order).hasSize(1)
    assertThat(order[0]).isInstanceOf(InlineTextAccessibilityHost::class.java)
  }

  @Test
  fun `a leaf is placed on the characters it covers`() {
    val text = "Read the terms"
    val run =
        ReactViewGroup.TextRunLayout(
            layoutOf(text),
            10f,
            20f,
            0,
            fragmentOffsets = intArrayOf(0, 9, text.length),
        )

    val first = checkNotNull(inlineTextLeafBounds(run, item(0, 0, "Read the ", fragment = 0)))
    val second = checkNotNull(inlineTextLeafBounds(run, item(1, 7, "terms", fragment = 1)))

    assertThat(first.left).isEqualTo(10)
    assertThat(first.top).isEqualTo(20)
    assertThat(first.width()).isGreaterThan(1)
    assertThat(first.height()).isGreaterThan(1)
    assertThat(second.left).isGreaterThanOrEqualTo(first.right - 1)
    assertThat(second.right).isGreaterThan(second.left + 1)
    assertThat(second.top).isEqualTo(first.top)
  }

  @Test
  fun `a wrapped leaf covers each of its lines`() {
    val text = "alpha beta gamma delta"
    val layout = layoutOf(text, width = 1)
    assertThat(layout.lineCount).isGreaterThan(1)
    val run = ReactViewGroup.TextRunLayout(layout, 0f, 0f, 0, fragmentOffsets = intArrayOf(0, text.length))

    val bounds = checkNotNull(inlineTextLeafBounds(run, item(0, 0, text, fragment = 0)))

    assertThat(bounds).isEqualTo(
        Rect(bounds.left, layout.getLineTop(0), bounds.right, layout.getLineBottom(layout.lineCount - 1)))
  }

  @Test
  fun `a run without fragment offsets cannot place a leaf`() {
    val run = ReactViewGroup.TextRunLayout(layoutOf("text"), 0f, 0f, 0)

    assertThat(inlineTextLeafBounds(run, item(0, 0, "text", fragment = 0))).isNull()
  }

  private fun attach(view: View) {
    val root = FrameLayout(activity)
    root.addView(view, FrameLayout.LayoutParams(400, 400))
    activity.setContentView(root)
  }

  private fun accessibleView(tag: Int): View =
      View(activity).apply {
        id = tag
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
        contentDescription = "view $tag"
      }

  private fun layoutOf(text: String, width: Int = 1000): Layout =
      StaticLayout.Builder.obtain(text, 0, text.length, TextPaint().apply { textSize = 20f }, width)
          .build()

  private fun item(
      kind: Int,
      tag: Int,
      label: String,
      vararg attachmentTags: Int,
      fragment: Int = 0,
  ): InlineAccessibilityItem =
      InlineAccessibilityItem(
          kind = kind,
          tag = tag,
          label = label,
          role = if (kind == InlineAccessibilityItem.KIND_STATIC_TEXT) "text" else "link",
          hint = "",
          language = "",
          disabled = false,
          selected = false,
          checked = InlineAccessibilityItem.CHECKED_NONE,
          fragmentIndices = intArrayOf(fragment),
          liveRegion = 0,
          busy = false,
          expanded = null,
          valueMin = null,
          valueMax = null,
          valueNow = null,
          valueText = null,
          actions = emptyList(),
          attachmentTags = attachmentTags,
      )

  private companion object {
    const val BUTTON_TAG = 11
    const val IMAGE_TAG = 12
  }
}
