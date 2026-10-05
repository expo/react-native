/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import <React/EXPElementColorInputComponentView.h>
#import <React/EXPElementControlComponentView.h>
#import <React/EXPElementControlMetricsProbe.h>
#import <React/EXPElementDateInputComponentView.h>
#import <React/EXPElementFileInputComponentView.h>
#import <React/EXPElementTextInputComponentView.h>
#import <react/renderer/components/view/ElementDateInputShadowNode.h>

using namespace facebook::react;

/*
 * The startup probe's numbers against the controls the elements mount.
 *
 * The probe exists so a control's FIRST frame is its own size: layout runs
 * before any view exists, so without it a control appears at one size and
 * jumps to its real one when it mounts and reports. That only works while the
 * probe measures the same control the element builds. When it did not — the
 * probe measured a borderless field and the element mounted a rounded rect —
 * every `<input>` spent one frame the height of its placeholder.
 */
@interface EXPElementControlProbeTests : XCTestCase
@end

@implementation EXPElementControlProbeTests

/** A mounted element's control, laid out in a window the way the app's is. */
static CGSize MountedIntrinsicSize(EXPElementControlComponentView *view)
{
  UIWindow *window = [[UIWindow alloc] initWithFrame:CGRectMake(0, 0, 400, 300)];
  [window addSubview:view];
  [window layoutIfNeeded];
  const CGSize size = view.elementControl.intrinsicContentSize;
  [view removeFromSuperview];
  return size;
}

- (void)testTheTextFieldProbeMeasuresTheFieldTheElementMounts
{
  ElementControlMetrics metrics;
  EXPProbeTextFieldMetrics(metrics);
  const CGSize mounted =
      MountedIntrinsicSize([[EXPElementTextInputComponentView alloc] initWithFrame:CGRectMake(0, 0, 200, 40)]);

  XCTAssertEqualWithAccuracy(metrics.textFieldDefaultHeight, mounted.height, 0.01);
}

- (void)testTheFileInputProbeMeasuresTheButtonTheElementMounts
{
  ElementControlMetrics metrics;
  EXPProbeFileInputMetrics(metrics);
  const CGSize mounted =
      MountedIntrinsicSize([[EXPElementFileInputComponentView alloc] initWithFrame:CGRectMake(0, 0, 200, 40)]);

  XCTAssertEqualWithAccuracy(metrics.fileDefaultWidth, mounted.width, 0.01);
  XCTAssertEqualWithAccuracy(metrics.fileDefaultHeight, mounted.height, 0.01);
}

- (void)testTheColourProbeMeasuresTheWellTheElementMounts
{
  ElementControlMetrics metrics;
  EXPProbeColorWellMetrics(metrics);
  const CGSize mounted =
      MountedIntrinsicSize([[EXPElementColorInputComponentView alloc] initWithFrame:CGRectMake(0, 0, 60, 40)]);

  XCTAssertEqualWithAccuracy(metrics.colorWellWidth, mounted.width, 0.01);
  XCTAssertEqualWithAccuracy(metrics.colorWellHeight, mounted.height, 0.01);
}

/*
 * A compact date picker has no intrinsic size, so this asks what the element
 * asks: what the picker needs to fit. Each type has its own first-frame
 * default, compared here with a mounted element of that type.
 */
- (void)testEachDateTypeStartsAtThePickerItMounts
{
  ElementControlMetrics metrics;
  EXPProbeDatePickerMetrics(metrics);
  const struct {
    const char *type;
    Float width;
    Float height;
  } cases[] = {
      {"date", metrics.datePickerDefaultWidth, metrics.datePickerDefaultHeight},
      {"time", metrics.timePickerDefaultWidth, metrics.timePickerDefaultHeight},
      {"datetime-local", metrics.dateTimePickerDefaultWidth, metrics.dateTimePickerDefaultHeight},
  };
  for (const auto &c : cases) {
    EXPElementDateInputComponentView *view =
        [[EXPElementDateInputComponentView alloc] initWithFrame:CGRectMake(0, 0, 220, 40)];
    auto props = std::make_shared<ElementDateInputProps>();
    props->type = c.type;
    [view updateProps:props oldProps:ElementDateInputShadowNode::defaultSharedProps()];
    UIWindow *window = [[UIWindow alloc] initWithFrame:CGRectMake(0, 0, 400, 300)];
    [window addSubview:view];
    [window layoutIfNeeded];
    const CGSize mounted = [view.elementControl sizeThatFits:CGSizeZero];

    XCTAssertEqualWithAccuracy(c.width, mounted.width, 0.01, @"%s", c.type);
    XCTAssertEqualWithAccuracy(c.height, mounted.height, 0.01, @"%s", c.type);
  }
}

@end
