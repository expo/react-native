/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementControlComponentView.h"

@implementation EXPElementControlComponentView

/**
 * A control's hit area is its border box, padding included, as in HTML, where
 * clicking a text field's padding puts the caret in it. The control is laid out
 * in the content box, so a hit in the padding that would stop at this container
 * is handed to the control, which interprets where it landed.
 */
- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event
{
  UIView *hit = [super hitTest:point withEvent:event];
  if (hit == self && _elementControl != nil && _elementControl.userInteractionEnabled && !_elementControl.hidden &&
      _elementControl.alpha > 0.01) {
    return _elementControl;
  }
  return hit;
}

- (void)setElementControl:(UIView *)elementControl
{
  _elementControl = elementControl;
  self.contentView = elementControl;
}

#pragma mark - Accessibility

/*
 * Each of these answers from props when props have something to say, and from
 * the control otherwise. The order matters: an author who writes
 * `aria-label` or `role` on the element is overriding the platform on purpose,
 * and the control should not talk over them.
 */

- (UIAccessibilityTraits)accessibilityTraits
{
  UIAccessibilityTraits traits = [super accessibilityTraits];
  if (traits != UIAccessibilityTraitNone) {
    return traits;
  }
  return _elementControl.accessibilityTraits;
}

- (NSString *)accessibilityValue
{
  NSString *value = [super accessibilityValue];
  if (value != nil) {
    return value;
  }
  return _elementControl.accessibilityValue;
}

- (NSString *)accessibilityLabel
{
  NSString *label = [super accessibilityLabel];
  if (label != nil) {
    return label;
  }
  return _elementControl.accessibilityLabel;
}

/*
 * The adjust actions VoiceOver sends to an adjustable element. They are
 * delivered to whichever view is the accessibility element — this container —
 * so without forwarding, swiping up on a slider under VoiceOver would do
 * nothing at all.
 *
 * The control changes its own value here, which fires the same
 * `UIControlEventValueChanged` a touch does, so the element reports `input` and
 * `change` through the ordinary path: an assisted adjustment is not a
 * different kind of edit.
 */
- (void)accessibilityIncrement
{
  [_elementControl accessibilityIncrement];
}

- (void)accessibilityDecrement
{
  [_elementControl accessibilityDecrement];
}

- (BOOL)accessibilityActivate
{
  return [_elementControl accessibilityActivate];
}

@end
