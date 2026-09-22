/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * How much of the window's bottom edge is currently obstructed, in points.
 *
 * `height` is the whole obstruction — the keyboard when one is up, the bottom
 * safe area when it is not. They are one quantity, not two: UIKit's own
 * `keyboardLayoutGuide` rests on the safe area when the keyboard is gone, which
 * is what makes a bar pinned to it correct in both states without branching.
 *
 * `safeArea` is the part of that which is always there. A consumer that already
 * insets for the safe area wants `height - safeArea`; one that insets for
 * nothing wants `height`.
 *
 * Deliberately not a third "keyboard height" field. The two platforms cannot
 * agree on what it would mean — iOS slides a guide that IS the safe area once
 * the keyboard has gone, so mid-flight there is no honest answer to "how tall is
 * the keyboard" — and every consumer so far wants one of the two numbers above.
 *
 * These are sampled from what is ON SCREEN this frame, not from where the
 * keyboard has been asked to end up.
 */
typedef struct {
  CGFloat height;
  CGFloat safeArea;
} EXPKeyboardGeometry;

/**
 * The geometry implied by where the follower has come to rest.
 *
 * Split out from the sampling so it can be checked without a keyboard: the
 * arithmetic is the part that has edge cases — a follower below the window, a
 * safe area larger than the obstruction — and none of them need a device to
 * provoke.
 */
FOUNDATION_EXPORT EXPKeyboardGeometry
EXPKeyboardGeometryFromFollower(CGRect followerInWindow, CGFloat windowHeight, CGFloat safeAreaBottom);

@protocol EXPKeyboardInsetObserving <NSObject>
- (void)keyboardGeometryDidChange:(EXPKeyboardGeometry)geometry;
@end

/**
 * A view that sits on top of the obstruction and so becomes part of it: a
 * composer docked to the keyboard covers the keyboard's points plus its own
 * height, and anything scrolling behind it has to clear both.
 */
@protocol EXPKeyboardObstructingView <NSObject>
/**
 * Where this view's top edge is once docked against an obstruction of
 * `obstructionHeight`, in window coordinates. Measured off the view rather than
 * derived, since the model and the pixels disagree while UIKit animates the bar;
 * `obstructionHeight` is for a conformer that cannot see itself.
 */
- (CGFloat)topInWindowForObstructionHeight:(CGFloat)obstructionHeight;
@end

/**
 * Reports the bottom obstruction every frame it moves.
 *
 * The keyboard notifications advertise a cubic of a given duration while the
 * motion is a spring with a long tail, and an interactive dismissal posts no
 * notification at all. `keyboardLayoutGuide` knows both but its `layoutFrame` is
 * the model value, which on show jumps to the destination in one frame. So this
 * pins an empty view to the guide and samples its presentation layer, which
 * tracks the spring and the finger alike, on a display link.
 */
@interface EXPKeyboardInsets : NSObject

/**
 * The sampler for the screen `view` is on, created on first use: one per view
 * controller's view, so a bar and a transcript on one screen share it and two
 * screens never do. `keyboardLayoutGuide` is per view, and a screen sliding in
 * does not see the keyboard leaving with the screen it covers. Anything not
 * inside a screen resolves to the root view controller's view.
 */
+ (instancetype)insetsForView:(UIView *)view;

// The geometry as of this frame
@property (nonatomic, readonly) EXPKeyboardGeometry geometry;

// A counter, readable in a trace; a bar and a transcript on one screen share it
@property (nonatomic, readonly) NSInteger identifier;

/**
 * The window the keys are in, or nil when there is no keyboard on screen.
 * `UIRemoteKeyboardWindow`, at window level 10000001, is the only place a view
 * can be to draw over the keys: an app's own window is clamped to 10000000, and
 * `UITextEffectsWindow` sits under the opaque key caps. It is not in
 * `UIWindowScene.windows`, so it is caught as it becomes visible, by a class
 * observer because it appears before any instance exists.
 */
+ (UIWindow *)keyboardWindow;

/**
 * Holds sampling open for the length of a gesture. An interactive dismissal
 * posts no notification, and a one-shot wake would park before the finger
 * reaches the keyboard. Calls nest; sampling continues until the last hold is
 * released and the geometry has settled.
 */
- (void)beginTracking;
- (void)endTracking;

// Observers and obstructing views are held weakly
- (void)addObserver:(id<EXPKeyboardInsetObserving>)observer;
- (void)removeObserver:(id<EXPKeyboardInsetObserving>)observer;

- (void)addObstructingView:(id<EXPKeyboardObstructingView>)view;
- (void)removeObstructingView:(id<EXPKeyboardObstructingView>)view;

// A docked view was placed, or changed where it rests, while the keyboard did
// not move; no notification announces that, so this wakes the sampler
- (void)obstructingViewsDidChange;

// The top edge of everything obstructing the bottom of the window: the
// keyboard's own top or the top of whatever is docked above it
- (CGFloat)obstructionTopInWindowForObstruction:(CGFloat)obstructionHeight;

@end

NS_ASSUME_NONNULL_END
