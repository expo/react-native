/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * This source code is licensed under the MIT license in the root directory.
 */
package dev.expo.astryxdemo

import com.facebook.fbreact.specs.NativePaneControllerSpec
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule

@ReactModule(name = "AstryxNavigation")
class AstryxNavigationModule(context: ReactApplicationContext) : NativePaneControllerSpec(context) {
  override fun getName() = "AstryxNavigation"

  override fun getTypedExportedConstants(): Map<String, Any> {
    val activity = reactApplicationContext.currentActivity as? MainActivity
    return mapOf(
        "twoPane" to (activity?.isTwoPane ?: false),
        "canToggleSidebar" to (activity?.canToggleSidebar ?: false),
        "galleryFold" to (activity?.isGalleryFold ?: false),
        "divisionStart" to (activity?.divisionStart ?: 0.0),
        "divisionWidth" to (activity?.divisionWidth ?: 0.0),
    )
  }

  override fun openDetail() {
    UiThreadUtil.runOnUiThread {
      (reactApplicationContext.currentActivity as? MainActivity)?.openDetail()
    }
  }

  override fun closeDetail() {
    UiThreadUtil.runOnUiThread {
      (reactApplicationContext.currentActivity as? MainActivity)?.closeDetail()
    }
  }

  override fun toggleSidebar() {
    UiThreadUtil.runOnUiThread {
      (reactApplicationContext.currentActivity as? MainActivity)?.toggleSidebar()
    }
  }

  companion object {
    fun publishMode(
        context: ReactContext?,
        twoPane: Boolean,
        canToggle: Boolean,
        galleryFold: Boolean,
        divisionStart: Double,
        divisionWidth: Double,
    ) {
      if (context?.hasActiveReactInstance() != true) return
      context
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(
              "astryxPaneMode",
              Arguments.createMap().apply {
                putBoolean("twoPane", twoPane)
                putBoolean("canToggleSidebar", canToggle)
                putBoolean("galleryFold", galleryFold)
                putDouble("divisionStart", divisionStart)
                putDouble("divisionWidth", divisionWidth)
              },
          )
    }
  }
}
