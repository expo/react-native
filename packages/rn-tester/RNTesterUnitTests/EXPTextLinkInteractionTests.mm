/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <XCTest/XCTest.h>

#import <React/EXPTextLinkInteraction.h>
#import <React/RCTAnonymousTextRunView.h>
#import <React/RCTViewComponentView.h>

/*
 * Declared, not implemented: this calls the real method at runtime and only
 * tells the compiler its shape. The alternative is widening a header for the
 * sake of a test.
 */
@interface RCTViewComponentView (EXPLinkContentTesting)
- (nullable UIView *)_viewForLinkContentInRects:(NSArray<NSValue *> *)rects
                                  fallingBackTo:(nullable UIView *)glyphView;
@end

/*
 * A menu animator that does not animate, so a test can decide WHEN the
 * dismissal finishes.
 *
 * UIKit defers a menu's teardown to the end of an animation, and the bug this
 * stands in for lives entirely in that gap: what happens if the next press
 * begins before the previous one's completion runs. Holding the completions and
 * running them on demand is what makes that a deterministic test rather than a
 * race nobody can aim at.
 */
@interface EXPStubMenuAnimator : NSObject <UIContextMenuInteractionAnimating>
- (void)runCompletions;
/** How many animation blocks were handed over — see the glass-fade test. */
@property (nonatomic, assign) NSUInteger animations;
@end

@implementation EXPStubMenuAnimator {
  NSMutableArray<void (^)(void)> *_completions;
}

- (instancetype)init
{
  if (self = [super init]) {
    _completions = [NSMutableArray array];
  }
  return self;
}

- (void)addAnimations:(void (^)(void))animations
{
  // Nothing here runs on a clock, so an animation block is simply the state the
  // dismissal was going to reach.
  _animations++;
  animations();
}

- (void)addCompletion:(void (^)(void))completion
{
  [_completions addObject:[completion copy]];
}

- (void)runCompletions
{
  NSArray<void (^)(void)> *pending = [_completions copy];
  [_completions removeAllObjects];
  for (void (^completion)(void) in pending) {
    completion();
  }
}

- (nullable UIViewController *)previewViewController
{
  return nil;
}

@end

/*
 * What a link lift is, now that a link is a VIEW.
 *
 * Every earlier version of this file manufactured something to lift — a
 * snapshot of the glyphs, then a cover laid over them — and then had to hide
 * the real text, and then had to work out when UIKit had finished so it could
 * put the text back. UIKit does not say: there is no callback for an
 * interaction it abandons, and `willEndForConfiguration:` arrives only
 * sometimes. That single gap produced holes in paragraphs, blank chips,
 * ghosting, and a watchdog to paper over them.
 *
 * A link is now painted by a view of its own, so UIKit is handed a REAL view
 * and hides, lifts and restores it exactly as it does for a `UITextView`.
 * These tests pin that: what is handed over, where it is aimed, and that
 * nothing is copied.
 */
@interface EXPTextLinkInteractionTests : XCTestCase
@end

@implementation EXPTextLinkInteractionTests {
  UIWindow *_window;
  UIView *_host;
  UIView *_linkView;
  EXPTextLinkInteraction *_interaction;
  UIContextMenuInteraction *_uikitInteraction;
  NSArray<NSValue *> *_linkRects;
}

- (void)setUp
{
  [super setUp];
  // A REAL window: `UITargetedPreview` raises if its view is not in one.
  _window = [[UIWindow alloc] initWithFrame:CGRectMake(0, 0, 320, 600)];
  _host = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 320, 200)];
  [_window addSubview:_host];
  _window.hidden = NO;

  // Stands in for the view that paints one link — a glyph view, or the mounted
  // `<img>` when the link's content is an image. The interaction does not care
  // which; that is the point of it being a view.
  _linkView = [[UIView alloc] initWithFrame:CGRectMake(40, 10, 120, 20)];
  [_host addSubview:_linkView];

  // A link that WRAPS: two rects that must lift as one joined shape.
  _linkRects = @[
    [NSValue valueWithCGRect:CGRectMake(40, 10, 120, 20)],
    [NSValue valueWithCGRect:CGRectMake(40, 30, 80, 20)],
  ];

  __weak __typeof(self) weakSelf = self;
  _interaction = [[EXPTextLinkInteraction alloc]
      initWithView:_host
          resolver:^id _Nullable(CGPoint point, NSMutableArray<NSValue *> *rects, UIView **outLinkView) {
            __typeof(self) strongSelf = weakSelf;
            if (strongSelf == nil || !CGRectContainsPoint(CGRectMake(0, 0, 200, 60), point)) {
              return nil;
            }
            [rects addObjectsFromArray:strongSelf->_linkRects];
            *outLinkView = strongSelf->_linkView;
            return [NSURL URLWithString:@"https://reactnative.dev/"];
          }];
  _uikitInteraction = [[UIContextMenuInteraction alloc] initWithDelegate:_interaction];
  [_interaction setInstalled:YES];
}

- (UIContextMenuConfiguration *)_configurationAt:(CGPoint)point
{
  return [_interaction contextMenuInteraction:_uikitInteraction configurationForMenuAtLocation:point];
}

- (UITargetedPreview *)_liftFor:(UIContextMenuConfiguration *)configuration
{
  return [_interaction contextMenuInteraction:_uikitInteraction
                                configuration:configuration
        highlightPreviewForItemWithIdentifier:@"link"];
}

#pragma mark - The link itself is what gets lifted

- (void)testTheLiftIsASTILLSoThePageKeepsItsText
{
  /*
   * The whole design in one assertion.
   *
   * `UITargetedPreview` hides the view it is handed, for as long as the
   * interaction lasts. Handed the link itself it took the words out of the
   * sentence — unnoticed while the chip sat over them, and a hole in the page
   * the moment the preview card was dragged aside. Press a link in Messages or
   * Safari, drag the card away, and the link is still there.
   *
   * So UIKit is handed a picture instead, standing exactly over the link. What
   * it hides is the picture, which changes nothing on screen, and the link keeps
   * drawing underneath.
   */
  UITargetedPreview *preview = [self _liftFor:[self _configurationAt:CGPointMake(50, 20)]];

  XCTAssertNotNil(preview);
  XCTAssertFalse(preview.view == _linkView, @"the link itself must not be what UIKit hides");
  XCTAssertTrue(CGRectEqualToRect(preview.view.bounds, _linkView.bounds), @"the still is the link's size");
  XCTAssertNotNil(_linkView.superview, @"and the link stays in the page");
  XCTAssertFalse(_linkView.hidden);
}

- (void)testAnyKindOfContentLiftsBecauseItIsJustAView
{
  /*
   * `<a><img></a>`, `<a><video></a>`, or anything else an author nests in a
   * link. The content is already a mounted view, so the resolver hands that
   * over and UIKit lifts it natively.
   *
   * This is what a capture-based lift could never do without learning about
   * each kind of content separately — and it silently produced an EMPTY chip
   * for an image, because an image is not painted by the text run at all.
   */
  UIImageView *picture = [[UIImageView alloc] initWithFrame:CGRectMake(40, 10, 120, 20)];
  [_host addSubview:picture];
  _linkView = picture;

  UITargetedPreview *preview = [self _liftFor:[self _configurationAt:CGPointMake(50, 20)]];

  XCTAssertNotNil(preview, @"content that is a view lifts as a picture of that view");
  XCTAssertTrue(CGRectEqualToRect(preview.view.bounds, picture.bounds));
  XCTAssertNotNil(picture.superview, @"and the image stays in the page");
}

#pragma mark - Where it is aimed

- (void)testTheLiftIsTargetedIntoTheWindowSoNothingCanClipIt
{
  /*
   * Left to itself, `initWithView:parameters:` targets the view's own
   * superview — for a glyph view that is the text RUN, a box the size of a
   * line, and the chip and its shadow were clipped against it. Naming some
   * ancestor instead only moves the question: an ancestor cannot be assumed
   * big enough. The window always is.
   */
  UIView *clipper = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 320, 60)];
  clipper.clipsToBounds = YES;
  [_window addSubview:clipper];
  [clipper addSubview:_host];

  UITargetedPreview *preview = [self _liftFor:[self _configurationAt:CGPointMake(50, 20)]];

  XCTAssertTrue(preview.target.container == _window, @"the lift is aimed into the window");
  XCTAssertFalse(preview.target.container.clipsToBounds, @"which nothing above can clip");
}

- (void)testTheDismissalAimsAtWhereTheLinkIsNowNotWhereItWas
{
  /*
   * Scroll while a menu is open and the link is somewhere else by the time it
   * closes. Handing back the preview built for the LIFT sent the text flying to
   * its pre-scroll position before snapping into place.
   *
   * Moving the link view stands in for the scroll.
   */
  UIContextMenuConfiguration *configuration = [self _configurationAt:CGPointMake(50, 20)];
  const CGPoint before = [self _liftFor:configuration].target.center;

  _linkView.frame = CGRectOffset(_linkView.frame, 0, -80);

  UITargetedPreview *dismissal =
      [_interaction contextMenuInteraction:_uikitInteraction
                             configuration:configuration
     dismissalPreviewForItemWithIdentifier:@"link"];

  XCTAssertEqualWithAccuracy(
      dismissal.target.center.y, before.y - 80, 0.5,
      @"the dismissal follows the link rather than returning to where it was");
}

/** `colour` resolved to RGBA, so a dynamic colour and a CGColor can be compared. */
static void ComponentsOf(UIColor *colour, CGFloat *out)
{
  [colour getRed:&out[0] green:&out[1] blue:&out[2] alpha:&out[3]];
}

- (void)testAViewLiftsWearingItsOwnColour
{
  /*
   * UIKit does not render a view's background into a preview — it fills behind
   * the view with `parameters.backgroundColor` instead. A box whose whole
   * appearance IS its background therefore lifted as a BLANK WHITE CHIP until
   * the colour was handed over explicitly.
   *
   * Read off the LAYER. Fabric sets `layer.backgroundColor` and leaves the
   * UIView property nil, so a branch that reads the property finds nothing on
   * any view in a real tree — which is what happened: every view lifted on a
   * clear platter while this test passed, because a plain `UIView` set both.
   */
  _linkView.layer.backgroundColor = UIColor.systemBlueColor.CGColor;

  UITargetedPreview *preview = [self _liftFor:[self _configurationAt:CGPointMake(50, 20)]];

  CGFloat wanted[4], got[4];
  ComponentsOf(UIColor.systemBlueColor, wanted);
  ComponentsOf(preview.parameters.backgroundColor, got);
  for (int i = 0; i < 4; i++) {
    XCTAssertEqualWithAccuracy(got[i], wanted[i], 0.01, @"the lift keeps the box's colour");
  }
}

- (void)testCONTENTTHATPAINTSITSELFGetsNoPlatter
{
  /*
   * An image brings its own pixels, including the ones it does NOT paint: a logo
   * with transparent corners is a rounded picture on the page. Fill behind it
   * and the corners fill too — the sampled page colour was tried as the fallback
   * here and it is not the page's colour at all, since sampling censuses the
   * pixels INSIDE the link's rects, which for a picture is the picture. It
   * lifted the rounded logo as a dark square. Reported from the device.
   *
   * Clear costs nothing that matters: the copy's transparent parts sit over the
   * original's transparent parts, so what shows through is the page either way.
   */
  _linkView.layer.backgroundColor = NULL;

  UITargetedPreview *preview = [self _liftFor:[self _configurationAt:CGPointMake(50, 20)]];

  XCTAssertEqualObjects(preview.parameters.backgroundColor, UIColor.clearColor);
}

- (void)testAViewLiftsInItsOwnSilhouette
{
  _linkView.layer.cornerRadius = 12;

  UITargetedPreview *preview = [self _liftFor:[self _configurationAt:CGPointMake(50, 20)]];

  // Compared loosely: the corner arcs leave floating-point dust on the origin.
  const CGRect shape = preview.parameters.visiblePath.bounds;
  XCTAssertEqualWithAccuracy(CGRectGetWidth(shape), CGRectGetWidth(_linkView.bounds), 0.01);
  XCTAssertEqualWithAccuracy(CGRectGetHeight(shape), CGRectGetHeight(_linkView.bounds), 0.01);
  XCTAssertEqualWithAccuracy(CGRectGetMinX(shape), 0.0, 0.01, @"a box lifts as its own shape");
}

- (void)testAPlainViewIsNotMistakenForGlyphs
{
  // Which of the two treatments a lift gets turns entirely on this.
  XCTAssertFalse([RCTAnonymousTextRunView isLinkGlyphView:_linkView]);
}

#pragma mark - Declining

- (void)testATouchOffAnyLinkOffersNoMenu
{
  XCTAssertNil([self _configurationAt:CGPointMake(300, 180)], @"ordinary text long-presses as it did");
}

- (void)testAResolverThatNamesNoViewOffersNoMenu
{
  /*
   * The contract, stated because breaking it is silent and total.
   *
   * A lift is now a VIEW, so a resolver that finds a link but cannot say which
   * view draws it has not resolved one. When `<a display:block>` was still
   * written against the older contract — report no rects and let UIKit pick the
   * view — it stopped offering a menu ENTIRELY, and nothing failed: no crash,
   * no log, just a long press that did nothing.
   */
  EXPTextLinkInteraction *nameless = [[EXPTextLinkInteraction alloc]
      initWithView:_host
          resolver:^id _Nullable(CGPoint point, NSMutableArray<NSValue *> *rects, UIView **outLinkView) {
            [rects addObject:[NSValue valueWithCGRect:CGRectMake(0, 0, 50, 20)]];
            return [NSURL URLWithString:@"https://reactnative.dev/"];
          }];
  UIContextMenuInteraction *uikit = [[UIContextMenuInteraction alloc] initWithDelegate:nameless];
  [nameless setInstalled:YES];

  XCTAssertNil([nameless contextMenuInteraction:uikit configurationForMenuAtLocation:CGPointMake(10, 10)]);
}

- (void)testADetachedLinkDeclinesToLiftInsteadOfRaising
{
  // `UITargetedPreview` RAISES if its view is not in a window, so a paragraph
  // unmounted between the touch and the lift would take the app down over a
  // long press.
  UIContextMenuConfiguration *configuration = [self _configurationAt:CGPointMake(50, 20)];
  [_host removeFromSuperview];

  XCTAssertNil([self _liftFor:configuration], @"no lift is the right answer for a view off screen");
}

#pragma mark - What UIKit must keep doing

- (void)testUIKitStillDressesTextLineRectsAsAChip
{
  /*
   * `initWithTextLineRects:` supplies the shape AND the platter colour, and we
   * deliberately override neither. A nil `backgroundColor` would lift glyphs
   * with no chip behind them — the "popout doesn't get the background" report —
   * and it would arrive without a line of our code changing.
   */
  UIPreviewParameters *parameters = [[UIPreviewParameters alloc]
      initWithTextLineRects:@[ [NSValue valueWithCGRect:CGRectMake(0, 0, 120, 20)] ]];

  XCTAssertNotNil(parameters.visiblePath, @"UIKit stopped shaping a text lift");
  XCTAssertNotNil(parameters.backgroundColor, @"UIKit stopped supplying the platter colour");

  // And a link that WRAPS joins into one form rather than lifting as two
  // separate rectangles — the case least likely to be tried by hand.
  UIPreviewParameters *wrapped = [[UIPreviewParameters alloc] initWithTextLineRects:@[
    [NSValue valueWithCGRect:CGRectMake(0, 0, 120, 20)],
    [NSValue valueWithCGRect:CGRectMake(0, 20, 80, 20)],
  ]];
  XCTAssertGreaterThan(
      CGRectGetMaxY(wrapped.visiblePath.bounds), 30.0, @"the shape must span both lines");
}

@end

#pragma mark - Which view IS the link's content

/*
 * `<a>` around something that is not glyphs — an image, a video, a custom
 * component — lifts that view. Picking it is a geometry question, and these pin
 * the one piece of geometry that is easy to get wrong.
 */
@interface EXPLinkContentViewTests : XCTestCase
@end

@implementation EXPLinkContentViewTests {
  RCTViewComponentView *_host;
  NSArray<NSValue *> *_linkRects;
  UIView *_glyphView;
}

- (void)setUp
{
  [super setUp];
  _host = [[RCTViewComponentView alloc] initWithFrame:CGRectMake(0, 0, 320, 200)];
  // One line box, the size of the attachment sitting in it.
  _linkRects = @[ [NSValue valueWithCGRect:CGRectMake(20, 20, 72, 72)] ];
  _glyphView = [[UIView alloc] initWithFrame:CGRectZero];
}

- (RCTViewComponentView *)_mountChildWithFrame:(CGRect)frame
{
  RCTViewComponentView *child = [[RCTViewComponentView alloc] initWithFrame:frame];
  [_host mountChildComponentView:child index:0];
  return child;
}

- (void)testTheAttachmentInsideTheLinkIsWhatLifts
{
  RCTViewComponentView *child = [self _mountChildWithFrame:CGRectMake(20, 20, 72, 72)];
  XCTAssertTrue([_host _viewForLinkContentInRects:_linkRects fallingBackTo:_glyphView] == child);
}

- (void)testAnAttachmentMerelyOnTheSameLineIsNotTheLink
{
  [self _mountChildWithFrame:CGRectMake(200, 20, 72, 72)];
  XCTAssertTrue(
      [_host _viewForLinkContentInRects:_linkRects fallingBackTo:_glyphView] == _glyphView,
      @"an image next to a link belongs to the sentence, not to the link");
}

- (void)testATurningAttachmentStillLifts
{
  /*
   * The regression, and it was invisible to every static case.
   *
   * `frame` is documented as undefined once a transform is set, and really is:
   * it reports the bounding box of the TURNED shape, so this 72pt square claims
   * about 102pt and never fitted the line box the text laid it out in. It fell
   * through to the glyph view — and a link whose whole content is this view has
   * no glyphs — so anything animating a rotation lifted an EMPTY CHIP. Found by
   * holding a lift on a spinning square.
   */
  RCTViewComponentView *child = [self _mountChildWithFrame:CGRectMake(20, 20, 72, 72)];
  child.transform = CGAffineTransformMakeRotation(M_PI_4);

  XCTAssertGreaterThan(
      CGRectGetWidth(child.frame), 100.0, @"precondition: a turned view's frame really does lie");
  XCTAssertTrue(
      [_host _viewForLinkContentInRects:_linkRects fallingBackTo:_glyphView] == child,
      @"a turning attachment is still the link's content");
}

- (void)testAGrowingAttachmentStillLifts
{
  // The same fault with a scale rather than a rotation — the shape an
  // attention-seeking press animation takes.
  RCTViewComponentView *child = [self _mountChildWithFrame:CGRectMake(20, 20, 72, 72)];
  child.transform = CGAffineTransformMakeScale(1.4, 1.4);

  XCTAssertTrue([_host _viewForLinkContentInRects:_linkRects fallingBackTo:_glyphView] == child);
}

- (void)testALinkOfBOTHAPictureAndWordsLiftsTheWholeLink
{
  /*
   * `<a><img>caption</a>`, and the case that made a device show half a link.
   *
   * TWO DIFFERENT VIEWS draw the halves: the image is a mounted subview, the
   * words are painted by the text run. So no single CHILD is the link. Handing
   * back the image lifts the picture without the words; falling through to the
   * glyph view lifts the words without the picture. The thing that draws both
   * is this container, and the preview masks it to the link's own rects.
   *
   * The two are asserted TOGETHER because the difference between them is the
   * whole rule — not "is there an image" but "does the image COVER the link":
   *
   *   picture alone  -> the picture IS the link  -> lift the picture
   *   picture + words -> it is only part of it   -> lift the container
   *
   * `EXPAtomicInlineLinkRangeTests` below pins the other half of this, that the
   * rects handed in really do span an image inside the link. Without that, the
   * mixed branch here would be unreachable.
   */
  RCTViewComponentView *picture = [self _mountChildWithFrame:CGRectMake(20, 20, 72, 72)];

  // The link runs PAST the picture: the picture, then a caption beside it.
  NSArray<NSValue *> *pictureAndWords = @[
    [NSValue valueWithCGRect:CGRectMake(20, 20, 72, 72)],
    [NSValue valueWithCGRect:CGRectMake(92, 20, 90, 72)],
  ];
  XCTAssertTrue(
      [_host _viewForLinkContentInRects:pictureAndWords fallingBackTo:_glyphView] == _host,
      @"a link of a picture AND words lifts the container that draws both");

  // `_linkRects` is exactly the picture's box: the picture IS the whole link.
  XCTAssertTrue(
      [_host _viewForLinkContentInRects:_linkRects fallingBackTo:_glyphView] == picture,
      @"a link that is only a picture still lifts the picture itself");
}

@end

#pragma mark - There is only ever one chip

/*
 * The ghosting — two chip outlines visible at once — was never a drawing bug.
 * It was two things on screen: a captured picture of the glyphs AND a cover
 * view standing in for them, briefly alive together because UIKit gives no
 * reliable signal for when it has finished with a preview.
 *
 * The design that replaced it cannot produce a second chip, and these say why
 * in a way that fails if anyone reintroduces one.
 */
/*
 * A stand-in for the container UIKit animates a dismissal in. The production
 * lookup matches on the class name's SUFFIX — the real one is Swift and reports
 * itself as `UIKit._UIMorphAnimationContainerView` — so a double named this way
 * is found by exactly the code that finds the real thing.
 */
@interface EXPFake_UIMorphAnimationContainerView : UIView
@end

@implementation EXPFake_UIMorphAnimationContainerView
@end

@interface EXPSingleChipTests : XCTestCase
@end

@implementation EXPSingleChipTests {
  UIWindow *_window;
  UIView *_host;
  UIView *_linkView;
  EXPTextLinkInteraction *_interaction;
  UIContextMenuInteraction *_uikit;
}

- (void)setUp
{
  [super setUp];
  _window = [[UIWindow alloc] initWithFrame:CGRectMake(0, 0, 320, 600)];
  _host = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 320, 200)];
  [_window addSubview:_host];
  _window.hidden = NO;
  _linkView = [[UIView alloc] initWithFrame:CGRectMake(40, 10, 120, 20)];
  [_host addSubview:_linkView];

  __weak __typeof(self) weakSelf = self;
  _interaction = [[EXPTextLinkInteraction alloc]
      initWithView:_host
          resolver:^id _Nullable(CGPoint point, NSMutableArray<NSValue *> *rects, UIView **outLinkView) {
            __typeof(self) strongSelf = weakSelf;
            if (strongSelf == nil) {
              return nil;
            }
            [rects addObject:[NSValue valueWithCGRect:CGRectMake(40, 10, 120, 20)]];
            *outLinkView = strongSelf->_linkView;
            return [NSURL URLWithString:@"https://reactnative.dev/"];
          }];
  _uikit = [[UIContextMenuInteraction alloc] initWithDelegate:_interaction];
  [_interaction setInstalled:YES];
}

static NSUInteger DescendantCount(UIView *view)
{
  NSUInteger total = view.subviews.count;
  for (UIView *child in view.subviews) {
    total += DescendantCount(child);
  }
  return total;
}

- (void)testALiftAddsEXACTLYONEViewAndTakesItBackOut
{
  /*
   * The still is a view on screen, so the count that used to be "none" is now
   * "one, and only while the press lasts". One is a copy standing over its
   * original; two is a second chip, which is the bug this whole set is named
   * for; one left behind is a picture of a paragraph that has moved on.
   */
  const NSUInteger before = DescendantCount(_window);

  UIContextMenuConfiguration *configuration =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];
  UITargetedPreview *preview = [_interaction contextMenuInteraction:_uikit
                                                      configuration:configuration
                              highlightPreviewForItemWithIdentifier:@"link"];

  XCTAssertNotNil(preview);
  XCTAssertEqual(DescendantCount(_window), before + 1, @"one still, over the link");
  XCTAssertTrue(preview.view.superview == _window, @"in the window, where nothing can clip it");

  EXPStubMenuAnimator *animator = [EXPStubMenuAnimator new];
  [_interaction contextMenuInteraction:_uikit willEndForConfiguration:configuration animator:animator];
  [animator runCompletions];

  XCTAssertEqual(DescendantCount(_window), before, @"and gone when the press is over");
}

/** The colour at the middle of `view`, rendered as it would be on screen. */
static UIColor *EXPColourAtTheMiddleOf(UIView *view)
{
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithBounds:view.bounds];
  UIImage *image = [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
    [view drawViewHierarchyInRect:view.bounds afterScreenUpdates:NO];
  }];
  CGImageRef cgImage = image.CGImage;
  const size_t x = (size_t)(CGImageGetWidth(cgImage) / 2);
  const size_t y = (size_t)(CGImageGetHeight(cgImage) / 2);
  uint8_t pixel[4] = {0, 0, 0, 0};
  CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(
      pixel, 1, 1, 8, 4, space, kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGContextDrawImage(context, CGRectMake(-(CGFloat)x, -(CGFloat)(CGImageGetHeight(cgImage) - y - 1), 
                                          CGImageGetWidth(cgImage), CGImageGetHeight(cgImage)), cgImage);
  CGContextRelease(context);
  CGColorSpaceRelease(space);
  return [UIColor colorWithRed:pixel[0] / 255.0 green:pixel[1] / 255.0 blue:pixel[2] / 255.0 alpha:pixel[3] / 255.0];
}

- (void)testTheStillCARRIES_THE_LINKS_PIXELS
{
  /*
   * The failure this exists for is silent: a still that draws nothing is a
   * BLANK CHIP, and every structural assertion around it still passes — right
   * size, right place, right target, nothing left behind. Only the pixels say
   * whether the copy copied anything.
   *
   * A distinctive colour rather than text, because glyph rendering is the text
   * system's business and this is asking one question: did the drawing happen.
   */
  _linkView.backgroundColor = [UIColor colorWithRed:0 green:0 blue:1 alpha:1];

  /*
   * THE INSTRUMENT FIRST. `-drawViewHierarchyInRect:afterScreenUpdates:NO`
   * copies what the render server has, and a window that was never on a screen
   * has nothing — which is the case in a plain `xctest` run. Asserting straight
   * away would fail for a reason that has nothing to do with the still; not
   * checking would let this pass while measuring two blank images against each
   * other. So the control is drawn first, and the test declines to run when the
   * control comes back empty.
   */
  CGFloat controlAlpha = 0, ignored = 0;
  [EXPColourAtTheMiddleOf(_linkView) getRed:&ignored green:&ignored blue:&ignored alpha:&controlAlpha];
  if (controlAlpha < 0.98) {
    XCTSkip(@"this environment cannot render a view offscreen, so there is nothing to compare");
  }

  UIContextMenuConfiguration *configuration =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];
  UITargetedPreview *preview = [_interaction contextMenuInteraction:_uikit
                                                      configuration:configuration
                              highlightPreviewForItemWithIdentifier:@"link"];

  CGFloat red = 0, green = 0, blue = 0, alpha = 0;
  [EXPColourAtTheMiddleOf(preview.view) getRed:&red green:&green blue:&blue alpha:&alpha];
  XCTAssertEqualWithAccuracy(blue, 1.0, 0.02, @"the still shows what the link was showing");
  XCTAssertEqualWithAccuracy(red, 0.0, 0.02);
  XCTAssertEqualWithAccuracy(alpha, 1.0, 0.02);
}

- (void)testONE_STILL_AT_A_TIME_EVEN_WHEN_A_PRESS_IS_ABANDONED
{
  /*
   * UIKit does not always say it has finished. There is no callback for a menu
   * it abandons, and `willEnd` arrives only sometimes — so nothing can be timed
   * against it. The window RETAINS a subview, so a picture left there would
   * hang over a page that has scrolled on.
   *
   * Keying by configuration does not answer this, and measurement is why:
   * `NSMapTable` with weak keys zeroes the key without promptly releasing the
   * strong value beside it, so an entry outlived the configuration it was keyed
   * by and a picture tied to that entry stayed on screen.
   *
   * The interaction holds the one still that is standing instead, and the next
   * press takes the last one out — which needs no end-of-press signal at all.
   */
  const NSUInteger before = DescendantCount(_window);

  @autoreleasepool {
    UIContextMenuConfiguration *abandoned =
        [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];
    XCTAssertNotNil([_interaction contextMenuInteraction:_uikit
                                           configuration:abandoned
                   highlightPreviewForItemWithIdentifier:@"link"]);
    XCTAssertEqual(DescendantCount(_window), before + 1);
    // …and then that press is simply dropped, with no `willEnd` at all.
  }

  UIContextMenuConfiguration *next =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];
  [_interaction contextMenuInteraction:_uikit
                         configuration:next
 highlightPreviewForItemWithIdentifier:@"link"];

  XCTAssertEqual(DescendantCount(_window), before + 1, @"the new press's still, and only it");
}

- (void)testTHE_GLASS_FADE_DOES_NOTHING_WHEN_THERE_IS_NO_MENU
{
  /*
   * The dismissal reaches into UIKit's own presentation to fade the menu's
   * glass, finding the container by a private class NAME. This is the promise
   * that makes that acceptable: when the name finds nothing — a future iOS, a
   * restructured presentation, or a test with no menu on screen — the
   * interaction does what it did before and hands the animator nothing of ours.
   *
   * The failure this guards against is a lookup that grows a fallback: "no
   * container, so fade the nearest effect view instead" would change behaviour
   * on exactly the systems that cannot be tested here.
   */
  UIContextMenuConfiguration *configuration =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];
  [_interaction contextMenuInteraction:_uikit
                         configuration:configuration
 highlightPreviewForItemWithIdentifier:@"link"];

  EXPStubMenuAnimator *animator = [EXPStubMenuAnimator new];
  XCTAssertNoThrow([_interaction contextMenuInteraction:_uikit
                                willEndForConfiguration:configuration
                                               animator:animator]);

  XCTAssertEqual(animator.animations, 0u, @"nothing found, nothing animated");
  XCTAssertFalse(_linkView.hidden, @"and the link is untouched either way");
  XCTAssertEqual(_linkView.alpha, 1.0);
}

- (void)testTHE_GLASS_IS_PUT_BACK_WHEN_THE_DISMISSAL_ENDS
{
  /*
   * UIKit keeps its material layers and uses them again. Measured across three
   * presses: the same two providers by pointer, arriving at the third dismissal
   * still at zero because the first had left them there — which does not dim one
   * menu's glass, it removes glass from every menu the app shows afterwards.
   * Invisible while testing dismissals, and obvious the moment anyone opens a
   * second menu.
   *
   * A layer named as UIKit names its material, covering the window, stands in
   * for the real thing here; what is pinned is the contract, which is that
   * whatever this dims it gives back.
   */
  /*
   * Inside a stand-in for UIKit's morph container, because that is the scope:
   * the search starts at the window's own sublayers and descends only into the
   * presentation being dismissed. A material anywhere else — an app's own glass
   * — is out of reach by construction, and this double is named to be found the
   * same way the real one is.
   */
  UIView *presentation = [EXPFake_UIMorphAnimationContainerView new];
  presentation.frame = _window.bounds;
  [_window addSubview:presentation];

  CALayer *material = [CALayer new];
  material.name = @"MaterialProvider";
  material.frame = _window.bounds;
  material.opacity = 1;
  [presentation.layer addSublayer:material];

  UIContextMenuConfiguration *configuration =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];
  [_interaction contextMenuInteraction:_uikit
                         configuration:configuration
 highlightPreviewForItemWithIdentifier:@"link"];

  EXPStubMenuAnimator *animator = [EXPStubMenuAnimator new];
  [_interaction contextMenuInteraction:_uikit willEndForConfiguration:configuration animator:animator];

  XCTAssertEqual(material.opacity, 0, @"held down while the menu collapses");

  [animator runCompletions];

  XCTAssertEqual(material.opacity, 1, @"and given back when the dismissal is over");
}

- (void)testTHE_GLASS_COMES_BACK_EVEN_IF_UIKIT_NEVER_SAYS_SO
{
  /*
   * The restore does not depend on being told.
   *
   * UIKit is free never to run a completion — an abandoned menu sends no
   * `willEnd` at all — and a material left at zero is not a cosmetic miss,
   * because these layers are reused and every later menu would show a flat
   * panel. Hanging the restore on the callback would put the worst outcome
   * behind the one guarantee this file has repeatedly found not to hold.
   *
   * So it hangs on ownership instead: whoever wants the glass down holds the
   * object that took it, and letting go is what gives it back. Here the animator
   * is dropped with its completions NEVER run, which is the case a
   * callback-driven restore cannot survive.
   */
  UIView *presentation = [EXPFake_UIMorphAnimationContainerView new];
  presentation.frame = _window.bounds;
  [_window addSubview:presentation];

  CALayer *material = [CALayer new];
  material.name = @"MaterialProvider";
  material.frame = _window.bounds;
  material.opacity = 1;
  [presentation.layer addSublayer:material];

  UIContextMenuConfiguration *configuration =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];
  [_interaction contextMenuInteraction:_uikit
                         configuration:configuration
 highlightPreviewForItemWithIdentifier:@"link"];

  @autoreleasepool {
    EXPStubMenuAnimator *animator = [EXPStubMenuAnimator new];
    [_interaction contextMenuInteraction:_uikit willEndForConfiguration:configuration animator:animator];
    XCTAssertEqual(material.opacity, 0, @"down while the menu collapses");
    // …and the animator goes away here, with its completions unrun.
  }

  XCTAssertEqual(material.opacity, 1, @"and back when the last hold on it goes");
}

- (void)testA_SECOND_PRESS_DOES_NOT_STEAL_THE_FIRSTS_LAYERS
{
  /*
   * These layers are UIKit's and are shared between presentations, so two
   * dismissals in flight are two owners of the same state. The second must not
   * record a dimmed layer's zero as its resting value, or restoring will put it
   * back dimmed and every later menu loses its glass.
   */
  UIView *presentation = [EXPFake_UIMorphAnimationContainerView new];
  presentation.frame = _window.bounds;
  [_window addSubview:presentation];

  CALayer *material = [CALayer new];
  material.name = @"MaterialProvider";
  material.frame = _window.bounds;
  material.opacity = 1;
  [presentation.layer addSublayer:material];

  UIContextMenuConfiguration *first =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];
  EXPStubMenuAnimator *firstAnimator = [EXPStubMenuAnimator new];
  [_interaction contextMenuInteraction:_uikit willEndForConfiguration:first animator:firstAnimator];

  // A second press, dismissed before the first has finished.
  UIContextMenuConfiguration *second =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];
  EXPStubMenuAnimator *secondAnimator = [EXPStubMenuAnimator new];
  [_interaction contextMenuInteraction:_uikit willEndForConfiguration:second animator:secondAnimator];

  [firstAnimator runCompletions];
  [secondAnimator runCompletions];

  XCTAssertEqual(material.opacity, 1, @"the second press must not restore it to the first's dimming");
}

- (void)testGLASS_THAT_APPEARS_MID_COLLAPSE_IS_ALSO_HELD_DOWN
{
  /*
   * The materials do not all exist when the dismissal begins. On a device the
   * window-covering providers are built a few frames into the collapse — at
   * `willEnd` the presentation carries only the platters — so a single pass
   * finds nothing to dim and the artefact is untouched.
   *
   * Here the layer is added AFTER the dismissal starts, which is the case a
   * one-shot cannot survive.
   */
  UIView *presentation = [EXPFake_UIMorphAnimationContainerView new];
  presentation.frame = _window.bounds;
  [_window addSubview:presentation];

  UIContextMenuConfiguration *configuration =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];
  [_interaction contextMenuInteraction:_uikit
                         configuration:configuration
 highlightPreviewForItemWithIdentifier:@"link"];

  EXPStubMenuAnimator *animator = [EXPStubMenuAnimator new];
  [_interaction contextMenuInteraction:_uikit willEndForConfiguration:configuration animator:animator];

  // Nothing to find yet — and then UIKit builds it.
  CALayer *material = [CALayer new];
  material.name = @"MaterialProvider";
  material.frame = _window.bounds;
  material.opacity = 1;
  [presentation.layer addSublayer:material];

  [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
  XCTAssertEqual(material.opacity, 0, @"a material that arrives late is still held down");

  [animator runCompletions];
  XCTAssertEqual(material.opacity, 1, @"and still given back");
}

- (void)testUNINSTALLING_TAKES_THE_STILL_OUT
{
  // The paragraph being recycled onto other text, with a menu still up. Nothing
  // of the old text may remain — least of all a picture of it.
  const NSUInteger before = DescendantCount(_window);

  UIContextMenuConfiguration *configuration =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];
  [_interaction contextMenuInteraction:_uikit
                         configuration:configuration
 highlightPreviewForItemWithIdentifier:@"link"];
  XCTAssertEqual(DescendantCount(_window), before + 1);

  [_interaction setInstalled:NO];

  XCTAssertEqual(DescendantCount(_window), before);
}

- (void)testTheStillStandsOverTheLinkItCopied
{
  UIContextMenuConfiguration *configuration =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];
  UITargetedPreview *preview = [_interaction contextMenuInteraction:_uikit
                                                      configuration:configuration
                              highlightPreviewForItemWithIdentifier:@"link"];

  // Same place, same size. Hiding it then changes nothing on screen, which is
  // the entire reason the page keeps its text.
  const CGRect linkInWindow = [_linkView.superview convertRect:_linkView.frame toView:_window];
  const CGRect stillInWindow = [preview.view.superview convertRect:preview.view.frame toView:_window];
  XCTAssertTrue(CGRectEqualToRect(stillInWindow, linkInWindow));
  XCTAssertFalse(preview.view.userInteractionEnabled, @"a picture takes no touches");
}

- (void)testRepeatedRequestsHandBackTheSAME_PREVIEW_OBJECT
{
  /*
   * Not merely the same view — the same `UITargetedPreview`.
   *
   * Handed a new object, UIKit tears the current lift down and builds another,
   * and it crosses from one to the other rather than continuing — seen as a
   * second chip ghosting behind the first. Measured at 120fps on device before
   * this: chip, chip, no platter, text flat on the page, chip.
   */
  UIContextMenuConfiguration *configuration =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];

  UITargetedPreview *first = [_interaction contextMenuInteraction:_uikit
                                                    configuration:configuration
                            highlightPreviewForItemWithIdentifier:@"link"];
  UITargetedPreview *second = [_interaction contextMenuInteraction:_uikit
                                                     configuration:configuration
                             highlightPreviewForItemWithIdentifier:@"link"];
  XCTAssertTrue(first == second, @"a second ask must not build a second lift");

  /*
   * The DISMISSAL is the one place a different object is right, and it is right
   * for the opposite reason: the effect is ending, and what it ends on has
   * nothing to draw. A morph back into a copy of the link would put that copy
   * over the link itself — the doubling the vanishing preview exists to remove.
   */
  UITargetedPreview *ending = [_interaction contextMenuInteraction:_uikit
                                                     configuration:configuration
                             dismissalPreviewForItemWithIdentifier:@"link"];
  XCTAssertFalse(first == ending);
  XCTAssertTrue(
      ending == [_interaction contextMenuInteraction:_uikit
                                       configuration:configuration
               dismissalPreviewForItemWithIdentifier:@"link"],
      @"but it is still one object, asked twice");
}

- (void)testAMovedLinkGetsAFreshPreviewSoTheDismissalAimsAtIt
{
  // The one reason to answer with something new. Scroll with the menu open and
  // a remembered centre would send the text back to where it used to be.
  UIContextMenuConfiguration *configuration =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];
  UITargetedPreview *before = [_interaction contextMenuInteraction:_uikit
                                                     configuration:configuration
                             highlightPreviewForItemWithIdentifier:@"link"];

  _linkView.frame = CGRectOffset(_linkView.frame, 0, -70);

  UITargetedPreview *after = [_interaction contextMenuInteraction:_uikit
                                                    configuration:configuration
                            dismissalPreviewForItemWithIdentifier:@"link"];

  XCTAssertFalse(before == after, @"a lift that moved needs a preview that says so");
  XCTAssertEqualWithAccuracy(after.target.center.y, before.target.center.y - 70, 0.5);
}

- (void)testTheEndOfONE_PRESS_LEAVES_THE_NEXT_ONE_ALONE
{
  /*
   * A dismissal's teardown is deferred to the end of UIKit's animation, and a
   * long press can begin while that animation is still running — pressing twice
   * in a row is enough. When one set of ivars held "the press", the late
   * completion cleared what the NEW press had just written, and the new press
   * had nothing to lift.
   *
   * On device that showed up two ways, both from this one moment: no link view
   * meant no preview at all, and UIKit's answer to no preview is to lift the
   * view the interaction is installed on — THE WHOLE PARAGRAPH (read out of
   * `-[_UIClickPresentationInteraction _prepareInteractionEffect]`); and no
   * rects meant the text came up wearing NO CHIP.
   *
   * Each press now owns its own entry, keyed by the configuration UIKit hands
   * back, so one press's teardown cannot reach another's answer.
   */
  UIContextMenuConfiguration *first =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];
  EXPStubMenuAnimator *animator = [EXPStubMenuAnimator new];
  [_interaction contextMenuInteraction:_uikit willEndForConfiguration:first animator:animator];

  // The second press, before the first one's dismissal has finished animating.
  UIContextMenuConfiguration *second =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];
  XCTAssertNotNil(second);

  [animator runCompletions];

  UITargetedPreview *preview = [_interaction contextMenuInteraction:_uikit
                                                      configuration:second
                              highlightPreviewForItemWithIdentifier:@"link"];
  XCTAssertNotNil(preview, @"the second press still has a link to lift");
  XCTAssertTrue(
      CGRectEqualToRect(preview.view.bounds, _linkView.bounds), @"and it is the link, not the paragraph around it");
}

- (void)testAPRESS_AFTER_ANOTHER_GETS_ITS_OWN_PREVIEW
{
  /*
   * The same object within one interaction, and never across two.
   *
   * UIKit is finished with a preview once its interaction ends — and it does
   * not always say so, since an abandoned interaction sends no `willEnd` at
   * all. Handing the next press that same object asks UIKit to lift from
   * something it has already consumed, which is the other way a press right
   * after another came up with no chip. Keying by configuration makes it
   * structural: a new press is a new key, so it cannot see the old answer.
   */
  UIContextMenuConfiguration *first =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];
  UITargetedPreview *before = [_interaction contextMenuInteraction:_uikit
                                                     configuration:first
                             highlightPreviewForItemWithIdentifier:@"link"];

  // No `willEnd`: UIKit abandoned that one, which it is free to do.
  UIContextMenuConfiguration *second =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];
  UITargetedPreview *after = [_interaction contextMenuInteraction:_uikit
                                                    configuration:second
                            highlightPreviewForItemWithIdentifier:@"link"];

  XCTAssertNotNil(after);
  XCTAssertFalse(before == after, @"a new press is a new lift, even from the same place");
}

- (void)testAConfigurationWeDidNotMakeIsNotAnsweredFor
{
  /*
   * The one case where no preview is the right answer.
   *
   * UIKit's fallback for a nil preview is to lift the view the interaction is
   * installed on — the whole paragraph. That is the correct outcome ONLY for a
   * configuration that is not ours: answering anyway would lift this
   * paragraph's link on someone else's behalf.
   *
   * For our own configurations there is no such case, which is the point of
   * keying by them: the lift a press was given is the lift it keeps.
   */
  UIContextMenuConfiguration *foreign = [UIContextMenuConfiguration configurationWithIdentifier:nil
                                                                               previewProvider:nil
                                                                                actionProvider:nil];
  XCTAssertNil([_interaction contextMenuInteraction:_uikit
                                      configuration:foreign
              highlightPreviewForItemWithIdentifier:@"link"]);
}

- (void)testATEARDOWN_OF_ONE_PRESS_LEAVES_ANOTHERS_LIFT_INTACT
{
  // Two live configurations at once, which is what pressing again during a
  // dismissal produces. Ending either must not touch the other's lift.
  UIContextMenuConfiguration *first =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];
  UIContextMenuConfiguration *second =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];

  [_interaction contextMenuInteraction:_uikit willEndForConfiguration:first animator:nil];

  UITargetedPreview *preview = [_interaction contextMenuInteraction:_uikit
                                                      configuration:second
                              highlightPreviewForItemWithIdentifier:@"link"];
  XCTAssertNotNil(preview, @"the press that did not end still has its link");
  XCTAssertTrue(CGRectEqualToRect(preview.view.bounds, _linkView.bounds));
  XCTAssertTrue(preview.view.superview == _window, @"and its still is still standing");
}

- (void)testTheDismissalHasNOTHINGTODRAW
{
  UIContextMenuConfiguration *configuration =
      [_interaction contextMenuInteraction:_uikit configurationForMenuAtLocation:CGPointMake(50, 20)];

  UITargetedPreview *highlight = [_interaction contextMenuInteraction:_uikit
                                                        configuration:configuration
                                highlightPreviewForItemWithIdentifier:@"link"];
  UITargetedPreview *dismissal = [_interaction contextMenuInteraction:_uikit
                                                        configuration:configuration
                                dismissalPreviewForItemWithIdentifier:@"link"];

  /*
   * The lift shows a picture of the link; the dismissal shows nothing at all.
   *
   * A dismissal is a morph, and it stretches whatever it is morphing INTO on the
   * way. Morphing into a picture of the link puts that picture over the link
   * itself, a few points out of register — recorded on the simulator as two sets
   * of the same glyphs, which reads as blur. Morphing into nothing simply fades
   * the card out over words that never moved.
   */
  XCTAssertNotNil(highlight.view);
  XCTAssertFalse(highlight.view == _linkView, @"the lift is the still, never the link itself");
  XCTAssertFalse(dismissal.view == highlight.view, @"and the dismissal is not the still either");
  XCTAssertEqual(dismissal.view.subviews.count, 0u, @"it draws nothing");
  XCTAssertEqualObjects(dismissal.parameters.backgroundColor, UIColor.clearColor, @"and wears nothing");
  XCTAssertTrue(
      CGRectEqualToRect(dismissal.view.bounds, _linkView.bounds), @"but it ends where the words are");
}

@end

#pragma mark - The card says where the link goes

/*
 * iOS shows the WHOLE destination:
 * `-[_UITextLinkInteractionHandler _titleForLink:]` is `return [url
 * _web_userVisibleString]` — WebKit's readable form of the whole URL —
 * unshortened. It is the second line of the card the chip becomes.
 *
 * This showed only the host for a while, on the theory that a two-line header
 * re-measures and restarts the menu's entrance animation. A three-way probe on
 * the simulator says otherwise: the same menu with no title, a short one and a
 * full URL grew monotonically and settled in every case, differing only in
 * height. So the destination is shown whole, and these say in what form.
 */
@interface EXPMenuTitleTests : XCTestCase
@end

@implementation EXPMenuTitleTests

// Declared here rather than exported: it is an implementation detail of the
// menu, and a test is the only other thing that should know about it.
extern NSString *RCTMenuTitleForHrefForTesting(NSString *href);

- (NSString *)_titleFor:(NSString *)href
{
  return RCTMenuTitleForHrefForTesting(href);
}

- (void)testTheHeaderIsTheWholeDestination
{
  // Scheme, host, path, query and fragment: what the user is about to open.
  XCTAssertEqualObjects(
      [self _titleFor:@"https://reactnative.dev/docs/getting-started"],
      @"https://reactnative.dev/docs/getting-started");
  XCTAssertEqualObjects([self _titleFor:@"http://example.com/a/b/c?q=1#frag"], @"http://example.com/a/b/c?q=1#frag");
}

- (void)testPercentEscapesAreDecodedForReading
{
  // The readable half of `_web_userVisibleString`: a header is for a person.
  XCTAssertEqualObjects([self _titleFor:@"https://example.com/a%20b"], @"https://example.com/a b");
  XCTAssertEqualObjects([self _titleFor:@"https://example.com/caf%C3%A9"], @"https://example.com/café");
}

- (void)testAnHrefThatIsNotValidEncodingSurvivesAsItself
{
  // `<a href>` takes anything, and a failed decode must not lose the header.
  XCTAssertEqualObjects([self _titleFor:@"https://example.com/%ZZ"], @"https://example.com/%ZZ");
  XCTAssertEqualObjects([self _titleFor:@"exa mple"], @"exa mple");
}

- (void)testANonHttpDestinationIsShownAsWritten
{
  XCTAssertEqualObjects([self _titleFor:@"mailto:someone@example.com"], @"mailto:someone@example.com");
}

- (void)testAnEmptyHrefGivesAnEmptyTitleRatherThanNil
{
  XCTAssertEqualObjects([self _titleFor:@""], @"");
}

@end

