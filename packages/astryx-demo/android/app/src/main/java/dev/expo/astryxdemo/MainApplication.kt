/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package dev.expo.astryxdemo

import android.app.Application
import android.util.Log
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactPackage
import com.facebook.react.ViewManagerOnDemandReactPackage
import com.facebook.react.common.assets.ReactFontManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.config.ReactFeatureFlags
import com.facebook.react.defaults.DefaultReactHost
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsDefaults
import dev.expo.astryxdemo.component.AstryxVectorShapeManager

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by
      lazy(LazyThreadSafetyMode.NONE) {
        DefaultReactHost.getDefaultReactHost(
            context = applicationContext,
            packageList =
                PackageList(this).packages.apply {
                  // The vector shape the Astryx `<svg>` renders with: the same view manager
                  // RNTester registers, for the icons in the templates
                  add(
                      object : ReactPackage, ViewManagerOnDemandReactPackage {
                        override fun getViewManagerNames(reactContext: ReactApplicationContext) =
                            listOf("AstryxVectorShape")

                        override fun createViewManagers(
                            reactContext: ReactApplicationContext
                        ): List<ViewManager<*, *>> = listOf(AstryxVectorShapeManager())

                        override fun createViewManager(
                            reactContext: ReactApplicationContext,
                            viewManagerName: String,
                        ): ViewManager<*, out ReactShadowNode<*>>? =
                            if (viewManagerName == "AstryxVectorShape") AstryxVectorShapeManager()
                            else null
                      }
                  )
                },
            // Metro's project root is this package (metro.config.js), as on iOS
            jsMainModulePath = "index",
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
     * The flags the iOS app sets in AppDelegate.mm; see there for why. After
     * `loadReactNative`, which installs the OSS-Stable overrides (so a plain
     * `override` would throw). `reactHost` is created lazily, so these are set
     * before anything renders.
     */
    val accessedEarly =
        ReactNativeFeatureFlags.dangerouslyForceOverride(
            object : ReactNativeFeatureFlagsDefaults() {
              override fun enableNativeGestureRecognizers(): Boolean = true

              override fun enableYogaDisplayBlock(): Boolean = true

              override fun enableResizeObserverByDefault(): Boolean = true

              override fun enableIntersectionObserverByDefault(): Boolean = true
            }
        )
    if (accessedEarly != null) {
      Log.w("AstryxDemo", "Feature flags read before the override: " + accessedEarly)
    }

    // The neutral theme's type, bundled at the weights it uses (res/font/figtree.xml);
    // a weight the family has is answered from it rather than synthesised
    ReactFontManager.getInstance().addCustomFont(this, "Figtree", R.font.figtree)
  }
}
