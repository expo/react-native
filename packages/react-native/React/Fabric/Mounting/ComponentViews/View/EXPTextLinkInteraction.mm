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

#import <React/RCTUtils.h>

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
/** What the lift shows: a picture of the link, taken before anything dimmed. */
@property (nonatomic, strong) EXPStandIn *lift;
/** What the dismissal morphs into: nothing, at the link's size and place. */
@property (nonatomic, strong) EXPStandIn *dismissal;
/** The colour the link sat on, sampled before the press dimmed anything. */
@property (nonatomic, strong, nullable) UIColor *platterColor;
/*
 * The box the lift shows, in `linkView`'s own coordinates — `CGRectNull` when
 * that is simply the view's bounds.
 *
 * It is set when the view handed over draws MORE than the link and no smaller
 * view is the link: `<a><img>caption</a>`, whose two halves are drawn by a
 * mounted subview and by the text run, so the only thing drawing both is the
 * container. A picture of the container's whole bounds is a picture of the
 * page, aimed at the middle of the page — so the picture is clipped to this box
 * and aimed at it instead.
 */
@property (nonatomic, assign) CGRect liftBox;
@end

/*
 * The card a link whose content is a PICTURE morphs into: that picture, at the
 * size it already had.
 *
 * A context menu morphs its lift into whatever it presents, so the lift needs a
 * destination — and for a link made of words that destination is `LPLinkView`,
 * the platform's own link preview. For a link that IS an image, it is not:
 * lifting a 70pt logo and then replacing it with a URL pill twice its width
 * reads as the chip jumping, which is what a device showed. iOS previews an
 * image link by previewing the image, and so does this.
 *
 * The picture is a second copy, not the lift's own: that one is UIKit's for the
 * duration of the interaction.
 */
@interface EXPLinkContentCard : UIViewController
+ (nullable instancetype)cardShowing:(nullable UIView *)picture ofSize:(CGSize)size;
@end

@implementation EXPLinkContentCard {
  UIView *_picture;
  CGSize _size;
}

+ (nullable instancetype)cardShowing:(nullable UIView *)picture ofSize:(CGSize)size
{
  if (picture == nil || size.width <= 0 || size.height <= 0) {
    return nil;
  }
  EXPLinkContentCard *card = [[EXPLinkContentCard alloc] initWithNibName:nil bundle:nil];
  card->_picture = picture;
  card->_size = size;
  card.preferredContentSize = size;
  return card;
}

- (void)viewDidLoad
{
  [super viewDidLoad];
  // Clear, so the card is the picture and not a platter behind it.
  self.view.backgroundColor = UIColor.clearColor;
  _picture.frame = CGRectMake(0, 0, _size.width, _size.height);
  [self.view addSubview:_picture];
}

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
/*
 * A picture of PART of a view, as a view of that part's size.
 *
 * The context is translated so the requested box lands at the origin: the
 * result is the box, not the view with the box somewhere inside it. That
 * matters because a `UITargetedPreview` is placed by its own centre — a picture
 * carrying the whole page would be aimed at the page's middle however it were
 * masked afterwards.
 */
static UIView *_Nullable EXPPictureOfViewRect(UIView *view, CGRect box)
{
  if (CGRectIsEmpty(box)) {
    return nil;
  }
  UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat preferredFormat];
  format.opaque = NO;
  const CGRect bounds = CGRectMake(0, 0, box.size.width, box.size.height);
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithBounds:bounds format:format];
  UIImage *image = [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
    CGContextTranslateCTM(context.CGContext, -box.origin.x, -box.origin.y);
    [view drawViewHierarchyInRect:view.bounds afterScreenUpdates:NO];
  }];
  UIImageView *picture = [[UIImageView alloc] initWithImage:image];
  picture.bounds = bounds;
  // A picture takes no touches: the link beneath it is what the finger is on.
  picture.userInteractionEnabled = NO;
  return picture;
}

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
  press.rects = local;
  /*
   * Sampled now, before anything dims. By the time UIKit asks for the press the
   * page is dimming and the chip is rising, and the same link reports a different
   * colour at each of those moments.
   */
  press.platterColor = EXPSampledBackgroundColor(linkView, local);
  /*
   * Taken now for the same reason: a picture taken later catches the page mid-dim
   * and the row mid-highlight.
   */
  /*
   * When the container itself was handed back, no single child is the link, and
   * the lift is the link's own box within it rather than the whole container.
   */
  press.liftBox = CGRectNull;
  if (linkView == self->_view && local.count > 0) {
    CGRect box = CGRectNull;
    for (NSValue *value in local) {
      box = CGRectIsNull(box) ? value.CGRectValue : CGRectUnion(box, value.CGRectValue);
    }
    press.liftBox = box;
  }
  press.lift.view = CGRectIsNull(press.liftBox) ? EXPPictureOfView(linkView)
                                                : EXPPictureOfViewRect(linkView, press.liftBox);

  UIContextMenuConfiguration *configuration = [self _configurationForPress:press];
  [_pressesByConfiguration setObject:press forKey:configuration];
  return configuration;
}

/*
 * A card showing the link's own content, for a link whose content is a view.
 *
 * Nil for a link made of glyphs, and nil for one drawn by its container (an
 * image AND words): the first has no picture of its own to show, and the second
 * is a region rather than a thing, so the platform's link preview is the better
 * destination for both.
 */
- (nullable UIViewController *)_contentCardForPress:(EXPLinkPress *)press
{
  UIView *linkView = press.linkView;
  if (linkView == nil || linkView == _view || !CGRectIsNull(press.liftBox)) {
    return nil;
  }
  if ([RCTAnonymousTextRunView isLinkGlyphView:linkView]) {
    return nil;
  }
  // A SECOND picture: the lift's own belongs to UIKit for the interaction.
  UIView *picture = EXPPictureOfView(linkView);
  return [EXPLinkContentCard cardShowing:picture ofSize:linkView.bounds.size];
}

/** The destination, and a menu built from it. */
- (UIContextMenuConfiguration *)_configurationForPress:(EXPLinkPress *)press
{
  __weak __typeof(self) weakSelf = self;
  return [UIContextMenuConfiguration configurationWithIdentifier:nil
      previewProvider:^UIViewController * {
        /*
         * A link that IS a picture previews as that picture, at the size it
         * already had, so the menu's morph has nothing to travel: the chip is
         * the image before and after. A link made of WORDS has no such
         * destination of its own and gets `LPLinkView`, the platform's own link
         * preview — the same one the system's own apps draw.
         *
         * Getting this wrong is visible rather than subtle. A 70pt logo lifting
         * and then being replaced by a URL pill twice its width was reported
         * from a device as the chip suddenly jumping to something larger than
         * the view it came from.
         */
        UIViewController *content = [weakSelf _contentCardForPress:press];
        return content ?: [EXPLinkPreviewCard cardForURL:press.url];
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
 * `src` composited over `dst`, so a translucent surface can be handed to a
 * preview as one opaque colour.
 *
 * Returns nil when there is nothing to composite onto — a caller with no
 * sampled page colour is better off with UIKit's own platter than with a
 * colour invented here.
 */
static UIColor *_Nullable EXPColorOver(UIColor *src, UIColor *_Nullable dst)
{
  if (dst == nil) {
    return nil;
  }
  CGFloat sr, sg, sb, sa, dr, dg, db, da;
  if (![src getRed:&sr green:&sg blue:&sb alpha:&sa] || ![dst getRed:&dr green:&dg blue:&db alpha:&da]) {
    return nil;
  }
  const CGFloat a = sa + da * (1 - sa);
  if (a <= 0) {
    return nil;
  }
  return [UIColor colorWithRed:(sr * sa + dr * da * (1 - sa)) / a
                         green:(sg * sa + dg * da * (1 - sa)) / a
                          blue:(sb * sa + db * da * (1 - sa)) / a
                         alpha:a];
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
- (UIPreviewParameters *)_parametersForPress:(EXPLinkPress *)press
{
  UIView *linkView = press.linkView;
  /*
   * The link's own shape, for a view that paints a whole RUN: the link is some
   * of its lines, and `initWithTextLineRects:` is what turns those into one
   * shape — the padding, the corner radius and the way wrapped lines join are
   * UIKit's.
   *
   * Only a run view qualifies. Anything else handed over here is a view whose
   * bounds ARE the link, because the preview is a picture of that view's whole
   * bounds, centred on that view (see `_previewOf:`). Hand over something
   * larger and the chip is a picture of everything around the link, placed
   * where that larger view sits — which is exactly what a container did.
   */
  const BOOL drawsMoreThanTheLink =
      [RCTAnonymousTextRunView isLinkGlyphView:linkView] || !CGRectIsNull(press.liftBox);
  if (drawsMoreThanTheLink && press.rects.count > 0) {
    /*
     * Rebased onto the picture. `press.rects` are in the link view's space; a
     * clipped picture starts at the link box's origin, so the shape has to be
     * expressed relative to that or the mask lands off the chip entirely.
     */
    NSArray<NSValue *> *shape = press.rects;
    if (!CGRectIsNull(press.liftBox)) {
      NSMutableArray<NSValue *> *rebased = [NSMutableArray arrayWithCapacity:press.rects.count];
      for (NSValue *value in press.rects) {
        [rebased addObject:[NSValue valueWithCGRect:CGRectOffset(value.CGRectValue,
                                                                 -press.liftBox.origin.x,
                                                                 -press.liftBox.origin.y)]];
      }
      shape = rebased;
    }
    UIPreviewParameters *parameters = [[UIPreviewParameters alloc] initWithTextLineRects:shape];
    // Everything else about a text press is UIKit's — the shape, the padding,
    // the corner radius, the way wrapped lines join. Only the platter COLOUR is
    // overridden, and only because UIKit's answer is the window's background
    // rather than this link's. Measured once, when the press began: see
    // `EXPSampledBackgroundColor` and `EXPLinkPress.platterColor`.
    if (press.platterColor != nil) {
      parameters.backgroundColor = press.platterColor;
    }
    return parameters;
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
  const CGFloat ownAlpha = layerColor != NULL ? CGColorGetAlpha(layerColor) : 0.0;
  if (ownAlpha > 0.99) {
    own = [UIColor colorWithCGColor:layerColor];
  } else if (ownAlpha > 0.0) {
    /*
     * A surface of its own, but a see-through one.
     *
     * UIKit does not render the view's background into the preview, so a
     * translucent one had nothing behind it and the chip lifted TRANSLUCENT:
     * the page slid under it and showed through, while a text link beside it
     * lifted on a solid platter. `display: block; background: #00000010` — a
     * tint, which is how anyone writes a pressable row — was exactly that.
     *
     * Composite the author's colour over the page's, which is what the eye
     * was seeing before the lift began.
     */
    own = EXPColorOver([UIColor colorWithCGColor:layerColor], press.platterColor);
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
    // The same box the lift used, so the menu shrinks back onto the link rather
    // than onto the container that happened to draw it.
    const CGRect box = CGRectIsNull(press.liftBox) ? linkView.bounds : press.liftBox;
    press.dismissal.view = [[UIView alloc] initWithFrame:CGRectMake(0, 0, box.size.width, box.size.height)];
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

  /*
   * Aimed at the LINK, which is the view's centre only when the view is the
   * link. With a clipped lift the picture is the link's box, so it has to be
   * placed over that box rather than over the middle of the container.
   */
  const CGPoint centerInLinkView = CGRectIsNull(press.liftBox)
      ? CGPointMake(CGRectGetMidX(linkView.bounds), CGRectGetMidY(linkView.bounds))
      : CGPointMake(CGRectGetMidX(press.liftBox), CGRectGetMidY(press.liftBox));
  const CGPoint center = [linkView convertPoint:centerInLinkView toView:window];
  if (standIn.preview != nil && fabs(standIn.center.x - center.x) < 0.5 && fabs(standIn.center.y - center.y) < 0.5) {
    return standIn.preview;
  }

  UIView *shown = standIn.view;
  if (shown == nil) {
    // No picture: the link itself, rather than no press at all, because an
    // unanswered preview makes UIKit press the whole paragraph. It is already in
    // place, so none of the positioning below applies.
    shown = linkView;
  } else {
    if (shown.superview != window) {
      // One stand-in at a time. A press beginning while another dismisses has
      // its own, and the earlier one has no work left.
      [self _takeStandInsOutUnless:press];
      [window addSubview:shown];
      _pressInWindow = press;
    }
    shown.center = center;
  }

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
 * means "go there", as it does in Safari and Mail.
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
