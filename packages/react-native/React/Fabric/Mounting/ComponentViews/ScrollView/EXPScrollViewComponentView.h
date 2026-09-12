/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <React/RCTMountingTransactionObserving.h>
#import <React/RCTViewComponentView.h>
#import "RCTVirtualViewContainerProtocol.h"
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * The view for `<native:scroll>`.
 *
 * A `UIScrollView`, which is the whole point: on iOS the platform's scrolling
 * container IS its gesture recognizers, its deceleration curve, its rubber
 * banding, its indicators, its pointer and trackpad handling and its
 * accessibility. Writing any of that ourselves could only be worse. What this
 * owns is the layer above — how props reach it, how insets are composed, and
 * which touches it may take from its content.
 *
 * The last of those is the one that differs from `RCTScrollViewComponentView`.
 * UIKit's rule is per content view: `-touchesShouldCancelInContentView:` returns
 * NO for a `UIControl` and YES for everything else, which is why dragging a
 * slider inside a table moves the slider while dragging a row scrolls the table.
 * React Native overrides that to YES for everything, so a scroll can steal any
 * touch and a control that owns a drag cannot work inside a scrollable at all.
 * This asks the element instead, through `EXPElementDragOwnership`, which
 * restores UIKit's rule rather than adding a second policy beside it.
 */
@interface EXPScrollViewComponentView : RCTViewComponentView <
    RCTMountingTransactionObserving,
    RCTVirtualViewContainerProtocol,
    RCTVirtualViewScrollHost>

/** The scroll view itself, for tests and for anything that must reach UIKit directly. */
@property (nonatomic, strong, readonly) UIScrollView *scrollView;

/**
 * Subscribe to this view's scrolling without becoming its delegate.
 *
 * `RCTScrollableProtocol`'s half of the contract, and the reason it exists here
 * is `VirtualView`: a virtual view finds the nearest ancestor that answers
 * `virtualViewContainerState`, and the state it gets back registers itself as a
 * listener so it can recompute which rows are near the viewport on every scroll.
 * A scroll view with no way to be listened to cannot host one.
 *
 * Delegates are called in the order they were added, and this view is already
 * the first of them — so nothing a listener does can pre-empt the insets, the
 * state or the events this view is responsible for.
 */
- (void)addScrollListener:(NSObject<UIScrollViewDelegate> *)scrollListener;
- (void)removeScrollListener:(NSObject<UIScrollViewDelegate> *)scrollListener;

@end

NS_ASSUME_NONNULL_END
