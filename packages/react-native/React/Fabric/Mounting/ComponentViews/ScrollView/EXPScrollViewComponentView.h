/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <React/RCTMountingTransactionObserving.h>
#import <React/RCTViewComponentView.h>
#import <UIKit/UIKit.h>
#import "RCTVirtualViewContainerProtocol.h"

NS_ASSUME_NONNULL_BEGIN

/**
 * The view for `<native:scroll>`: a `UIScrollView`, which owns the gestures,
 * the deceleration, the rubber banding and the indicators. This owns the layer
 * above: how props reach it, how insets are composed, and which touches it may
 * take from its content. Unlike `RCTScrollViewComponentView`, which cancels
 * every content touch, it asks the element through `EXPElementDragOwnership`,
 * restoring UIKit's own `-touchesShouldCancelInContentView:` rule.
 */
@interface EXPScrollViewComponentView
    : RCTViewComponentView <RCTMountingTransactionObserving, RCTVirtualViewContainerProtocol, RCTVirtualViewScrollHost>

// The scroll view itself, for tests and for anything that must reach UIKit directly
@property (nonatomic, strong, readonly) UIScrollView *scrollView;

// Subscribes to this view's scrolling without becoming its delegate, which a
// `VirtualView`'s container state needs. Delegates run in the order added, and
// this view is the first, so a listener cannot pre-empt its insets or events.
- (void)addScrollListener:(NSObject<UIScrollViewDelegate> *)scrollListener;
- (void)removeScrollListener:(NSObject<UIScrollViewDelegate> *)scrollListener;

@end

NS_ASSUME_NONNULL_END
