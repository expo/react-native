/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * A peek beginning and ending, for anything that must get out of its way. A
 * docked accessory bar held up by its own first responder does not go down when
 * a menu presents, and then sits in `UITextEffectsWindow` above the peek's dim
 * and the lifted balloon. No window the app owns can be drawn above the
 * keyboard's (level 10000001 against a clamp of 10000000), so letting the bar
 * go down is the only arrangement the platform can deliver.
 */
extern const NSNotificationName EXPPeekWillBeginNotification;
extern const NSNotificationName EXPPeekDidEndNotification;

/**
 * The platform's long press, a peek, on a view that asks for one:
 * `UIContextMenuInteraction`, with a `UIContextMenuInteractionDelegate` that
 * provides the highlight preview, so the hold duration, the movement slop, the
 * scroll-cancels-the-hold rule, the lift and its haptic are the system's.
 *
 * The configuration carries the element's `<menu>` when it has one and nothing
 * otherwise; `nil` from the action provider asks UIKit for the preview alone.
 * The lifted shape comes from the child that draws it (`-exp_setPeekShapeProvider:`),
 * since a preview without a path is a rounded rectangle.
 *
 * UIKit asks for the configuration before an enclosing scroll view's pan
 * reaches `Began`, so a peek cannot be cancelled from here when the list starts
 * scrolling; a finger that scrolls is moving before the hold completes, so the
 * recognizer fails first. See DOM-CSS-LIMITATION(peek-outruns-the-scroll).
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
 * The commands the lift presents, or empty for the lift alone. A leading run
 * of commands with an icon and no label becomes an inline `UIMenu` at
 * `UIMenuElementSizeSmall`, UIKit's compact row of glyphs; the rest become
 * ordinary rows. `onChoose` receives the chosen command's `id`.
 */
- (void)setCommands:(NSArray<NSDictionary<NSString *, id> *> *)commands
           onChoose:(void (^_Nullable)(NSString *identifier))onChoose;

/** Whether the interaction is installed; assigning adds or removes it */
@property (nonatomic, assign, getter=isEnabled) BOOL enabled;

@end

NS_ASSUME_NONNULL_END
