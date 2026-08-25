/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import <React/EXPElementRadioComponentView.h>

/*
 * How much of a radio's box actually takes a touch.
 *
 * The user-agent sheet gives `<input type="radio">` a 44x44 box for the Human
 * Interface Guidelines' minimum target, with the 22pt circle centred in it. The
 * box being 44pt is measurable from a screenshot and was; what a screenshot
 * cannot show is whether a touch 20pt from the centre — inside the box, well
 * outside the ink — actually reaches the control. Reported from a device as
 * still hard to hit while looking too widely spaced, which is exactly the shape
 * of a box that reserves 44pt of layout and accepts touches on rather less.
 *
 * So this asks the view the question directly, through `hitTest:`, which is the
 * same call UIKit makes when a finger lands.
 */
@interface EXPElementRadioHitAreaTests : XCTestCase
@end

@implementation EXPElementRadioHitAreaTests

/** A radio in its user-agent box, laid out the way the mounting layer leaves it. */
- (EXPElementRadioComponentView *)radio
{
  // The user-agent box, which is the INK's size now and not the target's.
  EXPElementRadioComponentView *view =
      [[EXPElementRadioComponentView alloc] initWithFrame:CGRectMake(0, 0, 32, 32)];
  // The mounting layer sizes the view and then lays it out; without this the
  // content view keeps whatever frame it was born with, which is the bug this
  // test exists to catch rather than to reproduce.
  [view layoutIfNeeded];
  return view;
}

- (void)testTheWholeBoxTakesATouch
{
  EXPElementRadioComponentView *view = [self radio];

  // Nine points across the 32pt box: centre, edge midpoints, corners.
  const CGPoint points[] = {
      {16, 16},
      {1, 16},
      {31, 16},
      {16, 1},
      {16, 31},
      {1, 1},
      {31, 1},
      {1, 31},
      {31, 31},
  };
  for (size_t i = 0; i < sizeof(points) / sizeof(points[0]); i++) {
    UIView *hit = [view hitTest:points[i] withEvent:nil];
    XCTAssertNotNil(
        hit,
        @"(%.0f, %.0f) is inside the box and hit nothing",
        points[i].x,
        points[i].y);
    XCTAssertTrue(
        hit == view || [hit isDescendantOfView:view],
        @"(%.0f, %.0f) is inside the box but missed the radio",
        points[i].x,
        points[i].y);
  }
}

- (void)testTheTargetReachesPastTheBox
{
  // The point of separating them. A 32pt box would be 32pt tappable if
  // `pointInside:` were left alone, which is under the guideline's 44pt; these
  // points are OUTSIDE the box and must still land on the control.
  EXPElementRadioComponentView *view = [self radio];
  const CGPoint outside[] = {{-5, 16}, {36, 16}, {16, -5}, {16, 36}, {-5, -5}};
  for (size_t i = 0; i < sizeof(outside) / sizeof(outside[0]); i++) {
    XCTAssertTrue(
        [view pointInside:outside[i] withEvent:nil],
        @"(%.0f, %.0f) is inside the 44pt target but was refused",
        outside[i].x,
        outside[i].y);
  }
}

- (void)testTheTargetStopsAtFortyFour
{
  // Not unbounded: a target that swallowed the whole row would take the taps
  // meant for a neighbouring radio, and the rows tile at this pitch.
  EXPElementRadioComponentView *view = [self radio];
  XCTAssertFalse(
      [view pointInside:CGPointMake(16, 45) withEvent:nil],
      @"the target reaches past 44pt and into the next row");
  XCTAssertFalse(
      [view pointInside:CGPointMake(-13, 16) withEvent:nil],
      @"the target reaches more than 44pt wide");
}

@end
