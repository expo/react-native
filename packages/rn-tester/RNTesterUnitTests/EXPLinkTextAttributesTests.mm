/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import <react/renderer/attributedstring/AttributedString.h>
#import <react/renderer/attributedstring/TextAttributes.h>
#import <react/renderer/textlayoutmanager/RCTAttributedTextUtils.h>
#import <react/renderer/textlayoutmanager/RCTTextLayoutManager.h>

using namespace facebook::react;

/*
 * What iOS itself does to link text.
 *
 * The user-agent sheet gives `<a href>` the platform's link colour and NO
 * underline, which is a deliberate departure from `html.css` and from every
 * browser. The justification is not a preference — it is what UIKit does — so
 * it is pinned here against UIKit rather than written down as an opinion.
 *
 * If Apple starts underlining links, this fails and the sheet should follow it.
 */
@interface EXPLinkTextAttributesTests : XCTestCase
@end

@implementation EXPLinkTextAttributesTests

- (void)testUIKitDoesNotUnderlineLinks
{
  /*
   * THE DEVIATION, stated as the platform's own answer.
   *
   * `UITextView`'s default `linkTextAttributes` colours a link and stops there:
   * there is no underline attribute in it at all. An underline in a native iOS
   * document therefore reads as a web page, which is the specific thing the
   * element vocabulary is trying not to look like.
   */
  UITextView *textView = [[UITextView alloc] initWithFrame:CGRectMake(0, 0, 100, 40)];
  XCTAssertNil(
      textView.linkTextAttributes[NSUnderlineStyleAttributeName],
      @"UIKit now underlines links; the user-agent sheet should follow it");
}

- (void)testTheLinkColourIsAdaptive
{
  /*
   * `LinkText` in `systemColors.js` resolves to this colour. The property that
   * matters is that it MOVES between appearances — a fixed `#0000EE`, which is
   * what the sheet used to state, cannot, and a document in dark mode got
   * hyperlink blue on near-black.
   */
  UIColor *light = [UIColor.linkColor
      resolvedColorWithTraitCollection:[UITraitCollection
                                           traitCollectionWithUserInterfaceStyle:UIUserInterfaceStyleLight]];
  UIColor *dark = [UIColor.linkColor
      resolvedColorWithTraitCollection:[UITraitCollection
                                           traitCollectionWithUserInterfaceStyle:UIUserInterfaceStyleDark]];
  XCTAssertNotNil(light);
  XCTAssertNotNil(dark);
  XCTAssertFalse(
      [light isEqual:dark],
      @"the link colour must differ between light and dark, or it is not adaptive");
}


- (void)testAnAnchorsURLLandsInUIKitsOwnLinkAttribute
{
  /*
   * A link inside a paragraph is a RANGE OF GLYPHS, not a view, so its
   * destination has to travel in the text attributes. It goes into
   * `NSLinkAttributeName` — UIKit's own key — rather than a private one of
   * ours, so that the platform's interactions can read it back and any host
   * that put this attributed string in a real `UITextView` would already
   * understand it.
   */
  TextAttributes attributes;
  attributes.href = "https://example.com/one";
  NSDictionary<NSAttributedStringKey, id> *ns = RCTNSTextAttributesFromTextAttributes(attributes);

  id link = ns[NSLinkAttributeName];
  XCTAssertNotNil(link, @"an anchor's href must reach UIKit's link attribute");
  XCTAssertTrue([link isKindOfClass:[NSURL class]]);
  XCTAssertEqualObjects([(NSURL *)link absoluteString], @"https://example.com/one");
}

- (void)testTextWithNoHrefCarriesNoLinkAttribute
{
  // The common case by far, and the one that must not become a link: every run
  // of ordinary text goes through the same conversion.
  TextAttributes attributes;
  XCTAssertNil(RCTNSTextAttributesFromTextAttributes(attributes)[NSLinkAttributeName]);
}

- (void)testAnUnparseableHrefIsStillALink
{
  /*
   * `NSLinkAttributeName` takes an NSURL or a string, and a destination NSURL
   * refuses to parse is still what the author wrote. Dropping the attribute
   * would leave the range unable to say it is a link at all — losing the
   * interaction as well as the navigation, over a URL that a custom scheme
   * handler might well accept.
   */
  TextAttributes attributes;
  attributes.href = "not a url at all";
  id link = RCTNSTextAttributesFromTextAttributes(attributes)[NSLinkAttributeName];
  XCTAssertNotNil(link);
}


- (void)testTheLinkAttributeDoesNotBringBackAnUnderline
{
  /*
   * A REGRESSION THAT ALREADY HAPPENED. `NSLayoutManager` underlines a link by
   * itself — `NSLinkAttributeName` is a style to TextKit as well as a
   * destination, inherited from the macOS text system — so carrying the URL
   * silently restored the web's underline on iOS and undid the deviation the
   * user-agent sheet states. It was visible on screen and no test saw it.
   */
  TextAttributes attributes;
  attributes.href = "https://example.com/";
  NSDictionary<NSAttributedStringKey, id> *ns = RCTNSTextAttributesFromTextAttributes(attributes);

  XCTAssertEqualObjects(
      ns[NSUnderlineStyleAttributeName],
      @(NSUnderlineStyleNone),
      @"a link must state that it is NOT underlined; absent means TextKit's link default, which is underlined");

  /*
   * And the part that actually does the work. `NSUnderlineStyleNone` alone is
   * IGNORED for a link range — the underline stayed on screen with it set, and
   * with this very assertion passing. Drawing the underline in a clear colour
   * is what removes it, so that is what has to be pinned.
   */
  XCTAssertEqualObjects(
      ns[NSUnderlineColorAttributeName],
      UIColor.clearColor,
      @"the style alone does not suppress a link's underline; the clear colour does");
}

- (void)testAnAuthorsUnderlineSurvivesTheLinkAttribute
{
  // The other half: the suppression must only apply where the cascade resolved
  // to no underline. An author who asked for one — and Android, where the
  // platform underlines links — must still get it.
  TextAttributes attributes;
  attributes.href = "https://example.com/";
  attributes.textDecorationLineType = TextDecorationLineType::Underline;
  NSDictionary<NSAttributedStringKey, id> *ns = RCTNSTextAttributesFromTextAttributes(attributes);

  XCTAssertNotEqualObjects(ns[NSUnderlineStyleAttributeName], @(NSUnderlineStyleNone));
}

@end

#pragma mark - Which link is under a point

/*
 * Three links side by side, each wrapping something that is not glyphs.
 *
 * `<a><img></a><a><img></a>` puts three ATTACHMENT characters next to each
 * other, and the whole question of which link the user pressed comes down to
 * mapping a point to one of three characters that look nothing like text. This
 * is asserted here rather than by pressing the simulator because a synthetic
 * long press turned out not to land where it was aimed — every tap arrived at
 * the same point — which is exactly the kind of instrument failure that reads
 * as a product bug.
 */
@interface EXPAdjacentLinkHitTests : XCTestCase
@end

@implementation EXPAdjacentLinkHitTests {
  RCTTextLayoutManager *_layoutManager;
}

static const CGFloat kBox = 72;

- (void)setUp
{
  [super setUp];
  _layoutManager = [RCTTextLayoutManager new];
}

/** Three boxes in a row, each carrying a different `href`. */
- (AttributedString)_threeAdjacentLinks
{
  auto base = TextAttributes::defaultTextAttributes();
  base.fontSize = 15;

  auto string = AttributedString{};
  for (const std::string &name : {"one", "two", "three"}) {
    auto attributes = base;
    attributes.href = "https://reactnative.dev/" + name;

    auto fragment = AttributedString::Fragment{};
    fragment.string = AttributedString::Fragment::AttachmentCharacter();
    fragment.textAttributes = attributes;
    auto metrics = LayoutMetrics{};
    metrics.frame.size = {kBox, kBox};
    fragment.parentShadowView.layoutMetrics = metrics;
    fragment.atomicInlineBaseline = kBox;
    string.appendFragment(std::move(fragment));
  }
  string.setBaseTextAttributes(base);
  return string;
}

- (nullable NSString *)_linkAtX:(CGFloat)x
{
  auto string = [self _threeAdjacentLinks];
  const CGRect frame = CGRectMake(0, 0, kBox * 3 + 40, 120);
  id link = [_layoutManager getLinkWithAttributedString:string
                                    paragraphAttributes:ParagraphAttributes{}
                                                  frame:frame
                                                atPoint:CGPointMake(x, kBox / 2)
                                                  rects:nil];
  return [link isKindOfClass:[NSURL class]] ? ((NSURL *)link).absoluteString : [link description];
}

- (void)testEachOfThreeAdjacentLinksAnswersForItsOwnBox
{
  XCTAssertEqualObjects([self _linkAtX:kBox * 0.5], @"https://reactnative.dev/one");
  XCTAssertEqualObjects([self _linkAtX:kBox * 1.5], @"https://reactnative.dev/two");
  XCTAssertEqualObjects([self _linkAtX:kBox * 2.5], @"https://reactnative.dev/three");
}

- (void)testTheBoundaryBetweenTwoLinksBelongsToTheBoxItIsInside
{
  // Just inside each edge of the middle box. An off-by-one here is invisible
  // in the middle of a box and obvious at its edges.
  XCTAssertEqualObjects([self _linkAtX:kBox + 2], @"https://reactnative.dev/two");
  XCTAssertEqualObjects([self _linkAtX:kBox * 2 - 2], @"https://reactnative.dev/two");
}

@end

#pragma mark - The rects a wrapped link occupies

/*
 * A link that WRAPS occupies one rect per line, and everything downstream needs
 * all of them: the view that paints the link is sized from them, the run paints
 * the exact complement, and a touch resolves through them.
 *
 * They used to come from `getRectWithAttributedString:`, which reports a single
 * rect per fragment. A wrapped link therefore existed, everywhere but the hit
 * test, as its FIRST LINE ONLY — so it was painted and lifted as one line, and
 * a press on its second line found a link with no view to lift, which UIKit
 * answered with a preview of its own.
 */
@interface EXPWrappedLinkRectTests : XCTestCase
@end

@implementation EXPWrappedLinkRectTests {
  RCTTextLayoutManager *_layoutManager;
}

- (void)setUp
{
  [super setUp];
  _layoutManager = [RCTTextLayoutManager new];
}

- (AttributedString)_stringWithLinkText:(const std::string &)linkText trailing:(const std::string &)trailing
{
  auto base = TextAttributes::defaultTextAttributes();
  base.fontSize = 15;

  auto linkAttributes = base;
  linkAttributes.href = "https://reactnative.dev/";
  linkAttributes.role = facebook::react::Role::Link;

  auto string = AttributedString{};
  auto link = AttributedString::Fragment{};
  link.string = linkText;
  link.textAttributes = linkAttributes;
  string.appendFragment(std::move(link));

  if (!trailing.empty()) {
    auto rest = AttributedString::Fragment{};
    rest.string = trailing;
    rest.textAttributes = base;
    string.appendFragment(std::move(rest));
  }
  string.setBaseTextAttributes(base);
  return string;
}

- (NSArray<NSArray<NSValue *> *> *)_groupsFor:(AttributedString)string width:(CGFloat)width
{
  NSMutableArray<NSArray<NSValue *> *> *groups = [NSMutableArray array];
  [_layoutManager getLineRectGroupsWithAttributedString:string
                                    paragraphAttributes:ParagraphAttributes{}
                                     enumerateAttribute:RCTTextAttributesAccessibilityRoleAttributeName
                                                  frame:CGRectMake(0, 0, width, 400)
                                             usingBlock:^(NSArray<NSValue *> *lineRects, NSString *value) {
                                               if ([value isEqualToString:@"link"]) {
                                                 [groups addObject:lineRects];
                                               }
                                             }];
  return groups;
}

- (void)testAWrappedLinkReportsEveryLineItOccupies
{
  // Narrow enough that the link cannot fit on one line.
  auto string = [self _stringWithLinkText:"a link long enough that it has to wrap onto a second line" trailing:""];
  NSArray<NSArray<NSValue *> *> *groups = [self _groupsFor:string width:160];

  XCTAssertEqual(groups.count, 1u, @"one link is one group, however many lines it takes");
  XCTAssertGreaterThan(
      groups.firstObject.count, 1u, @"a wrapped link must report a rect per line, not just its first");

  CGRect union_ = CGRectNull;
  for (NSValue *rect in groups.firstObject) {
    union_ = CGRectIsNull(union_) ? rect.CGRectValue : CGRectUnion(union_, rect.CGRectValue);
  }
  const CGFloat oneLine = CGRectGetHeight(groups.firstObject.firstObject.CGRectValue);
  XCTAssertGreaterThan(
      CGRectGetHeight(union_), oneLine * 1.5, @"the rects together must span more than the first line");

  /*
   * And the contrast that makes the assertion above mean something: the
   * per-FRAGMENT API, on this same string, reports one rect covering only the
   * first line. That is what the renderer used to paint links from, and it is
   * why this second API had to exist.
   */
  __block NSUInteger fragmentRects = 0;
  __block CGRect firstFragmentRect = CGRectNull;
  [_layoutManager getRectWithAttributedString:string
                          paragraphAttributes:ParagraphAttributes{}
                           enumerateAttribute:RCTTextAttributesAccessibilityRoleAttributeName
                                        frame:CGRectMake(0, 0, 160, 400)
                                   usingBlock:^(CGRect rect, NSString *text, NSString *value) {
                                     if ([value isEqualToString:@"link"]) {
                                       fragmentRects++;
                                       if (CGRectIsNull(firstFragmentRect)) {
                                         firstFragmentRect = rect;
                                       }
                                     }
                                   }];
  XCTAssertEqual(fragmentRects, 1u, @"the per-fragment API reports a single rect");
  XCTAssertLessThan(
      CGRectGetHeight(firstFragmentRect),
      CGRectGetHeight(union_),
      @"...and it is SHORTER than the link really is — the bug this replaced");
}

- (void)testAnUnwrappedLinkIsStillJustOneRect
{
  auto string = [self _stringWithLinkText:"short" trailing:" and ordinary words after it"];
  NSArray<NSArray<NSValue *> *> *groups = [self _groupsFor:string width:400];

  XCTAssertEqual(groups.count, 1u);
  XCTAssertEqual(groups.firstObject.count, 1u, @"a link on one line occupies one rect");
}

- (void)testALinkDoesNotClaimTheOrdinaryWordsAfterIt
{
  /*
   * The rect must hug the link's glyphs. Widening it to the line — which both
   * of the obvious TextKit APIs do — lifted the words after the link as well,
   * and those words then showed twice: once raised, once on the page beneath.
   */
  auto string = [self _stringWithLinkText:"link" trailing:" and a good deal of ordinary text after it"];
  NSArray<NSArray<NSValue *> *> *groups = [self _groupsFor:string width:400];

  const CGRect linkRect = groups.firstObject.firstObject.CGRectValue;
  XCTAssertLessThan(CGRectGetMaxX(linkRect), 200.0, @"the rect stops at the link, not at the line's end");
}

@end
