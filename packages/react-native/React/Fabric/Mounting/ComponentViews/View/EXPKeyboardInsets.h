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
 * A view that sits on top of the obstruction and so becomes part of it.
 *
 * A composer docked to the keyboard covers the same points the keyboard does, plus
 * its own height. Anything scrolling behind it has to clear both, or the newest
 * message lands underneath the bar — measured in the chat demo at y=486 against a
 * composer whose top was y=471, which is the ordinary chat layout rather than an
 * exotic one.
 *
 * Android has had this since the composer went in; iOS reserved for the keyboard
 * alone until the demo showed the difference.
 */
@protocol EXPKeyboardObstructingView <NSObject>
/**
 * Where this view's top edge ends up once docked against an obstruction of
 * `obstructionHeight`, in window coordinates.
 *
 * MEASURED off the view, not derived from `obstructionHeight` — the conforming
 * bar reports where its top edge actually is. This doc used to say the opposite,
 * and the implementation reversed it: a derivation could not describe a bar that
 * UIKit was animating, because the model and the pixels disagree mid-flight.
 * `obstructionHeight` is still passed because a conformer that cannot see itself
 * has only the keys' height to go on.
 */
- (CGFloat)topInWindowForObstructionHeight:(CGFloat)obstructionHeight;
@end

/**
 * Reports the bottom obstruction every frame it moves.
 *
 * UIKit describes the keyboard two ways and neither is sufficient alone. The
 * notifications carry a duration and a curve, but the motion they describe is a
 * spring — measured, on iOS 26: it accelerates for four frames and then decays
 * with a long tail, well past the advertised 0.3833s. Replaying that with a
 * cubic of the advertised duration cannot match it, which is why anything built
 * on the notifications drifts against the keyboard it is chasing. Worse, an
 * interactive dismissal emits no notification at all: dragging the keyboard down
 * with a finger produces silence, so a listener has nothing to follow.
 *
 * `keyboardLayoutGuide` knows both, but its `layoutFrame` is the model value —
 * on show it jumps to the destination in one frame while the keyboard is still
 * travelling. What is actually on screen is the presentation layer of a view
 * constrained to that guide, and THAT tracks the spring and the finger alike.
 *
 * So this observer pins an empty view to the guide and samples its presentation
 * layer on a display link. One mechanism, every case, on UIKit's clock rather
 * than a replica of it.
 */
@interface EXPKeyboardInsets : NSObject

/**
 * The sampler for the SCREEN `view` is on, created on first use.
 *
 * One per view controller's view, found by walking the responder chain, so a
 * bar and a transcript on one screen share a sampler and two screens never do.
 * That is the isolation the platform already provides — `keyboardLayoutGuide` is
 * per view, and a screen sliding in does not see the keyboard leaving with the
 * screen it covers — and sharing one follower on the root view threw it away:
 * measured on a phone as the incoming transcript reserving three hundred and
 * thirty-five points for a keyboard that was never its own, then sliding down
 * as that keyboard left with the screen underneath.
 *
 * Anything not inside a screen of its own resolves to the root view controller's
 * view, which is what every view resolved to before there were screens.
 */
+ (instancetype)insetsForView:(UIView *)view;

/** The geometry as of this frame. */
@property (nonatomic, readonly) EXPKeyboardGeometry geometry;

/** A counter, readable in a trace: lines from a bar and a transcript that share a screen share it. */
@property (nonatomic, readonly) NSInteger identifier;

/**
 * The window the KEYS are in, or nil when there is no keyboard on screen.
 *
 * `UIRemoteKeyboardWindow`, at window level 10000001 — and the only place a
 * view can be to draw over the keys. Measured three ways with
 * `~/Developer/probes/windowprobe`: a window of the app's own is clamped to
 * 10000000 and draws underneath; a view in `UITextEffectsWindow` (level 1, and
 * where a plain `inputAccessoryView` lives) shows through the keyboard's
 * translucent backdrop but is drawn under the opaque key caps; a view added to
 * THIS window, after its `UIInputSetContainerView`, covers them completely.
 *
 * It lives here because this is already the object that knows about the
 * keyboard, and because it cannot be found any other way: it is not in
 * `UIWindowScene.windows`, so it has to be caught as it becomes visible.
 *
 * A CLASS method, because there is one keyboard per process and it is not the
 * property of any app window. Written as an instance property first, which did
 * not work: the per-window instance that would answer is made the first time
 * something asks, which is after the keyboard's window has already appeared and
 * its notification has already gone by.
 */
+ (UIWindow *)keyboardWindow;


/**
 * Hold sampling open for the length of a gesture, and release it afterwards.
 *
 * An interactive dismissal emits no notification at any point, so nothing else
 * can tell us it is happening. A one-shot wake is not enough either: the finger
 * may travel for a second before it reaches the keyboard and starts moving it,
 * and a sampler that parks on stability will already have switched off by then —
 * measured, that yielded a single update at the very end instead of tracking.
 *
 * So this is a hold, not a nudge. Calls nest; sampling continues until the last
 * hold is released and the geometry has settled.
 */
- (void)beginTracking;
- (void)endTracking;

/** Observers are held weakly; there is no need to remove one on dealloc. */
- (void)addObserver:(id<EXPKeyboardInsetObserving>)observer;
- (void)removeObserver:(id<EXPKeyboardInsetObserving>)observer;

/** Obstructing views are held weakly too. */
- (void)addObstructingView:(id<EXPKeyboardObstructingView>)view;
- (void)removeObstructingView:(id<EXPKeyboardObstructingView>)view;

/**
 * A docked view was placed, or changed where it rests, while the keyboard did not
 * move: a screen appeared with its bar, a bar changed anchor or height.
 * No notification announces that, and the sampler only runs while something
 * moves — so a bar that arrived quietly was counted a frame or a second late,
 * and the transcript stepped by the bar's height after the transition had
 * settled. This wakes the sampler to read the docks and settle again.
 */
- (void)obstructingViewsDidChange;

/**
 * The top edge of everything obstructing the bottom of the window: the keyboard's
 * own top, or the top of whatever is docked above it, whichever is higher. A view
 * that is not resting on the obstruction reports a top below it and changes
 * nothing.
 */
- (CGFloat)obstructionTopInWindowForObstruction:(CGFloat)obstructionHeight;

@end

NS_ASSUME_NONNULL_END
