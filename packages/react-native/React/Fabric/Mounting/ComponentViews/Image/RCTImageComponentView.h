/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <React/RCTImageResponseDelegate.h>
#import <React/RCTUIImageViewAnimated.h>
#import <React/RCTViewComponentView.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * UIView class for root <Image> component.
 */
@interface RCTImageComponentView : RCTViewComponentView <RCTImageResponseDelegate> {
 @protected
  RCTUIImageViewAnimated *_imageView;
}

@end

/**
 * UIView class for the intrinsic inline `<img>` tag (text-children-plan.md §3.C).
 * Reuses the whole `RCTImageComponentView` rendering (its `<img>` shadow node
 * uses the same `ImageProps`/`ImageState`); only the component handle differs so
 * it can be routed inline and positioned by its owning View.
 */
@interface RCTImgComponentView : RCTImageComponentView
@end

NS_ASSUME_NONNULL_END
