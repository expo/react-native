/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "RCTDisplayCapabilities.h"

#import <FBReactNativeSpec/FBReactNativeSpec.h>
#import <React/RCTUtils.h>
#import <react/renderer/graphics/ColorSpaceValue.h>
#import <react/renderer/graphics/HostPlatformColor.h>

#import "CoreModulesPlugins.h"

using namespace facebook::react;

static NSString *const kDisplayCapabilitiesDidChange = @"displayCapabilitiesDidChange";

// UIKit names sRGB and P3 only
static NSString *RCTColorGamut(UITraitCollection *traitCollection)
{
  return traitCollection.displayGamut == UIDisplayGamutP3 ? @"p3" : @"srgb";
}

// The potential headroom, not the current one, which moves with brightness
// and ambient light; iOS 26's trait collection can also limit HDR headroom use
static NSString *RCTDynamicRange(UIScreen *screen, UITraitCollection *traitCollection)
{
  BOOL high = NO;
  if (@available(iOS 16.0, *)) {
    high = screen.potentialEDRHeadroom > 1.0;
  }
  if (high) {
    if (@available(iOS 26.0, *)) {
      high = traitCollection.hdrHeadroomUsageLimit != UIHDRHeadroomUsageLimitActive;
    }
  }
  return high ? @"high" : @"standard";
}

@interface RCTDisplayCapabilities () <NativeDisplayCapabilitiesSpec>
@end

@implementation RCTDisplayCapabilities {
  NSDictionary<NSString *, NSString *> *_capabilities;
}

RCT_EXPORT_MODULE(DisplayCapabilities)

- (instancetype)init
{
  if ((self = [super init])) {
    _capabilities = [self readCapabilities];
    NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
    [center addObserver:self selector:@selector(displayChanged:) name:UIScreenModeDidChangeNotification object:nil];
    if (@available(iOS 16.0, *)) {
      [center addObserver:self
                 selector:@selector(displayChanged:)
                     name:UIScreenReferenceDisplayModeStatusDidChangeNotification
                   object:nil];
    }
    // A window may have moved to another screen, or the headroom changed while
    // the app was away
    [center addObserver:self
               selector:@selector(displayChanged:)
                   name:UIApplicationDidBecomeActiveNotification
                 object:nil];
  }
  return self;
}

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

- (std::shared_ptr<TurboModule>)getTurboModule:(const ObjCTurboModule::InitParams &)params
{
  return std::make_shared<NativeDisplayCapabilitiesSpecJSI>(params);
}

- (NSDictionary<NSString *, NSString *> *)readCapabilities
{
  UIWindow *window = RCTKeyWindow();
  UIScreen *screen = window.windowScene.screen ?: RCTSharedApplication().windows.firstObject.windowScene.screen;
  UITraitCollection *traitCollection = window.traitCollection ?: screen.traitCollection;
  if (screen == nil) {
    return @{@"colorGamut" : @"srgb", @"dynamicRange" : @"standard"};
  }
  return @{
    @"colorGamut" : RCTColorGamut(traitCollection ?: screen.traitCollection),
    @"dynamicRange" : RCTDynamicRange(screen, traitCollection ?: screen.traitCollection),
  };
}

- (void)displayChanged:(NSNotification *)notification
{
  NSDictionary<NSString *, NSString *> *capabilities = [self readCapabilities];
  // Replaced on the main queue and read synchronously from the JS thread
  @synchronized(self) {
    if ([capabilities isEqualToDictionary:_capabilities]) {
      return;
    }
    _capabilities = capabilities;
  }
  [self sendEventWithName:kDisplayCapabilitiesDidChange body:capabilities];
}

RCT_EXPORT_SYNCHRONOUS_TYPED_METHOD(NSDictionary *, getCapabilities)
{
  @synchronized(self) {
    return _capabilities;
  }
}

// A space CSS defines always draws, by CSS's arithmetic where Core Graphics
// has no space for it; a dashed, platform space only where Core Graphics
// provides it
RCT_EXPORT_SYNCHRONOUS_TYPED_METHOD(NSNumber *, isColorSpaceAvailable : (NSString *)name)
{
  auto space = colorSpaceFromName(std::string_view([name UTF8String]));
  if (!space.has_value()) {
    return @NO;
  }
  if (![name hasPrefix:@"--"]) {
    return @YES;
  }
  return @(platformColorSpaceFor(*space) != nullptr);
}

#pragma mark - RCTEventEmitter

- (NSArray<NSString *> *)supportedEvents
{
  return @[ kDisplayCapabilitiesDidChange ];
}

- (void)invalidate
{
  [super invalidate];
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

@end

Class RCTDisplayCapabilitiesCls(void)
{
  return RCTDisplayCapabilities.class;
}
