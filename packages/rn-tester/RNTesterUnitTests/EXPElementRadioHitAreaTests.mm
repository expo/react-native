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
 * The user-agent sheet gives `<input type="radio">` a 22x44 box on iOS: as tall
 * as the platform's row, and only as wide as the mark it draws, so that a run
 * of radios costs a list's worth of width rather than a column of empty target.
 * The box is measurable from a screenshot and was; what a screenshot cannot
 * show is whether a touch 20pt from the centre — inside the target, outside the
 * box — actually reaches the control. Reported from a device as hard to hit
 * while looking too widely spaced, which is exactly the shape of a box that
 * reserves layout it does not accept touches on.
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
      [[EXPElementRadioComponentView alloc] initWithFrame:CGRectMake(0, 0, 22, 44)];
  // The mounting layer sizes the view and then lays it out; without this the
  // content view keeps whatever frame it was born with, which is the bug this
  // test exists to catch rather than to reproduce.
  [view layoutIfNeeded];
  return view;
}

- (void)testTheWholeBoxTakesATouch
{
  EXPElementRadioComponentView *view = [self radio];

  // Nine points across the 22x44 box: centre, edge midpoints, corners.
  const CGPoint points[] = {
      {11, 22},
      {1, 22},
      {21, 22},
      {11, 1},
      {11, 43},
      {1, 1},
      {21, 1},
      {1, 43},
      {21, 43},
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
  // The point of separating them. A 22pt-wide box would be 22pt tappable if
  // `pointInside:` were left alone, which is half the guideline's 44pt; these
  // points are OUTSIDE the box and must still land on the control. Only the
  // horizontal axis has anything to make up — the box is already 44pt tall.
  EXPElementRadioComponentView *view = [self radio];
  const CGPoint outside[] = {{-5, 22}, {26, 22}, {-10, 1}, {31, 43}, {-10, 43}};
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
      [view pointInside:CGPointMake(11, 45) withEvent:nil],
      @"the target reaches past the box's own 44pt height and into the next row");
  XCTAssertFalse(
      [view pointInside:CGPointMake(-12, 22) withEvent:nil],
      @"the target reaches more than 44pt wide");
}

@end
