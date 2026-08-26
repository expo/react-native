/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import <react/renderer/attributedstring/TextAttributes.h>
#import <react/renderer/attributedstring/TextRoleMetrics.h>
#import <react/renderer/attributedstring/conversions.h>
#import <react/renderer/components/view/BaseViewProps.h>
#import <react/renderer/textlayoutmanager/RCTAttributedTextUtils.h>

using namespace facebook::react;

/*
 * The size a heading's margin is resolved against.
 *
 * `h1 { margin-block: 0.67em }` needs a font-size to multiply, and once the
 * size comes from the platform the layout layer cannot ask for it — resolving a
 * role needs UIKit, and layout does not run on a UI thread. So the text layer
 * publishes it into `TextRoleMetrics` and layout reads it.
 *
 * The claim that matters is not that the registry stores numbers. It is that
 * the number it stores is THE SIZE THE TEXT IS DRAWN AT — because a margin
 * resolved against anything else is a margin belonging to type that is not on
 * the screen, which is precisely the bug this replaced. So the central test
 * here compares the published size against what the text pipeline independently
 * produces for the same role, and never against a literal.
 *
 * The FALLBACK half — a host with no platform to ask, where the web ladder
 * stands in — is pinned in `HeadingMargins-itest.js`, which runs on exactly
 * such a host.
 */
@interface EXPTextRoleMetricsTests : XCTestCase
@end

@implementation EXPTextRoleMetricsTests

- (void)setUp
{
  [super setUp];
  // Each test states the registry it needs. Without this they would depend on
  // each other's publishes and on whatever the app had already published.
  TextRoleMetrics::reset();
}

- (void)tearDown
{
  TextRoleMetrics::reset();
  [super tearDown];
}

/** The size the text pipeline actually draws `ramp` at, with nothing else stated. */
- (CGFloat)drawnSizeForRamp:(DynamicTypeRamp)ramp
{
  TextAttributes attributes;
  attributes.dynamicTypeRamp = ramp;
  // As the cascade leaves a heading: no size of its own, the role supplies it.
  attributes.fontSize = std::numeric_limits<Float>::quiet_NaN();
  attributes.fontSizeMultiplier = std::numeric_limits<Float>::quiet_NaN();
  UIFont *font = RCTNSTextAttributesFromTextAttributes(attributes)[NSFontAttributeName];
  return font.pointSize;
}

- (void)testAnUnpublishedRoleHasNoSize
{
  // The state a host with no type scale is in, and the one the renderer's
  // fallback depends on being distinguishable. A zero here rather than an empty
  // answer would have every heading resolve its margin against nothing.
  XCTAssertFalse(TextRoleMetrics::sizeOf(DynamicTypeRamp::Title1).has_value());
}

- (void)testPublishingEveryRoleFillsEveryRole
{
  RCTPublishTextRoleMetrics();
  for (size_t index = 0; index < kDynamicTypeRampCount; index++) {
    const auto ramp = static_cast<DynamicTypeRamp>(index);
    const auto size = TextRoleMetrics::sizeOf(ramp);
    XCTAssertTrue(size.has_value(), @"role %s was left unpublished", toString(ramp).c_str());
    XCTAssertGreaterThan(*size, 0);
  }
}

- (void)testThePublishedSizeIsTheSizeTheTextIsDrawnAt
{
  /*
   * THE INVARIANT. A heading's margin is `factor x this`, so if this ever stops
   * being the size on screen the margins go with it — and they would still look
   * plausible, which is why it is asserted rather than reasoned about.
   *
   * Both sides are asked independently: one goes through the publisher, the
   * other through the attributed-string path that really produces the font.
   * Neither is a literal, so this keeps holding when Apple changes the scale.
   */
  RCTPublishTextRoleMetrics();
  for (size_t index = 0; index < kDynamicTypeRampCount; index++) {
    const auto ramp = static_cast<DynamicTypeRamp>(index);
    XCTAssertEqualWithAccuracy(
        *TextRoleMetrics::sizeOf(ramp),
        [self drawnSizeForRamp:ramp],
        0.01,
        @"role %s: the margin would resolve against a size the text is not drawn at",
        toString(ramp).c_str());
  }
}

- (void)testTheRolesAreDistinctEnoughToBeMeaningful
{
  /*
   * A guard against the whole scale collapsing to one value — which is what a
   * failed resolution looks like when it still produces a number, and which
   * every other assertion here would pass.
   */
  RCTPublishTextRoleMetrics();
  XCTAssertGreaterThan(*TextRoleMetrics::sizeOf(DynamicTypeRamp::Title1), *TextRoleMetrics::sizeOf(DynamicTypeRamp::Title2));
  XCTAssertGreaterThan(*TextRoleMetrics::sizeOf(DynamicTypeRamp::Title2), *TextRoleMetrics::sizeOf(DynamicTypeRamp::Title3));
  XCTAssertGreaterThan(*TextRoleMetrics::sizeOf(DynamicTypeRamp::Title3), *TextRoleMetrics::sizeOf(DynamicTypeRamp::Footnote));
}

- (void)testAFailedResolutionIsNotStoredAsASize
{
  // A role the platform could not answer must stay UNPUBLISHED, so the renderer
  // falls back to the cascade's size. Storing the failure as a number would
  // give every heading at that role a silently collapsed margin, several layers
  // away from the lookup that actually failed.
  TextRoleMetrics::publish(DynamicTypeRamp::Title1, 0);
  XCTAssertFalse(TextRoleMetrics::sizeOf(DynamicTypeRamp::Title1).has_value());

  TextRoleMetrics::publish(DynamicTypeRamp::Title1, -12);
  XCTAssertFalse(TextRoleMetrics::sizeOf(DynamicTypeRamp::Title1).has_value());

  TextRoleMetrics::publish(DynamicTypeRamp::Title1, std::numeric_limits<Float>::quiet_NaN());
  XCTAssertFalse(TextRoleMetrics::sizeOf(DynamicTypeRamp::Title1).has_value());

  // And a real one still lands, so the guard is rejecting the value rather than
  // the call.
  TextRoleMetrics::publish(DynamicTypeRamp::Title1, 28);
  XCTAssertEqualWithAccuracy(*TextRoleMetrics::sizeOf(DynamicTypeRamp::Title1), 28, 0.01);
}

- (void)testPublishingByNameUsesTheStylePropertysOwnVocabulary
{
  /*
   * Android resolves its type scale in Kotlin and sends the result across JNI
   * by NAME rather than by the enum's ordinal, so that the enum's order is not
   * copied into a second language where inserting a ramp would silently shift
   * it.
   *
   * Every name is checked against `toString`, which is the same spelling the
   * `dynamicTypeRamp` style property accepts — one vocabulary, not two.
   */
  for (size_t index = 0; index < kDynamicTypeRampCount; index++) {
    const auto ramp = static_cast<DynamicTypeRamp>(index);
    const Float size = 10 + (Float)index;
    XCTAssertTrue(TextRoleMetrics::publishByName(toString(ramp), size));
    XCTAssertEqualWithAccuracy(
        *TextRoleMetrics::sizeOf(ramp), size, 0.01, @"name %s landed on the wrong ramp", toString(ramp).c_str());
  }
}

- (void)testAnUnknownNamePublishesNothing
{
  XCTAssertFalse(TextRoleMetrics::publishByName("titleEnormous", 40));
  XCTAssertFalse(TextRoleMetrics::publishByName("", 40));
  for (size_t index = 0; index < kDynamicTypeRampCount; index++) {
    XCTAssertFalse(
        TextRoleMetrics::sizeOf(static_cast<DynamicTypeRamp>(index)).has_value(),
        @"an unknown name must not land on some ramp anyway");
  }
}

- (void)testRepublishingOverwrites
{
  // The user changing their text size re-publishes, and the new sizes have to
  // replace the old ones rather than being ignored as already-present.
  TextRoleMetrics::publish(DynamicTypeRamp::Body, 17);
  TextRoleMetrics::publish(DynamicTypeRamp::Body, 53);
  XCTAssertEqualWithAccuracy(*TextRoleMetrics::sizeOf(DynamicTypeRamp::Body), 53, 0.01);
}


#pragma mark - The user-agent origin channel

/*
 * `uaFontSizeEm` / `uaFontWeight` are the user-agent stylesheet's own
 * declarations, in properties an author never writes.
 *
 * They exist so the sheet can state a size UNCONDITIONALLY and let the renderer
 * decide whether it applies — which is what removed the stylesheet's branch on
 * which host it was running on. The two halves both have to hold:
 *
 *   - where the platform answers the role, the sheet's values must NOT apply,
 *     or every heading on every device would be the web's size in the web's
 *     weight and the role would be decorative;
 *   - where it does not, they MUST apply, or the run is left with no size at
 *     all — which is the crash this closed.
 */

/** The attributes a heading's element props produce, as the cascade builds them. */
- (TextAttributes)attributesForRamp:(DynamicTypeRamp)ramp uaSizeEm:(Float)uaSizeEm uaWeight:(std::optional<FontWeight>)uaWeight
{
  BaseViewProps props;
  props.inheritedDynamicTypeRamp = ramp;
  // As the cascade leaves a heading that states neither of its own.
  props.inheritedFontSize = std::numeric_limits<Float>::quiet_NaN();
  props.inheritedFontWeight = {};
  props.uaFontSizeEm = uaSizeEm;
  props.uaFontWeight = uaWeight;

  TextAttributes attributes = TextAttributes::defaultTextAttributes();
  props.applyInheritedTextAttributes(attributes);
  return attributes;
}

- (void)testTheSheetsSizeIsIgnoredWhereThePlatformAnswers
{
  TextRoleMetrics::publish(DynamicTypeRamp::Title1, 28);
  TextAttributes attributes = [self attributesForRamp:DynamicTypeRamp::Title1 uaSizeEm:2 uaWeight:FontWeight::Bold];

  // Left UNSET rather than filled with 28: the platform is asked for a whole
  // FONT downstream, which carries the weight and the leading too. Filling in
  // the number here would win the size and quietly lose the rest.
  XCTAssertTrue(std::isnan(attributes.fontSize), @"the sheet's size must not stand in here");
  XCTAssertFalse(attributes.fontWeight.has_value(), @"the sheet's weight must not stand in here");
}

- (void)testTheSheetsSizeStandsInWhereNothingAnswers
{
  // No publish: a host with no type scale, or a role that failed to resolve.
  TextAttributes attributes = [self attributesForRamp:DynamicTypeRamp::Title1 uaSizeEm:2 uaWeight:FontWeight::Bold];

  XCTAssertFalse(std::isnan(attributes.fontSize), @"an unresolvable role must not leave the run unsized");
  // The sheet states a FACTOR, so what stands in is that factor against the
  // size in scope — here nothing is inherited, so the initial size. Stating
  // the arithmetic rather than 34 keeps this true wherever the initial size
  // differs, which is the whole reason the property became an `em`.
  XCTAssertEqualWithAccuracy(
      attributes.fontSize, 2 * TextAttributes::initialFontSize(), 0.01);
  XCTAssertTrue(attributes.fontWeight.has_value());
  XCTAssertEqual(*attributes.fontWeight, FontWeight::Bold);
}

- (void)testAnUnresolvableRoleWithNoSheetValueLeavesTheSizeInScopeStanding
{
  /*
   * The honest limit of the guard: it stands in what the SHEET gave it, and
   * here the sheet gave nothing.
   *
   * Nothing answers the role and no `em` factor is stated, so this element
   * declares no size at all — and an element that declares no size inherits
   * one. That is the difference `resolveFontSize` draws between "no answer"
   * and "an answer that is NaN": the branch above, where the platform DOES
   * answer, deliberately unsets the size so the whole platform font is asked
   * for downstream; this branch must not, or naming a role a host cannot
   * resolve would leave the run with no size to fall back to.
   *
   * Nothing is inherited in this fixture, so what stands is the initial size.
   * Stated as `initialFontSize()` rather than 17 for the same reason the sheet
   * moved to `em`: the number is a property of the platform, not of the test.
   */
  TextAttributes attributes =
      [self attributesForRamp:DynamicTypeRamp::Title1 uaSizeEm:std::numeric_limits<Float>::quiet_NaN() uaWeight:{}];

  XCTAssertFalse(std::isnan(attributes.fontSize), @"an unresolvable role must not leave the run unsized");
  XCTAssertEqualWithAccuracy(attributes.fontSize, TextAttributes::initialFontSize(), 0.01);
}

- (void)testAnAuthorsSizeBeatsBothOfThem
{
  /*
   * The precedence the whole channel exists to express. An author writes
   * `fontSize`, which arrives as `inheritedFontSize`, and it outranks the
   * platform's role AND the user-agent sheet — which is what a user-agent
   * declaration does on the web, and what a single shared `style` slot cannot
   * represent.
   */
  TextRoleMetrics::publish(DynamicTypeRamp::Title1, 28);
  BaseViewProps props;
  props.inheritedDynamicTypeRamp = DynamicTypeRamp::Title1;
  props.inheritedFontSize = 13;
  props.inheritedFontWeight = FontWeight::Thin;
  props.uaFontSizeEm = 2;
  props.uaFontWeight = FontWeight::Bold;

  TextAttributes attributes = TextAttributes::defaultTextAttributes();
  props.applyInheritedTextAttributes(attributes);

  XCTAssertEqualWithAccuracy(attributes.fontSize, 13, 0.01);
  XCTAssertEqual(*attributes.fontWeight, FontWeight::Thin);
}

- (void)testTheSizeAndTheWeightAgreeOnWhoAnswered
{
  /*
   * They are decided from ONE question, and this is why that matters: a heading
   * drawn at the sheet's size in the platform's weight — or the reverse — is
   * neither, and would look like a font bug rather than a cascade one.
   */
  for (const bool published : {true, false}) {
    TextRoleMetrics::reset();
    if (published) {
      TextRoleMetrics::publish(DynamicTypeRamp::Title1, 28);
    }
    TextAttributes attributes = [self attributesForRamp:DynamicTypeRamp::Title1 uaSizeEm:2 uaWeight:FontWeight::Bold];
    XCTAssertEqual(
        std::isnan(attributes.fontSize),
        !attributes.fontWeight.has_value(),
        @"size and weight disagreed about whether the platform answered");
  }
}

@end
