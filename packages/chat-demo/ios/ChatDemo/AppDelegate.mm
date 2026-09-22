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

#if __has_include(<ReactAppDependencyProvider/RCTAppDependencyProvider.h>)
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>
#define KEYBOARD_DEMO_HAS_DEPENDENCY_PROVIDER 1
#endif

#import <React/EXPKeyboardTrace.h>
#import <React/RCTConstants.h>
#import <react/renderer/animationbackend/CSSTransitionsTrace.h>

#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/featureflags/ReactNativeFeatureFlagsOverridesOSSStable.h>

#import <chrono>
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
 *
 * They are set here because a JavaScript `override()` doesn't reach flags read
 * natively. The class subclasses the OSS-Stable overrides because
 * `dangerouslyForceOverride` replaces the ones `RCTReactNativeFactory`
 * installed. Android sets the first two in MainApplication.kt.
 */
class ChatDemoFeatureFlags : public facebook::react::ReactNativeFeatureFlagsOverridesOSSStable {
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
};

} // namespace

@interface ChatDemoFactoryDelegate : RCTDefaultReactNativeFactoryDelegate
@end

@implementation ChatDemoFactoryDelegate

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  // Relative to the repository root, which is Metro's `projectRoot` in metro.config.js.
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"packages/chat-demo/index"];
#else
  return [NSBundle.mainBundle URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end

@implementation AppDelegate {
  RCTReactNativeFactory *_factory;
  ChatDemoFactoryDelegate *_factoryDelegate;
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

/**
 * The launch environment the UI tests set (mostly in DemoCase.swift), as the
 * root component's props in App.js. An unset variable leaves App.js's default.
 */
- (NSDictionary *)initialProperties
{
  NSMutableDictionary *initialProps = [NSMutableDictionary dictionary];
  // `>= 0`: zero is a valid length (an empty transcript).
  const char *seed = getenv("EXP_SEED_MESSAGES");
  if (seed != NULL) {
    char *end = NULL;
    long count = strtol(seed, &end, 10);
    if (end != seed && count >= 0) {
      initialProps[@"seedMessages"] = @(count);
    }
  }
  const char *profiling = getenv("EXP_PROFILING");
  if (profiling != NULL && strcmp(profiling, "1") == 0) {
    initialProps[@"initialProfiling"] = @YES;
  }
  // Overrides `DELIVERED_AFTER` in screens/ChatScreen.js. Set by ReceiptHandoffCheck.swift.
  const char *delivered = getenv("EXP_DELIVERED_AFTER_MS");
  if (delivered != NULL) {
    char *end = NULL;
    long ms = strtol(delivered, &end, 10);
    if (end != delivered && ms > 0) {
      initialProps[@"deliveredAfterMs"] = @(ms);
    }
  }
  const char *screen = getenv("EXP_OPEN_SCREEN");
  if (screen != NULL && strlen(screen) > 0) {
    initialProps[@"initialScreen"] = [NSString stringWithUTF8String:screen];
  }
  return initialProps.count > 0 ? initialProps : nil;
}

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  // The DOM elements' `onClick` needs W3C pointer events. Android sets
  // `ReactFeatureFlags.dispatchPointerEvents` in MainApplication.kt.
  RCTSetDispatchW3CPointerEvents(YES);

  _factoryDelegate = [ChatDemoFactoryDelegate new];
#ifdef KEYBOARD_DEMO_HAS_DEPENDENCY_PROVIDER
  _factoryDelegate.dependencyProvider = [RCTAppDependencyProvider new];
#endif
  _factory = [[RCTReactNativeFactory alloc] initWithDelegate:_factoryDelegate];

  // After the factory is created, because it installs the OSS-Stable overrides
  // (so a plain `override` would throw). Before `startReactNative` in
  // SceneDelegate.mm, which starts reading flags.
  facebook::react::ReactNativeFeatureFlags::dangerouslyForceOverride(std::make_unique<ChatDemoFeatureFlags>());

  // A two-finger double-tap (set up in SceneDelegate.mm) copies the trace; see
  // `copyTrace:`.
  [EXPKeyboardTrace start];
  // SceneDelegate.mm creates the window and starts React Native.
  _launchOptions = launchOptions;
  return YES;
}

- (void)copyTrace:(UITapGestureRecognizer *)recognizer
{
  /*
   * Appends the `CSSTransitionsTrace` lines, re-stamped in `EXPKeyboardTrace`
   * time (ms since `start`). Each `CSSTransitionsTrace` line starts with
   * `steady_clock` ms modulo `CSSTransitionsTrace::kHourMs` and a space. Each
   * line's age is taken modulo the hour, so it stays correct when the hour
   * wraps between the stamp and this read.
   */
  NSMutableString *trace = [[EXPKeyboardTrace dump] mutableCopy];
  const auto transitions = facebook::react::CSSTransitionsTrace::shared()->drain();
  if (!transitions.empty()) {
    constexpr long long kHourMs = facebook::react::CSSTransitionsTrace::kHourMs;
    const long long engineNow =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch())
            .count() %
        kHourMs;
    const double traceNow = [EXPKeyboardTrace nowMs];
    [trace appendString:@"\n--- transitions (same clock as above) ---\n"];
    for (const auto &line : transitions) {
      NSString *text = [NSString stringWithUTF8String:line.c_str()];
      const NSRange space = [text rangeOfString:@" "];
      if (space.location == NSNotFound) {
        [trace appendFormat:@"%@\n", text];
        continue;
      }
      const long long stamped = [text substringToIndex:space.location].longLongValue;
      const long long age = ((engineNow - stamped) % kHourMs + kHourMs) % kHourMs;
      [trace appendFormat:@"%6.0f %@\n", traceNow - (double)age, [text substringFromIndex:space.location + 1]];
    }
  }
  UIPasteboard.generalPasteboard.string = trace;
  const NSUInteger transitionCount = transitions.size();

  const NSUInteger count = [trace componentsSeparatedByString:@"\n"].count;
  // The lines EXPKeyboardAccessoryComponentView.mm records while its bar is
  // off screen, one per position it is drawn at. Read by HoldCheck.swift.
  const NSUInteger offScreen = [trace componentsSeparatedByString:EXPKeyboardTrace.barOffScreenMarker].count - 1;
  /*
   * TraceDumpCheck.swift and HoldCheck.swift parse the counts from this message,
   * so keep its wording. They can't read the pasteboard: from XCUITest that
   * shows a paste prompt that blocks the run.
   */
  UIAlertController *alert =
      [UIAlertController alertControllerWithTitle:@"Diagnostics copied"
                                          message:[NSString stringWithFormat:@"%lu lines on the clipboard "
                                                                             @"(%lu transitions). "
                                                                             @"%lu off-screen positions. "
                                                                             @"Paste them into a message.",
                                                                             (unsigned long)count,
                                                                             (unsigned long)transitionCount,
                                                                             (unsigned long)offScreen]
                                   preferredStyle:UIAlertControllerStyleAlert];
  [alert addAction:[UIAlertAction actionWithTitle:@"Keep recording" style:UIAlertActionStyleDefault handler:nil]];
  [alert addAction:[UIAlertAction actionWithTitle:@"Start over"
                                            style:UIAlertActionStyleDestructive
                                          handler:^(UIAlertAction *_Nonnull action) {
                                            [EXPKeyboardTrace start];
                                          }]];
  UIView *view = recognizer.view;
  UIWindow *window = [view isKindOfClass:UIWindow.class] ? (UIWindow *)view : view.window;
  [window.rootViewController presentViewController:alert animated:YES completion:nil];
}

@end
