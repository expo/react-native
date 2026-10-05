/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "SceneDelegate.h"

#import "NativeExampleViews/FlexibleSizeExampleView.h"
#import "NativeExampleViews/UpdatePropertiesExampleView.h"

#import <React/RCTBundleURLProvider.h>
#import <React/RCTConstants.h>
#import <React/RCTDefines.h>
#import <React/RCTLinkingManager.h>
#import <React/RCTSurfaceHostingProxyRootView.h>
#import <ReactCommon/RCTSampleTurboModule.h>
#import <ReactCommon/RCTTurboModuleManager.h>

#import <NativeCxxModuleExample/NativeCxxModuleExample.h>
#ifndef RN_DISABLE_OSS_PLUGIN_HEADER
#import <RNTMyNativeViewComponentView.h>
#endif

#if __has_include(<ReactAppDependencyProvider/RCTAppDependencyProvider.h>)
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>
#endif

#if RCT_DEV_MENU
#import <React/RCTDevMenu.h>
#endif

#import <RNTesterFeatureFlags/RNTesterFeatureFlags.h>

#import <memory>

static NSString *const kBundlePath = @"js/RNTesterApp.ios";

@implementation SceneDelegate

- (NSDictionary *)prepareInitialProps
{
  NSMutableDictionary *initProps = [NSMutableDictionary dictionary];
  NSString *routeUri = [[NSUserDefaults standardUserDefaults] stringForKey:@"route"];
  if (routeUri != nil) {
    // `-route Grid` opens the module; `-route Grid/autofill` opens one example
    // within it. The "Example" suffix belongs to the MODULE key only, so it is
    // appended to the first path segment rather than to the whole string —
    // otherwise an example key would come out as "…/autofillExample" and fail
    // to resolve. This is what makes a single example addressable for
    // screenshots without driving the UI.
    NSRange separator = [routeUri rangeOfString:@"/"];
    if (separator.location == NSNotFound) {
      initProps[@"exampleFromAppetizeParams"] = [NSString stringWithFormat:@"rntester://example/%@Example", routeUri];
    } else {
      NSString *moduleKey = [routeUri substringToIndex:separator.location];
      NSString *exampleKey = [routeUri substringFromIndex:separator.location + 1];
      initProps[@"exampleFromAppetizeParams"] =
          [NSString stringWithFormat:@"rntester://example/%@Example/%@", moduleKey, exampleKey];
    }
  }
  return [initProps copy];
}

- (void)scene:(UIScene *)scene
    willConnectToSession:(UISceneSession *)session
                 options:(UISceneConnectionOptions *)connectionOptions
{
  if (![scene isKindOfClass:[UIWindowScene class]]) {
    return;
  }

#if __has_include(<ReactAppDependencyProvider/RCTAppDependencyProvider.h>)
  self.dependencyProvider = [[RCTAppDependencyProvider alloc] init];
#endif

  // Enable W3C Pointer Events so DOM-style pointer/click events (and the DOM
  // event/target APIs) dispatch — required for text children's inline elements
  // to handle click events like the web (text-children demo).
  RCTSetDispatchW3CPointerEvents(YES);

  self.reactNativeFactory = [[RCTReactNativeFactory alloc] initWithDelegate:self releaseLevel:[self releaseLevel]];

  // The factory just installed the OSS-Stable feature-flag provider (a plain
  // `override` here — before or after — would throw on double-override), so
  // replace it via the sanctioned escape hatch with our subclass that also
  // enables the native Yoga block formatting context for the demo. Runs
  // before startReactNative below, which is what starts reading flags.
  RNTesterOverrideFeatureFlags();

  auto *windowScene = (UIWindowScene *)scene;
  self.window = [[UIWindow alloc] initWithWindowScene:windowScene];

  NSMutableDictionary *initialProps = [[self prepareInitialProps] mutableCopy];
  NSURL *initialURL = connectionOptions.URLContexts.anyObject.URL;
  if (initialURL != nil) {
    initialProps[@"exampleFromAppetizeParams"] = initialURL.absoluteString;
  }

  [self.reactNativeFactory startReactNativeWithModuleName:@"RNTesterApp"
                                                 inWindow:self.window
                                        initialProperties:initialProps
                                        connectionOptions:connectionOptions];

#if RCT_DEV_MENU
  RCTDevMenuConfiguration *devMenuConfiguration = [[RCTDevMenuConfiguration alloc] initWithDevMenuEnabled:true
                                                                                      shakeGestureEnabled:true
                                                                                 keyboardShortcutsEnabled:true];
  [self.reactNativeFactory setDevMenuConfiguration:devMenuConfiguration];
#endif
}

- (RCTReleaseLevel)releaseLevel
{
  return RCTReleaseLevel::Stable;
}

- (void)scene:(UIScene *)scene continueUserActivity:(NSUserActivity *)userActivity
{
  [RCTLinkingManager scene:scene continueUserActivity:userActivity];
}

- (void)scene:(UIScene *)scene openURLContexts:(NSSet<UIOpenURLContext *> *)URLContexts
{
  [RCTLinkingManager scene:scene openURLContexts:URLContexts];

  // A scene can receive its URL while JavaScript is still starting, before
  // Linking has an observer. Retain the route in the root props as well.
  NSURL *URL = URLContexts.anyObject.URL;
  UIView *rootView = self.window.rootViewController.view;
  if (URL != nil && [rootView isKindOfClass:[RCTSurfaceHostingProxyRootView class]]) {
    auto *hostingView = (RCTSurfaceHostingProxyRootView *)rootView;
    NSMutableDictionary *properties = [hostingView.appProperties mutableCopy] ?: [NSMutableDictionary dictionary];
    properties[@"exampleFromAppetizeParams"] = URL.absoluteString;
    hostingView.appProperties = properties;
  }
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:kBundlePath];
#else
  // Release: load the embedded bundle; RNTester's default always points at
  // Metro, which does not exist for a release benchmark build.
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const std::string &)name
                                                      jsInvoker:(std::shared_ptr<facebook::react::CallInvoker>)jsInvoker
{
  if (name == facebook::react::NativeCxxModuleExample::kModuleName) {
    return std::make_shared<facebook::react::NativeCxxModuleExample>(jsInvoker);
  }

  return [super getTurboModule:name jsInvoker:jsInvoker];
}

- (NSArray<id<RCTBridgeModule>> *)extraModulesForBridge:(__unused RCTBridge *)bridge
{
  return @[
    [[FlexibleSizeExampleViewManager alloc] initWithRootViewFactory:self.reactNativeFactory.rootViewFactory],
    [[UpdatePropertiesExampleViewManager alloc] initWithRootViewFactory:self.reactNativeFactory.rootViewFactory],
  ];
}

#ifndef RN_DISABLE_OSS_PLUGIN_HEADER
- (nonnull NSDictionary<NSString *, Class<RCTComponentViewProtocol>> *)thirdPartyFabricComponents
{
  NSMutableDictionary *dict = [super thirdPartyFabricComponents].mutableCopy;
  if (!dict[@"RNTMyNativeView"]) {
    dict[@"RNTMyNativeView"] = NSClassFromString(@"RNTMyNativeViewComponentView");
  }
  if (!dict[@"RNTesterTabsIOS"]) {
    dict[@"RNTesterTabsIOS"] = NSClassFromString(@"RNTesterTabsIOSComponentView");
  }
  if (!dict[@"SampleNativeComponent"]) {
    dict[@"SampleNativeComponent"] = NSClassFromString(@"RCTSampleNativeComponentComponentView");
  }
  return dict;
}
#endif

@end
