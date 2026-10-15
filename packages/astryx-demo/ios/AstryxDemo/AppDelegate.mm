/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
// No `React/` prefix: the React-RCTAppDelegate pod doesn't install its public headers under `React/`.
#import "RCTDefaultReactNativeFactoryDelegate.h"
#import "RCTReactNativeFactory.h"

// Expo modules (expo-image behind <img>, expo-linking and expo-constants
// behind Expo Router). The app bootstraps the module runtime itself in
// host:didInitializeRuntime: below — the four lines Expo's own app delegate
// would run — so it needs none of Expo's AppDelegate machinery, as RN Tester.
#if __has_include("ExpoModulesCore-Swift.h") || __has_include(<ExpoModulesCore/ExpoModulesCore-Swift.h>)
#define ASTRYX_DEMO_USE_EXPO_MODULES 1
#import <ExpoModulesCore/EXHostWrapper.h>
#import <ExpoModulesCore/EXRuntime.h>
#if __has_include(<ExpoModulesCore/ExpoModulesCore-Swift.h>)
#import <ExpoModulesCore/ExpoModulesCore-Swift.h>
#else
#import "ExpoModulesCore-Swift.h"
#endif
#else
#define ASTRYX_DEMO_USE_EXPO_MODULES 0
#error "AstryxDemo: ExpoModulesCore headers not found — Expo Router needs the Expo modules runtime"
#endif

#if __has_include(<ReactAppDependencyProvider/RCTAppDependencyProvider.h>)
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>
#define ASTRYX_DEMO_HAS_DEPENDENCY_PROVIDER 1
#endif

#import <React/RCTConstants.h>

#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/featureflags/ReactNativeFeatureFlagsOverridesOSSStable.h>

#import <memory>

namespace {

/**
 * Feature flags the DOM elements need. All are off by default. Without them
 * there is no error, only wrong behaviour:
 *
 *  - `enableNativeGestureRecognizers`: without it `<button>` never fires
 *    `onClick`.
 *  - `enableYogaDisplayBlock`: without it `<div>` uses the flex emulation of
 *    block layout.
 *  - `useSharedAnimatedBackend` and `cxxNativeAnimatedEnabled`: without both,
 *    CSS transitions and animations don't run and the new value applies at once.
 *  - `enableResizeObserverByDefault`: without it there is no `ResizeObserver`,
 *    and Astryx's OverflowList never learns its width, so a row of tabs or
 *    filters runs off the screen instead of collapsing into "+N".
 *  - `enableIntersectionObserverByDefault`: without it there is no
 *    `IntersectionObserver`, which Astryx's tables construct to load rows as
 *    they scroll into view; Filterable Table threw on it.
 *
 * They are set here because a JavaScript `override()` doesn't reach flags read
 * natively. The class subclasses the OSS-Stable overrides because
 * `dangerouslyForceOverride` replaces the ones `RCTReactNativeFactory`
 * installed. Android sets the first two and the last two in MainApplication.kt.
 */
class AstryxDemoFeatureFlags : public facebook::react::ReactNativeFeatureFlagsOverridesOSSStable {
 public:
  bool enableNativeGestureRecognizers() override
  {
    return true;
  }

  bool enableYogaDisplayBlock() override
  {
    return true;
  }

  bool useSharedAnimatedBackend() override
  {
    return true;
  }

  bool cxxNativeAnimatedEnabled() override
  {
    return true;
  }

  bool enableResizeObserverByDefault() override
  {
    return true;
  }

  bool enableIntersectionObserverByDefault() override
  {
    return true;
  }
};

} // namespace

@interface AstryxDemoFactoryDelegate : RCTDefaultReactNativeFactoryDelegate
@end

@implementation AstryxDemoFactoryDelegate

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  // Relative to this package, which is Metro's `projectRoot` in metro.config.js.
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [NSBundle.mainBundle URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

#if ASTRYX_DEMO_USE_EXPO_MODULES
- (void)host:(RCTHost *)host didInitializeRuntime:(facebook::jsi::Runtime &)runtime
{
  static EXAppContext *appContext;
  appContext = [EXAppContext new];
  appContext._runtime = [[EXRuntime alloc] initWithRuntime:runtime];
  [appContext setHostWrapper:[[EXHostWrapper alloc] initWithHost:host]];
  [appContext registerNativeModules];
}
#endif

@end

@implementation AppDelegate {
  RCTReactNativeFactory *_factory;
  AstryxDemoFactoryDelegate *_factoryDelegate;
  NSDictionary *_launchOptions;
}

- (RCTReactNativeFactory *)factory
{
  return _factory;
}

- (NSDictionary *)launchOptions
{
  return _launchOptions;
}

/** Keep in step with `UIApplicationSceneManifest` in project.yml. */
- (UISceneConfiguration *)application:(UIApplication *)application
    configurationForConnectingSceneSession:(UISceneSession *)connectingSceneSession
                                   options:(UISceneConnectionOptions *)options
{
  UISceneConfiguration *configuration = [[UISceneConfiguration alloc] initWithName:@"Default"
                                                                       sessionRole:connectingSceneSession.role];
  configuration.delegateClass = NSClassFromString(@"SceneDelegate");
  return configuration;
}

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  // The DOM elements' `onClick` needs W3C pointer events. Android sets
  // `ReactFeatureFlags.dispatchPointerEvents` in MainApplication.kt.
  RCTSetDispatchW3CPointerEvents(YES);

  _factoryDelegate = [AstryxDemoFactoryDelegate new];
#ifdef ASTRYX_DEMO_HAS_DEPENDENCY_PROVIDER
  _factoryDelegate.dependencyProvider = [RCTAppDependencyProvider new];
#endif
  _factory = [[RCTReactNativeFactory alloc] initWithDelegate:_factoryDelegate];

  // After the factory is created, because it installs the OSS-Stable overrides
  // (so a plain `override` would throw). Before `startReactNative` in
  // SceneDelegate.mm, which starts reading flags.
  facebook::react::ReactNativeFeatureFlags::dangerouslyForceOverride(std::make_unique<AstryxDemoFeatureFlags>());

  // SceneDelegate.mm creates the window and starts React Native.
  _launchOptions = launchOptions;
  return YES;
}

@end
