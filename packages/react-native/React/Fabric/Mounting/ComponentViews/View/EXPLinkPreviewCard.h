/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * The card a link's context menu morphs into: `LPLinkView`, the platform's own
 * link preview, and the same one Messages and Notes draw.
 *
 * A context menu morphs its lift into whatever it is presenting rather than
 * appearing beside it, so the lift needs a destination. Without one, a chip the
 * size of a few words grows to the width of the menu and fades out on the way.
 */
@interface EXPLinkPreviewCard : UIViewController

/** A card for `url`, or nil when there is no URL to show. */
+ (nullable instancetype)cardForURL:(nullable NSURL *)url;

@end

NS_ASSUME_NONNULL_END
