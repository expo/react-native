/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.image

import android.content.Context
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import com.facebook.common.executors.UiThreadImmediateExecutorService
import com.facebook.common.references.CloseableReference
import com.facebook.datasource.BaseDataSubscriber
import com.facebook.datasource.DataSource
import com.facebook.drawee.backends.pipeline.Fresco
import com.facebook.imagepipeline.image.CloseableBitmap
import com.facebook.imagepipeline.image.CloseableImage
import com.facebook.imagepipeline.request.ImageRequestBuilder
import com.facebook.react.uimanager.style.BackgroundImageProvider
import com.facebook.react.views.imagehelper.ImageSource
import java.io.Closeable

/**
 * React Native's background image provider: an image loads through Fresco's pipeline, as an
 * `<Image>`'s does, from a URL or a bundled resource ([ImageSource] tells which), and is drawn as a
 * bitmap. A loaded image holds its bitmap's reference until its handle is closed.
 */
public class FrescoBackgroundImageProvider : BackgroundImageProvider {

  override fun requestImage(
      context: Context,
      uri: String,
      onLoad: (BackgroundImageProvider.Image?) -> Unit,
  ): Closeable {
    if (!Fresco.hasBeenInitialized()) {
      onLoad(null)
      return Closeable {}
    }
    val request = ImageRequestBuilder.newBuilderWithSource(ImageSource(context, uri).uri).build()
    val dataSource = Fresco.getImagePipeline().fetchDecodedImage(request, null)
    val load = Load(context, dataSource, onLoad)
    dataSource.subscribe(load, UiThreadImmediateExecutorService.getInstance())
    return load
  }

  private class Load(
      private val context: Context,
      private val dataSource: DataSource<CloseableReference<CloseableImage>>,
      private var onLoad: ((BackgroundImageProvider.Image?) -> Unit)?,
  ) : BaseDataSubscriber<CloseableReference<CloseableImage>>(), Closeable {
    private var reference: CloseableReference<CloseableImage>? = null

    override fun onNewResultImpl(dataSource: DataSource<CloseableReference<CloseableImage>>) {
      if (!dataSource.isFinished) {
        return
      }
      val result = dataSource.result
      val bitmap = (result?.get() as? CloseableBitmap)?.underlyingBitmap
      // A load closed before its result came has nobody to hand it to
      if (result == null || bitmap == null || onLoad == null) {
        CloseableReference.closeSafely(result)
        finish(null)
        return
      }
      reference = result
      finish(BitmapImage(context, bitmap))
    }

    override fun onFailureImpl(dataSource: DataSource<CloseableReference<CloseableImage>>) {
      finish(null)
    }

    private fun finish(image: BackgroundImageProvider.Image?) {
      val callback = onLoad ?: return
      onLoad = null
      callback(image)
    }

    override fun close() {
      onLoad = null
      dataSource.close()
      CloseableReference.closeSafely(reference)
      reference = null
    }
  }

  private class BitmapImage(private val context: Context, private val bitmap: Bitmap) :
      BackgroundImageProvider.Image {
    // A CSS image's natural size is its size in pixels, as on the web, and a CSS pixel is a dp
    override val naturalWidth: Float = bitmap.width.toFloat()
    override val naturalHeight: Float = bitmap.height.toFloat()

    override fun newDrawable(): Drawable = BitmapDrawable(context.resources, bitmap)
  }
}
