/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

@class RCTVirtualViewContainerState;

@protocol RCTVirtualViewContainerProtocol

- (RCTVirtualViewContainerState *)virtualViewContainerState;

@end

/**
 * All that `RCTVirtualViewContainerState` needs from the scroll view it belongs
 * to: somewhere to read the viewport from, and a way to be told when it moves.
 *
 * Stated as a protocol because being a virtualization container is not the same
 * thing as being `RCTScrollViewComponentView`. `RCTScrollableProtocol` would
 * have done as a type, but it also demands `scrollToOffset:`, `scrollToEnd:`,
 * `zoomToRect:` and a `contentSize` that none of this touches — implementing
 * five methods to satisfy a parameter is the wrong reason to write code.
 */
@protocol RCTVirtualViewScrollHost <NSObject>

@property (nonatomic, strong, readonly) UIScrollView *scrollView;

- (void)addScrollListener:(NSObject<UIScrollViewDelegate> *)scrollListener;
- (void)removeScrollListener:(NSObject<UIScrollViewDelegate> *)scrollListener;

@end
