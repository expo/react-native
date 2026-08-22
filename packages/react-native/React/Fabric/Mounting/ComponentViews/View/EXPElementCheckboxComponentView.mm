/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementCheckboxComponentView.h"

#import <React/RCTConversions.h>
#import <react/renderer/components/view/ElementCheckboxShadowNode.h>

#import "RCTComponentViewFactory.h"

using namespace facebook::react;

@implementation EXPElementCheckboxComponentView {
  UISwitch *_switch;
  BOOL _isInitialValueSet;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ElementCheckboxShadowNode::defaultSharedProps();

    _switch = [[UISwitch alloc] initWithFrame:self.bounds];
    [_switch addTarget:self action:@selector(switchToggled:) forControlEvents:UIControlEventValueChanged];
    // Handing the control to the base class installs it as the content view,
    // which lays it out into the element's box and routes the element's
    // accessibility to it.
    self.elementControl = _switch;
  }
  return self;
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  /*
   * A UISwitch ignores assigned sizes — set its frame to the element's box and
   * it snaps back to its own intrinsic size, hanging out of the right edge if
   * the box is smaller. The sheet states the control's real footprint, so in
   * the normal case this is the identity; when the two ever disagree (a new
   * OS resizes the control again), centring makes the drift symmetrical
   * instead of an overlap with whatever text follows the control on its line.
   */
  [_switch sizeToFit];
  _switch.center = CGPointMake(CGRectGetMidX(self.bounds), CGRectGetMidY(self.bounds));
}

- (void)switchToggled:(UISwitch *)sender
{
  if (!_eventEmitter) {
    return;
  }
  std::static_pointer_cast<const ElementCheckboxEventEmitter>(_eventEmitter)->onElementChange(sender.isOn);
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldCheckboxProps = static_cast<const ElementCheckboxProps &>(*_props);
  const auto &newCheckboxProps = static_cast<const ElementCheckboxProps &>(*props);

  // The first application must be unconditional: the props it is diffed
  // against are this component's defaults, so an element whose attributes
  // happen to equal them would never reach the control.
  if (!_isInitialValueSet || oldCheckboxProps.checked != newCheckboxProps.checked) {
    // Animated only for later changes. Animating the initial state would make
    // every checkbox in a freshly mounted list visibly flip on appear.
    [_switch setOn:newCheckboxProps.checked animated:_isInitialValueSet];
  }

  if (!_isInitialValueSet || oldCheckboxProps.disabled != newCheckboxProps.disabled) {
    _switch.enabled = !newCheckboxProps.disabled;
  }

  _isInitialValueSet = YES;

  [super updateProps:props oldProps:oldProps];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _props = ElementCheckboxShadowNode::defaultSharedProps();
  _isInitialValueSet = NO;
  _switch.enabled = YES;
  [_switch setOn:NO animated:NO];
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ElementCheckboxComponentDescriptor>();
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end
