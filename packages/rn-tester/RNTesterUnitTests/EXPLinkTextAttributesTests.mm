/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import <react/renderer/attributedstring/TextAttributes.h>
#import <react/renderer/textlayoutmanager/RCTAttributedTextUtils.h>

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
