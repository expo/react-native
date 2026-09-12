/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementControlComponentView.h"

@implementation EXPElementControlComponentView

/**
 * A control's hit area is its BORDER box, padding included.
 *
 * The control is laid out in the CONTENT box — inside the padding, which is
 * where padding belongs on a form control — so the padding strip belongs to
 * this container and a touch that lands in it reaches nothing. On a composer
 * with fifteen points of leading padding that is a fifteen-point dead strip
 * down the field's leading edge, and a tap there does nothing at all: measured
 * on the demo's composer, every tap between x=80 (the pill's edge) and x=96
 * (where the text starts) failed to raise the keyboard, ten times out of ten.
 * Reported from a device as "sometimes when I tap on the text area it doesn't
 * bring up the keyboard".
 *
 * HTML has no such strip. A control's box IS the control: clicking a text
 * field's padding puts the caret in it, and clicking a checkbox's padding
 * toggles it. So a hit anywhere inside this view that would otherwise stop at
 * the container is handed to the control, which is then free to interpret where
 * it landed — a `UITextView` given a point outside its text container puts the
 * caret at the nearest position, which is what tapping just left of the first
 * glyph should do.
 */
- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event
{
  UIView *hit = [super hitTest:point withEvent:event];
  if (hit == self && _elementControl != nil && _elementControl.userInteractionEnabled &&
      !_elementControl.hidden && _elementControl.alpha > 0.01) {
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
