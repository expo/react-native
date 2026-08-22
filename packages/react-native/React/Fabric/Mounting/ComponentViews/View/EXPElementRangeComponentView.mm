/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementRangeComponentView.h"

#import <React/RCTConversions.h>
#import <React/EXPElementDragOwnership.h>
#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/renderer/components/view/ElementRangeShadowNode.h>

#import "RCTComponentViewFactory.h"

using namespace facebook::react;

@interface EXPElementRangeComponentView () <EXPElementDragOwnership>
@end

@implementation EXPElementRangeComponentView {
  UISlider *_slider;
  double _step;
  BOOL _isTracking;
  BOOL _isInitialValueSet;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ElementRangeShadowNode::defaultSharedProps();
    _step = 1.0;

    _slider = [[UISlider alloc] initWithFrame:self.bounds];
    _slider.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    [_slider addTarget:self action:@selector(sliderValueChanged:) forControlEvents:UIControlEventValueChanged];
    // `touchUpInside` alone would miss a scrub that ends off the control, which
    // is the common case — a finger rarely lifts exactly on the thumb.
    [_slider addTarget:self
                  action:@selector(sliderEditingEnded:)
        forControlEvents:UIControlEventTouchUpInside | UIControlEventTouchUpOutside |
                         UIControlEventTouchCancel];
    // Handing the control to the base class installs it as the content view,
    // which lays it out into the element's box and routes the element's
    // accessibility to it.
    self.elementControl = _slider;
  }
  return self;
}

#pragma mark - EXPElementDragOwnership

- (BOOL)elementOwnsDragGesture
{
  // Always, while enabled: a scrub belongs to the slider for its whole
  // duration. This is the behaviour UIKit gives a `UISlider` inside a scroll
  // view for free, and that React Native's scroll view otherwise takes away.
  return ReactNativeFeatureFlags::enableNativeGestureRecognizers() && _slider.isEnabled;
}

#pragma mark - Events

- (double)snappedValue:(double)value
{
  // HTML snaps to `step` from `min`. Without this a slider with step=10 would
  // report every intermediate float while dragging.
  const auto &props = static_cast<const ElementRangeProps &>(*_props);
  if (_step <= 0) {
    return value;
  }
  const double steps = std::round((value - props.minimum) / _step);
  const double snapped = props.minimum + steps * _step;
  return std::clamp(snapped, props.minimum, props.maximum);
}

- (void)sliderValueChanged:(UISlider *)sender
{
  _isTracking = YES;
  const double value = [self snappedValue:sender.value];
  // Snap the control itself, not just the reported number, or the thumb slides
  // between steps while the value jumps — which reads as a broken control.
  if (std::abs(value - (double)sender.value) > 0.0001) {
    sender.value = (float)value;
  }
  if (_eventEmitter) {
    std::static_pointer_cast<const ElementRangeEventEmitter>(_eventEmitter)->onElementInput(value);
  }
}

- (void)sliderEditingEnded:(UISlider *)sender
{
  if (!_isTracking) {
    return;
  }
  _isTracking = NO;
  if (_eventEmitter) {
    std::static_pointer_cast<const ElementRangeEventEmitter>(_eventEmitter)
        ->onElementChange([self snappedValue:sender.value]);
  }
}

#pragma mark - RCTComponentViewProtocol

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldRangeProps = static_cast<const ElementRangeProps &>(*_props);
  const auto &newRangeProps = static_cast<const ElementRangeProps &>(*props);

  // The first update must apply unconditionally, not just on a difference. The
  // props it is diffed against are the component's *defaults*, and HTML's
  // defaults (0–100, value 50) do not match `UISlider`'s (0–1, value 0) — so an
  // `<input type="range">` written without attributes matched on every field,
  // updated nothing, and drew a slider pinned to the left of a 0–1 range.
  const bool rangeChanged = !_isInitialValueSet || oldRangeProps.minimum != newRangeProps.minimum ||
      oldRangeProps.maximum != newRangeProps.maximum;
  if (rangeChanged) {
    _slider.minimumValue = (float)newRangeProps.minimum;
    _slider.maximumValue = (float)newRangeProps.maximum;
  }

  _step = newRangeProps.step;

  // Do not fight the user: while a scrub is in flight the control's own value
  // is the truth, and writing a prop value back mid-gesture would make the
  // thumb stutter under the finger.
  if (!_isTracking && (rangeChanged || !_isInitialValueSet || oldRangeProps.value != newRangeProps.value)) {
    _slider.value = (float)newRangeProps.clampedValue();
  }

  if (!_isInitialValueSet) {
    _slider.enabled = !newRangeProps.disabled;
  }
  _isInitialValueSet = YES;

  if (oldRangeProps.disabled != newRangeProps.disabled) {
    _slider.enabled = !newRangeProps.disabled;
  }

  [super updateProps:props oldProps:oldProps];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _props = ElementRangeShadowNode::defaultSharedProps();
  _isTracking = NO;
  _isInitialValueSet = NO;
  _step = 1.0;
  _slider.enabled = YES;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ElementRangeComponentDescriptor>();
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end
