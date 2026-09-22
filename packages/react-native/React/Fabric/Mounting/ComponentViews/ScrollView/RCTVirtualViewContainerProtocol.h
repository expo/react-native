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

// All that `RCTVirtualViewContainerState` needs from its scroll view: a
// viewport to read and a way to hear it move. `RCTScrollableProtocol` would
// also demand scrolling and zooming methods none of this touches.
@protocol RCTVirtualViewScrollHost <NSObject>

@property (nonatomic, strong, readonly) UIScrollView *scrollView;

- (void)addScrollListener:(NSObject<UIScrollViewDelegate> *)scrollListener;
- (void)removeScrollListener:(NSObject<UIScrollViewDelegate> *)scrollListener;

@end
