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
 * How much of a radio's box takes a touch: all of it, so an author who gives
 * the element a box gets a control that works across it, and nothing past it,
 * since in a run the row is the target and a ring past the box would compete
 * with it. Asked through `hitTest:` and `pointInside:`, the calls UIKit makes.
 */
@interface EXPElementRadioHitAreaTests : XCTestCase
@end

@implementation EXPElementRadioHitAreaTests

/** A radio in its user-agent box, laid out the way the mounting layer leaves it. */
- (EXPElementRadioComponentView *)radio
{
  // The user-agent box, which is the INK's size now and not the target's.
  EXPElementRadioComponentView *view = [[EXPElementRadioComponentView alloc] initWithFrame:CGRectMake(0, 0, 22, 44)];
  // The mounting layer sizes the view and then lays it out; without this the
  // content view keeps its initial frame
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
    XCTAssertNotNil(hit, @"(%.0f, %.0f) is inside the box and hit nothing", points[i].x, points[i].y);
    XCTAssertTrue(
        hit == view || [hit isDescendantOfView:view],
        @"(%.0f, %.0f) is inside the box but missed the radio",
        points[i].x,
        points[i].y);
  }
}

- (void)testNothingOutsideTheBoxIsClaimed
{
  // Points 5 to 10pt outside a 22x44 box, on every side a 44pt target used to
  // reach. Each belongs to the row or to a neighbour, never to the radio.
  EXPElementRadioComponentView *view = [self radio];
  const CGPoint outside[] = {{-5, 22}, {26, 22}, {-10, 1}, {31, 43}, {-10, 43}, {11, 45}};
  for (size_t i = 0; i < sizeof(outside) / sizeof(outside[0]); i++) {
    XCTAssertFalse(
        [view pointInside:outside[i] withEvent:nil],
        @"(%.0f, %.0f) is outside the box but the radio claimed it",
        outside[i].x,
        outside[i].y);
  }
}

@end
