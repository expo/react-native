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
 */
/**
 * `outSourceView`, when set, is the view whose pixels the lift should be taken
 * from — the run that drew the glyphs, which paints on a CLEAR background.
 *
 * Snapshotting the host view instead brings the page's own background up with
 * the text, so the lifted link floats on a slab of it. Left unset by a caller
 * that has no such view, in which case the host is used.
 */
typedef id _Nullable (^EXPTextLinkResolver)(
    CGPoint point,
    NSMutableArray<NSValue *> *rects,
    UIView *_Nullable *_Nullable outSourceView);


/**
 * iOS's own long-press behaviour for a link, on text this renderer draws
 * itself.
 *
 * ## Why this is a `UIContextMenuInteraction` and not something of ours
 *
 * Press-and-hold on a link in Messages or Notes lifts the link's TEXT off the
 * page, blurs what is behind it, and offers Open / Copy / Share. That is not a
 * house style — it is `UIContextMenuInteraction`, and every app that hosts a
 * `UITextView` gets it without asking. Imitating the look would mean copying a
 * blur radius, a corner radius, a lift height and a menu layout that Apple
 * changes between releases, and being subtly wrong about all of them forever.
 * Using the real interaction means the OS draws it, and keeps drawing it
 * correctly.
 *
 * ## Which parts are Apple's, and which are ours
 *
 * Worth stating plainly, because the answer is "nearly all of it, with one
 * deliberate exception".
 *
 * Apple's, used as documented: `UIContextMenuInteraction` and its delegate;
 * `UIContextMenuConfiguration`; `UITargetedPreview`; `UIPreviewParameters`,
 * built with `initWithTextLineRects:` — the initialiser that exists for exactly
 * this, so the lift's padding, corner radius and multi-line joining are UIKit's
 * numbers and not copied ones; `UIMenu`/`UIAction`; `dismissMenu`. Both
 * generations of the preview callbacks are implemented, so no path UIKit can
 * take is unanswered.
 *
 * OURS, and unavoidable: the preview's VIEW. `UITargetedPreview` expects the
 * view the user is interacting with, and for a link in a paragraph no such view
 * exists — the link is a range of glyphs inside text this renderer draws in one
 * pass. So the glyphs are captured and stood up as a view of their own. That is
 * within the API's contract (it asks only for a view in a window) but it is
 * scaffolding UIKit would not need if this were a `UITextView`, and the
 * suppression that stops the original drawing underneath is entirely ours.
 *
 * The documented alternative for a preview that is not itself in place —
 * `UIPreviewTarget(container:center:)` — was tried first and is WORSE here:
 * UIKit tears its preview down between the highlight and the menu, and with
 * nothing real to put back it left a hole, then an empty chip on dismissal.
 * Giving it a real view is what makes it behave.
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
