/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <XCTest/XCTest.h>

#import <React/EXPTextLinkInteraction.h>
#import <React/RCTAnonymousTextRunView.h>

/*
 * What the OS does during a link lift is the OS's business. What this file
 * pins is the part WE are responsible for and that has now been broken twice,
 * both times invisibly to every other test:
 *
 *   1. the run underneath must stop painting the lifted glyphs, or the link is
 *      on screen twice — once sharp, once being scaled by UIKit — for the whole
 *      animation;
 *   2. it must start again however the menu ends, or a hole is left in the
 *      paragraph;
 *   3. UIKit must be handed the SAME preview each time it asks, or the lift is
 *      replaced mid-animation and flickers as the menu commits;
 *   4. the preview's container must be above anything that clips, or the
 *      lift's shadow is sliced off against a parent's bounds.
 *
 * The first of those regressed by DELETING the machinery and leaving the
 * comment that described it, which is the specific thing these tests exist to
 * catch: a comment cannot fail, and this can.
 */

/*
 * The end-of-touch hook, declared rather than exposed.
 *
 * `_touchFinished` is what the interaction's own touch observer calls when the
 * fingers leave. Tests need to reach it to exercise a lift that UIKit abandons,
 * and declaring it here keeps that seam out of the production header — nothing
 * outside a test has any business ending a touch by hand.
 */
@interface EXPTextLinkInteraction (EXPTesting)
- (void)_touchFinished;
@end

#pragma mark - A run view that records what it was told

/*
 * A plain run. Nothing is recorded any more because nothing is DONE to the run
 * any more: a lifted link is covered by a picture of itself rather than hidden,
 * so the run paints exactly as it always does and the interaction has no way to
 * leave it in a bad state. What used to be asserted here — "was it hidden, was
 * it put back" — no longer has anything to describe.
 */
@interface EXPRecordingRunView : RCTAnonymousTextRunView
@end

@implementation EXPRecordingRunView
@end

#pragma mark -

@interface EXPTextLinkInteractionTests : XCTestCase
@end

@implementation EXPTextLinkInteractionTests {
  UIWindow *_window;
  UIView *_host;
  EXPRecordingRunView *_run;
  EXPTextLinkInteraction *_interaction;
  UIContextMenuInteraction *_uikitInteraction;
  NSArray<NSValue *> *_linkRects;
}

- (void)setUp
{
  [super setUp];
  // A REAL window, because `UIPreviewTarget` raises
  // `BUG_IN_CLIENT_OF_TARGETED_PREVIEW__CONTAINER_IS_NOT_IN_A_WINDOW` if its
  // container is not in one. Found by this test failing that way, which is also
  // why the production code now declines to lift a detached view rather than
  // taking the app down with it.
  _window = [[UIWindow alloc] initWithFrame:CGRectMake(0, 0, 320, 600)];
  _host = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 320, 200)];
  _run = [[EXPRecordingRunView alloc] initWithFrame:CGRectMake(0, 0, 320, 200)];
  [_host addSubview:_run];
  /*
   * Something for the capture to actually capture.
   *
   * The interaction refuses a capture with no contrast in it, because a blank
   * cover pasted over a link is a hole by another route. An empty test host
   * therefore produces no lift at all — correctly — so the fixture has to draw
   * something where the link is, standing in for glyphs.
   */
  // Deliberately SMALLER than any link rect: a capture that is uniformly ink is
  // as contrastless as one that is uniformly blank, and would be refused for
  // exactly the same reason.
  UIView *ink = [[UIView alloc] initWithFrame:CGRectMake(52, 14, 56, 8)];
  ink.backgroundColor = [UIColor blackColor];
  [_host addSubview:ink];
  _host.backgroundColor = [UIColor whiteColor];
  [_window addSubview:_host];
  [_window makeKeyAndVisible];

  // A link that wraps, because one that does not would not catch a single-rect
  // assumption.
  _linkRects = @[
    [NSValue valueWithCGRect:CGRectMake(40, 10, 120, 20)],
    [NSValue valueWithCGRect:CGRectMake(0, 30, 80, 20)],
  ];

  __weak __typeof(self) weakSelf = self;
  _interaction = [[EXPTextLinkInteraction alloc]
      initWithView:_host
          resolver:^id _Nullable(CGPoint point, NSMutableArray<NSValue *> *rects, UIView **outSourceView) {
            __typeof(self) strongSelf = weakSelf;
            if (strongSelf == nil) {
              return nil;
            }
            // Two links, and a region belonging to neither — so "the same
            // link again", "a different link" and "missed entirely" are all
            // cases these tests can express.
            *outSourceView = strongSelf->_run;
            if (CGRectContainsPoint(CGRectMake(0, 0, 200, 60), point)) {
              [rects addObjectsFromArray:strongSelf->_linkRects];
              return [NSURL URLWithString:@"https://reactnative.dev/"];
            }
            if (CGRectContainsPoint(CGRectMake(0, 100, 200, 60), point)) {
              [rects addObject:[NSValue valueWithCGRect:CGRectMake(10, 110, 90, 20)]];
              return [NSURL URLWithString:@"https://reactnative.dev/docs"];
            }
            *outSourceView = nil;
            return nil;
          }];
  // A real one, so these calls are the calls UIKit makes rather than a shape
  // that only happens to compile.
  _uikitInteraction = [[UIContextMenuInteraction alloc] initWithDelegate:_interaction];
}

- (UIContextMenuConfiguration *)_beginMenuAtPoint:(CGPoint)point
{
  return [_interaction contextMenuInteraction:self->_uikitInteraction
               configurationForMenuAtLocation:point];
}

/*
 * The lift, asked for the way a CURRENT iOS asks for it.
 *
 * Deliberately not the deprecated `previewForHighlightingMenuWithConfiguration:`: that pair is
 * compiled out once the deployment target reaches iOS 16, so tests written against it would stop
 * building the day the floor moves. The one test that must see both generations calls the legacy
 * method itself, under the same guard the implementation uses.
 */
- (UITargetedPreview *)_liftPreviewFor:(UIContextMenuConfiguration *)configuration
{
  return [_interaction contextMenuInteraction:self->_uikitInteraction
                                configuration:configuration
        highlightPreviewForItemWithIdentifier:@"link"];
}

#pragma mark - The source stops painting for the duration




#pragma mark - UIKit is handed one preview, not a series of copies

- (void)testTheSamePreviewIsReturnedForHighlightingAndDismissing
{
  UIContextMenuConfiguration *configuration = [self _beginMenuAtPoint:CGPointMake(50, 20)];
  UITargetedPreview *lift =
      [self _liftPreviewFor:configuration];
  UITargetedPreview *again =
      [self _liftPreviewFor:configuration];
  UITargetedPreview *dismissing =
      [_interaction contextMenuInteraction:self->_uikitInteraction
                                configuration:configuration
        dismissalPreviewForItemWithIdentifier:@"link"];

  XCTAssertTrue(lift == again, @"a second ask must not build a second preview");
  /*
   * The DISMISSAL preview is deliberately NOT the same object.
   *
   * It has to aim at where the link is when the menu closes, which is not where
   * it was when the menu opened if the page has scrolled in between — that was
   * the "release the chip and scroll and it targets the pre-scroll position"
   * report. What must stay identical is the VIEW and the SHAPE, so there is
   * nothing for UIKit to swap; only the target is recomputed.
   */
  XCTAssertTrue(dismissing.view == lift.view, @"the same view, so nothing is swapped");
}

#pragma mark - The lift is not clipped by the page



#pragma mark - The lift is not clipped by the page

- (void)testTheLiftTravelsWithTheTextRatherThanTheWindow
{
  /*
   * The stand-in shares the LINK'S coordinate space.
   *
   * It lived in the window once, and scrolling showed why that was wrong:
   * window coordinates do not move with content, so after dismissing a menu and
   * scrolling, UIKit animated the text back to where the link used to be and
   * the real glyphs reappearing read as a jump.
   *
   * Deliberately NOT a Fabric component view either: those mount children by
   * index, and adding a foreign subview to one stopped the lift happening at
   * all, with nothing in the log to explain it. The run view is a plain
   * `UIView`, which is what makes it a safe parent.
   */
  UIView *clipper = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 320, 100)];
  clipper.clipsToBounds = YES;
  UIView *outer = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 320, 200)];
  outer.clipsToBounds = YES;
  [_window addSubview:outer];
  [outer addSubview:clipper];
  [clipper addSubview:_host];

  UIContextMenuConfiguration *configuration = [self _beginMenuAtPoint:CGPointMake(50, 20)];
  UITargetedPreview *preview = [self _liftPreviewFor:configuration];

  XCTAssertNotNil(preview);
  XCTAssertTrue(
      preview.view.superview == _run,
      @"the stand-in must share the text's coordinate space, or it does not scroll with it");
  /*
   * Stated positively, because the obvious negative check does not work:
   * React Native puts a `UIView (ComponentViewProtocol)` category on EVERY
   * view, so `respondsToSelector:@selector(mountChildComponentView:index:)` is
   * true for all of them and asserts nothing. What matters is that the parent
   * is a run — a plain painter — rather than a component view that mounts its
   * children by index.
   */
  XCTAssertTrue(
      [preview.view.superview isKindOfClass:[RCTAnonymousTextRunView class]],
      @"the stand-in must hang off the text run, not off a Fabric component view");
}
#pragma mark - Text that is not a link is untouched


#pragma mark - Every path UIKit can take lands on the same preview

- (void)testTheModernPerItemCallbacksReturnTheSamePreview
{
  /*
   * The pair iOS 16 replaced the deprecated callbacks with. Answering only the
   * old ones meant the lift came from one path and the MENU's preview from
   * another, so UIKit substituted its own and swapped the thing already on
   * screen as the menu appeared — the reported flicker. Nothing about the old
   * callbacks failing would have caught it, which is why this asserts across
   * BOTH generations wherever both exist.
   */
  UIContextMenuConfiguration *configuration = [self _beginMenuAtPoint:CGPointMake(50, 20)];
  UITargetedPreview *modernHighlight = [self _liftPreviewFor:configuration];
  UITargetedPreview *modernDismissal =
      [_interaction contextMenuInteraction:self->_uikitInteraction
                             configuration:configuration
     dismissalPreviewForItemWithIdentifier:@"link"];

  XCTAssertNotNil(modernHighlight, @"the iOS 16+ callback must be answered, not left to UIKit");
  XCTAssertNotNil(modernDismissal, @"and so must the dismissal, or UIKit substitutes its own");
  // Same view; the target is recomputed so the lift returns to where the link
  // is NOW rather than where it was when the menu opened.
  XCTAssertTrue(modernDismissal.view == modernHighlight.view, @"the same view on the way out");

#if !defined(__IPHONE_OS_VERSION_MIN_REQUIRED) || __IPHONE_OS_VERSION_MIN_REQUIRED < 160000
  // While iOS 15 is still supported the old pair is the only API UIKit has
  // there, so it must agree with the new one rather than build a second
  // preview. Compiled out with the implementation once the floor reaches 16.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  UITargetedPreview *legacy =
      [_interaction contextMenuInteraction:self->_uikitInteraction
          previewForHighlightingMenuWithConfiguration:configuration];
#pragma clang diagnostic pop
  XCTAssertTrue(legacy == modernHighlight, @"both generations must hand back one object");
#endif
}

- (void)testADetachedViewDeclinesToLiftInsteadOfRaising
{
  // `UIPreviewTarget` raises if its container is not in a window. A paragraph
  // unmounted between the touch and the lift would otherwise take the app down
  // over a long press, and a crash is never the better failure.
  [_host removeFromSuperview];

  UIContextMenuConfiguration *configuration = [self _beginMenuAtPoint:CGPointMake(50, 20)];
  UITargetedPreview *preview =
      [self _liftPreviewFor:configuration];

  XCTAssertNil(preview, @"no lift is the correct answer for a view that is not on screen");
  XCTAssertEqual(_run.subviews.count, 0u, @"and nothing is left covering the link");
}





- (void)testAStaleLiftCannotSurviveIntoTheNextMenu
{
  /*
   * The invariant behind all of the above: after a dismissal nothing pending
   * remains, so a second menu cannot inherit the first one's URL or rects. This
   * is what stops a recycled view from offering Open on a link belonging to the
   * screen it used to be.
   */
  [_interaction setInstalled:YES];
  UIContextMenuConfiguration *first = [self _beginMenuAtPoint:CGPointMake(50, 20)];
  UITargetedPreview *firstPreview = [self _liftPreviewFor:first];
  XCTAssertNotNil(firstPreview);

  [_interaction dismissMenuIfPresenting];

  // Asking for a preview again without a fresh configuration must produce
  // nothing: the pending lift is gone rather than merely hidden.
  XCTAssertNil([self _liftPreviewFor:first], @"a dismissed lift must not be re-servable");

  // ...and a genuinely new press builds a new one.
  UIContextMenuConfiguration *second = [self _beginMenuAtPoint:CGPointMake(50, 20)];
  UITargetedPreview *secondPreview = [self _liftPreviewFor:second];
  XCTAssertNotNil(secondPreview);
  XCTAssertTrue(secondPreview != firstPreview, @"the second menu must build its own preview");
}



#pragma mark - What UIKit must keep doing

/*
 * The tests above pin OUR behaviour. These pin APPLE'S — the handful of UIKit
 * facts this file is built on, each of which is currently true, none of which
 * we control.
 *
 * The point is the failure mode. Every visual fault in this file's history was
 * invisible to every test and visible only to a person looking at a screen: a
 * grey chip, a duplicated line, a hole in a paragraph, a 100ms flicker. If a
 * future iOS quietly changes one of these, the same thing happens again and the
 * suite stays green. Asserting them means an OS that moves under us fails a
 * test on the next run instead of reaching a user.
 *
 * If one of these ever fails, it is NOT a bug in this file — it is notice that
 * the lift needs rethinking against the new behaviour.
 */

- (void)testUIKitStillDressesTextLineRectsAsAChip
{
  /*
   * `initWithTextLineRects:` is what makes the lift look like iOS rather than
   * like our idea of iOS: it supplies the rounded shape AND the platter colour.
   * We deliberately override neither.
   *
   * A nil `visiblePath` would lift an unclipped rectangle; a nil
   * `backgroundColor` would lift glyphs with no chip behind them — which is
   * exactly the "the popout doesn't get the background" report, and it would
   * arrive without a single line of our code having changed.
   */
  NSArray<NSValue *> *lineRects = @[ [NSValue valueWithCGRect:CGRectMake(0, 0, 120, 20)] ];
  UIPreviewParameters *parameters =
      [[UIPreviewParameters alloc] initWithTextLineRects:lineRects];

  XCTAssertNotNil(parameters.visiblePath, @"UIKit stopped shaping a text lift; the chip is ours to draw now");
  XCTAssertNotNil(parameters.backgroundColor, @"UIKit stopped supplying the platter colour behind lifted text");
}

- (void)testUIKitStillJoinsSeveralLinesIntoOneShape
{
  // A link that wraps lifts as ONE continuous form, not a stack of boxes. That
  // joining is UIKit's; losing it would be visible only on a wrapped link,
  // which is the case least likely to be exercised by hand.
  NSArray<NSValue *> *lineRects = @[
    [NSValue valueWithCGRect:CGRectMake(40, 0, 120, 20)],
    [NSValue valueWithCGRect:CGRectMake(0, 24, 80, 20)],
  ];
  UIPreviewParameters *parameters =
      [[UIPreviewParameters alloc] initWithTextLineRects:lineRects];

  XCTAssertNotNil(parameters.visiblePath);
  // The shape must span BOTH lines: a path covering only the first would clip
  // the second line's glyphs out of the lift entirely.
  CGRect bounds = parameters.visiblePath.bounds;
  XCTAssertGreaterThan(
      CGRectGetMaxY(bounds), 24.0, @"the lifted shape no longer reaches the second line of a wrapped link");
}

- (void)testUIKitStillTakesItsTargetFromTheViewWeGiveIt
{
  /*
   * With no explicit `UIPreviewTarget`, `initWithView:parameters:` takes the
   * view's own place in its superview as the target. The whole design rests on
   * that: it is why the lift rises from the link and returns to it, and why
   * putting the stand-in in the window keeps the shadow unclipped.
   *
   * If UIKit ever stopped deriving the target this way, the lift would animate
   * from somewhere else entirely.
   */
  UIView *host = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 320, 200)];
  [_window addSubview:host];
  UIImageView *standIn = [[UIImageView alloc] initWithFrame:CGRectMake(40, 60, 120, 20)];
  [host addSubview:standIn];

  UITargetedPreview *preview =
      [[UITargetedPreview alloc] initWithView:standIn
                                   parameters:[[UIPreviewParameters alloc] init]];

  XCTAssertTrue(preview.target.container == host, @"UIKit no longer targets the view's own superview");
  XCTAssertTrue(preview.view == standIn, @"UIKit no longer previews the view it was handed");
}

- (void)testNothingIsLeftBehindWhenTheInteractionGoesAway
{
  /*
   * The cover is a view added to somebody else's view, so releasing the
   * interaction does not take it down by itself. Left behind it would sit over
   * the link showing a picture of text that may since have changed — stale
   * pixels rather than a hole, but still wrong, and nothing else would ever
   * remove it.
   */
  NSUInteger before = _run.subviews.count;
  @autoreleasepool {
    EXPTextLinkInteraction *doomed = [[EXPTextLinkInteraction alloc]
        initWithView:_host
            resolver:^id _Nullable(CGPoint point, NSMutableArray<NSValue *> *rects, UIView **outSourceView) {
              [rects addObject:[NSValue valueWithCGRect:CGRectMake(40, 10, 120, 20)]];
              *outSourceView = self->_run;
              return [NSURL URLWithString:@"https://reactnative.dev/"];
            }];
    [doomed setInstalled:YES];
    UIContextMenuInteraction *uikit = [[UIContextMenuInteraction alloc] initWithDelegate:doomed];
    UIContextMenuConfiguration *configuration =
        [doomed contextMenuInteraction:uikit configurationForMenuAtLocation:CGPointMake(50, 20)];
    XCTAssertNotNil([doomed contextMenuInteraction:uikit
                                     configuration:configuration
             highlightPreviewForItemWithIdentifier:@"link"]);
    XCTAssertGreaterThan(_run.subviews.count, before, @"precondition: the cover is in place");
  }

  XCTAssertEqual(_run.subviews.count, before, @"the cover outlived the interaction");
}

- (void)testTheLiftCapturesContentThatIsNotGlyphs
{
  /*
   * `<a><img></a>` — a link whose content is a picture.
   *
   * An image inside a link is NOT painted by the text run; it is mounted as its
   * own view alongside it, positioned by the inline layout. While the capture
   * rendered only the run, this produced an EMPTY chip for exactly the case
   * where the link IS the picture, with the real image left visible
   * underneath: "the popover shows no image, and I can see the image below".
   *
   * A plain coloured view stands in for the image here — what matters is that
   * it is a sibling of the run rather than something the run draws.
   */
  UIView *attachment = [[UIView alloc] initWithFrame:CGRectMake(40, 10, 120, 20)];
  attachment.backgroundColor = [UIColor colorWithRed:1 green:0 blue:0 alpha:1];
  [_host addSubview:attachment];

  [_interaction setInstalled:YES];
  UIContextMenuConfiguration *configuration = [self _beginMenuAtPoint:CGPointMake(50, 20)];
  UITargetedPreview *preview = [self _liftPreviewFor:configuration];
  XCTAssertNotNil(preview, @"a link made of non-glyph content must still lift");

  UIImage *image = [(UIImageView *)preview.view image];
  XCTAssertNotNil(image);

  // The captured pixels must actually contain the attachment, not an empty chip.
  UIGraphicsImageRenderer *renderer =
      [[UIGraphicsImageRenderer alloc] initWithSize:CGSizeMake(1, 1)];
  __block BOOL sawRed = NO;
  UIImage *probe = [renderer imageWithActions:^(UIGraphicsImageRendererContext *ctx) {
    // Draw the capture down to a single pixel; if it is blank this stays clear.
    [image drawInRect:CGRectMake(0, 0, 1, 1)];
  }];
  CGImageRef cgImage = probe.CGImage;
  uint8_t pixel[4] = {0, 0, 0, 0};
  CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
  CGContextRef ctx = CGBitmapContextCreate(
      pixel, 1, 1, 8, 4, space, kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGContextDrawImage(ctx, CGRectMake(0, 0, 1, 1), cgImage);
  CGContextRelease(ctx);
  CGColorSpaceRelease(space);
  sawRed = pixel[0] > 40 && pixel[3] > 40;

  XCTAssertTrue(
      sawRed,
      @"the capture is empty: content mounted as a view, rather than painted by the "
      @"run, is being left out of the lift");
}


#pragma mark - Clipping, scrolling, and lifts UIKit abandons

- (void)testTheLiftIsTargetedIntoTheWindowSoNothingCanClipIt
{
  /*
   * The stand-in lives in the text run so it scrolls with the text — but the
   * run is a box the size of a LINE. Left to itself,
   * `initWithView:parameters:` would target that superview, and UIKit puts the
   * lift inside its container: the chip and its shadow were cut off against it.
   *
   * Naming some ancestor instead only moves the question — you cannot assume an
   * ancestor is big enough. The window is the one container guaranteed to be.
   */
  [_interaction setInstalled:YES];
  UIContextMenuConfiguration *configuration = [self _beginMenuAtPoint:CGPointMake(50, 20)];
  UITargetedPreview *preview = [self _liftPreviewFor:configuration];

  XCTAssertNotNil(preview);
  XCTAssertTrue(preview.target.container == _window, @"the lift must be targeted into the window");
  XCTAssertTrue(preview.view.superview == _run, @"while the stand-in still travels with the text");
}

- (void)testTheDismissalAimsAtWhereTheLinkIsNowNotWhereItWas
{
  /*
   * Scroll after opening a menu and the link is somewhere else by the time it
   * closes. The preview handed back on the way out used to be the one built for
   * the lift, still carrying its original position, so the text flew to where
   * the link had been and then jumped into place. Reported exactly that way.
   *
   * Moving the run stands in for the scroll here.
   */
  [_interaction setInstalled:YES];
  UIContextMenuConfiguration *configuration = [self _beginMenuAtPoint:CGPointMake(50, 20)];
  UITargetedPreview *lift = [self _liftPreviewFor:configuration];
  XCTAssertNotNil(lift);
  const CGPoint before = lift.target.center;

  // The page scrolls.
  _run.frame = CGRectOffset(_run.frame, 0, -120);

  UITargetedPreview *dismissal =
      [_interaction contextMenuInteraction:self->_uikitInteraction
                             configuration:configuration
     dismissalPreviewForItemWithIdentifier:@"link"];

  XCTAssertNotNil(dismissal);
  XCTAssertEqualWithAccuracy(
      dismissal.target.center.y, before.y - 120, 0.5,
      @"the dismissal must follow the text, not return to the pre-scroll position");
}


#pragma mark - Nothing is ever hidden, so nothing has to be put back

- (void)testTheLinkIsCoveredRatherThanHidden
{
  /*
   * The design that made every "hole in the paragraph" bug impossible.
   *
   * Earlier versions HID the real glyphs for the duration of a lift, which
   * created state only UIKit could tell us to undo — and UIKit will not: there
   * is no callback for an abandoned interaction, and `willEndForConfiguration:`
   * is sent only sometimes. Measured: 633ms of hole while a finger was still
   * down, and a watchdog papering over it.
   *
   * Now the lift is an OPAQUE picture of the link laid over the link. The run
   * keeps painting throughout, so both of UIKit's behaviours are correct rather
   * than one being an error: hide the cover and the real glyphs show through;
   * abandon it and the real glyphs were never gone.
   */
  [_interaction setInstalled:YES];
  UIContextMenuConfiguration *configuration = [self _beginMenuAtPoint:CGPointMake(50, 20)];
  UITargetedPreview *preview = [self _liftPreviewFor:configuration];

  XCTAssertNotNil(preview);
  XCTAssertTrue(preview.view.superview == _run, @"the cover sits over the link, in the run");
  XCTAssertFalse(preview.view.hidden, @"and it covers — hiding is UIKit's business, not ours");
}

- (void)testAnEmptyCaptureIsRefused
{
  /*
   * A cover is only safe because it shows what is underneath. An EMPTY capture
   * would paste a blank rectangle over the link — a hole by another route, and
   * the exact symptom this design exists to prevent.
   *
   * Rather than enumerate the ways a capture can come back empty (a layer that
   * has never displayed, content dropped under memory pressure, a run
   * mid-relayout), the result is checked for contrast and refused if it has
   * none. Refusing costs a lift; pasting a blank costs a visible defect.
   */
  UIView *blankHost = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 320, 200)];
  blankHost.backgroundColor = [UIColor whiteColor];
  [_window addSubview:blankHost];
  EXPRecordingRunView *blankRun = [[EXPRecordingRunView alloc] initWithFrame:blankHost.bounds];
  [blankHost addSubview:blankRun];

  EXPTextLinkInteraction *interaction = [[EXPTextLinkInteraction alloc]
      initWithView:blankHost
          resolver:^id _Nullable(CGPoint point, NSMutableArray<NSValue *> *rects, UIView **outSourceView) {
            [rects addObject:[NSValue valueWithCGRect:CGRectMake(10, 10, 100, 20)]];
            *outSourceView = blankRun;
            return [NSURL URLWithString:@"https://reactnative.dev/"];
          }];
  [interaction setInstalled:YES];
  UIContextMenuInteraction *uikit = [[UIContextMenuInteraction alloc] initWithDelegate:interaction];

  // Nothing is drawn anywhere in that host, so the capture is one flat colour.
  UIContextMenuConfiguration *configuration =
      [interaction contextMenuInteraction:uikit configurationForMenuAtLocation:CGPointMake(20, 15)];
  UITargetedPreview *preview = [interaction contextMenuInteraction:uikit
                                                     configuration:configuration
                             highlightPreviewForItemWithIdentifier:@"link"];

  XCTAssertNil(preview, @"a capture with nothing in it must not become a cover");
  XCTAssertEqual(blankRun.subviews.count, 0u, @"and nothing blank is left over the link");
}

@end

#pragma mark - The menu says where the link goes

/*
 * iOS shows the WHOLE destination in a link menu's header:
 * `-[_UITextLinkInteractionHandler _titleForLink:]` is `return [url
 * _web_userVisibleString]` — WebKit's readable form of the whole URL — handed
 * to `menuWithTitle:` unshortened.
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
