/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementControlMetricsProbe.h"

#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>

void EXPPrewarmElementControlMetrics(void)
{
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    RCTUnsafeExecuteOnMainQueueSync(^{
      facebook::react::ElementControlMetrics metrics;
      EXPProbeTextAreaMetrics(metrics);
      EXPProbeSelectMetrics(metrics);
      EXPProbeFileInputMetrics(metrics);
      EXPProbeButtonMetrics(metrics);
      EXPProbeTextFieldMetrics(metrics);
      EXPProbeDatePickerMetrics(metrics);
      EXPProbeColorWellMetrics(metrics);
      /*
       * Published as a unit, once every control has answered: the fields are
       * read together and a half-filled struct describes nothing that exists.
       */
      facebook::react::setElementControlMetrics(metrics);
    });
  });
}

CGFloat EXPTextBaselineInView(UILabel *label, UIView *view)
{
  UIFont *font = label.font;
  if (font == nil) {
    return 0;
  }
  const CGFloat inLabel = (CGRectGetHeight(label.bounds) - font.lineHeight) / 2 + font.ascender;
  return [label convertPoint:CGPointMake(0, inLabel) toView:view].y;
}

UILabel *EXPFirstLabelIn(UIView *view)
{
  for (UIView *subview in view.subviews) {
    if ([subview isKindOfClass:[UILabel class]] && ((UILabel *)subview).text.length > 0) {
      return (UILabel *)subview;
    }
    UILabel *found = EXPFirstLabelIn(subview);
    if (found != nil) {
      return found;
    }
  }
  return nil;
}
