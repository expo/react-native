/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Resolves the link at a point, if any, and reports the rects it occupies.
 *
 * `rects` is filled in the host view's coordinate space. A link that wraps
 * across lines has several.
 *
 * `outLinkView` is set to the view that DRAWS that link — the view whose glyphs
 * they are, or the mounted view the link's content already is (`<a><img>`).
 * Not a copy of it and not a snapshot: the actual view, which is what lets
 * UIKit lift it natively. A resolver that cannot name one resolves no link.
 */
typedef id _Nullable (
    ^EXPTextLinkResolver)(CGPoint point, NSMutableArray<NSValue *> *rects, UIView *_Nullable *_Nullable outLinkView);

/**
 * iOS's own long-press behaviour for a link, on text this renderer draws
 * itself.
 *
 * Press-and-hold on a link in the system's own apps lifts the link's text off
 * the page, blurs what is behind it, and offers Open / Copy / Share. That is
 * `UIContextMenuInteraction`, which every app hosting a `UITextView` gets
 * without asking. Imitating the look would mean copying a blur radius, a corner
 * radius, a lift height and a menu layout that Apple changes between releases;
 * using the real interaction means the OS draws it.
 *
 * Apple's, used as documented: `UIContextMenuInteraction` and its delegate,
 * `UIContextMenuConfiguration`, `UITargetedPreview`, `UIPreviewParameters`
 * built with `initWithTextLineRects:` (so the lift's padding, corner radius,
 * platter colour and multi-line joining are UIKit's numbers), `UIPreviewTarget`,
 * `UIMenu`/`UIAction`, `dismissMenu`. Both generations of the preview callbacks
 * are implemented. Ours: only which view is the link, and the container the
 * lift is targeted into.
 *
 * `UITargetedPreview` is built around a view the OS can see, so each link is
 * painted by a view of its own (see `RCTAnonymousTextRunView`) and this hands
 * UIKit that view. UIKit hides it, lifts it and restores it as it does for a
 * `UITextView`, and there is no state of ours to unwind: UIKit does not say
 * when it has finished (there is no callback for an interaction it abandons,
 * and `willEndForConfiguration:` arrives only sometimes), so anything copied
 * from the text would have no reliable moment to be put back. A link whose
 * content is already a view, like `<a><img>`, lifts as that view.
 *
 * It cannot simply be a `UITextView`: these paragraphs are laid out by the
 * renderer's own inline formatting context, and a `UITextView` insists on doing
 * its own layout. So the interaction is hosted on the view that draws the text
 * and asks it what link, if any, is under the touch.
 *
 * No press-down highlight: nothing on iOS draws React Native's `isHighlighted`
 * grey rounded rect behind a link. The feedback for a tap is that the link
 * opens, and the feedback for a hold is this.
 */
@interface EXPTextLinkInteraction : NSObject <UIContextMenuInteractionDelegate>

/**
 * `view` is the view that draws the text and hosts the interaction; it is held
 * WEAKLY, because the view owns this object.
 */
- (instancetype)initWithView:(UIView *)view resolver:(EXPTextLinkResolver)resolver;

/**
 * Adds or removes the interaction so it is present exactly when `wanted`.
 *
 * Gated rather than always-on: this installs a long-press recognizer, and a
 * view whose text contains no link has no business competing for one.
 */
- (void)setInstalled:(BOOL)wanted;

/**
 * Takes down a lift or menu that is on screen right now.
 *
 * Called when the text this was lifted out of goes away: the view leaves the
 * window, or is recycled onto different content. Left floating, the lifted copy
 * would show a link that is not there, and its menu would open a URL belonging
 * to a screen the user has left.
 *
 * Safe to call when nothing is presenting.
 */
- (void)dismissMenuIfPresenting;

@end

NS_ASSUME_NONNULL_END
