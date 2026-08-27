/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPTextLinkInteraction.h"

#import "EXPContextMenuGlass.h"
#import "EXPLinkPreviewCard.h"
#import "EXPSampledBackground.h"
#import "RCTAnonymousTextRunView.h"



/*
 * A view standing over the link while UIKit animates, and the preview aimed at
 * it. A press has two: the picture it lifts, and the empty view it dismisses
 * into.
 */
@interface EXPStandIn : NSObject
@property (nonatomic, strong, nullable) UIView *view;
@property (nonatomic, strong, nullable) UITargetedPreview *preview;
/** Where the preview was aimed, so a press that MOVES is noticed. */
@property (nonatomic, assign) CGPoint center;
@end

@implementation EXPStandIn
@end

/*
 * One press's worth of link, keyed by the configuration UIKit hands back.
 *
 * UIKit passes its callbacks only the configuration, so per-press state cannot
 * live in ivars: two presses overlap whenever the second begins before the
 * first's dismissal animation ends, and the first's teardown would clear what
 * the second had written.
 *
 * Getting that wrong is not a missing press but a wrong one. Given no preview,
 * UIKit lifts the view the interaction is installed on — here, the whole
 * paragraph.
 */
@interface EXPLinkPress : NSObject
/** The destination, when it is a URL we can act on. */
@property (nonatomic, strong, nullable) NSURL *url;
/** The `href` as authored — what Copy Link puts on the pasteboard. */
@property (nonatomic, copy, nullable) NSString *rawHref;
/** The link's line rects, in the link view's own coordinate space. */
@property (nonatomic, copy) NSArray<NSValue *> *rects;
/** The view that draws this link. Weak: the paragraph may recycle under us. */
@property (nonatomic, weak) UIView *linkView;
/** The preview handed to UIKit, kept so the same one can be handed back. */
@property (nonatomic, strong, nullable) UITargetedPreview *preview;
/** Where that preview was aimed, so a lift that MOVES is noticed. */
@property (nonatomic, assign) CGPoint previewCenter;
/** The empty stand-in the DISMISSAL morphs into — see `_vanishingPreviewForConfiguration:`. */
@property (nonatomic, strong, nullable) UIView *nothing;
@property (nonatomic, strong, nullable) UITargetedPreview *vanishing;
@property (nonatomic, assign) CGPoint vanishingCenter;
@end

@implementation EXPLinkPress

- (instancetype)init
{
  if (self = [super init]) {
    _lift = [EXPStandIn new];
    _dismissal = [EXPStandIn new];
  }
  return self;
}

@end

/*
 * A picture of a view, as a view.
 *
 * Drawn rather than snapshotted: `-snapshotViewAfterScreenUpdates:` returns nil
 * for anything the render server has not displayed, which includes every view in
 * a test. `-drawViewHierarchyInRect:` rather than `-[CALayer renderInContext:]`,
 * which draws the model layer and misses what UIKit renders for itself.
 */
static UIView *_Nullable EXPPictureOfView(UIView *view)
{
  const CGRect bounds = view.bounds;
  if (CGRectIsEmpty(bounds)) {
    return nil;
  }
  UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat preferredFormat];
  // Transparent, so a link keeps the page's colour behind its glyphs rather
  // than gaining a slab of black.
  format.opaque = NO;
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithBounds:bounds format:format];
  UIImage *image = [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
    [view drawViewHierarchyInRect:bounds afterScreenUpdates:NO];
  }];
  UIImageView *picture = [[UIImageView alloc] initWithImage:image];
  picture.bounds = bounds;
  // A picture takes no touches: the link beneath it is what the finger is on.
  picture.userInteractionEnabled = NO;
  return picture;
}

@implementation EXPTextLinkInteraction {
  __weak UIView *_view;
  EXPTextLinkResolver _resolver;
  UIContextMenuInteraction *_interaction;
  /*
   * Every live press. Keys are weak, so an interaction UIKit abandons — which it
   * does silently, with no `willEnd` — takes its entry with it.
   */
  NSMapTable<UIContextMenuConfiguration *, EXPLinkPress *> *_pressesByConfiguration;
  /*
   * The press whose stand-ins are in the window: the picture it lifts and the
   * empty view it dismisses into.
   *
   * Held here rather than by the entry that made them. `_pressesByConfiguration`
   * has weak keys, and a zeroed key does not promptly release the strong value
   * beside it, so an entry can outlive the press it belongs to.
   */
  EXPLinkPress *_pressInWindow;
}

- (instancetype)initWithView:(UIView *)view resolver:(EXPTextLinkResolver)resolver
{
  if (self = [super init]) {
    _view = view;
    _resolver = [resolver copy];
    _pressesByConfiguration = [NSMapTable weakToStrongObjectsMapTable];
  }
  return self;
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
  } else {
    // A menu still on screen belongs to text that is being recycled onto
    // something else.
    [self dismissMenuIfPresenting];
    [view removeInteraction:_interaction];
    _interaction = nil;
  }
}

- (void)dismissMenuIfPresenting
{
  [_interaction dismissMenu];
  [self _takeStandInsOutUnless:nil];
  // Nothing to unwind, and nothing to time: an entry lives exactly as long as
  // the configuration it is keyed by. See `_pressesByConfiguration`.
  [_pressesByConfiguration removeAllObjects];
}

- (nullable UIContextMenuConfiguration *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
                                 configurationForMenuAtLocation:(CGPoint)location
{
  UIView *view = _view;
  NSMutableArray<NSValue *> *rects = [NSMutableArray array];
  UIView *linkView = nil;
  id link = (_resolver != nil && view != nil) ? _resolver(location, rects, &linkView) : nil;
  if (link == nil || linkView == nil) {
    // Declining is how a context menu is refused, and it is the answer for
    // every touch that is not on a link — including every touch on the
    // ordinary text around one.
    return nil;
  }

  EXPLinkPress *press = [EXPLinkPress new];
  press.linkView = linkView;
  if ([link isKindOfClass:[NSURL class]]) {
    press.url = link;
    press.rawHref = ((NSURL *)link).absoluteString;
  } else {
    press.rawHref = [link description];
  }
  // Into the link view's own space: `UIPreviewParameters` interprets its rects
  // relative to the view the preview is built from.
  NSMutableArray<NSValue *> *local = [NSMutableArray arrayWithCapacity:rects.count];
  for (NSValue *value in rects) {
    [local addObject:[NSValue valueWithCGRect:[view convertRect:value.CGRectValue toView:linkView]]];
  }
  lift.rects = local;

  UIContextMenuConfiguration *configuration = [self _configurationForPress:press];
  [_pressesByConfiguration setObject:press forKey:configuration];
  return configuration;
}

/** The destination, and a menu built from it. */
- (UIContextMenuConfiguration *)_configurationForPress:(EXPLinkPress *)press
{
  __weak __typeof(self) weakSelf = self;
  return [UIContextMenuConfiguration configurationWithIdentifier:nil
      previewProvider:^UIViewController * {
        return [EXPLinkPreviewCard cardForURL:press.url];
      }
      actionProvider:^UIMenu *(NSArray<UIMenuElement *> *suggested) {
        // The press is captured, not looked up: the menu is this
        // press's menu, and there is no moment at which it should
        // be built from anything else.
        return [weakSelf _menuForPress:press];
      }];
}

/*
 * The destination, whole and readable, which is what iOS shows:
 * `-[_UITextLinkInteractionHandler _titleForLink:]` returns WebKit's
 * user-visible form of the entire URL — percent-escapes decoded, unshortened.
 *
 * `stringByRemovingPercentEncoding` is the public half of that. The rest — IDN,
 * and the escaping WebKit keeps for spoofable scripts — has no public
 * equivalent, so a host Safari would show in its own script stays in punycode.
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

- (UIMenu *)_menuForPress:(EXPLinkPress *)press
{
  __weak __typeof(self) weakSelf = self;
  NSMutableArray<UIMenuElement *> *actions = [NSMutableArray array];
  NSURL *url = press.url;
  NSString *raw = press.rawHref;

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
                                           [weakSelf _share:url fromPress:press];
                                         }]];
  }

  /*
   * No title. The card above the menu already names the site and the address,
   * and a menu that repeated it would say the destination twice — which iOS
   * does not: with a preview present, its link menu carries no header at all.
   */
  return [UIMenu menuWithTitle:@"" children:actions];
}

- (void)_share:(NSURL *)url fromPress:(EXPLinkPress *)press
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
  share.popoverPresentationController.sourceRect = [self _unionOfRectsForPress:press inView:view];
  [presenter presentViewController:share animated:YES completion:nil];
}

/** The link's rects, in `view`'s space — the anchor a popover needs. */
- (CGRect)_unionOfRectsForPress:(EXPLinkPress *)press inView:(UIView *)view
{
  UIView *linkView = press.linkView;
  CGRect union_ = CGRectNull;
  for (NSValue *value in press.rects) {
    const CGRect rect = linkView != nil ? [linkView convertRect:value.CGRectValue toView:view] : value.CGRectValue;
    union_ = CGRectIsNull(union_) ? rect : CGRectUnion(union_, rect);
  }
  return CGRectIsNull(union_) ? CGRectZero : union_;
}

/*
 * How the press is dressed.
 *
 * UIKit does not render a view's background into a preview. It renders the
 * contents — layers, borders, subviews — and fills behind them with
 * `parameters.backgroundColor`, substituting a light platter when that is nil.
 * A view whose whole appearance is its background therefore lifts as a blank
 * chip unless the colour is handed over.
 *
 * Glyphs instead get `initWithTextLineRects:`, which supplies the padding, the
 * corner radius, the platter colour and the way wrapped lines join into one
 * shape.
 */
- (UIPreviewParameters *)_parametersForLift:(UIView *)linkView rects:(NSArray<NSValue *> *)rects
{
  if ([RCTAnonymousTextRunView isLinkGlyphView:linkView]) {
    return [[UIPreviewParameters alloc] initWithTextLineRects:rects];
  }

  UIPreviewParameters *parameters = [[UIPreviewParameters alloc] init];
  // The view's own silhouette, corners included, so a rounded box does not lift
  // as a square one.
  parameters.visiblePath = [UIBezierPath bezierPathWithRoundedRect:linkView.bounds
                                                      cornerRadius:linkView.layer.cornerRadius];
  /*
   * The view's own colour, read off the LAYER: Fabric sets
   * `layer.backgroundColor` and leaves the UIView property nil.
   *
   * Clear when it has none, and not the sampled colour:
   * `EXPSampledBackgroundColor` censuses the pixels inside the link's rects,
   * which for a picture is the picture, so filling a logo's transparent corners
   * with its own dark lifts it as a square. Clear costs nothing — the copy's
   * transparent parts sit over the original's.
   */
  UIColor *own = nil;
  CGColorRef layerColor = linkView.layer.backgroundColor;
  if (layerColor != NULL && CGColorGetAlpha(layerColor) > 0.99) {
    own = [UIColor colorWithCGColor:layerColor];
  }
  parameters.backgroundColor = own ?: UIColor.clearColor;
  return parameters;
}

/*
 * The press is a picture of the link, standing exactly over it.
 *
 * `UITargetedPreview` hides the view it is given for as long as the interaction
 * lasts, so handing over the link itself takes the words out of the paragraph —
 * invisible under the chip, and a hole in the sentence as soon as the preview
 * card is dragged aside. Hiding a picture that stands over the link changes
 * nothing on screen, and the link underneath keeps drawing.
 *
 * The container is the WINDOW. Left to itself the target would be the view's
 * superview — a text run, one line tall — and the chip and its shadow would be
 * clipped against it.
 */
- (nullable UITargetedPreview *)_liftPreviewForConfiguration:(UIContextMenuConfiguration *)configuration
{
  EXPLinkPress *press = [_pressesByConfiguration objectForKey:configuration];
  if (press.rects.count == 0) {
    // Not one of ours. Answering anyway would press whatever the paragraph is
    // showing now, which is worse than saying nothing.
    return nil;
  }
  return [self _previewOf:press.lift forPress:press parameters:[self _parametersForPress:press]];
}

/*
 * The dismissal has nothing to draw.
 *
 * A dismissal is a morph, and UIKit draws the "from" and "to" states together
 * and cross-fades them. Morphing back into a picture of the link puts two copies
 * of the same words on screen, a few points apart, for the length of the flight
 * — measured with the page's own link hidden, so it is UIKit's cross-fade and
 * not ours.
 *
 * With nothing to become, the card fades out over words that never moved. The
 * empty view is the link's size so the morph ends where the words are rather
 * than shrinking to a point, and wears no platter: a coloured rectangle fading
 * out over the link would be the same interruption in another colour.
 */
- (nullable UITargetedPreview *)_dismissalPreviewForConfiguration:(UIContextMenuConfiguration *)configuration
{
  EXPLinkPress *press = [_pressesByConfiguration objectForKey:configuration];
  UIView *linkView = press.linkView;
  if (linkView == nil) {
    return nil;
  }
  if (press.dismissal.view == nil) {
    press.dismissal.view = [[UIView alloc] initWithFrame:linkView.bounds];
    press.dismissal.view.userInteractionEnabled = NO;
  }

  UIPreviewParameters *parameters = [[UIPreviewParameters alloc] init];
  parameters.backgroundColor = UIColor.clearColor;
  return [self _previewOf:press.dismissal forPress:press parameters:parameters];
}

/*
 * Puts a stand-in over the link and aims a preview at it.
 *
 * The same object is handed back while it still describes the same press. UIKit
 * asks twice across one interaction, once for the press and once for the
 * dismissal, and the two answers are the ends of one animation; a second object
 * makes UIKit tear the effect down and cross-fade to the new one, which reads as
 * a second chip ghosting behind the first. It is rebuilt when the link MOVES,
 * because scrolling with the menu open would otherwise send the words back to
 * where they used to be.
 *
 * The container is the WINDOW. Left to itself the target would be the view's
 * superview — a text run, one line tall — and the chip and its shadow would be
 * clipped against it.
 */
- (nullable UITargetedPreview *)_previewOf:(EXPStandIn *)standIn
                                  forPress:(EXPLinkPress *)press
                                parameters:(UIPreviewParameters *)parameters
{
  UIView *linkView = press.linkView;
  UIWindow *window = linkView.window;
  if (window == nil) {
    // `UITargetedPreview` raises if its container is not in a window, so a
    // paragraph unmounted between the touch and the press would take the app down
    // over a long press.
    return nil;
  }

  const CGPoint center = [linkView.superview convertPoint:linkView.center toView:window];
  if (standIn.preview != nil && fabs(standIn.center.x - center.x) < 0.5 && fabs(standIn.center.y - center.y) < 0.5) {
    return standIn.preview;
  }

  UIPreviewParameters *parameters = [self _parametersForLift:linkView rects:lift.rects];
  UIPreviewTarget *target = [[UIPreviewTarget alloc] initWithContainer:window center:center];
  standIn.preview = [[UITargetedPreview alloc] initWithView:shown parameters:parameters target:target];
  standIn.center = center;
  return standIn.preview;
}

#if !defined(__IPHONE_OS_VERSION_MIN_REQUIRED) || __IPHONE_OS_VERSION_MIN_REQUIRED < 160000

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-implementations"

- (nullable UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
           previewForHighlightingMenuWithConfiguration:(UIContextMenuConfiguration *)configuration
{
  return [self _liftPreviewForConfiguration:configuration];
}

- (nullable UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
             previewForDismissingMenuWithConfiguration:(UIContextMenuConfiguration *)configuration
{
  return [self _liftPreviewForConfiguration:configuration];
}

#pragma clang diagnostic pop

#endif // deployment target below iOS 16

- (nullable UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
                                         configuration:(UIContextMenuConfiguration *)configuration
                 highlightPreviewForItemWithIdentifier:(id<NSCopying>)identifier
{
  return [self _liftPreviewForConfiguration:configuration];
}

- (nullable UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
                                         configuration:(UIContextMenuConfiguration *)configuration
                 dismissalPreviewForItemWithIdentifier:(id<NSCopying>)identifier
{
  return [self _dismissalPreviewForConfiguration:configuration];
}

/*
 * The card is a link too: a press ending on the preview rather than on an action
 * means "go there", as it does in Safari, Mail and Messages.
 */
- (void)contextMenuInteraction:(UIContextMenuInteraction *)interaction
    willPerformPreviewActionForMenuWithConfiguration:(UIContextMenuConfiguration *)configuration
                                            animator:(id<UIContextMenuInteractionCommitAnimating>)animator
{
  NSURL *url = [_pressesByConfiguration objectForKey:configuration].url;
  if (url == nil) {
    return;
  }
  // After the menu has gone, so the app is not opened out from under a
  // dismissal that is still animating.
  [animator addCompletion:^{
    [RCTSharedApplication() openURL:url options:@{} completionHandler:nil];
  }];
}

- (void)contextMenuInteraction:(UIContextMenuInteraction *)interaction
       willEndForConfiguration:(UIContextMenuConfiguration *)configuration
                      animator:(nullable id<UIContextMenuInteractionAnimating>)animator
{
  /*
   * This press's entry, and only once its animation is done: the dismissal preview
   * is still answered from it.
   *
   * Naming the configuration is what makes deferring safe — a press beginning
   * during this dismissal has its own entry, which this completion cannot reach.
   * Dropping it is not merely tidiness: a zeroed weak key does not promptly
   * release the strong value beside it.
   */
  if (animator != nil) {
    __weak __typeof(self) weakSelf = self;
    EXPHoldContextMenuGlassDown(_view.window, animator);
    [animator addCompletion:^{
      // Through a method, so an interaction that outlives its view sends this
      // to nil rather than reaching through a released object's ivars.
      [weakSelf _forgetPressForConfiguration:configuration];
    }];
  } else {
    [self _forgetPressForConfiguration:configuration];
  }
}

- (void)_forgetPressForConfiguration:(UIContextMenuConfiguration *)configuration
{
  // The picture goes with the press that took it. Removed rather than hidden: it
  // is a picture of a paragraph that is free to change, and a stale one left in
  // the window would be a copy of text that is no longer there.
  EXPLinkPress *press = [_pressesByConfiguration objectForKey:configuration];
  if (press != nil && press == _pressInWindow) {
    [self _takeStandInsOutUnless:nil];
  }
  [_pressesByConfiguration removeObjectForKey:configuration];
}

/** Takes a press's stand-ins out of the window, unless the press is `keep`. */
- (void)_takeStandInsOutUnless:(nullable EXPLinkPress *)keep
{
  if (_pressInWindow == nil || _pressInWindow == keep) {
    return;
  }
  [_pressInWindow.lift.view removeFromSuperview];
  [_pressInWindow.dismissal.view removeFromSuperview];
  _pressInWindow = nil;
}

- (void)dealloc
{
  // Nothing else is left to notice. A picture outliving the interaction that
  // made it would be a copy of a paragraph hanging over a page that has moved on.
  UIView *picture = _pressInWindow.lift.view;
  UIView *nothing = _pressInWindow.dismissal.view;
  if (picture != nil || nothing != nil) {
    RCTExecuteOnMainQueue(^{
      [picture removeFromSuperview];
      [nothing removeFromSuperview];
    });
  }
}

@end
