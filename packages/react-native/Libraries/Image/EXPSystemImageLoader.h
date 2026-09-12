/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <React/RCTImageURLLoader.h>

/**
 * `<img src="system:pencil">` — the platform's own icon as an image source.
 *
 * ## Why a URL and not a prop
 *
 * `<img>` already means "an image from somewhere", and the system is a
 * somewhere. A `src` scheme keeps the element standard and puts the
 * platform-specific part in the VALUE, which is the same shape
 * `-apple-visual-effect` uses: a platform capability named in a value rather
 * than a new element invented for it. It also comes with everything `<img>`
 * already has — `srcset`, `alt`, sizing, and `tintColor` — instead of needing
 * each of them again.
 *
 * A `systemImage` PROP would have been the other option and is the worse one.
 * `<native:menubutton>` has one, and it has to: its title and image are the
 * button's *configuration*, never a node, so there is no `src` for them to be.
 * An `<img>` has one already.
 *
 * ## Why `system:` and not `symbol:`
 *
 * Two reasons, and the second is the one that decided it. `systemColor()` is
 * already this codebase's word for "the platform's own", so a source that means
 * the same thing should say it the same way. And SF Symbols are Apple's brand:
 * a `symbol:` URL would read as an Apple thing being asked for, where the value
 * an author writes should be "the system's icon called this" — which Android
 * can answer with a Material symbol without either side lying.
 *
 * ## Why an icon is not a glyph
 *
 * The alternative, and what the keyboard demo did: draw the icon as TEXT, a
 * `<span>` containing `≡` or `✎`. It works until it doesn't. Each glyph's ink
 * sits differently in its em box, so one centring correction cannot centre them
 * all; they scale with the reader's text size while their box does not; and a
 * colour emoji cannot be tinted at all. Measured on the demo's own command
 * tiles: `≡` sat high, the pencil rendered as a colour emoji at its own size,
 * and a presentation selector (`U+FE0E`) did not persuade iOS otherwise.
 *
 * A template image has no baseline and no em box. There is nothing to centre,
 * because the artwork is already centred in its own square.
 *
 * ## The shape
 *
 *     system:pencil
 *     system:arrow.up?weight=semibold
 *     system:arrow.up?weight=bold&scale=large
 *
 * `system://pencil` is accepted too, because both spellings are things people
 * write and neither is wrong enough to reject.
 *
 * Always a TEMPLATE image, so `tintColor` colours it — which is the property a
 * symbol has and an emoji does not, and half the reason for the scheme.
 */
@interface EXPSystemImageLoader : NSObject <RCTImageURLLoader>
@end
