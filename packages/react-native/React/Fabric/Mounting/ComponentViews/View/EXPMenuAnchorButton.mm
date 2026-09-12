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

// UIKit asks again for the dismissal; answering only the highlight leaves the
// default platter for the shape coming back
- (UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
    previewForDismissingMenuWithConfiguration:(UIContextMenuConfiguration *)configuration
{
  return [self exp_preview];
}

/**
 * Nothing drawn for the source, since the anchor is not visible: UIKit would
 * otherwise draw a `systemBackgroundColor` platter behind the attachment point.
 * An empty visible path draws none of it; nil would mean the default platter,
 * and the button's shape would collect the menu's shadow as a dark blob. The
 * menu's own scale-up from an unseen source remains; see `_installMenuSource`.
 */
- (UITargetedPreview *)exp_preview
{
  UIPreviewParameters *parameters = [UIPreviewParameters new];
  parameters.backgroundColor = UIColor.clearColor;
  parameters.visiblePath = [UIBezierPath bezierPathWithRect:CGRectZero];
  return [[UITargetedPreview alloc] initWithView:self parameters:parameters];
}

@end
