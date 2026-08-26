/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPTextLinkInteraction.h"

#import "RCTAnonymousTextRunView.h"

#import <React/RCTLog.h>
#import <React/RCTUtils.h>

/*
 * A gesture recognizer that never recognizes anything, used purely to know when
 * a touch starts and when it stops.
 *
 * `UIContextMenuInteractionDelegate` HAS NO CALLBACK for an interaction that is
 * abandoned, and — measured, repeatedly — `willEndForConfiguration:` is sent
 * only sometimes when UIKit gives up on a menu it was building. Twice the same
 * gesture produced different callback sequences. Everything the lift set up is
 * left standing in the runs where it is not sent: the paragraph keeps a hole in
 * it and the preview UIKit has dropped reads as a blank chip.
 *
 * Correctness therefore cannot rest on any one UIKit signal. What this adds is
 * a signal UIKit cannot withhold: the touch itself.
 *
 * It fails immediately and claims nothing, so it cannot affect scrolling, the
 * long press, or anything else competing for the same touches.
 */
/*
 * The cover, and the one signal UIKit gives that is actually dependable.
 *
 * UIKit HIDES the view it was handed as a preview for exactly as long as it is
 * displaying its own copy of it — proven by tinting this view red and finding
 * no red anywhere on screen during a lift. It does so on the LAYER, which is
 * why overriding `-[UIView setHidden:]` caught nothing and an earlier design
 * concluded, wrongly, that UIKit left the view alone.
 *
 * That hiding is worth more than any delegate callback, because it is not a
 * notification that can be skipped — it is the mechanism itself. While the
 * cover is hidden the OS is showing the link, and the run underneath must not
 * paint it as well; while it is visible the cover shows the link and the run
 * beneath is harmlessly covered. Suppression is slaved to it, so the two can
 * never disagree, and there is no timing, no watchdog and nothing to guess.
 */
@interface EXPCoverLayer : CALayer
@property (nonatomic, copy, nullable) void (^onHiddenChanged)(BOOL hidden);
@end

@implementation EXPCoverLayer

- (void)setHidden:(BOOL)hidden
{
  const BOOL was = self.isHidden;
  [super setHidden:hidden];
  if (was != hidden && _onHiddenChanged != nil) {
    _onHiddenChanged(hidden);
  }
}

@end

@interface EXPCoverView : UIImageView
@end

@implementation EXPCoverView
+ (Class)layerClass
{
  return [EXPCoverLayer class];
}
@end

/** Forces any pending drawing in a whole view subtree to happen now. */
static void EXPDisplayIfNeededRecursively(UIView *view)
{
  [view.layer displayIfNeeded];
  for (UIView *subview in view.subviews) {
    EXPDisplayIfNeededRecursively(subview);
  }
}

/*
 * Whether an image contains anything at all, judged by whether its pixels
 * differ from one another. A capture of glyphs always varies; a capture of
 * nothing is one flat colour, or empty.
 */
static BOOL EXPImageHasContrast(UIImage *image)
{
  CGImageRef cgImage = image.CGImage;
  if (cgImage == NULL) {
    return NO;
  }
  const size_t width = CGImageGetWidth(cgImage);
  const size_t height = CGImageGetHeight(cgImage);
  if (width == 0 || height == 0) {
    return NO;
  }
  // A small fixed sample: enough to tell text from a blank fill, cheap enough
  // to run on the main thread while a finger is down.
  const size_t kSide = 24;
  uint8_t pixels[kSide * kSide * 4];
  memset(pixels, 0, sizeof(pixels));
  CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(
      pixels, kSide, kSide, 8, kSide * 4, space, kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);
  if (context == NULL) {
    return YES; // cannot tell; assume it is fine rather than refuse to lift
  }
  CGContextDrawImage(context, CGRectMake(0, 0, kSide, kSide), cgImage);
  CGContextRelease(context);

  uint8_t lo = 255;
  uint8_t hi = 0;
  for (size_t i = 0; i < kSide * kSide; i++) {
    const uint8_t *p = &pixels[i * 4];
    if (p[3] < 8) {
      continue; // transparent: not ink
    }
    const uint8_t luma = (uint8_t)((p[0] * 30 + p[1] * 59 + p[2] * 11) / 100);
    lo = MIN(lo, luma);
    hi = MAX(hi, luma);
  }
  return hi > lo && (hi - lo) >= 12;
}

@interface EXPTouchPhaseObserver : UIGestureRecognizer
@property (nonatomic, copy, nullable) void (^onTouchBegan)(void);
@property (nonatomic, copy, nullable) void (^onTouchFinished)(void);
@end

@implementation EXPTouchPhaseObserver

- (instancetype)init
{
  if (self = [super initWithTarget:nil action:NULL]) {
    self.cancelsTouchesInView = NO;
    self.delaysTouchesBegan = NO;
    self.delaysTouchesEnded = NO;
  }
  return self;
}

- (void)touchesBegan:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  [super touchesBegan:touches withEvent:event];
  if (_onTouchBegan != nil) {
    _onTouchBegan();
  }
}

- (void)_finished:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  if (event.allTouches.count <= touches.count && _onTouchFinished != nil) {
    _onTouchFinished();
  }
  self.state = UIGestureRecognizerStateFailed;
}

- (void)touchesEnded:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  [super touchesEnded:touches withEvent:event];
  [self _finished:touches withEvent:event];
}

- (void)touchesCancelled:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  [super touchesCancelled:touches withEvent:event];
  [self _finished:touches withEvent:event];
}

@end

@implementation EXPTextLinkInteraction {
  __weak UIView *_view;
  EXPTextLinkResolver _resolver;
  UIContextMenuInteraction *_interaction;
  /*
   * The link the open gesture began on, and where its glyphs are.
   *
   * Held between `configurationForMenuAtLocation:` and the preview and action
   * callbacks, because UIKit does not pass the location to those — it passes
   * the configuration, which is opaque. Cleared when the menu ends so a stale
   * URL can never be opened by a later menu.
   */
  NSURL *_pendingURL;
  NSString *_pendingRawHref;
  NSArray<NSValue *> *_pendingRects;
  UIImage *_pendingLiftImage;
  CGRect _pendingLiftBounds;
  __weak UIView *_pendingSourceView;
  /*
   * Built ONCE per menu and handed back for every request.
   *
   * UIKit asks for a preview more than once — for the lift, and again when the
   * menu commits and when it dismisses. Building a fresh `UITargetedPreview`
   * (with a fresh view inside it) each time meant the thing already on screen
   * was swapped for an identical-looking copy mid-animation, which reads as the
   * lift "replacing itself" and flickering at exactly the moment the menu
   * appears. The same object every time gives UIKit nothing to swap.
   */
  UITargetedPreview *_pendingPreview;
  /*
   * A real view, parented to the RUN, showing the link's own pixels where the
   * link is. See `_liftPreview` — it is what UIKit hides, animates and puts
   * back, and being in the run's coordinate space is what makes it travel with
   * the text when the page scrolls.
   */
  EXPCoverView *_pendingLiftedView;
  UIPreviewParameters *_pendingParameters;
  EXPTouchPhaseObserver *_touchObserver;
  /*
   * Whether UIKit got as far as showing the menu. A displayed menu outlives the
   * finger, so the touch ending says nothing about it; a lift that never got
   * that far is over when the touch is.
   */
  BOOL _menuDisplayed;
}

- (instancetype)initWithView:(UIView *)view resolver:(EXPTextLinkResolver)resolver
{
  if (self = [super init]) {
    _view = view;
    _resolver = [resolver copy];
  }
  return self;
}

/*
 * Nothing of ours may outlive this object.
 *
 * The stand-in is a view we added to someone else's view, and the run stays
 * suppressed until something tells it otherwise — so an interaction released
 * mid-menu would leave a picture of a link sitting over the page and a
 * permanent hole in the paragraph behind it. Neither is undone by the owning
 * view going away, because neither belongs to it.
 *
 * Both are undone directly rather than through `_clearPending`, because the
 * deferred removal there posts a block, and a block scheduled from `dealloc`
 * would be reading a half-destroyed object.
 */
- (void)dealloc
{
  UIView *source = _pendingSourceView;
  if ([source isKindOfClass:[RCTAnonymousTextRunView class]]) {
    [(RCTAnonymousTextRunView *)source setSuppressedContainerRects:nil];
  }
  [_pendingLiftedView removeFromSuperview];
}

- (void)setInstalled:(BOOL)wanted
{
  UIView *view = _view;
  if (view == nil) {
    return;
  }
  if (wanted == (_interaction != nil)) {
    return;
  }
  if (wanted) {
    _interaction = [[UIContextMenuInteraction alloc] initWithDelegate:self];
    [view addInteraction:_interaction];
    __weak __typeof(self) weakSelf = self;
    _touchObserver = [EXPTouchPhaseObserver new];
    _touchObserver.onTouchBegan = ^{
      [weakSelf _touchBegan];
    };
    _touchObserver.onTouchFinished = ^{
      [weakSelf _touchFinished];
    };
    [view addGestureRecognizer:_touchObserver];
  } else {
    if (_touchObserver != nil) {
      [view removeGestureRecognizer:_touchObserver];
      _touchObserver = nil;
    }
    // Before the interaction goes: a menu still on screen belongs to text that
    // is being recycled onto something else.
    [self dismissMenuIfPresenting];
    [view removeInteraction:_interaction];
    _interaction = nil;
    [self _clearPending];
  }
}

/*
 * Two chances to notice that a lift is over, because UIKit cannot be relied on
 * to say so.
 *
 * A touch ENDING with no menu displayed means the lift was abandoned — clean
 * up now. A touch BEGINNING while state is still pending from a previous
 * gesture means the last one ended without anyone telling us — clean up before
 * doing anything else. Together they bound every missed callback to "until the
 * screen is touched again", which in practice is immediate, instead of leaving
 * a hole in the paragraph for the life of the surface.
 */
/*
 * UIKit has hidden or restored the cover, which is the same thing as saying it
 * has started or stopped displaying its own copy of the link.
 *
 * Hidden: the OS is showing those glyphs, so this run must not. Visible: the
 * cover is showing them again, so the run beneath is covered either way and
 * there is nothing to withhold.
 */
- (void)_coverHiddenChanged:(BOOL)hidden
{
  UIView *source = _pendingSourceView;
  if (![source isKindOfClass:[RCTAnonymousTextRunView class]]) {
    return;
  }
  [(RCTAnonymousTextRunView *)source setSuppressedContainerRects:hidden ? _pendingRects : nil];
}

- (void)_touchBegan
{
  if (_pendingPreview != nil || _pendingLiftedView != nil) {
    [self _clearPending];
  }
}

- (void)_touchFinished
{
  if (_menuDisplayed) {
    return;
  }
  [self _clearPending];
}

- (void)dismissMenuIfPresenting
{
  [_interaction dismissMenu];
  /*
   * The pending state is dropped HERE rather than left to
   * `willEndForConfiguration:`, because the reason for dismissing is that the
   * source is going away — and a view being torn down is exactly the case where
   * that callback may never arrive. Left behind, the suppressed rects would be
   * the last thing ever said to a run view, which is how a paragraph ends up
   * with a permanent hole in it where a link used to be.
   *
   * Safe when nothing is presenting: `dismissMenu` is a no-op then, and
   * clearing already-clear state is one too.
   */
  [self _clearPending];
}

- (void)_clearPending
{
  _menuDisplayed = NO;
  /*
   * Whatever the cover's hidden state was, the run paints normally from here.
   * This is the backstop for the one case UIKit does not signal: an
   * interaction it abandons while its copy is up, leaving the cover hidden and
   * never restoring it.
   */
  UIView *source = _pendingSourceView;
  if ([source isKindOfClass:[RCTAnonymousTextRunView class]]) {
    [(RCTAnonymousTextRunView *)source setSuppressedContainerRects:nil];
  }
  // Painting the glyphs again is the LAST thing undone and must happen however
  // the menu ended — committed, dismissed, or cancelled before it opened. A
  // miss here leaves a permanent hole in the paragraph where the link was.
  /*
   * Removed on the next turn rather than this one.
   *
   * Nothing underneath has to be repainted — the real glyphs were there the
   * whole time — but taking the cover away mid-transaction can land in the same
   * frame as UIKit's own teardown, and deferring costs nothing.
   */
  UIImageView *standIn = _pendingLiftedView;
  _pendingLiftedView = nil;
  if (standIn != nil) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [standIn removeFromSuperview];
    });
  }
  _pendingURL = nil;
  _pendingRawHref = nil;
  _pendingRects = nil;
  _pendingLiftImage = nil;
  _pendingPreview = nil;
  _pendingParameters = nil;
  _pendingSourceView = nil;
}

/*
 * An image of the LINK'S GLYPHS ALONE, captured before UIKit dims the page.
 *
 * Both halves are load-bearing and both were learned the hard way.
 *
 * DO NOT PAD THE RECTS. There was once a constant here for "room to leave for
 * the shape UIKit draws", and it must not come back: these are LINE FRAGMENT
 * rects, which already span the full line height including leading, so growing
 * them reaches into the line below — a sliver of the next line's ascenders
 * inside the chip, and neighbouring words swallowed when the link wraps. UIKit
 * insets the shape itself from whatever it is given, so there is nothing to
 * leave room for.
 *
 * CLIPPED to the link's line rects, because the preview is padded: UIKit
 * outsets a text lift by 14pt horizontally and 10pt vertically (read from
 * `_textPathInsets` on a parameters object it built itself). Handing it the
 * whole run view means that padding exposes the characters either side of the
 * link and the line below, which then travel up with it.
 *
 * CAPTURED HERE, at configuration time, because the preview is asked for during
 * the lift — by which point the backdrop is already dimmed, and a capture taken
 * then produces a grey chip. That cost six attempts at "the background" before
 * the pixels said the lifted region was DARKER than its surroundings, which no
 * background could have caused.
 */
- (nullable UIImage *)_liftImageForRects:(NSArray<NSValue *> *)rects bounds:(CGRect *)outBounds
{
  UIView *view = _view;
  if (view == nil || rects.count == 0) {
    return nil;
  }
  CGRect bounds = CGRectNull;
  for (NSValue *value in rects) {
    bounds = CGRectIsNull(bounds) ? value.CGRectValue : CGRectUnion(bounds, value.CGRectValue);
  }
  if (CGRectIsNull(bounds) || CGRectIsEmpty(bounds)) {
    return nil;
  }
  *outBounds = bounds;

  /*
   * Rendered from the RUN, not from the host.
   *
   * The run paints glyphs on a clear background; the host paints the page's
   * background behind them. Capturing the host therefore lifts the link sitting
   * on an opaque slab of whatever the page is — which is what stops the lifted
   * copy from blending with what is around it. This is what the resolver's
   * `outSourceView` is FOR, and it was being reported and then ignored here.
   *
   * The rects arrive in the host's space, so the render is offset by where the
   * run sits inside it rather than assuming the two share an origin.
   */
  /*
   * Everything INSIDE the link's rects, which is not the same as the run that
   * drew the glyphs.
   *
   * `<a><img></a>` is a link whose content is an image, and an image is not
   * painted by the text run at all — it is mounted as its own view alongside
   * it, positioned by the inline layout. Rendering only the run therefore
   * produced an EMPTY chip for exactly the case where the link is a picture,
   * while the real image stayed visible underneath: reported as "the popover
   * shows no image, and I can see the image below".
   *
   * So the capture walks the host's own subviews and draws each one that falls
   * inside the rects. That takes the glyph runs and the attachments together,
   * and — because the host's own layer is never rendered — leaves the page's
   * background behind, which is the thing that made the lift float on an opaque
   * slab when this used to capture the host directly.
   */
  /*
   * Every layer that owes a repaint must do it BEFORE it is captured, and that
   * means the WHOLE subtree, not the host's own children.
   *
   * The run that paints the glyphs is a grandchild — the host holds a single
   * content view, and the runs live inside that — so walking one level deep
   * reached the content view and never the text. A run whose layer had not
   * displayed yet contributed nothing, and the capture came back as background
   * with no glyphs in it: a cover that pastes a blank over the link, which is a
   * hole by another name. It survived the emptiness check precisely because a
   * background is not empty.
   */
  EXPDisplayIfNeededRecursively(view);

  UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat preferredFormat];
  format.opaque = NO;
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:bounds.size format:format];
  UIImage *__result = [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
    CGContextTranslateCTM(context.CGContext, -bounds.origin.x, -bounds.origin.y);
    CGContextBeginPath(context.CGContext);
    for (NSValue *value in rects) {
      CGContextAddRect(context.CGContext, value.CGRectValue);
    }
    CGContextClip(context.CGContext);

    /*
     * The host's OWN layer first — its background — and then its subviews.
     *
     * This capture has to COVER what is underneath it, not merely show the same
     * glyphs, which is what lets the original keep being drawn. Rendering the
     * host's background is the whole difference between a stand-in that hides
     * the link and one that has to be helped by hiding it.
     */
    [view.layer renderInContext:context.CGContext];

    for (UIView *subview in view.subviews) {
      if (subview.hidden || subview.alpha <= 0.01) {
        continue;
      }
      const CGRect frameInHost = [subview convertRect:subview.bounds toView:view];
      if (!CGRectIntersectsRect(frameInHost, bounds)) {
        continue;
      }
      CGContextSaveGState(context.CGContext);
      CGContextTranslateCTM(context.CGContext, frameInHost.origin.x, frameInHost.origin.y);
      [subview.layer renderInContext:context.CGContext];
      CGContextRestoreGState(context.CGContext);
    }
  }];
  /*
   * A capture with nothing in it must never be used.
   *
   * The stand-in COVERS the link — that is what lets the original keep being
   * drawn — so an empty capture does not degrade to "no lift", it degrades to a
   * blank rectangle pasted over the link. A hole, in other words, and exactly
   * the symptom this design exists to make impossible.
   *
   * Rather than reason about every way a capture could come back empty (a layer
   * that has not displayed, content discarded under memory pressure, a run
   * mid-relayout), the result is checked. Uniform means nothing was drawn:
   * decline the lift, and the link is simply left alone.
   */
  return EXPImageHasContrast(__result) ? __result : nil;
}

#pragma mark - UIContextMenuInteractionDelegate

- (nullable UIContextMenuConfiguration *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
                                 configurationForMenuAtLocation:(CGPoint)location
{
  /*
   * NOTE: nothing is cleared here. Anything pending is given up only once we
   * know this query resolves to a DIFFERENT link — see below. Clearing first
   * looked tidier and created a race: the clear un-suppresses the run, the
   * repaint is asynchronous, and the capture taken immediately afterwards
   * recorded glyphs that had not been painted back yet.
   */
  NSMutableArray<NSValue *> *rects = [NSMutableArray array];
  UIView *sourceView = nil;
  id link = _resolver != nil ? _resolver(location, rects, &sourceView) : nil;
  if (link == nil) {
    // Returning nil is how a context menu is declined, and it is the answer for
    // every touch that is not on a link — including every touch on the ordinary
    // text around one. Long-press elsewhere behaves as it did. Whatever was
    // pending belonged to a menu that is not happening, so it is given up here
    // — a run left suppressed by it would keep a hole nothing would fill.
    [self _clearPending];
    //
    // `_pendingSourceView` is deliberately NOT assigned before this check.
    // Doing so meant a query that missed the link — the same drift described
    // above — nulled the source view mid-lift, after which suppressing and
    // un-suppressing both addressed nothing: the original glyphs kept being
    // painted under the lifted copy, so the link appeared twice, and it only
    // happened when a finger moved, which is why it looked intermittent.
    return nil;
  }
  /*
   * The SAME link, asked about again, keeps the capture it already has.
   *
   * This is the common case, not an edge one: a finger that drifts a few points
   * makes UIKit re-ask, and the answer is the same link. Rebuilding then was
   * actively harmful, because `_clearPending` above un-suppresses the run and
   * the repaint that follows is ASYNCHRONOUS — so the fresh capture, taken in
   * this same turn, recorded the run while its glyphs were still hidden. An
   * EMPTY chip over a HOLE, for as long as the menu was up.
   *
   * Measured on a 60fps device recording: four frames, ~67ms, unmistakable.
   * Reported as "the text not appearing in the chip if I move my finger
   * enough" — the "if I move" was the whole diagnosis.
   */
  if (_pendingLiftImage != nil && _pendingSourceView == sourceView &&
      [_pendingRects isEqualToArray:rects]) {
    return [self _configurationForResolvedLink:link];
  }

  [self _clearPending];
  _pendingSourceView = sourceView;

  _pendingRects = [rects copy];
  _pendingLiftBounds = CGRectZero;
  _pendingLiftImage = [self _liftImageForRects:_pendingRects bounds:&_pendingLiftBounds];
  return [self _configurationForResolvedLink:link];
}

/** The destination, and a menu built from it. Shared by both paths above. */
- (UIContextMenuConfiguration *)_configurationForResolvedLink:(id)link
{
  if ([link isKindOfClass:[NSURL class]]) {
    _pendingURL = link;
    _pendingRawHref = ((NSURL *)link).absoluteString;
  } else {
    _pendingURL = nil;
    _pendingRawHref = [link description];
  }

  __weak __typeof(self) weakSelf = self;
  return [UIContextMenuConfiguration
      configurationWithIdentifier:nil
                  previewProvider:nil
                   actionProvider:^UIMenu *(NSArray<UIMenuElement *> *suggested) {
                     return [weakSelf _menu];
                   }];
}

/*
 * The destination, whole and readable — which is what iOS shows.
 *
 * `-[_UITextLinkInteractionHandler _titleForLink:]`, read out of UIKitCore, is
 * one line: `return [url _web_userVisibleString]`. That is WebKit's
 * user-visible form of the WHOLE url — percent-escapes decoded, an
 * internationalised host in its own script — handed to `menuWithTitle:`
 * unshortened. The platform's answer to "how much of a link does a link menu
 * show" is: all of it, readably.
 *
 * This showed only the host for a while, to stop a two-line header from
 * re-measuring and restarting the menu's entrance animation. That was wrong on
 * both counts. A three-way probe on the simulator — the same menu with no
 * title, a short one, and a full URL, nothing else different — grew
 * monotonically and settled in every case; the titled menus were simply taller
 * (222pt / 262pt / 278pt, the full URL wrapping to a second line and costing
 * one line's height). A title does not make a menu re-animate. The menu is also
 * far wider than its widest action, so the twenty-character budget was
 * measuring nothing.
 *
 * `stringByRemovingPercentEncoding` is the public half of what WebKit does. The
 * rest of `_web_userVisibleString` — IDN, and the escaping it keeps for
 * spoofable scripts — has no public equivalent, so a host Safari would show in
 * its own script stays in punycode here.
 * DOM-CSS-LIMITATION(link-title-is-not-idn-decoded).
 */
static NSString *RCTMenuTitleForHref(NSString *_Nullable href);

/*
 * Reachable from the unit tests, which is the only other thing that should know
 * this exists. Kept out of the header: how the destination is written is an
 * implementation detail of the menu, not part of the interaction's surface.
 */
NSString *RCTMenuTitleForHrefForTesting(NSString *_Nullable href);
NSString *RCTMenuTitleForHrefForTesting(NSString *_Nullable href)
{
  return RCTMenuTitleForHref(href);
}

static NSString *RCTMenuTitleForHref(NSString *_Nullable href)
{
  if (href.length == 0) {
    return @"";
  }
  // Decoding can fail — an href is author input and need not be valid
  // percent-encoded UTF-8 — and the raw string is the right answer when it does.
  return href.stringByRemovingPercentEncoding ?: href;
}

- (UIMenu *)_menu
{
  __weak __typeof(self) weakSelf = self;
  NSMutableArray<UIMenuElement *> *actions = [NSMutableArray array];
  NSURL *url = _pendingURL;
  NSString *raw = _pendingRawHref;

  if (url != nil) {
    // The system's own titles and glyphs, so the menu reads like every other
    // link menu on the device rather than like this app's idea of one.
    [actions addObject:[UIAction actionWithTitle:@"Open"
                                           image:[UIImage systemImageNamed:@"safari"]
                                      identifier:nil
                                         handler:^(__unused UIAction *action) {
                                           [RCTSharedApplication() openURL:url options:@{} completionHandler:nil];
                                         }]];
  }

  if (raw.length > 0) {
    [actions addObject:[UIAction actionWithTitle:@"Copy Link"
                                           image:[UIImage systemImageNamed:@"doc.on.doc"]
                                      identifier:nil
                                         handler:^(__unused UIAction *action) {
                                           UIPasteboard.generalPasteboard.string = raw;
                                         }]];
  }

  if (url != nil) {
    [actions addObject:[UIAction actionWithTitle:@"Share…"
                                           image:[UIImage systemImageNamed:@"square.and.arrow.up"]
                                      identifier:nil
                                         handler:^(__unused UIAction *action) {
                                           [weakSelf _share:url];
                                         }]];
  }

  return [UIMenu menuWithTitle:RCTMenuTitleForHref(raw) children:actions];
}

- (void)_share:(NSURL *)url
{
  UIView *view = _view;
  UIViewController *presenter = RCTPresentedViewController();
  if (view == nil || presenter == nil) {
    return;
  }
  UIActivityViewController *share = [[UIActivityViewController alloc] initWithActivityItems:@[ url ]
                                                                     applicationActivities:nil];
  // Required on iPad, where a share sheet is a popover and has to be anchored
  // to something; without this it raises rather than presenting.
  share.popoverPresentationController.sourceView = view;
  share.popoverPresentationController.sourceRect = [self _unionOfPendingRects];
  [presenter presentViewController:share animated:YES completion:nil];
}

- (CGRect)_unionOfPendingRects
{
  CGRect union_ = CGRectNull;
  for (NSValue *value in _pendingRects) {
    union_ = CGRectIsNull(union_) ? value.CGRectValue : CGRectUnion(union_, value.CGRectValue);
  }
  return CGRectIsNull(union_) ? CGRectZero : union_;
}

/*
 * The LIFT: what the OS peels off the page and floats above the blur.
 *
 * Without this, UIKit previews the whole host view — for a link in a paragraph
 * that means the entire paragraph, and often the entire screen, rises up. What
 * should rise is the link.
 *
 * ## The shape is UIKit's, not ours
 *
 * `UIPreviewParameters(textLineRects:)` exists for exactly this: it takes the
 * per-line rects of a text range and produces the shape iOS lifts text with —
 * the corner radius, the inset, and the way consecutive lines join into one
 * continuous form rather than a stack of separate rounded boxes. It is what a
 * text view's own link preview is built from.
 *
 * Hand-rolling it — `bezierPathWithRoundedRect:cornerRadius:4` per rect, unioned
 * — is what this did first, and it looked like a near-miss of the real thing:
 * right idea, wrong radii, wrong joins, and a visible box around each line.
 * Reported as "the way the link pops out is non-native", which it was.
 *
 * ## Hiding the source happens HERE
 *
 * This method is called as the lift begins, which makes it the only correct
 * moment to stop painting the glyphs underneath. Doing it later — when the menu
 * commits — leaves the original visible *through the whole lift animation*, so
 * the link is briefly on screen twice.
 *
 * This paragraph once described machinery that had been DELETED, and the
 * deletion is what the second report of duplicated content was: a snapshot
 * floating over glyphs that never stopped being drawn, the copy softening as
 * UIKit scaled it up while the original stayed sharp underneath, and the whole
 * effect resolving to "sharp" the instant the copy went away. A comment
 * asserting behaviour is worth nothing if nothing tests it — see
 * `EXPTextLinkInteractionTests`, which now fails if the source is not
 * suppressed for the duration of a lift.
 */
- (nullable UITargetedPreview *)_liftPreview
{

  if (_pendingPreview != nil) {
    // Still being asked about, so still alive.
      return _pendingPreview;
  }

  UIView *view = _view;
  if (view == nil || _pendingLiftImage == nil || _pendingRects.count == 0) {
    /*
     * Declining is safe but NOT harmless, and it is worth saying so out loud.
     *
     * UIKit's fallback for a nil preview is to lift the whole interaction view
     * — for a link in a paragraph, the entire paragraph, often most of the
     * screen. That looks like a bug in the page rather than a missing preview
     * here, so nobody would trace it back to this method.
     *
     * A configuration was already accepted by the time this runs, so a link WAS
     * found: reaching here means the capture failed for a reason worth knowing
     * about, and the most likely future cause is a change in how the run view
     * renders. Debug-only, because in a shipped app there is nothing the user
     * can do and the fallback still shows a menu.
     */
#if RCT_DEBUG
    RCTLogWarn(
        @"<a href> lift declined: no snapshot to present (view=%@, image=%@, rects=%lu). "
        @"UIKit will lift the whole view instead.",
        view != nil ? @"ok" : @"nil",
        _pendingLiftImage != nil ? @"ok" : @"nil",
        (unsigned long)_pendingRects.count);
#endif
    return nil;
  }

  /*
   * NOTHING IS HIDDEN. This is the point of the whole design.
   *
   * The stand-in is an OPAQUE picture of the link and the background behind it,
   * laid exactly over the link — so the original keeps being drawn and is
   * simply covered. The alternative, hiding the real glyphs, is what every
   * earlier version did, and it created state that only UIKit could tell us to
   * undo. UIKit will not: there is no callback for an abandoned interaction and
   * `willEndForConfiguration:` is sent only sometimes. That is what produced a
   * hole in the paragraph and a blank chip, and what a watchdog was papering
   * over.
   *
   * Now both outcomes are correct rather than one being an error to recover
   * from. UIKit hides its preview view during the lift, and the real glyphs
   * show through underneath — right. UIKit abandons and never restores it, and
   * the real glyphs are still there — also right, with nothing to clean up.
   */

  EXPCoverView *lifted = [[EXPCoverView alloc] initWithImage:_pendingLiftImage];
  lifted.frame = CGRectMake(0, 0, _pendingLiftBounds.size.width, _pendingLiftBounds.size.height);
  /*
   * It is added to a view the renderer owns, so it declares itself furniture:
   * it takes no touches and it is invisible to assistive technology.
   *
   * Without the second line VoiceOver would find an unlabelled image floating
   * over the page for the length of the interaction, and the run's own
   * accessibility element — the one carrying the link's text and its `link`
   * trait — already says everything true about it.
   */
  __weak __typeof(self) weakSelf = self;
  ((EXPCoverLayer *)lifted.layer).onHiddenChanged = ^(BOOL hidden) {
    [weakSelf _coverHiddenChanged:hidden];
  };
  lifted.userInteractionEnabled = NO;
  lifted.isAccessibilityElement = NO;
  lifted.accessibilityElementsHidden = YES;

  /*
   * `initWithTextLineRects:` for the SHAPE, so the padding is Apple's.
   *
   * It outsets the path it builds — 14pt horizontally, 10pt vertically, corner
   * radius 13 — which is the breathing room a lifted link has on iOS and which
   * a path built from the raw rects does not have. Those numbers are not copied
   * here: they come from the initialiser, so a future iOS that changes them
   * changes this too.
   *
   * The rects are in the IMAGE's coordinates, which is what the parameters are
   * interpreted in once the image is the preview's view.
   */
  NSMutableArray<NSValue *> *lineRects = [NSMutableArray array];
  for (NSValue *value in _pendingRects) {
    [lineRects addObject:[NSValue valueWithCGRect:CGRectOffset(value.CGRectValue,
                                                               -_pendingLiftBounds.origin.x,
                                                               -_pendingLiftBounds.origin.y)]];
  }
  UIPreviewParameters *parameters = [[UIPreviewParameters alloc] initWithTextLineRects:lineRects];

  /*
   * The lifted glyphs become a REAL VIEW, in the window, sitting exactly where
   * the link is — and UIKit is handed that, with no explicit target.
   *
   * This is the shape `UITargetedPreview` is built around: given a view it can
   * see, UIKit hides it, animates its own copy, and puts it back. That single
   * fact fixes both remaining faults. Across the highlight-to-menu handoff,
   * where UIKit tears its preview down and re-presents, it un-hides this view —
   * so the gap shows the link's own pixels in the link's own place instead of a
   * hole. And on dismissal the content animates back into position while only
   * the chip fades, which is what Messages does; before, UIKit emptied the chip
   * and left its opaque platter over a blank.
   *
   * It is parented to the RUN — see below for why that, and not the window.
   *
   * No `UIPreviewTarget`: with a view UIKit can see, its own position IS the
   * target, which is precisely what makes the return animation land on the
   * text rather than on a remembered centre.
   */
  /*
   * The stand-in is parented to the RUN, so it travels with the text.
   *
   * It used to go in the window, and that was wrong in a way only scrolling
   * showed: window coordinates do not move with content, so after dismissing a
   * menu and scrolling, UIKit animated the text back to where the link USED to
   * be, and the real glyphs reappearing a moment later read as a jump. Reported
   * exactly that way.
   *
   * The run view is the right parent for two reasons. It is in the same
   * coordinate space as the link, so scrolling is simply not a special case.
   * And it is a plain `UIView` rather than a Fabric component view — component
   * views mount their children BY INDEX (`mountChildComponentView:index:`), so
   * a foreign subview corrupts that bookkeeping; an earlier attempt put the
   * stand-in in the root component view and the lift stopped happening at all,
   * with nothing in the log to explain it.
   *
   * Not on screen means no lift, rather than a raise: `UITargetedPreview` RAISES
   * if its view is not in a window
   * (`BUG_IN_CLIENT_OF_TARGETED_PREVIEW__CONTAINER_IS_NOT_IN_A_WINDOW`), so a
   * paragraph unmounted between the touch and the lift would otherwise take the
   * app down over a long press. Painting must resume too, or the link stays
   * invisible for as long as the paragraph lives.
   */
  UIView *standInParent = _pendingSourceView ?: view;
  if (standInParent.window == nil) {
    return nil;
  }
  lifted.frame = [view convertRect:_pendingLiftBounds toView:standInParent];
  [standInParent addSubview:lifted];
  _pendingLiftedView = lifted;

  _pendingParameters = parameters;
  _pendingPreview = [self _targetedPreviewForStandIn:lifted parameters:parameters];
  return _pendingPreview;
}

/*
 * Aimed at where the stand-in is RIGHT NOW, inside a container that cannot clip.
 *
 * Two faults share this one cause. Left to itself,
 * `initWithView:parameters:` takes the view's own superview as the container —
 * and that superview is the text RUN, a box the size of a line. UIKit puts the
 * lift inside it, so the chip and its shadow were cut off against it. Naming
 * some ancestor instead only moves the question: you cannot assume an ancestor
 * is big enough. The window is the one container guaranteed to be, so it is
 * named explicitly.
 *
 * And because the centre is resolved HERE rather than remembered, asking again
 * later gives a different and correct answer — which is what makes a dismissal
 * after scrolling land on the link instead of on where the link used to be.
 */
- (nullable UITargetedPreview *)_targetedPreviewForStandIn:(UIView *)standIn
                                                parameters:(UIPreviewParameters *)parameters
{
  UIView *container = standIn.window;
  if (container == nil || standIn.superview == nil) {
    return nil;
  }
  const CGPoint center = [standIn.superview convertPoint:standIn.center toView:container];
  UIPreviewTarget *target = [[UIPreviewTarget alloc] initWithContainer:container center:center];
  return [[UITargetedPreview alloc] initWithView:standIn parameters:parameters target:target];
}

/*
 * FOUR callbacks, ONE preview.
 *
 * iOS 16 deprecated `previewForHighlightingMenuWithConfiguration:` and its
 * dismissing twin in favour of per-item variants. Implementing only the
 * deprecated pair is not merely untidy: on a current OS the lift is built from
 * the old callback and the MENU presentation resolves its preview through the
 * new one, which nothing answered — so UIKit substituted its own, and the thing
 * already on screen was exchanged for a different one at exactly the moment the
 * menu appeared. That is the reported "the pop out then replaces itself and
 * flickers", and caching alone could not have fixed it, because the two
 * previews were being asked for down two different paths.
 *
 * All four now return the one cached object, so every path UIKit can take
 * arrives at the same preview.
 *
 * The deprecated pair is COMPILED OUT once the deployment target reaches iOS
 * 16, where the replacements exist and these are dead weight. React Native's
 * floor is 15.1 today, so on that floor they are not merely allowed but
 * required — the per-item callbacks do not exist for UIKit to call. Writing the
 * condition rather than a comment means the day the floor moves, the dependency
 * on a deprecated API removes itself, instead of waiting for someone to
 * remember it is here.
 *
 * MEASURED, not assumed: instrumenting all four and long-pressing a link on
 * iOS 26.5 logged `highlightPreviewForItemWithIdentifier:` and
 * `dismissalPreviewForItemWithIdentifier:` exactly once each, and the
 * deprecated pair ZERO times. A modern OS never touches them — they are reached
 * only on a system old enough to have nothing else, which is precisely the
 * shape a deprecated fallback should have.
 */
#if !defined(__IPHONE_OS_VERSION_MIN_REQUIRED) || __IPHONE_OS_VERSION_MIN_REQUIRED < 160000

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-implementations"

- (nullable UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
           previewForHighlightingMenuWithConfiguration:(UIContextMenuConfiguration *)configuration
{
  return [self _liftPreview];
}

- (nullable UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
             previewForDismissingMenuWithConfiguration:(UIContextMenuConfiguration *)configuration
{
  // The same shape going back down as coming up, so the link settles onto the
  // glyphs it came from instead of fading in place.
  return [self _liftPreview];
}

#pragma clang diagnostic pop

#endif // deployment target below iOS 16

- (nullable UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
                                         configuration:(UIContextMenuConfiguration *)configuration
                 highlightPreviewForItemWithIdentifier:(id<NSCopying>)identifier
{
  return [self _liftPreview];
}

- (nullable UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
                                         configuration:(UIContextMenuConfiguration *)configuration
                 dismissalPreviewForItemWithIdentifier:(id<NSCopying>)identifier
{
  return [self _dismissalPreview];
}

/*
 * Rebuilt against the CURRENT position, unlike the lift.
 *
 * The stand-in travels with the text, so after a scroll it is somewhere new,
 * and the preview UIKit needs on the way out has to aim there rather than at
 * where the link was when the menu opened. Handing back the remembered one made
 * the text fly to its pre-scroll position and then jump into place when the
 * real glyphs were painted again.
 *
 * Same view and same shape as the lift; only the target is recomputed, so there
 * is nothing for UIKit to swap.
 */
- (nullable UITargetedPreview *)_dismissalPreview
{
  if (_pendingLiftedView == nil || _pendingParameters == nil) {
    return [self _liftPreview];
  }
  return [self _targetedPreviewForStandIn:_pendingLiftedView parameters:_pendingParameters]
      ?: _pendingPreview;
}

/*
 * Once the menu is up, the glyphs are painted again — and the lifted copy sits
 * over them, so nothing shows twice.
 *
 * This is a mitigation, and the thing it mitigates is UIKit's, not ours.
 * Recorded at 60fps: UIKit TEARS DOWN the highlight preview and re-presents it
 * for the menu, replaying the lift from the source. Between the two there is a
 * window with our preview gone. Whatever the source is doing in that window is
 * what the user sees, and while it stayed suppressed the answer was a blank gap
 * where the link should be.
 *
 * Painting from here shrinks that window from six frames to two on the same
 * measurement. It cannot close it completely: the remaining frames are before
 * this callback runs, and there is no earlier signal that the lift has landed.
 *
 * Showing the source this early is safe, and is arguably what the platform
 * does anyway — a real `UITextView` settles its lifted text back onto the line
 * and marks it with a plain highlight while its menu is open, rather than
 * keeping it floating.
 */
- (void)contextMenuInteraction:(UIContextMenuInteraction *)interaction
    willDisplayMenuForConfiguration:(UIContextMenuConfiguration *)configuration
                       animator:(nullable id<UIContextMenuInteractionAnimating>)animator
{
  // The menu is up, so the touch ending no longer implies the lift is over.
  // Nothing else to do: the stand-in holds the link's place for the duration.
  _menuDisplayed = YES;
}

- (void)contextMenuInteraction:(UIContextMenuInteraction *)interaction
       willEndForConfiguration:(UIContextMenuConfiguration *)configuration
                      animator:(nullable id<UIContextMenuInteractionAnimating>)animator
{
  /*
   * Nothing is repainted here. The stand-in view is still standing where the
   * link is and UIKit is animating its content back onto it, so putting the
   * real glyphs back now would show them twice. Everything is given up in
   * `_clearPending` once the animation has finished.
   */
  if (animator != nil) {
    __weak __typeof(self) weakSelf = self;
    [animator addCompletion:^{
      [weakSelf _clearPending];
    }];
  } else {
    [self _clearPending];
  }
}

@end
