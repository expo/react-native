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
 * Text ROLES are answered by the platform, not by a table.
 *
 * A heading names `title1` and the renderer asks `[UIFont
 * preferredFontForTextStyle:]` what that is, rather than carrying a copy of
 * today's answer. A copied number is right until the platform moves, and then
 * wrong in a way nothing detects.
 *
 * So every assertion here compares against UIKit'S OWN ANSWER rather than a
 * literal. If Apple changes Title 1 tomorrow, the renderer and these tests move
 * together and stay green — which is the property being tested. A test that
 * said `XCTAssertEqual(size, 28)` would be the same mistake one layer up.
 *
 * This applies to the ELEMENTS only. React Native's own
 * `RCTBaseSizeForDynamicTypeRamp` still holds its table and still serves
 * `<Text dynamicTypeRamp>` unchanged; the element path resolves alongside it
 * rather than through it. `-testAnRNTextWithARampIsUntouched` is that boundary
 * written down.
 */
@interface EXPPlatformTextRoleTests : XCTestCase
@end

@implementation EXPPlatformTextRoleTests

/** The font the renderer produces for a role, with nothing else stated. */
- (UIFont *)fontForRamp:(DynamicTypeRamp)ramp
{
  TextAttributes attributes;
  attributes.dynamicTypeRamp = ramp;
  // As the cascade leaves it when the element states no size or weight of its
  // own: the role is expected to supply both.
  attributes.fontSize = std::numeric_limits<Float>::quiet_NaN();
  attributes.fontSizeMultiplier = 1.0;
  NSDictionary<NSAttributedStringKey, id> *nsAttributes = RCTNSTextAttributesFromTextAttributes(attributes);
  return nsAttributes[NSFontAttributeName];
}

- (UIFont *)platformFontForTextStyle:(UIFontTextStyle)style
{
  return [UIFont preferredFontForTextStyle:style
               compatibleWithTraitCollection:[UITraitCollection
                                                 traitCollectionWithPreferredContentSizeCategory:
                                                     UIContentSizeCategoryLarge]];
}

- (void)testEachRoleTakesThePlatformsSize
{
  const std::pair<DynamicTypeRamp, UIFontTextStyle> roles[] = {
      {DynamicTypeRamp::Title1, UIFontTextStyleTitle1},
      {DynamicTypeRamp::Title2, UIFontTextStyleTitle2},
      {DynamicTypeRamp::Title3, UIFontTextStyleTitle3},
      {DynamicTypeRamp::Headline, UIFontTextStyleHeadline},
      {DynamicTypeRamp::Subheadline, UIFontTextStyleSubheadline},
      {DynamicTypeRamp::Footnote, UIFontTextStyleFootnote},
  };
  for (const auto &[ramp, style] : roles) {
    UIFont *produced = [self fontForRamp:ramp];
    XCTAssertNotNil(produced);
    XCTAssertEqualWithAccuracy(
        produced.pointSize,
        [self platformFontForTextStyle:style].pointSize,
        0.01,
        @"role %@ did not take the platform's size",
        style);
  }
}

- (void)testHeadlineKeepsItsSemibold
{
  /*
   * The half a size table cannot express, and the reason this is about fonts
   * rather than numbers: Headline and Body are BOTH 17pt, and the only thing
   * that distinguishes them is that Headline is semibold. Asking for a size
   * gets the same answer for each.
   */
  UIFont *headline = [self fontForRamp:DynamicTypeRamp::Headline];
  UIFont *body = [self fontForRamp:DynamicTypeRamp::Body];
  XCTAssertEqualWithAccuracy(headline.pointSize, body.pointSize, 0.01, @"the premise: same size");

  NSDictionary *headlineTraits = [headline.fontDescriptor objectForKey:UIFontDescriptorTraitsAttribute];
  NSDictionary *bodyTraits = [body.fontDescriptor objectForKey:UIFontDescriptorTraitsAttribute];
  const double headlineWeight = [headlineTraits[UIFontWeightTrait] doubleValue];
  const double bodyWeight = [bodyTraits[UIFontWeightTrait] doubleValue];

  XCTAssertGreaterThan(headlineWeight, bodyWeight, @"Headline should be heavier than Body");
  XCTAssertEqualWithAccuracy(
      headlineWeight,
      [[[self platformFontForTextStyle:UIFontTextStyleHeadline].fontDescriptor
          objectForKey:UIFontDescriptorTraitsAttribute][UIFontWeightTrait] doubleValue],
      0.01,
      @"the weight should be the platform's, not one of ours");
}

- (void)testAnExplicitSizeStillWins
{
  // The role is the INITIAL value, not an override: an author who states a size
  // gets it. A user-agent stylesheet gives way to an author's on the web, and a
  // platform default has to give way the same.
  TextAttributes attributes;
  attributes.dynamicTypeRamp = DynamicTypeRamp::Title1;
  attributes.fontSize = 13;
  attributes.fontSizeMultiplier = 1.0;
  UIFont *font = RCTNSTextAttributesFromTextAttributes(attributes)[NSFontAttributeName];
  XCTAssertEqualWithAccuracy(font.pointSize, 13, 0.01);
}

- (void)testAnRNTextWithARampIsUntouched
{
  /*
   * THE BOUNDARY: new elements use the platform, old React Native components
   * behave exactly as they did.
   *
   * `dynamicTypeRamp` is an existing `<Text>` prop with existing semantics — it
   * selects the Dynamic Type CURVE and nothing else, leaving the size to the
   * author. A `<Text>` that states no size gets React Native's default, not
   * NaN, which is what keeps it out of the branch above: the role fills in a
   * size only where there is genuinely none, and for a `<Text>` there never is.
   *
   * Asserted rather than reasoned about, because the two paths share one field
   * and the failure would be silent — every `<Text dynamicTypeRamp="title1">`
   * in every app on this fork would quietly jump from 17pt to 28pt.
   */
  TextAttributes attributes;
  attributes.dynamicTypeRamp = DynamicTypeRamp::Title1;
  // Exactly what BaseTextProps leaves when the author states no `fontSize`.
  attributes.fontSize = TextAttributes::defaultTextAttributes().fontSize;
  attributes.fontSizeMultiplier = 1.0;
  UIFont *font = RCTNSTextAttributesFromTextAttributes(attributes)[NSFontAttributeName];

  XCTAssertEqualWithAccuracy(
      font.pointSize,
      TextAttributes::defaultTextAttributes().fontSize,
      0.01,
      @"a <Text> with a ramp must keep React Native's size");
  XCTAssertNotEqualWithAccuracy(
      font.pointSize,
      [self platformFontForTextStyle:UIFontTextStyleTitle1].pointSize,
      0.01,
      @"the role must NOT have supplied a size here");
}

- (void)testAnExplicitWeightStillWins
{
  // The same for weight, which is what h5 and h6 rely on: they take the
  // platform's SIZE for a secondary-text role but state a heavier weight, so
  // that a low-level heading still reads as a heading.
  TextAttributes attributes;
  attributes.dynamicTypeRamp = DynamicTypeRamp::Subheadline;
  attributes.fontSize = std::numeric_limits<Float>::quiet_NaN();
  attributes.fontWeight = FontWeight::Semibold;
  attributes.fontSizeMultiplier = 1.0;
  UIFont *font = RCTNSTextAttributesFromTextAttributes(attributes)[NSFontAttributeName];

  XCTAssertEqualWithAccuracy(
      font.pointSize,
      [self platformFontForTextStyle:UIFontTextStyleSubheadline].pointSize,
      0.01,
      @"the size should still be the platform's");
  NSDictionary *traits = [font.fontDescriptor objectForKey:UIFontDescriptorTraitsAttribute];
  XCTAssertGreaterThan(
      [traits[UIFontWeightTrait] doubleValue],
      0.0,
      @"a stated weight should survive the role");
}

@end
