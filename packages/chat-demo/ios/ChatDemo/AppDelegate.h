/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

@class RCTReactNativeFactory;

@interface AppDelegate : UIResponder <UIApplicationDelegate>

/** Built at launch; the scene starts React Native with it, into its own window. */
@property (nonatomic, readonly) RCTReactNativeFactory *factory;
/** The launch options, kept for the scene's start. */
@property (nonatomic, readonly, nullable) NSDictionary *launchOptions;
/** The root component's initial properties, from the launch environment: the seeded conversation and the screen to open on. */
@property (nonatomic, readonly, nullable) NSDictionary *initialProperties;

/** The geometry trace to the pasteboard; the scene's window recognises the gesture. */
- (void)copyTrace:(UITapGestureRecognizer *)recognizer;

@end
