/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

#import <React/RCTViewComponentView.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * The view behind `<native:popover>`: a card the platform presents as a
 * POPOVER, zoomed out of the glass of the element under `anchor`, over a
 * keyboard stood down behind a picture of its keys.
 *
 * The native chat's `+` opens one. The card is the popover's own glass
 * platter, the morph and the dimming are UIKit's zoom transition, and the tap
 * outside and the pull to dismiss are the popover's. Draws nothing itself: its
 * children are mounted into the card controller's view.
 */
@interface EXPPopoverComponentView : RCTViewComponentView
@end

NS_ASSUME_NONNULL_END
