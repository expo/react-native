/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * An image a `background-image: url()` layer names, as its provider loaded it.
 */
@protocol RCTBackgroundImage <NSObject>

/**
 * The image's natural size in points, which `background-size: auto`, `cover`
 * and `contain` measure.
 */
@property (nonatomic, readonly) CGSize naturalSize;

/**
 * A new layer that draws the image scaled to fill its bounds. The view gives it
 * its size and place, and repeats it.
 */
- (CALayer *)makeLayer;

@end

/**
 * Loads and draws the images `background-image: url()` names.
 *
 * A view hands its provider each URL its background names and draws what comes
 * back as CSS lays it out: sized, placed and repeated, clipped to the view's
 * corners and stacked with its gradients. How an image is fetched, decoded and
 * drawn is the provider's. React Native's own provider
 * (`RCTImageManagerBackgroundImageProvider`) loads through the image manager
 * `<Image>` loads through; a framework may set its own on the mounting manager
 * (`RCTMountingManager.backgroundImageProvider`), which the views mounted
 * after that use.
 */
@protocol RCTBackgroundImageProvider <NSObject>

/**
 * Starts loading the image at `uri`. `completion` is called once, on the main
 * queue, with the image, or with nil when it cannot be loaded. The load lasts
 * as long as the returned object does: releasing it cancels the load.
 */
- (id)requestImageWithURI:(NSString *)uri completion:(void (^)(id<RCTBackgroundImage> _Nullable image))completion;

@end

NS_ASSUME_NONNULL_END
