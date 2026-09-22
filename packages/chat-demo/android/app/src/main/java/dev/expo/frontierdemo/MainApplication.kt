/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package dev.expo.frontierdemo

import android.app.Application
import android.util.Log
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.config.ReactFeatureFlags
import com.facebook.react.defaults.DefaultReactHost
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsDefaults

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by
      lazy(LazyThreadSafetyMode.NONE) {
        DefaultReactHost.getDefaultReactHost(
            context = applicationContext,
            packageList = PackageList(this).packages,
            jsMainModulePath = "packages/chat-demo/index",
        )
      }

  override fun onCreate() {
    /*
     * Without this, `<a>` and `<button>` never get `onClick`: clicks come from
     * `JSPointerDispatcher`, which `ReactSurfaceView` creates in `init` only when
     * this is on. So it must be set before any surface is created. iOS:
     * `RCTSetDispatchW3CPointerEvents(YES)` in AppDelegate.mm.
     */
    ReactFeatureFlags.dispatchPointerEvents = true
    super.onCreate()
    loadReactNative(this)

    /*
     * The first two flags of `ChatDemoFeatureFlags` in AppDelegate.mm; see there
     * for why. After `loadReactNative`, which installs the OSS-Stable overrides
     * (so a plain `override` would throw). `reactHost` is created lazily, so
     * these are set before anything renders.
     */
    val accessedEarly =
        ReactNativeFeatureFlags.dangerouslyForceOverride(
            object : ReactNativeFeatureFlagsDefaults() {
              override fun enableNativeGestureRecognizers(): Boolean = true

              override fun enableYogaDisplayBlock(): Boolean = true
            }
        )
    if (accessedEarly != null) {
      Log.w("ChatDemo", "Feature flags read before the override: " + accessedEarly)
    }
  }
}
