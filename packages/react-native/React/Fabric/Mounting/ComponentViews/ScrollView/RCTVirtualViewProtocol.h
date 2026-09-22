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
 * Where a virtual view is, without asking UIKit where it is.
 *
 * The container needs a view's frame and its parent for every registered view
 * on every scroll event, and both are expensive to ask for: `-[UIView frame]`
 * rebuilds the rect from `CALayer`, and `-[UIView superview]` is
 * `CALayerGetSuperlayer` behind an unfair lock. Ten thousand of each, sixty
 * times a second, was the largest single cost on the main thread while a long
 * list was moving.
 *
 * One STRUCT rather than two accessors, and that is not tidiness. A method
 * that returns an object returns it at +0 valid for the enclosing autorelease
 * pool, which is `objc_autoreleaseReturnValue` into `pthread_setspecific` on
 * every call — measured at more than half of what the loop cost once the locks
 * were gone. A struct return has no ARC in it at all, and the parent comes back
 * `__unsafe_unretained` for the same reason.
 */
typedef struct {
  /** The frame the view was last given, in its superview's coordinates. */
  CGRect frame;
  /** The view it was last added to, or `nil` if it has none. */
  __unsafe_unretained UIView *_Nullable superview;
} RCTVirtualViewGeometry;

@protocol RCTVirtualViewProtocol <NSObject>

- (NSString *)virtualViewID;
- (CGRect)containerRelativeRect:(UIView *)view;

/**
 * The frame and parent the view last recorded — see `RCTVirtualViewGeometry`.
 *
 * Both are written where they change, so neither can drift: the frame wherever
 * a frame is set, the parent in `-didMoveToSuperview`.
 */
- (RCTVirtualViewGeometry)virtualViewGeometry;

- (void)onModeChange:(RCTVirtualViewMode)newMode targetRect:(CGRect)targetRect thresholdRect:(CGRect)thresholdRect;
@end

NS_ASSUME_NONNULL_END
