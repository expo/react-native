/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/*
 * Adopted by element views whose gesture is a *drag they own* — a slider, a
 * stepper being scrubbed, a segmented control being swiped across.
 *
 * This exists because of a difference between UIKit's scroll view and React
 * Native's. UIKit decides per content view whether a scroll may steal a touch:
 * `-[UIScrollView touchesShouldCancelInContentView:]` returns NO for a
 * `UIControl` and YES for everything else. That single rule is why dragging a
 * `UISlider` inside a table view moves the slider instead of scrolling the
 * table, while dragging a plain row scrolls it.
 *
 * `RCTScrollViewComponentView` overrides that to return YES for every view, so
 * under React Native a scroll can cancel *any* touch. For a `<button>` that is
 * right — a press should lose to a scroll. For anything that owns a drag it is
 * wrong, and wrong in a way an iOS developer notices immediately: the control
 * simply does not work inside a scrollable.
 *
 * Rather than invent a second policy, this restores UIKit's: an element says
 * whether it owns the drag, and the scroll view asks. The Android counterpart
 * is `requestDisallowInterceptTouchEvent`, which the corresponding views call
 * on touch-down — different mechanism, same rule.
 */
@protocol EXPElementDragOwnership <NSObject>

/*
 * YES when a gesture beginning in this view belongs to it for the gesture's
 * duration, and an enclosing scroll view must not cancel it.
 *
 * Asked while the touch is live, so it may vary per instance and per state — a
 * disabled control owns nothing.
 */
- (BOOL)elementOwnsDragGesture;

@end

NS_ASSUME_NONNULL_END
