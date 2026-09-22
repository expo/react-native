/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

@class RCTReactNativeFactory;

@interface AppDelegate : UIResponder <UIApplicationDelegate>

// Read by SceneDelegate.mm to start React Native.
@property (nonatomic, readonly) RCTReactNativeFactory *factory;
@property (nonatomic, readonly, nullable) NSDictionary *launchOptions;
@property (nonatomic, readonly, nullable) NSDictionary *initialProperties;

/** Copies the diagnostics trace to the pasteboard. The gesture is set up in SceneDelegate.mm. */
- (void)copyTrace:(UITapGestureRecognizer *)recognizer;

@end
