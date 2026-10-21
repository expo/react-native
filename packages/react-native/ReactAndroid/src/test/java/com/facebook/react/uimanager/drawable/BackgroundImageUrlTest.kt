/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.uimanager.drawable

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.ColorDrawable
import android.os.Looper
import com.facebook.react.bridge.DynamicFromObject
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.uimanager.DisplayMetricsHolder
import com.facebook.react.uimanager.LengthPercentage
import com.facebook.react.uimanager.LengthPercentageType
import com.facebook.react.uimanager.PixelUtil.dpToPx
import com.facebook.react.uimanager.style.BackgroundImageLayer
import com.facebook.react.uimanager.style.BackgroundImageProvider
import com.facebook.react.uimanager.style.BackgroundRepeat
import com.facebook.react.uimanager.style.BackgroundRepeatKeyword
import com.facebook.react.uimanager.style.BackgroundSize
import com.facebook.react.uimanager.style.BackgroundSizeLengthPercentage
import java.io.Closeable
import org.assertj.core.api.Assertions.assertThat
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * Tests that a `background-image: url()` layer loads through the background image provider, lets
 * its image go when the background stops showing, and draws it at the size CSS gives it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "mdpi")
class BackgroundImageUrlTest {
  private val context: Context = RuntimeEnvironment.getApplication()
  private val provider = FakeProvider()

  @Before
  fun setUp() {
    DisplayMetricsHolder.initDisplayMetrics(context)
    BackgroundImageProvider.current = provider
  }

  @After
  fun tearDown() {
    BackgroundImageProvider.current = null
  }

  @Test
  fun aUrlLayerParsesWithItsUrl() {
    val layer = BackgroundImageLayer.parse(JavaOnlyMap.of("type", "url", "uri", "a.png"), context)
    assertThat(layer?.uri).isEqualTo("a.png")
    // A layer naming no image is `none`, which keeps its place
    val none = BackgroundImageLayer.parse(JavaOnlyMap.of("type", "url"), context)
    assertThat(none?.uri).isEmpty()
  }

  @Test
  fun coverAndContainParse() {
    assertThat(BackgroundSize.parse(DynamicFromObject("cover"))).isSameAs(BackgroundSize.Cover)
    assertThat(BackgroundSize.parse(DynamicFromObject("contain")))
        .isSameAs(BackgroundSize.Contain)
  }

  @Test
  fun theBackgroundLoadsEachImageItNamesOnce() {
    val drawable = BackgroundImageDrawable(context)
    drawable.backgroundImageLayers = listOf(layer("a.png"), layer(""), layer("a.png"))
    assertThat(provider.requested).containsExactly("a.png")

    drawable.backgroundImageLayers = listOf(layer("b.png"))
    assertThat(provider.requested).containsExactly("a.png", "b.png")
    assertThat(provider.closed).containsExactly("a.png")
  }

  @Test
  fun aHiddenBackgroundLetsItsImagesGoAFrameLater() {
    val drawable = BackgroundImageDrawable(context)
    drawable.backgroundImageLayers = listOf(layer("a.png"))

    drawable.setVisible(false, false)
    assertThat(provider.closed).isEmpty()
    shadowOf(Looper.getMainLooper()).idle()
    assertThat(provider.closed).containsExactly("a.png")

    drawable.setVisible(true, false)
    assertThat(provider.requested).containsExactly("a.png", "a.png")
  }

  @Test
  fun aBackgroundHiddenAndShownAtOnceKeepsItsImages() {
    val drawable = BackgroundImageDrawable(context)
    drawable.backgroundImageLayers = listOf(layer("a.png"))

    // What a view does as it swaps the composite background holding this drawable
    drawable.setVisible(false, false)
    drawable.setVisible(true, false)
    shadowOf(Looper.getMainLooper()).idle()

    assertThat(provider.closed).isEmpty()
    assertThat(provider.requested).containsExactly("a.png")
  }

  @Test
  fun coverAndContainKeepTheImagesRatio() {
    assertThat(tileFor(BackgroundSize.Cover, 200f, 100f)).isEqualTo(Rect(0, 0, px(200f), px(100f)))
    assertThat(tileFor(BackgroundSize.Contain, 200f, 100f)).isEqualTo(Rect(0, 0, px(100f), px(50f)))
  }

  @Test
  fun aSingleAutoKeepsTheImagesRatio() {
    val width =
        BackgroundSize.LengthPercentageAuto(
            BackgroundSizeLengthPercentage(LengthPercentage(50f, LengthPercentageType.POINT), null)
        )
    assertThat(tileFor(width, 200f, 100f)).isEqualTo(Rect(0, 0, px(50f), px(25f)))
  }

  @Test
  fun anImageWithNoSizeDrawsAtItsNaturalSize() {
    assertThat(tileFor(null, 40f, 30f)).isEqualTo(Rect(0, 0, px(40f), px(30f)))
  }

  // The bounds a 100 dp square box draws its one image at, the image `width` by `height` dp
  private fun tileFor(size: BackgroundSize?, width: Float, height: Float): Rect {
    val drawable = BackgroundImageDrawable(context)
    drawable.backgroundImageLayers = listOf(layer("a.png"))
    drawable.backgroundSize = size?.let { listOf(it) }
    drawable.backgroundRepeat =
        listOf(BackgroundRepeat(BackgroundRepeatKeyword.NoRepeat, BackgroundRepeatKeyword.NoRepeat))
    val image = provider.load("a.png", width, height)
    drawable.setBounds(0, 0, px(100f), px(100f))
    drawable.draw(Canvas(Bitmap.createBitmap(px(100f), px(100f), Bitmap.Config.ARGB_8888)))
    return image.drawnBounds.single()
  }

  private fun px(dp: Float): Int = dp.dpToPx().toInt()

  private fun layer(uri: String): BackgroundImageLayer =
      checkNotNull(BackgroundImageLayer.parse(JavaOnlyMap.of("type", "url", "uri", uri), context))

  private class FakeProvider : BackgroundImageProvider {
    val requested = mutableListOf<String>()
    val closed = mutableListOf<String>()
    private val pending = HashMap<String, (BackgroundImageProvider.Image?) -> Unit>()

    override fun requestImage(
        context: Context,
        uri: String,
        onLoad: (BackgroundImageProvider.Image?) -> Unit,
    ): Closeable {
      requested.add(uri)
      pending[uri] = onLoad
      return Closeable { closed.add(uri) }
    }

    fun load(uri: String, width: Float, height: Float): RecordingDrawable {
      val drawable = RecordingDrawable()
      checkNotNull(pending.remove(uri))(
          object : BackgroundImageProvider.Image {
            override val naturalWidth = width
            override val naturalHeight = height

            override fun newDrawable() = drawable
          }
      )
      return drawable
    }
  }

  private class RecordingDrawable : ColorDrawable(Color.RED) {
    val drawnBounds = mutableListOf<Rect>()

    override fun draw(canvas: Canvas) {
      drawnBounds.add(Rect(bounds))
      super.draw(canvas)
    }
  }
}
