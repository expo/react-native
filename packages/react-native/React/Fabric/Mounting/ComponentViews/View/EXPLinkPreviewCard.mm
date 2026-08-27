/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPLinkPreviewCard.h"

#import <LinkPresentation/LinkPresentation.h>

@implementation EXPLinkPreviewCard {
  LPLinkView *_link;
}

+ (nullable instancetype)cardForURL:(nullable NSURL *)url
{
  if (url == nil) {
    return nil;
  }

  /*
   * Metadata carrying only the URL, rather than `-initWithURL:`. Handed
   * metadata, `LPLinkView` draws a finished card at once; given a URL it
   * expects metadata to arrive and shows a placeholder until it does. Nothing
   * here fetches.
   */
  LPLinkMetadata *metadata = [LPLinkMetadata new];
  metadata.originalURL = url;
  metadata.URL = url;

  EXPLinkPreviewCard *card = [EXPLinkPreviewCard new];
  card->_link = [[LPLinkView alloc] initWithMetadata:metadata];
  card->_link.translatesAutoresizingMaskIntoConstraints = NO;
  [card.view addSubview:card->_link];
  [NSLayoutConstraint activateConstraints:@[
    [card->_link.leadingAnchor constraintEqualToAnchor:card.view.leadingAnchor],
    [card->_link.trailingAnchor constraintEqualToAnchor:card.view.trailingAnchor],
    [card->_link.topAnchor constraintEqualToAnchor:card.view.topAnchor],
    [card->_link.bottomAnchor constraintEqualToAnchor:card.view.bottomAnchor],
  ]];
  return card;
}

- (void)viewDidLayoutSubviews
{
  [super viewDidLayoutSubviews];

  // `preferredContentSize` is how a preview controller states its size to the
  // menu; without it the card fills the width offered.
  const CGFloat available = CGRectGetWidth(self.view.bounds);
  if (available <= 0) {
    return;
  }
  const CGSize fitted = [_link sizeThatFits:CGSizeMake(available, CGFLOAT_MAX)];
  if (!CGSizeEqualToSize(self.preferredContentSize, fitted)) {
    self.preferredContentSize = fitted;
  }
}

@end
