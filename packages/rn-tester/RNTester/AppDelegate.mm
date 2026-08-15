/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "AppDelegate.h"

#if !TARGET_OS_TV
#import <UserNotifications/UserNotifications.h>
#endif

#import <React/RCTBundleURLProvider.h>
#import <React/RCTConstants.h>
#import <React/RCTDefines.h>
#import <React/RCTLinkingManager.h>
#import <React/RCTUtils.h>
#import <ReactCommon/RCTSampleTurboModule.h>
#import <ReactCommon/RCTTurboModuleManager.h>

#if !TARGET_OS_TV
#import <React/RCTPushNotificationManager.h>
#endif

#import <NativeCxxModuleExample/NativeCxxModuleExample.h>
#ifndef RN_DISABLE_OSS_PLUGIN_HEADER
#import <RNTMyNativeViewComponentView.h>
#endif

#if __has_include(<ReactAppDependencyProvider/RCTAppDependencyProvider.h>)
#define USE_OSS_CODEGEN 1
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>
#else
#define USE_OSS_CODEGEN 0
#endif

#if RCT_DEV_MENU
#import <React/RCTDevMenu.h>
#endif

// Expo modules, for the DOM element catalog's SDK-backed elements (<img> is
// expo-image). The tester bootstraps the module runtime itself in
// host:didInitializeRuntime: below — the four lines Expo's own app delegate
// would run — so it needs none of Expo's AppDelegate machinery.
#if __has_include("ExpoModulesCore-Swift.h") || __has_include(<ExpoModulesCore/ExpoModulesCore-Swift.h>)
#define RNTESTER_USE_EXPO_MODULES 1
#import <ExpoModulesCore/EXHostWrapper.h>
#import <ExpoModulesCore/EXRuntime.h>
#if __has_include(<ExpoModulesCore/ExpoModulesCore-Swift.h>)
#import <ExpoModulesCore/ExpoModulesCore-Swift.h>
#else
#import "ExpoModulesCore-Swift.h"
#endif
#else
#define RNTESTER_USE_EXPO_MODULES 0
#warning "RNTester: ExpoModulesCore headers not found — expo-backed elements will use fallbacks"
#endif

#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/featureflags/ReactNativeFeatureFlagsOverridesOSSStable.h>

#import <memory>

static NSString *kBundlePath = @"js/RNTesterApp.ios";

namespace {

// RNTester runs the text-children/css-display demo with the native Yoga block
// formatting context (YGDisplayBlock) instead of the flex emulation, so the
// demo exercises real block layout: block-child stacking/sizing and CSS2
// §8.3.1 margin collapsing (see text-children-plan.md §4.5). Subclasses the
// OSS-Stable overrides (what `RCTReactNativeFactory` installs for this app)
// so the standard stable flags are preserved.
class RNTesterFeatureFlagsOverrides : public facebook::react::ReactNativeFeatureFlagsOverridesOSSStable {
 public:
  bool enableYogaDisplayBlock() override
  {
    return true;
  }

  // The shared C++ animation backend, which drives prop updates from a display
  // link WITHOUT going through React's JavaScript pipeline. Both flags are
  // needed: the backend itself, and the C++ Animated implementation that owns
  // it. Upstream has these default-off with `expectedReleaseValue: true`.
  bool useSharedAnimatedBackend() override
  {
    return true;
  }

  bool cxxNativeAnimatedEnabled() override
  {
    return true;
  }

  // The DOM element catalog's own elements recognize presses with real platform
  // gesture recognizers rather than the JS responder system, so an enclosing
  // scroll view claiming the gesture cancels the press in UIKit's arbitration
  // instead of after a round trip through JavaScript.
  bool enableNativeGestureRecognizers() override
  {
    return true;
  }
};

} // namespace

#if !TARGET_OS_TV
@interface AppDelegate () <UNUserNotificationCenterDelegate>
@end
#else
@interface AppDelegate ()
@end
#endif

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  // Enable W3C Pointer Events so DOM-style pointer/click events (and the DOM
  // event/target APIs) dispatch — required for text children's inline elements
  // to handle click events like the web (text-children demo).
  RCTSetDispatchW3CPointerEvents(YES);

  self.reactNativeFactory = [[RCTReactNativeFactory alloc] initWithDelegate:self];

  // The factory just installed the OSS-Stable feature-flag provider (a plain
  // `override` here — before or after — would throw on double-override), so
  // replace it via the sanctioned escape hatch with our subclass that also
  // enables the native Yoga block formatting context for the demo. Runs
  // before startReactNative below, which is what starts reading flags.
  facebook::react::ReactNativeFeatureFlags::dangerouslyForceOverride(
      std::make_unique<RNTesterFeatureFlagsOverrides>());
#if USE_OSS_CODEGEN
  self.dependencyProvider = [RCTAppDependencyProvider new];
#endif

#if RCT_DEV_MENU

  RCTDevMenuConfiguration *devMenuConfiguration = [[RCTDevMenuConfiguration alloc] initWithDevMenuEnabled:true
                                                                                      shakeGestureEnabled:true
                                                                                 keyboardShortcutsEnabled:true];
  [self.reactNativeFactory setDevMenuConfiguration:devMenuConfiguration];

#endif

  self.window = [[UIWindow alloc] initWithFrame:[UIScreen mainScreen].bounds];

  [self.reactNativeFactory startReactNativeWithModuleName:@"RNTesterApp"
                                                 inWindow:self.window
                                        initialProperties:[self prepareInitialProps]
                                            launchOptions:launchOptions];

#if !TARGET_OS_TV
  [[UNUserNotificationCenter currentNotificationCenter] setDelegate:self];
#endif

  return YES;
}

- (NSDictionary *)prepareInitialProps
{
  NSMutableDictionary *initProps = [NSMutableDictionary new];

  NSString *_routeUri = [[NSUserDefaults standardUserDefaults] stringForKey:@"route"];
  if (_routeUri) {
    // `-route Grid` opens the module; `-route Grid/autofill` opens one example
    // within it. The "Example" suffix belongs to the MODULE key only, so it is
    // appended to the first path segment rather than to the whole string —
    // otherwise an example key would come out as "…/autofillExample" and fail
    // to resolve. This is what makes a single example addressable for
    // screenshots without driving the UI.
    NSRange separator = [_routeUri rangeOfString:@"/"];
    if (separator.location == NSNotFound) {
      initProps[@"exampleFromAppetizeParams"] =
          [NSString stringWithFormat:@"rntester://example/%@Example", _routeUri];
    } else {
      NSString *moduleKey = [_routeUri substringToIndex:separator.location];
      NSString *exampleKey = [_routeUri substringFromIndex:separator.location + 1];
      initProps[@"exampleFromAppetizeParams"] =
          [NSString stringWithFormat:@"rntester://example/%@Example/%@", moduleKey, exampleKey];
    }
  }

  return initProps;
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:kBundlePath];
}

- (BOOL)application:(UIApplication *)app
            openURL:(NSURL *)url
            options:(NSDictionary<UIApplicationOpenURLOptionsKey, id> *)options
{
  // `rntester://nativeprobe` — the pure-UIKit control experiment for the
  // select-dismissal glitch. Presented modally OVER the React app with not a
  // single React Native view inside it, so a finger on a real device can
  // answer "does UIKit's own pop-up ghost when scrolled during dismissal?"
  // with the app itself as the control group. Type the URL in Safari on the
  // device to open it.
  if ([url.host isEqualToString:@"nativeprobe"]) {
    [self presentNativeMenuProbe];
    return YES;
  }
  return [RCTLinkingManager application:app openURL:url options:options];
}

- (void)presentNativeMenuProbe
{
  UIViewController *probe = [UIViewController new];
  probe.view.backgroundColor = UIColor.systemBackgroundColor;

  UIScrollView *scroll = [[UIScrollView alloc] initWithFrame:probe.view.bounds];
  scroll.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  scroll.contentSize = CGSizeMake(probe.view.bounds.size.width, 3000);
  [probe.view addSubview:scroll];

  for (int i = 0; i < 30; i++) {
    UILabel *row = [[UILabel alloc] initWithFrame:CGRectMake(16, 100 + i * 100, 320, 30)];
    row.text = [NSString stringWithFormat:@"plain UIKit row %d", i];
    row.textColor = UIColor.labelColor;
    [scroll addSubview:row];
  }

  UIButtonConfiguration *configuration = [UIButtonConfiguration borderedButtonConfiguration];
  configuration.cornerStyle = UIButtonConfigurationCornerStyleMedium;
  UIButton *popUp = [UIButton buttonWithConfiguration:configuration primaryAction:nil];
  popUp.frame = CGRectMake(60, 450, 240, 44);
  popUp.showsMenuAsPrimaryAction = YES;
  popUp.changesSelectionAsPrimaryAction = YES;
  popUp.menu = [UIMenu menuWithTitle:@""
                            children:@[
                              [UIAction actionWithTitle:@"Apple" image:nil identifier:nil handler:^(UIAction *a){}],
                              [UIAction actionWithTitle:@"Banana" image:nil identifier:nil handler:^(UIAction *a){}],
                              [UIAction actionWithTitle:@"Cherry" image:nil identifier:nil handler:^(UIAction *a){}],
                            ]];
  [scroll addSubview:popUp];

  UIButton *close = [UIButton buttonWithType:UIButtonTypeSystem];
  close.frame = CGRectMake(16, 40, 80, 44);
  [close setTitle:@"Close" forState:UIControlStateNormal];
  [close addAction:[UIAction actionWithHandler:^(UIAction *a) {
           [probe dismissViewControllerAnimated:YES completion:nil];
         }]
      forControlEvents:UIControlEventTouchUpInside];
  [probe.view addSubview:close];

  probe.modalPresentationStyle = UIModalPresentationFullScreen;
  UIViewController *top = RCTKeyWindow().rootViewController;
  while (top.presentedViewController != nil) {
    top = top.presentedViewController;
  }
  [top presentViewController:probe animated:YES completion:nil];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const std::string &)name
                                                      jsInvoker:(std::shared_ptr<facebook::react::CallInvoker>)jsInvoker
{
  if (name == facebook::react::NativeCxxModuleExample::kModuleName) {
    return std::make_shared<facebook::react::NativeCxxModuleExample>(jsInvoker);
  }

  return [super getTurboModule:name jsInvoker:jsInvoker];
}

#if !TARGET_OS_TV
// Required for the remoteNotificationsRegistered event.
- (void)application:(__unused UIApplication *)application
    didRegisterForRemoteNotificationsWithDeviceToken:(NSData *)deviceToken
{
  [RCTPushNotificationManager didRegisterForRemoteNotificationsWithDeviceToken:deviceToken];
}

// Required for the remoteNotificationRegistrationError event.
- (void)application:(__unused UIApplication *)application
    didFailToRegisterForRemoteNotificationsWithError:(NSError *)error
{
  [RCTPushNotificationManager didFailToRegisterForRemoteNotificationsWithError:error];
}

#pragma mark - UNUserNotificationCenterDelegate

// Required for the remoteNotificationReceived and localNotificationReceived events
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler
{
  [RCTPushNotificationManager didReceiveNotification:notification];
  completionHandler(UNNotificationPresentationOptionNone);
}

// Required for the remoteNotificationReceived and localNotificationReceived events
// Called when a notification is tapped from background. (Foreground notification will not be shown per
// the presentation option selected above).
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))completionHandler
{
  UNNotification *notification = response.notification;

  // This condition will be true if tapping the notification launched the app.
  if ([response.actionIdentifier isEqualToString:UNNotificationDefaultActionIdentifier]) {
    // This can be retrieved with getInitialNotification.
    [RCTPushNotificationManager setInitialNotification:notification];
  }

  [RCTPushNotificationManager didReceiveNotification:notification];
  completionHandler();
}
#endif

#pragma mark - RCTComponentViewFactoryComponentProvider

#ifndef RN_DISABLE_OSS_PLUGIN_HEADER
- (nonnull NSDictionary<NSString *, Class<RCTComponentViewProtocol>> *)thirdPartyFabricComponents
{
  NSMutableDictionary *dict = [super thirdPartyFabricComponents].mutableCopy;
  if (!dict[@"RNTMyNativeView"]) {
    dict[@"RNTMyNativeView"] = NSClassFromString(@"RNTMyNativeViewComponentView");
  }
  if (!dict[@"SampleNativeComponent"]) {
    dict[@"SampleNativeComponent"] = NSClassFromString(@"RCTSampleNativeComponentComponentView");
  }
  return dict;
}
#endif

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


#if RNTESTER_USE_EXPO_MODULES
// [JS thread] Forwarded by RCTReactNativeFactory from the RCTHost. Creates the
// Expo AppContext, injects `global.expo`, and registers the modules the
// generated ExpoModulesProvider lists — after this, an element whose view
// config names an Expo view (the catalog's <img> → expo-image) resolves like
// any other component.
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
