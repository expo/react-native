/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementRadioComponentView.h"

#import <React/RCTConversions.h>
#import <react/renderer/components/view/ElementRadioShadowNode.h>

#import "EXPRadioRunList.h"
#import "RCTComponentViewFactory.h"

using namespace facebook::react;

#pragma mark - The control

/*
 * The radio itself, which on iOS draws NOTHING.
 *
 * UIKit has no radio control — `PickerStyle.radioGroup` is macOS-only — and
 * what iOS offers for "one of several" is a list whose chosen row carries a
 * checkmark. A run of radios is presented as exactly that, and the checkmark is
 * the LIST'S: a real `UICellAccessoryCheckmark`, so its glyph, its tint, its
 * placement and its SIDE are the platform's. Trailing in a left-to-right layout
 * and leading in a right-to-left one is a decision nobody here should be
 * making, and the accessory API already makes it.
 *
 * So the element has no ink. It still carries `name`, `value` and `checked` —
 * what the run reads to know which row is chosen, and what a form submits — and
 * it still reports itself to assistive technology as a button whose selected
 * state is meaningful, which is how UIKit describes a chosen row. An earlier
 * version drew the mark here, in the element's own box, and the result was two
 * checkmarks on the chosen row: the element's on the left and the platform's on
 * the right.
 *
 * A drawn RING is gone for the same reason and a stronger one: it is a web
 * affordance an iOS user has no model for, and beside a checkmark it states the
 * same thing twice in two different symbols.
 */
@interface EXPElementRadioControl : UIControl
@property (nonatomic, assign) BOOL isChosen;
@end

/*
 * The touch target, which is deliberately LARGER than the box.
 *
 * The box is the space the row spends on the control, and with nothing to draw
 * that is nearly nothing. This is what a finger has to find. Nothing in the
 * layout moves when it changes.
 *
 * The ancestor still has to be big enough to let the touch through — UIKit
 * stops walking down at the first view whose bounds exclude the point — which
 * is why a radio's box is as tall as the platform's row.
 */
static const CGFloat kEXPRadioTouchTarget = 44;

@implementation EXPElementRadioControl

/*
 * Accepts a touch anywhere within the target, even outside the view's bounds.
 *
 * `hitSlop` is not the mechanism for the same reason it was rejected for the
 * box: it is clipped to the ancestor's bounds, and it is not expressible from
 * the user-agent sheet at all. This is the platform's own hook for the same
 * idea, and it belongs on the control because the control is the thing being
 * aimed at.
 */
- (BOOL)pointInside:(CGPoint)point withEvent:(UIEvent *)event
{
  const CGRect bounds = self.bounds;
  const CGFloat dx = MAX(0, (kEXPRadioTouchTarget - CGRectGetWidth(bounds)) / 2);
  const CGFloat dy = MAX(0, (kEXPRadioTouchTarget - CGRectGetHeight(bounds)) / 2);
  return CGRectContainsPoint(CGRectInset(bounds, -dx, -dy), point);
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    self.backgroundColor = [UIColor clearColor];
    self.isAccessibilityElement = YES;
    self.accessibilityTraits = UIAccessibilityTraitButton;
  }
  return self;
}

- (void)setIsChosen:(BOOL)isChosen
{
  if (_isChosen == isChosen) {
    return;
  }
  _isChosen = isChosen;
  // No ink to change — only what this announces. The mark is the list's.
  self.accessibilityTraits =
      isChosen ? (UIAccessibilityTraitButton | UIAccessibilityTraitSelected) : UIAccessibilityTraitButton;
}

- (void)setEnabled:(BOOL)enabled
{
  [super setEnabled:enabled];
  self.accessibilityTraits = enabled ? self.accessibilityTraits
                                     : (self.accessibilityTraits | UIAccessibilityTraitNotEnabled);
}

@end

#pragma mark - Component view

@interface EXPElementRadioComponentView () <EXPRadioRunMember>
@end

@implementation EXPElementRadioComponentView {
  EXPElementRadioControl *_radio;
  BOOL _isInitialValueSet;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ElementRadioShadowNode::defaultSharedProps();

    _radio = [[EXPElementRadioControl alloc] initWithFrame:self.bounds];
    [_radio addTarget:self action:@selector(radioTapped) forControlEvents:UIControlEventTouchUpInside];
    self.elementControl = _radio;
  }
  return self;
}

/*
 * The container has to admit the touch too.
 *
 * UIKit walks down from the window and stops at the first view whose
 * `pointInside:` says no, so an expanded target on the control alone is
 * unreachable: the point never gets past this view. Both have to agree, which
 * is easy to forget because the control's override is the one that looks like
 * it does the work.
 */
- (BOOL)pointInside:(CGPoint)point withEvent:(UIEvent *)event
{
  const CGRect bounds = self.bounds;
  const CGFloat dx = MAX(0, (kEXPRadioTouchTarget - CGRectGetWidth(bounds)) / 2);
  const CGFloat dy = MAX(0, (kEXPRadioTouchTarget - CGRectGetHeight(bounds)) / 2);
  return CGRectContainsPoint(CGRectInset(bounds, -dx, -dy), point);
}

#pragma mark - Belonging to a run

/*
 * A radio's ROW is the element that contains it, and its container is what
 * contains that.
 *
 * Stated as a rule rather than inferred, because inference here has no honest
 * answer: HTML does not mark rows. `<label><input> Text</label>` is how a radio
 * row is idiomatically written, and `<div><input> Free</div>` is the other way;
 * in both, the thing that contains the radio is the thing that should become a
 * row. A radio with no element around it has no row, and is left alone.
 */
- (void)didMoveToWindow
{
  [super didMoveToWindow];
  UIView *row = self.superview;
  UIView *container = row.superview;
  if (self.window == nil || row == nil || container == nil) {
    return;
  }
  [EXPRadioRunList announceRadio:self row:row inContainer:container];
}

- (void)removeFromSuperview
{
  UIView *row = self.superview;
  UIView *container = row.superview;
  if (row != nil && container != nil) {
    [EXPRadioRunList withdrawRow:row fromContainer:container];
  }
  [super removeFromSuperview];
}

/*
 * Re-grouping is driven from HERE, not from every container's layout.
 *
 * A container has no reason to wonder whether it holds radios, and asking it to
 * check on every layout would put the cost of this feature on every view in
 * every tree. The radio knows, so the radio asks — and it asks on the next turn
 * of the run loop, once the whole layout pass has been through the container's
 * other children and their frames are final.
 */
- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics
           oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  UIView *container = self.superview.superview;
  if (container == nil || ![EXPRadioRunList containerHasRuns:container]) {
    return;
  }
  [EXPRadioRunList scheduleRegroupFor:container];
}

#pragma mark - EXPRadioRunMember

- (BOOL)exp_isChosen
{
  return static_cast<const ElementRadioProps &>(*_props).checked;
}

- (void)exp_choose
{
  [self radioTapped];
}

- (void)radioTapped
{
  const auto &props = static_cast<const ElementRadioProps &>(*_props);
  // Choosing an already-chosen radio is not a change — in HTML a radio cannot
  // be unchecked by clicking it, only by another in its group being chosen.
  if (props.checked) {
    return;
  }
  if (_eventEmitter) {
    std::static_pointer_cast<const ElementCheckboxEventEmitter>(_eventEmitter)->onElementChange(true);
  }
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldRadioProps = static_cast<const ElementRadioProps &>(*_props);
  const auto &newRadioProps = static_cast<const ElementRadioProps &>(*props);

  if (!_isInitialValueSet || oldRadioProps.checked != newRadioProps.checked) {
    _radio.isChosen = newRadioProps.checked;
    // The mark is the list's accessory, so the list is what has to look again.
    // Told here rather than polled: this is the only moment the answer can
    // change, and a run that is not showing this radio has nothing to redraw.
    [EXPRadioRunList radioDidChange:self];
  }

  if (!_isInitialValueSet || oldRadioProps.disabled != newRadioProps.disabled) {
    _radio.enabled = !newRadioProps.disabled;
    self.userInteractionEnabled = !newRadioProps.disabled;
  }

  _isInitialValueSet = YES;

  [super updateProps:props oldProps:oldProps];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _props = ElementRadioShadowNode::defaultSharedProps();
  _isInitialValueSet = NO;
  _radio.isChosen = NO;
  _radio.enabled = YES;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ElementRadioComponentDescriptor>();
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end
