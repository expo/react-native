/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <React/RCTImageURLLoader.h>

/**
 * `<img src="system:pencil">`: the platform's own icon as an image source. A
 * `src` scheme keeps the element standard and names the platform capability in
 * the value, as `-apple-visual-effect` does, and brings `srcset`, `alt`, sizing
 * and `tintColor` with it. `system:` rather than `symbol:` because
 * `systemColor()` is this codebase's word for the platform's own, and Android
 * can answer the same name with a Material symbol. A template image, unlike a
 * glyph drawn as text, has no baseline or em box to centre and takes a tint.
 *
 *     system:pencil
 *     system:arrow.up?weight=semibold
 *     system:arrow.up?weight=bold&scale=large
 *
 * `system://pencil` is accepted too.
 */
@interface EXPSystemImageLoader : NSObject <RCTImageURLLoader>
@end
