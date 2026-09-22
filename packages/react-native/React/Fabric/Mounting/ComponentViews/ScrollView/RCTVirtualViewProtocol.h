/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <React/RCTVirtualViewMode.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Where a virtual view is, without asking UIKit: `-[UIView frame]` rebuilds the
 * rect from `CALayer` and `-[UIView superview]` takes a lock, for every
 * registered view on every scroll event. One struct rather than two accessors,
 * since an object return costs an autorelease per call; the parent is
 * `__unsafe_unretained` for the same reason.
 */
typedef struct {
  // The frame the view was last given, in its superview's coordinates
  CGRect frame;
  // The view it was last added to, or `nil`
  __unsafe_unretained UIView *_Nullable superview;
} RCTVirtualViewGeometry;

@protocol RCTVirtualViewProtocol <NSObject>

- (NSString *)virtualViewID;
- (CGRect)containerRelativeRect:(UIView *)view;

// The frame and parent the view last recorded, written where they change
- (RCTVirtualViewGeometry)virtualViewGeometry;

- (void)onModeChange:(RCTVirtualViewMode)newMode targetRect:(CGRect)targetRect thresholdRect:(CGRect)thresholdRect;
@end

NS_ASSUME_NONNULL_END
