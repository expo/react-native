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
typedef id _Nullable (^EXPTextLinkResolver)(
    CGPoint point,
    NSMutableArray<NSValue *> *rects,
    UIView *_Nullable *_Nullable outLinkView);


/**
 * iOS's own long-press behaviour for a link, on text this renderer draws
 * itself.
 *
 * ## Why this is a `UIContextMenuInteraction` and not something of ours
 *
 * Press-and-hold on a link in the system's own apps lifts the link's TEXT off
 * the page, blurs what is behind it, and offers Open / Copy / Share. That is not a
 * house style — it is `UIContextMenuInteraction`, and every app that hosts a
 * `UITextView` gets it without asking. Imitating the look would mean copying a
 * blur radius, a corner radius, a lift height and a menu layout that Apple
 * changes between releases, and being subtly wrong about all of them forever.
 * Using the real interaction means the OS draws it, and keeps drawing it
 * correctly.
 *
 * ## Which parts are Apple's, and which are ours
 *
 * Worth stating plainly, because the answer is "all of it".
 *
 * Apple's, used as documented: `UIContextMenuInteraction` and its delegate;
 * `UIContextMenuConfiguration`; `UITargetedPreview`; `UIPreviewParameters`,
 * built with `initWithTextLineRects:` — the initialiser that exists for exactly
 * this, so the lift's padding, corner radius, platter colour and multi-line
 * joining are UIKit's numbers and not copied ones; `UIPreviewTarget`;
 * `UIMenu`/`UIAction`; `dismissMenu`. Both generations of the preview callbacks
 * are implemented, so no path UIKit can take is unanswered.
 *
 * OURS: only the choice of WHICH view is the link, and the container the lift
 * is targeted into. Both are answers to questions the API asks.
 *
 * ## The one thing that had to change for that to be true
 *
 * `UITargetedPreview` is built around a view the OS can see, and for a long
 * time no such view existed here: a link was a range of glyphs inside a
 * paragraph this renderer draws in one pass. Every attempt to work around that
 * — snapshot the glyphs, stand the picture up as a view, hide the real text
 * underneath — needed to know when UIKit had FINISHED in order to put the text
 * back, and UIKit does not say. There is no callback for an interaction it
 * abandons, and `willEndForConfiguration:` arrives only sometimes. That one gap
 * is where the holes in paragraphs, the blank chips, the ghosting and the
 * double outlines all came from; they were not separate bugs.
 *
 * So each link is now painted by a VIEW OF ITS OWN (see
 * `RCTAnonymousTextRunView`), and this hands UIKit that view. UIKit hides it,
 * lifts it and restores it exactly as it does for a `UITextView`, and there is
 * no state of ours to unwind. Nothing is copied, so nothing can go stale — and
 * a link whose content is already a view, like `<a><img>`, lifts as that view
 * rather than as a drawing that never contained it.
 *
 * ## Why it cannot simply be a `UITextView`
 *
 * That would be the easy way to get all of this, and it is not available: these
 * paragraphs are laid out by the renderer's own inline formatting context, and
 * a `UITextView` insists on doing its own layout. So the interaction is hosted
 * on the view that draws the text, and asks it what link — if any — is under
 * the touch.
 *
 * ## What it deliberately does NOT do
 *
 * No press-down highlight. React Native's `isHighlighted` draws a grey rounded
 * rect behind pressed glyphs, and nothing on iOS does that to a link: the
 * feedback for a tap is that the link opens, and the feedback for a hold is
 * this. A grey overlay would read as an app built from a web toolkit, which is
 * precisely what the element vocabulary is trying not to look like.
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
 * Called when the text this was lifted OUT OF goes away — the view leaves the
 * window, or is recycled onto different content. The lifted copy is a picture
 * of something that no longer exists, so it goes with it; leaving it floating
 * over the app until the user dismisses it would be showing them a link that
 * is not there, and acting on its menu would open a URL belonging to a screen
 * they have left.
 *
 * Safe to call when nothing is presenting.
 */
- (void)dismissMenuIfPresenting;

@end

NS_ASSUME_NONNULL_END
