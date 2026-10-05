/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.modules.display

import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Build
import android.view.Display
import com.facebook.fbreact.specs.NativeDisplayCapabilitiesSpec
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ColorSpaceColors
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule

/**
 * What the display can show, for `matchMedia`'s `color-gamut` and `dynamic-range`, and whether this
 * OS provides a named color space, for `CSS.supports`. Read from the default display, and sent
 * again as `displayCapabilitiesDidChange` when a display changes.
 */
@ReactModule(name = NativeDisplayCapabilitiesSpec.NAME)
public class DisplayCapabilitiesModule(reactContext: ReactApplicationContext) :
    NativeDisplayCapabilitiesSpec(reactContext) {

  private var colorGamut: String = "srgb"
  private var dynamicRange: String = "standard"

  private val displayListener =
      object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int): Unit = emitIfChanged()

        override fun onDisplayRemoved(displayId: Int): Unit = emitIfChanged()

        override fun onDisplayChanged(displayId: Int): Unit = emitIfChanged()
      }

  init {
    read()
    displayManager()?.registerDisplayListener(displayListener, null)
  }

  private fun displayManager(): DisplayManager? =
      reactApplicationContext.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager

  /** The display the app draws on: the activity's where there is one, else the default */
  private fun display(): Display? {
    val activity = reactApplicationContext.currentActivity
    if (activity != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      activity.display?.let {
        return it
      }
    }
    return displayManager()?.getDisplay(Display.DEFAULT_DISPLAY)
  }

  // Android says "wide", not which gamut; Display P3 is what every wide-gamut Android panel
  // covers, and none reports rec2020
  private fun read() {
    val display = display()
    val wide = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && display?.isWideColorGamut == true
    val hdr = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && display?.isHdr == true
    colorGamut = if (wide) "p3" else "srgb"
    dynamicRange = if (hdr) "high" else "standard"
  }

  private fun capabilities(): WritableMap =
      Arguments.createMap().apply {
        putString("colorGamut", colorGamut)
        putString("dynamicRange", dynamicRange)
      }

  private fun emitIfChanged() {
    val oldGamut = colorGamut
    val oldRange = dynamicRange
    read()
    if (oldGamut == colorGamut && oldRange == dynamicRange) {
      return
    }
    getReactApplicationContextIfActiveOrWarn()?.emitDeviceEvent(CHANGE_EVENT_NAME, capabilities())
  }

  public override fun getCapabilities(): WritableMap = capabilities()

  /**
   * Asked of the platform by name; the Lab and XYZ families go by CSS's arithmetic and need no
   * space of the platform's. DOM-CSS-LIMITATION(android-needs-the-platforms-color-space)
   */
  public override fun isColorSpaceAvailable(name: String): Boolean =
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
          (name in ARITHMETIC_SPACES || ColorSpaceColors.colorSpace(name) != null)

  /** Stub */
  public override fun addListener(eventName: String): Unit = Unit

  /** Stub */
  public override fun removeListeners(count: Double): Unit = Unit

  public override fun invalidate() {
    displayManager()?.unregisterDisplayListener(displayListener)
    super.invalidate()
  }

  public companion object {
    public const val NAME: String = NativeDisplayCapabilitiesSpec.NAME
    private const val CHANGE_EVENT_NAME = "displayCapabilitiesDidChange"
    private val ARITHMETIC_SPACES =
        setOf("lab", "lch", "oklab", "oklch", "xyz", "xyz-d50", "xyz-d65")
  }
}
