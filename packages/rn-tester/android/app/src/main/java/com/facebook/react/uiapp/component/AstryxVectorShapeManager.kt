/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.uiapp.component

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.AstryxVectorShapeManagerDelegate
import com.facebook.react.viewmanagers.AstryxVectorShapeManagerInterface

/** View manager for the `<svg>` intrinsics' shape view. */
@ReactModule(name = AstryxVectorShapeManager.REACT_CLASS)
internal class AstryxVectorShapeManager :
    SimpleViewManager<AstryxVectorShapeView>(),
    AstryxVectorShapeManagerInterface<AstryxVectorShapeView> {

  companion object {
    const val REACT_CLASS = "AstryxVectorShape"
  }

  private val delegate: ViewManagerDelegate<AstryxVectorShapeView> =
      AstryxVectorShapeManagerDelegate(this)

  override fun getDelegate(): ViewManagerDelegate<AstryxVectorShapeView> = delegate

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(reactContext: ThemedReactContext): AstryxVectorShapeView =
      AstryxVectorShapeView(reactContext)

  override fun setCommands(view: AstryxVectorShapeView, value: ReadableArray?) {
    if (value == null) {
      view.setCommands(FloatArray(0))
      return
    }
    val commands = FloatArray(value.size())
    for (i in 0 until value.size()) {
      commands[i] = value.getDouble(i).toFloat()
    }
    view.setCommands(commands)
  }

  override fun setFillColor(view: AstryxVectorShapeView, value: Int) {
    view.setFillColor(value)
  }

  override fun setStrokeColor(view: AstryxVectorShapeView, value: Int) {
    view.setStrokeColor(value)
  }

  override fun setStrokeWidth(view: AstryxVectorShapeView, value: Float) {
    view.setStrokeWidth(value)
  }

  override fun setStrokeLinecap(view: AstryxVectorShapeView, value: String?) {
    view.setStrokeLinecap(value)
  }

  override fun setStrokeLinejoin(view: AstryxVectorShapeView, value: String?) {
    view.setStrokeLinejoin(value)
  }

  override fun setFillRule(view: AstryxVectorShapeView, value: String?) {
    view.setFillRule(value)
  }
}
