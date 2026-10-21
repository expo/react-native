/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <React/RCTBackgroundImageProvider.h>

#import <memory>

#import <react/utils/ContextContainer.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * React Native's background image provider: an image loads through
 * `RCTImageLoader`, by way of the image manager the context container holds
 * the loader for, as an `<Image>`'s does, and is drawn as a layer's contents.
 */
@interface RCTImageManagerBackgroundImageProvider : NSObject <RCTBackgroundImageProvider>

/**
 * Nil when the context container holds no image loader.
 */
- (nullable instancetype)initWithContextContainer:
    (const std::shared_ptr<const facebook::react::ContextContainer> &)contextContainer;

@end

NS_ASSUME_NONNULL_END
