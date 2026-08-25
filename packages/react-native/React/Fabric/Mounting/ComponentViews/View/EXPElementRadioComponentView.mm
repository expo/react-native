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
 * The radio itself draws nothing on iOS. UIKit has no radio control; a run of
 * radios is presented as a grouped list whose chosen row carries the list's
 * own `UICellAccessoryCheckmark` (see `EXPRadioRunList`). The element keeps
 * `name`, `value` and `checked`, which the run reads and a form submits, and
 * reports itself to assistive technology as a button with a meaningful selected
 * state, as UIKit describes a chosen row.
 */
@interface EXPElementRadioControl : UIControl
@property (nonatomic, assign) BOOL isChosen;
@end

@implementation EXPElementRadioControl

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
  // No ink to change; the mark is the list's
  self.accessibilityTraits =
      isChosen ? (UIAccessibilityTraitButton | UIAccessibilityTraitSelected) : UIAccessibilityTraitButton;
}

- (void)setEnabled:(BOOL)enabled
{
  [super setEnabled:enabled];
  self.accessibilityTraits =
      enabled ? self.accessibilityTraits : (self.accessibilityTraits | UIAccessibilityTraitNotEnabled);
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
    /*
     * The control answers for its own box only, which on iOS is zero wide
     * (`RADIO_FOOTPRINT_BY_PLATFORM.ios`); in a run the row is the target and
     * the row's cell selects. The action stays for a radio with no run behind
     * it and for VoiceOver, whose activation goes through `UIControl`, not hit
     * testing.
     */
    [_radio addTarget:self action:@selector(radioTapped) forControlEvents:UIControlEventTouchUpInside];
    self.elementControl = _radio;
  }
  return self;
}

#pragma mark - Belonging to a run

/*
 * A radio's row is the element that contains it, and its container is what
 * contains that. HTML does not mark rows; both `<label><input> Text</label>`
 * and `<div><input> Free</div>` make the containing element the row. A radio
 * with no element around it has no row and is left alone.
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
 * Re-grouping is driven from the radio, not from every container's layout, so
 * a tree without radios pays nothing; it runs on the next turn of the run
 * loop, once the container's other children have their frames.
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

- (BOOL)exp_isEnabled
{
  // The control's own state, not a second copy of the `disabled` prop
  return _radio.enabled;
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
    // The mark is the list's accessory, so the list is told to look again
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
