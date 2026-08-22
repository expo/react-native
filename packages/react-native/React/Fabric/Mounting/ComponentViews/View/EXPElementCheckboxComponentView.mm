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
   * it snaps back to its own intrinsic size. The sheet states the control's
   * footprint, so in the normal case this is the identity; but the two CAN
   * disagree at runtime — on iOS 26 the switch grows with the accessibility
   * content-size categories, which the sheet's constant cannot know.
   *
   * When they disagree, the overflow must go TRAILING, never leading: this
   * box starts at whatever alignment the layout gave the element, and a
   * centred control spilled half the excess PAST the text margin — a row of
   * controls at large Dynamic Type read as randomly indented (user-reported,
   * from a device screenshot: one switch 6pt left of the paragraph edge).
   * The trailing side is where the platform's own label gap and the sheet's
   * inline-end margin already budget space.
   */
  [_switch sizeToFit];
  const CGRect bounds = self.bounds;
  CGRect controlFrame = _switch.frame;
  const BOOL rightToLeft = self.effectiveUserInterfaceLayoutDirection ==
      UIUserInterfaceLayoutDirectionRightToLeft;
  controlFrame.origin.x =
      rightToLeft ? CGRectGetMaxX(bounds) - controlFrame.size.width : CGRectGetMinX(bounds);
  controlFrame.origin.y = CGRectGetMidY(bounds) - controlFrame.size.height / 2;
  _switch.frame = controlFrame;
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
