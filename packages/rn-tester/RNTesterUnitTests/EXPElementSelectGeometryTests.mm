/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

/*
 * `<select>` shrink-to-fits its widest option (the web's rule, measured in
 * real Safari: 41/72/239px for one-char/short/long options — and also the
 * platform pop-up button's own behaviour). The C++ measure builds the width
 * as `widest label at kElementSelectLabelFontSize + kElementSelectChromeInline`;
 * these tests pin BOTH constants against the real control, so the next time
 * UIKit resizes its bordered configuration or its title font, a test fails
 * by name instead of every select drifting silently
 * (ElementSelectShadowNode.h — the identical-strings rule, update together).
 */
@interface EXPElementSelectGeometryTests : XCTestCase
@end

@implementation EXPElementSelectGeometryTests

static UIButton *PopUpButton(NSString *title)
{
  UIButtonConfiguration *configuration = [UIButtonConfiguration borderedButtonConfiguration];
  configuration.cornerStyle = UIButtonConfigurationCornerStyleMedium;
  configuration.title = title;
  UIButton *button = [UIButton buttonWithConfiguration:configuration primaryAction:nil];
  button.showsMenuAsPrimaryAction = YES;
  button.changesSelectionAsPrimaryAction = YES;
  button.menu = [UIMenu menuWithTitle:@""
                             children:@[ [UIAction actionWithTitle:title image:nil identifier:nil
                                                           handler:^(UIAction *a){}] ]];
  [button sizeToFit];
  return button;
}

- (void)testPopUpChromeMatchesTheMeasureConstants
{
  // The label font the C++ measure assumes (kElementSelectLabelFontSize).
  UIFont *labelFont = [UIFont systemFontOfSize:17];
  UIButton *apple = PopUpButton(@"Apple");
  UIFont *actualFont = apple.titleLabel.font;
  XCTAssertEqualWithAccuracy(actualFont.pointSize, labelFont.pointSize, 0.1,
                             @"UIButton's title font changed — update kElementSelectLabelFontSize");

  // The chrome — everything that is not the label: content insets, the
  // selection chevron and its gap. Derived from two labels so the label term
  // cancels: chrome = intrinsic - labelWidth must agree between them.
  for (NSString *title in @[ @"Apple", @"A considerably longer option label" ]) {
    UIButton *button = PopUpButton(title);
    CGFloat labelWidth = ceil([title sizeWithAttributes:@{NSFontAttributeName : labelFont}].width);
    CGFloat chrome = button.bounds.size.width - labelWidth;
    NSLog(@"@@SELECTGEO title='%@' intrinsic=%.1f label=%.1f chrome=%.1f height=%.1f",
          title, button.bounds.size.width, labelWidth, chrome, button.bounds.size.height);
    XCTAssertEqualWithAccuracy(chrome, 39.7, 1,
                               @"pop-up chrome changed — update kElementSelectChromeInline");
  }
}

@end
