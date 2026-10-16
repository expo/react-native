/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.views.toplayer

import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewGroupManager
import com.facebook.react.uimanager.annotations.ReactProp

// View manager for `<native:toplayer>`
@ReactModule(name = ExpoTopLayerViewManager.REACT_CLASS)
public class ExpoTopLayerViewManager : ViewGroupManager<ExpoTopLayerView>() {

  public companion object {
    // Matches `ExpoTopLayerComponentName` in C++
    public const val REACT_CLASS: String = "native-toplayer"
  }

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): ExpoTopLayerView =
      ExpoTopLayerView(context)

  // The events this element sends; an event dispatched under an unexported name is dropped silently
  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
      mutableMapOf(OUTSIDE_PRESS_EVENT to mapOf("registrationName" to "onOutsidePress"))

  @ReactProp(name = "active", defaultBoolean = false)
  public fun setActive(view: ExpoTopLayerView, value: Boolean) {
    view.active = value
  }
}
