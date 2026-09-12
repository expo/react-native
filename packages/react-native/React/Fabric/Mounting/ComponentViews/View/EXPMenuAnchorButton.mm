/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPMenuAnchorButton.h"

@implementation EXPMenuAnchorButton

- (UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
    previewForHighlightingMenuWithConfiguration:(UIContextMenuConfiguration *)configuration
{
  return [self exp_preview];
}

/*
 * Asked TWICE, and both have to answer.
 *
 * UIKit ends the lift effect at presentation and asks again for the dismissal.
 * Answering only the first leaves the default platter for the second, which is
 * the shape coming back as the menu closes.
 */
- (UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
    previewForDismissingMenuWithConfiguration:(UIContextMenuConfiguration *)configuration
{
  return [self exp_preview];
}

/**
 * NOTHING drawn for the source, because the source is not visible.
 *
 * UIKit draws a preview of the menu's source behind the attachment point and
 * fills it with `systemBackgroundColor` whatever the source's own background
 * was. For a real button that platter IS the button and the menu unfolds from
 * it. For an anchor there is nothing to unfold from, and the platter is a pale
 * chip in roughly the right place — reported as "a weird nub at the bottom for
 * a second".
 *
 * An empty visible path draws none of it. Two things that look like better
 * ideas are not:
 *
 *  - returning nil means "use the default", which is the platter;
 *  - giving the path the BUTTON's rounded shape, so the platter reads as the
 *    button, makes it worse rather than better — the platter is what the menu's
 *    shadow falls on, so a shape there produces a large dark blob at the start
 *    of the animation. Tried, photographed, reverted.
 *
 * This does not remove the effect entirely. What is left is the menu's own
 * scale-up from a source that cannot be seen, and closing that means the real
 * button being the source — which is what it cannot be here, because its lift
 * would be drawn under the keyboard. See `_installMenuSource`.
 */
- (UITargetedPreview *)exp_preview
{
  UIPreviewParameters *parameters = [UIPreviewParameters new];
  parameters.backgroundColor = UIColor.clearColor;
  parameters.visiblePath = [UIBezierPath bezierPathWithRect:CGRectZero];
  return [[UITargetedPreview alloc] initWithView:self parameters:parameters];
}

@end
