/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
// Unqualified, because these come from the React-RCTAppDelegate pod, whose public headers are on
// the search path directly rather than under a `React/` prefix. RN Tester writes `<React/...>` and
// gets away with it because its own bespoke Podfile arranges that; a normal app does not.
#import "RCTDefaultReactNativeFactoryDelegate.h"
#import "RCTReactNativeFactory.h"

#if __has_include(<ReactAppDependencyProvider/RCTAppDependencyProvider.h>)
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>
#define KEYBOARD_DEMO_HAS_DEPENDENCY_PROVIDER 1
#endif

#import <React/RCTConstants.h>
/*
 * Declared here rather than imported: the trace lives inside the React-Fabric
 * pod and its header is not in that pod's public set. Adding it to the podspec
 * for a diagnostic would be a wider change than the diagnostic deserves, and the
 * interface is two class methods.
 */
@interface EXPKeyboardTrace : NSObject
+ (void)start;
+ (NSString *)dump;
/** This trace's own clock, for rebasing the engine's timeline onto it below. */
+ (double)nowMs;
@end
#import <react/renderer/animationbackend/CSSTransitionsTrace.h>

#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/featureflags/ReactNativeFeatureFlagsOverridesOSSStable.h>

#import <chrono>
#import <memory>

namespace {

/**
 * The flags the elements need, which are not on by default.
 *
 * This app is written in the DOM elements, and two of them do not work at all
 * without a flag — which is not obvious, because both fail SILENTLY and each
 * failure looks like something else:
 *
 *  - `enableNativeGestureRecognizers`: `<button>` reports its click from a
 *    platform gesture recognizer. With this off, a button draws its full native
 *    chrome, highlights under a finger, and its `onClick` never fires. Measured:
 *    a button labelled "Add a row (30)" still said "(30)" after being tapped,
 *    while an `<a>` and an `<input type="checkbox">` on the same screen worked.
 *  - `enableYogaDisplayBlock`: `<div>` gets a real block formatting context
 *    rather than the flex emulation.
 *  - `useSharedAnimatedBackend` and `cxxNativeAnimatedEnabled`: CSS transitions
 *    and CSS animations, which this app uses in place of `Animated` wherever a
 *    style property can express the thing.
 *
 * They are read on the NATIVE side, so a JavaScript `override()` cannot reach
 * them — an hour went into an override in `index.js` that had no effect and
 * reported `false` when the value was put on screen. RN Tester sets them here,
 * and this is the same subclass for the same reason: `RCTReactNativeFactory`
 * has already installed the OSS-Stable provider, so these must extend it.
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

  /*
   * The shared C++ animation backend, which is what CSS transitions and CSS
   * animations are implemented ON. Without it `transition-*` and `animation-*`
   * are accepted and do nothing — the value still applies, immediately — which
   * reads as a broken animation rather than as a missing flag.
   *
   * Both are needed and RN Tester sets both: the backend itself, and the C++
   * `Animated` implementation that owns it. Upstream has them default-off with
   * `expectedReleaseValue: true`.
   */
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

/**
 * The whole app delegate, and deliberately the whole of it.
 *
 * RN Tester's is several hundred lines because it hosts a catalogue; this app hosts one screen and
 * exists to be a window with nothing in it — no header, no tab bar, no chrome of its own. That is
 * the point of it: the safe-area and keyboard behaviour under test is only visible in a window
 * whose content reaches the system's own furniture, and RN Tester's chrome guarantees it never
 * does.
 */
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
  // The entry point is inside the monorepo, not inside this package: Metro is served from the
  // repository root so that both this app and the elements it imports are under one project root.
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

/** The scene named in the manifest; one configuration, one window. */
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
 * A seeded conversation, for the tests.
 *
 * The chat's "Add fifty messages" command exists for a person at the panel;
 * a test that needs two hundred messages was opening that panel four times —
 * a quarter of its runtime spent on UI round-trips that prove nothing. An
 * environment variable is the channel XCUITest already has
 * (`launchEnvironment`), and initial props are how a number reaches the root
 * component without inventing a module for it. Absent, nothing changes.
 */
- (NSDictionary *)initialProperties
{
  NSMutableDictionary *initialProps = [NSMutableDictionary dictionary];
  // Zero is a conversation length like any other — the empty transcript — so
  // the variable's PRESENCE decides, not whether its value is positive.
  const char *seed = getenv("EXP_SEED_MESSAGES");
  if (seed != NULL) {
    char *end = NULL;
    long count = strtol(seed, &end, 10);
    if (end != seed && count >= 0) {
      initialProps[@"seedMessages"] = @(count);
    }
  }
  // The tests read the performance banner, which a person has to switch on.
  const char *profiling = getenv("EXP_PROFILING");
  if (profiling != NULL && strcmp(profiling, "1") == 0) {
    initialProps[@"initialProfiling"] = @YES;
  }
  const char *screen = getenv("EXP_OPEN_SCREEN");
  if (screen != NULL && strlen(screen) > 0) {
    initialProps[@"initialScreen"] = [NSString stringWithUTF8String:screen];
  }
  return initialProps.count > 0 ? initialProps : nil;
}

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  // DOM-style pointer and click events, which is how the elements dispatch.
  RCTSetDispatchW3CPointerEvents(YES);

  _factoryDelegate = [ChatDemoFactoryDelegate new];
#ifdef KEYBOARD_DEMO_HAS_DEPENDENCY_PROVIDER
  _factoryDelegate.dependencyProvider = [RCTAppDependencyProvider new];
#endif
  _factory = [[RCTReactNativeFactory alloc] initWithDelegate:_factoryDelegate];

  // After the factory (which installs the OSS-Stable provider — a plain
  // `override` either side of it throws on double-override) and before
  // `startReactNative`, which is what begins reading flags.
  facebook::react::ReactNativeFeatureFlags::dangerouslyForceOverride(
      std::make_unique<ChatDemoFeatureFlags>());

  /*
   * A trace the tester can hand back.
   *
   * Everything that has gone wrong here is per-frame geometry that settles
   * before anyone can look at it, and three fixes shipped blind because the
   * fault only appears on a device. Recording starts with the app and a
   * two-finger double-tap copies it to the pasteboard, so a report can carry the
   * numbers instead of a description of them.
   */
  [EXPKeyboardTrace start];
  // The window, and React Native in it, are the scene's — see `SceneDelegate`.
  _launchOptions = launchOptions;
  return YES;
}

- (void)copyTrace:(UITapGestureRecognizer *)recognizer
{
  /*
   * BOTH timelines, ON ONE CLOCK.
   *
   * The transition engine keeps its own ring (`CSSTransitionsTrace`) and until
   * now it reached a device report only through `EXP_CSS_TRACE_ECHO`, which
   * needs an environment variable and a `simctl` console — neither of which
   * exists on someone's phone. So a report of an animation misbehaving arrived
   * with the geometry and nothing about whether a transition started, was
   * retargeted, or was refused.
   *
   * REBASED, because they do not share an origin and a first attempt at this
   * assumed they did. The geometry trace stamps milliseconds since it started
   * recording; the engine stamps `steady_clock` since boot, truncated to the
   * hour. Both come from mach time, so the difference is a constant — but
   * unrebased, one dump read `3111` beside `1754361` for events a few
   * milliseconds apart, and nothing could be lined up.
   *
   * Age is computed modulo the hour so a wrap between the two reads cannot turn
   * a recent line into an hour-old one.
   */
  NSMutableString *trace = [[EXPKeyboardTrace dump] mutableCopy];
  const auto transitions = facebook::react::CSSTransitionsTrace::shared()->drain();
  if (!transitions.empty()) {
    constexpr long long kHourMs = 3600000;
    const long long engineNow =
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now().time_since_epoch())
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
      [trace appendFormat:@"%6.0f %@\n", traceNow - (double)age,
                          [text substringFromIndex:space.location + 1]];
    }
  }
  UIPasteboard.generalPasteboard.string = trace;
  const NSUInteger transitionCount = transitions.size();

  const NSUInteger count = [trace componentsSeparatedByString:@"\n"].count;
  // Frames on which a bar was off the screen while a field inside it was being
  // edited; the accessory pins one line per such frame. `HoldCheck` reads this
  // number from the alert after a held drag.
  const NSUInteger offScreen = [trace componentsSeparatedByString:@"bar OFF SCREEN"].count - 1;
  /*
   * BOTH counts, and the transitions one is not decoration.
   *
   * It says whether the animation timeline actually made it into the dump. Zero
   * there means the engine ran nothing in the window being reported, which is
   * itself the answer to "did that animation even start" — and it is the only
   * way to know without reading the paste. A UI test asserts on this line rather
   * than on the pasteboard: reading a pasteboard the app wrote raises the
   * system's paste prompt in the test runner, which XCUITest does not dismiss,
   * and the whole suite hangs behind it.
   */
  UIAlertController *alert =
      [UIAlertController alertControllerWithTitle:@"Diagnostics copied"
                                          message:[NSString stringWithFormat:@"%lu lines on the clipboard "
                                                                             @"(%lu transitions). "
                                                                             @"%lu off-screen frames. "
                                                                             @"Paste them into a message.",
                                                                             (unsigned long)count,
                                                                             (unsigned long)transitionCount,
                                                                             (unsigned long)offScreen]
                                   preferredStyle:UIAlertControllerStyleAlert];
  [alert addAction:[UIAlertAction actionWithTitle:@"Keep recording"
                                            style:UIAlertActionStyleDefault
                                          handler:nil]];
  [alert addAction:[UIAlertAction actionWithTitle:@"Start over"
                                            style:UIAlertActionStyleDestructive
                                          handler:^(UIAlertAction *_Nonnull action) {
                                            [EXPKeyboardTrace start];
                                          }]];
  // The gesture is on the scene's window itself; present from that window.
  UIView *view = recognizer.view;
  UIWindow *window = [view isKindOfClass:UIWindow.class] ? (UIWindow *)view : view.window;
  [window.rootViewController presentViewController:alert animated:YES completion:nil];
}

@end
