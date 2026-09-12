/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * A peek beginning and ending, for anything that must get out of its way.
 *
 * The composer bar is the one thing that does. A docked bar is held up by a
 * first responder it owns (the accessory's claim), so unlike an ordinary
 * accessory it does NOT go down when a menu presents — it has no field to
 * resign. It then sits in `UITextEffectsWindow`, above the peek's dim and above
 * the lifted balloon, which is the wrong way round.
 *
 * There is no arrangement of windows that fixes it the other way: the keyboard's
 * window is level 10000001 and an app's own is clamped to 10000000, so nothing
 * the app owns can be drawn above the bar. Measured — an overlay window at
 * 100000000 still composited behind. Letting the bar go down is therefore the
 * only version of this the platform can actually deliver, and it is also what
 * the platform does on its own once nothing is propping the bar up.
 */
extern NSNotificationName const EXPPeekWillBeginNotification;
extern NSNotificationName const EXPPeekDidEndNotification;

/**
 * The platform's long press — a peek — on a view that asks for one.
 *
 * `UIContextMenuInteraction` is the API that replaced 3D Touch's peek and pop,
 * and it is the one the platform's own chat uses for a balloon: a
 * `UIContextMenuInteractionDelegate` providing
 * `previewForHighlightingContextMenuWithConfiguration:`, with the reaction row
 * hung above the menu. Using it means the hold duration, the movement slop, the
 * scroll-cancels-the-hold rule, the lift and its haptic are the system's rather
 * than reimplemented — which is why nothing here fires a feedback generator.
 *
 * The configuration carries the element's `<menu>` when it has one, and NOTHING
 * when it does not — returning `nil` from the action provider is how UIKit is
 * asked for the preview alone. Which of the two a box gets decides whether it
 * also publishes `contextmenu`: the platform presenting a menu IS the hold
 * happening, and an app told about it as well draws its own over the top.
 *
 * Its own object, rather than the element box's business, because everything
 * about a peek that is not "which view" is the same wherever one is wanted, and
 * the parts that differ are two blocks.
 *
 * The SHAPE is one of them, and it is not the installing view's to know: a
 * preview is a rounded rectangle unless it is given a path, so a balloon lifted
 * without one grows a tail-less square out of a shape that has a tail. The box
 * gets its path from the child that draws it — see
 * `-exp_setPeekShapeProvider:`.
 *
 * A hold cannot be taken back. UIKit asks for a configuration — which is when
 * this fires — BEFORE an enclosing scroll view's pan reaches `Began`; measured
 * at eighty milliseconds before, with both logging their own callbacks. So
 * "cancel the peek when the list starts scrolling" is not implementable from
 * here, and it does not need to be: a finger that begins a scroll is moving
 * before the half second is up, so UIKit's own recogniser fails and none of this
 * runs. See DOM-CSS-LIMITATION(peek-outruns-the-scroll).
 */
@interface EXPPeekInteraction : NSObject

/**
 * @param view       the view lifted, and the one the interaction is installed on
 * @param visiblePath the lifted shape in `view`'s coordinates, or `nil` for its bounds
 * @param onPeek     called when the hold completes, before the lift
 */
- (instancetype)initWithView:(UIView *)view
                 visiblePath:(UIBezierPath *_Nullable (^)(void))visiblePath
                      onPeek:(void (^)(void))onPeek NS_DESIGNATED_INITIALIZER;

- (instancetype)init NS_UNAVAILABLE;

/**
 * The commands the lift presents, or empty for the LIFT ALONE.
 *
 * Set from the element's `<menu>`. A leading run of commands that carry an icon
 * and no label becomes an inline `UIMenu` at `UIMenuElementSizeSmall` — UIKit's
 * compact row of glyphs, which is where the native chat app puts its reactions — and the
 * rest become ordinary rows beneath it. That is the whole of the peek: the row,
 * the menu, the lift, the blur and the dismissal are UIKit's, and nothing here
 * draws any of them.
 *
 * The block is called when a command is chosen, with the command's `id`.
 */
- (void)setCommands:(NSArray<NSDictionary<NSString *, id> *> *)commands
           onChoose:(void (^_Nullable)(NSString *identifier))onChoose;

/**
 * Whether the interaction is installed.
 *
 * Setting it is what adds and removes the interaction, so a view that stops
 * wanting a peek — including one being recycled — loses it by assigning `NO`.
 */
@property (nonatomic, assign, getter=isEnabled) BOOL enabled;

@end

NS_ASSUME_NONNULL_END
