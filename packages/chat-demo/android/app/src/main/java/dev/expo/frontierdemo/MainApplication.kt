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
     * W3C pointer events, WITHOUT which nothing in this app can be tapped.
     *
     * `onClick` on Android is synthesised by `JSPointerDispatcher`, and the
     * dispatcher is only constructed when this flag is on — so with it off the
     * surface delivers no pointer events and no clicks at all, and every `<a>`
     * and `<button>` is dead. Native controls still work, because a checkbox
     * handles its own touches and reports a change rather than a click, which is
     * what made the whole thing look like an element-layer bug: half the screen
     * responded and half did not.
     *
     * The iOS counterpart is `RCTSetDispatchW3CPointerEvents(YES)`, and RN Tester
     * sets this for the same reason.
     *
     * Before `super.onCreate()`, because the surface view reads it in its `init`.
     */
    ReactFeatureFlags.dispatchPointerEvents = true
    super.onCreate()
    // Loads the native libraries and installs the SO mapping; replaces calling SoLoader directly.
    loadReactNative(this)

    /*
     * The same two flags the iOS AppDelegate sets, and for the same reasons.
     *
     * They were only on iOS, and the difference was not subtle: on Android
     * every `<a>` and `<button>` in this app was DEAD — the row that opens the
     * chat screen was clickable in the accessibility tree and did nothing when
     * tapped — and `<div>` laid out through the flex emulation rather than a
     * real block formatting context.
     *
     * Read on the native side, so a JavaScript `override()` cannot reach them.
     *
     * After `loadReactNative`, not before: that installs the OSS-Stable
     * provider, and a second plain `override` on either side of it throws. The
     * React host is created lazily by the activity, so these are in place
     * before anything renders. Anything read earlier is reported rather than
     * swallowed.
     */
    val accessedEarly =
        ReactNativeFeatureFlags.dangerouslyForceOverride(
            object : ReactNativeFeatureFlagsDefaults() {
              override fun enableNativeGestureRecognizers(): Boolean = true

              override fun enableYogaDisplayBlock(): Boolean = true
            })
    if (accessedEarly != null) {
      Log.w("ChatDemo", "Feature flags read before the override: " + accessedEarly)
    }
  }
}
