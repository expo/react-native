/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

#import <React/EXPElementControlMetricsProbe.h>
#import <React/EXPElementSelectComponentView.h>

/*
 * `<select>` shrink-to-fits its widest option (the web's rule, measured in
 * real Safari: 41/72/239px for one-char/short/long options — and also the
 * platform pop-up button's own behaviour). The C++ measure builds the width
 * as `widest label + chrome`, and the chrome is the real control's width for
 * a probe title LESS what the text engine makes of that same string, so the
 * two engines' disagreement cancels instead of being carried as an allowance.
 *
 * These tests used to pin two hand-measured constants — a title font size and
 * a 39.7pt chrome with a +3 fudge bolted on. Both are gone: the control is
 * asked at startup and layout uses what it said. So what is left to check is
 * that the probe REPORTS THE CONTROL, which is the only thing that can now be
 * wrong, and that it built the same button `<select>` mounts rather than one
 * that merely resembles it.
 */
@interface EXPElementSelectGeometryTests : XCTestCase
@end

@implementation EXPElementSelectGeometryTests

/*
 * A pop-up button measured the way the probe measures one.
 *
 * `EXPMakeElementSelectButton` is the element's own constructor, not a copy of
 * it. The override has to be resolved, and a detached view resolves nothing: a
 * button outside a hierarchy keeps whatever traits it was born with, so it is
 * put in a window, laid out, and only then measured.
 */
static UIButton *PopUpButton(NSString *title)
{
  UIButton *button = EXPMakeElementSelectButton();
  UIButtonConfiguration *configuration = button.configuration;
  configuration.title = title;
  button.configuration = configuration;
  button.menu = [UIMenu menuWithTitle:@""
                             children:@[ [UIAction actionWithTitle:title
                                                             image:nil
                                                        identifier:nil
                                                           handler:^(__unused UIAction *a){
                                                           }] ]];
  UIWindow *window = [[UIWindow alloc] initWithFrame:CGRectMake(0, 0, 400, 200)];
  [window addSubview:button];
  [window layoutIfNeeded];
  [button sizeToFit];
  [button removeFromSuperview];
  return button;
}

/*
 * The probe published what a real pop-up button measures.
 *
 * If UIKit resizes its bordered configuration or changes its title font, this
 * keeps passing and the layout moves with it — which is the whole point of
 * asking rather than remembering. It fails only if the probe stops describing
 * the control, which is the failure that used to be invisible.
 */
- (void)testTheProbeReportsWhatARealPopUpButtonMeasures
{
  EXPPrewarmElementControlMetrics();
  const auto metrics = facebook::react::elementControlMetrics();

  NSString *probeTitle = [NSString stringWithUTF8String:facebook::react::elementSelectProbeTitle().c_str()];
  UIButton *button = PopUpButton(probeTitle);

  XCTAssertEqualWithAccuracy(
      metrics.selectProbeIntrinsicWidth,
      button.bounds.size.width,
      0.5,
      @"the published pop-up width is not the control's");
  XCTAssertEqualWithAccuracy(
      metrics.selectBlockSize, button.bounds.size.height, 0.5, @"the published pop-up height is not the control's");
  XCTAssertEqualWithAccuracy(
      metrics.selectLabelFontSize,
      button.titleLabel.font.pointSize,
      0.1,
      @"the published title font size is not the control's");
}

/*
 * And the chrome is a constant of the control, not of the string.
 *
 * The measure adds one chrome to whatever the widest label comes to, which is
 * only sound if the chrome is the same for every label. Derived from two very
 * different titles so the label term cancels: if a pop-up button ever starts
 * padding long titles differently, the subtraction stops being legitimate and
 * this says so.
 */
- (void)testThePopUpChromeDoesNotDependOnItsTitle
{
  UIFont *titleFont = PopUpButton(@"Apple").titleLabel.font;
  CGFloat firstChrome = 0;
  BOOL haveFirst = NO;

  for (NSString *title in @[ @"Apple", @"A considerably longer option label" ]) {
    UIButton *button = PopUpButton(title);
    const CGFloat labelWidth = ceil([title sizeWithAttributes:@{NSFontAttributeName : titleFont}].width);
    const CGFloat chrome = button.bounds.size.width - labelWidth;
    NSLog(
        @"@@SELECTGEO title='%@' intrinsic=%.1f label=%.1f chrome=%.1f height=%.1f",
        title,
        button.bounds.size.width,
        labelWidth,
        chrome,
        button.bounds.size.height);
    if (!haveFirst) {
      firstChrome = chrome;
      haveFirst = YES;
    } else {
      XCTAssertEqualWithAccuracy(chrome, firstChrome, 2.0, @"a pop-up button's chrome now depends on its title");
    }
  }
}

@end
