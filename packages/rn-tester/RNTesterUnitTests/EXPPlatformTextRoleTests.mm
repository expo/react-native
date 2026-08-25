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
 * Text roles are answered by the platform: a heading names `title1` and the
 * renderer asks `[UIFont preferredFontForTextStyle:]`, so every assertion here
 * compares against UIKit's own answer rather than a literal. React Native's
 * `RCTBaseSizeForDynamicTypeRamp` keeps its table for `<Text dynamicTypeRamp>`;
 * `-testAnRNTextWithARampIsUntouched` pins that boundary.
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
  return [UIFont
          preferredFontForTextStyle:style
      compatibleWithTraitCollection:[UITraitCollection
                                        traitCollectionWithPreferredContentSizeCategory:UIContentSizeCategoryLarge]];
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
   * Headline and Body are both 17pt and differ only in weight, which a size
   * table cannot express.
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
  // The role is the initial value, not an override: an author's size wins
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
   * `dynamicTypeRamp` selects the Dynamic Type curve and leaves the size to the
   * author, and a `<Text>` without a size gets React Native's default rather
   * than NaN, so the role never fills in a size for it. Asserted because the two
   * paths share one field and the failure would be a silent 17pt to 28pt jump.
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
  // The same for weight: h5 and h6 take a secondary role's size with a heavier
  // weight
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
  XCTAssertGreaterThan([traits[UIFontWeightTrait] doubleValue], 0.0, @"a stated weight should survive the role");
}

@end
