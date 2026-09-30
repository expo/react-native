/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * How much of the window's bottom edge is obstructed this frame, in points,
 * sampled from what is on screen rather than where the keyboard was asked to go.
 *
 * `height` is the whole obstruction: the keyboard when one is up, the bottom safe
 * area when it is not, one quantity as UIKit's `keyboardLayoutGuide` treats it.
 * `safeArea` is the part that is always there; a consumer already inset for the
 * safe area wants `height - safeArea`. There is no separate keyboard height,
 * since mid-flight the guide gives no honest answer to it.
 */
typedef struct {
  CGFloat height;
  CGFloat safeArea;
} EXPKeyboardGeometry;

/**
 * Posted, with the view that would resign as its object, when a field is asked
 * to blur. A field whose keyboard is stood down behind a picture is not first
 * responder, so the resign is a no-op; whoever holds the keyboard for that
 * field listens here and does not give it back.
 */
FOUNDATION_EXPORT const NSNotificationName EXPFieldAskedToBlurNotification;

// The geometry implied by where the follower rests, split from the sampling so
// the edge cases (a follower below the window, a safe area larger than the
// obstruction) can be checked without a keyboard
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
