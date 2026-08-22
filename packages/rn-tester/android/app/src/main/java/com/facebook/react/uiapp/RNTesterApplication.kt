/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

@file:Suppress("DEPRECATION")

package com.facebook.react.uiapp

import android.app.Application
import android.util.Log
import com.facebook.fbreact.specs.SampleLegacyModule
import com.facebook.fbreact.specs.SampleTurboModule
import com.facebook.react.BaseReactPackage
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactPackage
import com.facebook.react.config.ReactFeatureFlags
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsDefaults
import com.facebook.react.ViewManagerOnDemandReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.common.assets.ReactFontManager
import com.facebook.react.defaults.DefaultReactHost
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uiapp.component.MyLegacyViewManager
import com.facebook.react.uiapp.component.AstryxVectorShapeManager
import com.facebook.react.uiapp.component.MyNativeViewManager
import com.facebook.react.uiapp.component.ReportFullyDrawnViewManager
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager

internal class RNTesterApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by
      lazy(LazyThreadSafetyMode.NONE) {
        val packages: List<ReactPackage> =
            PackageList(this@RNTesterApplication).packages.apply {
              add(
                  object : BaseReactPackage() {
                    override fun getModule(
                        name: String,
                        reactContext: ReactApplicationContext,
                    ): NativeModule? =
                        when (name) {
                          SampleTurboModule.NAME -> SampleTurboModule(reactContext)
                          SampleLegacyModule.NAME -> SampleLegacyModule(reactContext)
                          else -> null
                        }

                    // Note: Specialized annotation processor for @ReactModule isn't configured in
                    // OSS yet. For now, hardcode this information, though it's not necessary for
                    // most modules.
                    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
                        ReactModuleInfoProvider {
                          mapOf(
                              SampleTurboModule.NAME to
                                  ReactModuleInfo(
                                      SampleTurboModule.NAME,
                                      "SampleTurboModule",
                                      canOverrideExistingModule = false,
                                      needsEagerInit = false,
                                      isCxxModule = false,
                                      isTurboModule = true,
                                  ),
                              SampleLegacyModule.NAME to
                                  ReactModuleInfo(
                                      SampleLegacyModule.NAME,
                                      "SampleLegacyModule",
                                      canOverrideExistingModule = false,
                                      needsEagerInit = false,
                                      isCxxModule = false,
                                      isTurboModule = false,
                                  ),
                          )
                        }
                  }
              )
              add(
                  object : ReactPackage, ViewManagerOnDemandReactPackage {
                    override fun getViewManagerNames(
                        reactContext: ReactApplicationContext
                    ) = listOf(
                        "RNTMyNativeView",
                        "RNTMyLegacyNativeView",
                        "RNTReportFullyDrawnView",
                        "AstryxVectorShape",
                    )

                    override fun createViewManagers(
                        reactContext: ReactApplicationContext
                    ): List<ViewManager<*, *>> = listOf(
                        MyNativeViewManager(),
                        MyLegacyViewManager(reactContext),
                        ReportFullyDrawnViewManager(),
                        AstryxVectorShapeManager(),
                    )

                    override fun createViewManager(
                        reactContext: ReactApplicationContext,
                        viewManagerName: String,
                    ): ViewManager<*, out ReactShadowNode<*>>? =
                        when (viewManagerName) {
                          "RNTMyNativeView" -> MyNativeViewManager()
                          "RNTMyLegacyNativeView" -> MyLegacyViewManager(reactContext)
                          "RNTReportFullyDrawnView" -> ReportFullyDrawnViewManager()
                          "AstryxVectorShape" -> AstryxVectorShapeManager()
                          else -> null
                        }
                  }
              )
            }

        DefaultReactHost.getDefaultReactHost(
            applicationContext,
            packages,
            jsMainModulePath = BuildConfig.JS_MAIN_MODULE_NAME,
            jsBundleAssetPath = BuildConfig.BUNDLE_ASSET_NAME,
            useDevSupport = BuildConfig.DEBUG,
        )
      }

  override fun onCreate() {
    ReactFontManager.getInstance().addCustomFont(this, "Rubik", R.font.rubik)
    ReactFontManager.getInstance().addCustomFont(this, "FiraCode", R.font.firacode)
    // Enable W3C pointer events so DOM-style click events (onClick + bubbling) on
    // intrinsics fire like on the web — the Android analog of iOS's
    // RCTSetDispatchW3CPointerEvents(YES) in AppDelegate (text-children demo).
    ReactFeatureFlags.dispatchPointerEvents = true
    super.onCreate()
    loadReactNative(this)
    // The shared C++ animation backend, which drives prop updates from the
    // Choreographer WITHOUT going through React's JavaScript pipeline. Both
    // flags are needed: the backend itself, and the C++ Animated implementation
    // that owns it. Upstream has these default-off with an expected release
    // value of true.
    //
    // After `loadReactNative`, not before: that installs the OSS-Stable
    // provider, and a second plain `override` — on either side — throws. So
    // this replaces it through the sanctioned escape hatch, which is what the
    // iOS counterpart in AppDelegate.mm does for the same reason. The React
    // host is created lazily by the activity, so the new values are in place
    // before anything renders. Any flag read before this point is reported
    // back, and is worth knowing about rather than swallowing.
    val accessedEarly =
        ReactNativeFeatureFlags.dangerouslyForceOverride(
            object : ReactNativeFeatureFlagsDefaults() {
              // The native Yoga block formatting context (YGDisplayBlock)
              // instead of the flex emulation, matching the iOS AppDelegate.
              // Without it the two platforms lay block containers out through
              // different code entirely: the emulation stacks children with
              // column-flex, where `align-content` — which is how a <button>
              // centres its content (css-align-3 §5.3) — does not apply. A
              // radio's dot sat at the top of its ring on Android while iOS
              // centred it, from one missing line here rather than anything
              // platform-specific in the renderer.
              override fun enableYogaDisplayBlock(): Boolean = true

              override fun useSharedAnimatedBackend(): Boolean = true

              override fun cxxNativeAnimatedEnabled(): Boolean = true

              // The DOM element catalog's elements track presses through
              // Android's own touch dispatch rather than the JS responder
              // system, so an ancestor scroll container intercepting the
              // gesture cancels the press directly (ACTION_CANCEL) instead of
              // after a round trip through JavaScript. Matches the iOS
              // AppDelegate.
              override fun enableNativeGestureRecognizers(): Boolean = true
            }
        )
    if (accessedEarly != null) {
      Log.w("RNTester", "Feature flags read before the override: " + accessedEarly)
    }
  }
}
