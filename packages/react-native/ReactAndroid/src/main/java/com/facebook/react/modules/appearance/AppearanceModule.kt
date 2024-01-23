/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.modules.appearance

import android.content.Context
import android.content.res.Configuration
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import com.facebook.fbreact.specs.NativeAppearanceSpec
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule

/** Module that exposes the user's preferred color scheme. */
@ReactModule(name = NativeAppearanceSpec.NAME)
public class AppearanceModule
@JvmOverloads
constructor(
    reactContext: ReactApplicationContext,
    private val overrideColorScheme: OverrideColorScheme? = null
) : NativeAppearanceSpec(reactContext) {

  private var colorScheme = colorSchemeForCurrentConfiguration(reactContext)

  /** Optional override to the current color scheme */
  public fun interface OverrideColorScheme {
    /**
     * Color scheme will use the return value instead of the current system configuration. Available
     * scheme: {light, dark}
     */
    public fun getScheme(): String
  }

  // NOTE(brentvatne): this was static previously, but it wasn't necessary and we need it to not be
  // in order to use getCurrentActivity
  private fun colorSchemeForCurrentConfiguration(context: Context): String {
    if (overrideColorScheme != null) {
      return overrideColorScheme.getScheme()
    }
    // NOTE(brentvatne): Same code (roughly) that we use in ExpoAppearanceModule to get the config
    // as set by ExperienceActivityUtils to force the dark/light mode config on the activity
    if (currentActivity is AppCompatActivity) {
      val mode = (currentActivity as AppCompatActivity?)!!.delegate.localNightMode
      when (mode) {
        AppCompatDelegate.MODE_NIGHT_YES -> return "dark"
        AppCompatDelegate.MODE_NIGHT_NO -> return "light"
      }
    }

    val currentNightMode =
        context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
    when (currentNightMode) {
      Configuration.UI_MODE_NIGHT_NO -> return "light"
      Configuration.UI_MODE_NIGHT_YES -> return "dark"
      else -> return "light"
    }
  }

  public override fun getColorScheme(): String {
    // Attempt to use the Activity context first in order to get the most up to date
    // scheme. This covers the scenario when AppCompatDelegate.setDefaultNightMode()
    // is called directly (which can occur in Brownfield apps for example).
    val activity = getCurrentActivity()
    colorScheme = colorSchemeForCurrentConfiguration(activity ?: getReactApplicationContext())
    return colorScheme
  }

  public override fun setColorScheme(style: String) {
    var nightMode = AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
    if (style == "dark") {
      nightMode = AppCompatDelegate.MODE_NIGHT_YES
    } else if (style == "light") {
      nightMode = AppCompatDelegate.MODE_NIGHT_NO
    } else if (style == "unspecified") {
      nightMode = AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
    }

    val activity = currentActivity
    if (activity is AppCompatActivity) {
      (activity as AppCompatActivity).delegate.localNightMode = nightMode
    } else {
      AppCompatDelegate.setDefaultNightMode(nightMode)
    }
  }

  /** Stub */
  public override fun addListener(eventName: String): Unit = Unit

  /** Stub */
  public override fun removeListeners(count: Double): Unit = Unit

  /*
   * Call this from your root activity whenever configuration changes. If the
   * color scheme has changed, an event will emitted.
   */
  public fun onConfigurationChanged(currentContext: Context) {
    val newColorScheme = colorSchemeForCurrentConfiguration(currentContext)
    if (colorScheme != newColorScheme) {
      colorScheme = newColorScheme
      emitAppearanceChanged(colorScheme)
    }
  }

  /** Sends an event to the JS instance that the preferred color scheme has changed. */
  public fun emitAppearanceChanged(colorScheme: String) {
    val appearancePreferences = Arguments.createMap()
    appearancePreferences.putString("colorScheme", colorScheme)
    val reactApplicationContext = getReactApplicationContextIfActiveOrWarn()
    reactApplicationContext?.emitDeviceEvent(APPEARANCE_CHANGED_EVENT_NAME, appearancePreferences)
  }

  public companion object {
    public const val NAME: String = NativeAppearanceSpec.NAME
    private const val APPEARANCE_CHANGED_EVENT_NAME = "appearanceChanged"
  }
}
