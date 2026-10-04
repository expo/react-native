/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.imagehelper

import android.content.Context
import android.content.res.Resources
import android.net.Uri
import org.assertj.core.api.Assertions.assertThat
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.kotlin.mock
import org.mockito.kotlin.whenever
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class ResourceDrawableIdHelperTest {

  private lateinit var context: Context
  private val mockContext = mock<Context>()
  private val resources = mock<Resources>()

  @Before
  fun setUp() {
    context = RuntimeEnvironment.getApplication()
    ResourceDrawableIdHelper.clear()
    whenever(mockContext.resources).thenReturn(resources)
    whenever(mockContext.packageName).thenReturn("test.images")
  }

  @After
  fun tearDown() {
    ResourceDrawableIdHelper.clear()
  }

  @Test
  fun returnsZeroForMissingName() {
    assertThat(ResourceDrawableIdHelper.getResourceDrawableId(context, null)).isEqualTo(0)
    assertThat(ResourceDrawableIdHelper.getResourceDrawableId(context, "")).isEqualTo(0)
  }

  @Test
  fun returnsNumericNameAsId() {
    assertThat(ResourceDrawableIdHelper.getResourceDrawableId(context, "123")).isEqualTo(123)
    assertThat(ResourceDrawableIdHelper.getResourceDrawableId(context, "+42")).isEqualTo(42)
  }

  @Test
  fun looksUpNonNumericNameAsDrawable() {
    val expected =
        context.resources.getIdentifier(
            "redbox_top_border_background",
            "drawable",
            context.packageName,
        )
    assertThat(expected).isGreaterThan(0)
    assertThat(
            ResourceDrawableIdHelper.getResourceDrawableId(
                context,
                "Redbox-Top-Border-Background",
            )
        )
        .isEqualTo(expected)
  }

  @Test
  fun looksUpNumberThatDoesNotFitInAnIntAsDrawable() {
    assertThat(ResourceDrawableIdHelper.getResourceDrawableId(context, "99999999999")).isEqualTo(0)
  }

  @Test
  fun returnsZeroForUnknownDrawable() {
    assertThat(ResourceDrawableIdHelper.getResourceDrawableId(context, "unknown_image"))
        .isEqualTo(0)
  }

  @Test
  fun bundledRawImageResolvesToResourceUri() {
    whenever(resources.getIdentifier("color_hlg", "raw", "test.images")).thenReturn(42)

    assertThat(ResourceDrawableIdHelper.getResourceDrawableUri(mockContext, "color_hlg"))
        .isEqualTo(Uri.parse("res:/42"))
  }

  @Test
  fun drawableTakesPrecedenceOverRawResource() {
    whenever(resources.getIdentifier("color_hlg", "drawable", "test.images")).thenReturn(23)
    whenever(resources.getIdentifier("color_hlg", "raw", "test.images")).thenReturn(42)

    assertThat(ResourceDrawableIdHelper.getResourceDrawableUri(mockContext, "color_hlg"))
        .isEqualTo(Uri.parse("res:/23"))
  }

  @Test
  fun missingImageStillReturnsEmptyUri() {
    assertThat(ResourceDrawableIdHelper.getResourceDrawableUri(mockContext, "missing"))
        .isEqualTo(Uri.EMPTY)
  }
}
