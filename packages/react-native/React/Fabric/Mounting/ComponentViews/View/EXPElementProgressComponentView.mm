/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementProgressComponentView.h"

#import <React/RCTConversions.h>
#import <react/renderer/components/view/ElementProgressShadowNode.h>

#import "RCTComponentViewFactory.h"

using namespace facebook::react;

@implementation EXPElementProgressComponentView {
  UIView *_container;
  UIProgressView *_progressView;
  UIActivityIndicatorView *_indicator;
  BOOL _isInitialValueSet;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ElementProgressShadowNode::defaultSharedProps();

    // Two views under one container, because a determinate and an
    // indeterminate `<progress>` are different controls on this platform and an
    // element can switch between them at any time — `<progress>` becomes
    // indeterminate the moment its `value` attribute is removed.
    _container = [[UIView alloc] initWithFrame:self.bounds];

    _progressView = [[UIProgressView alloc] initWithProgressViewStyle:UIProgressViewStyleDefault];
    _progressView.autoresizingMask = UIViewAutoresizingFlexibleWidth;
    [_container addSubview:_progressView];

    _indicator = [[UIActivityIndicatorView alloc] initWithActivityIndicatorStyle:UIActivityIndicatorViewStyleMedium];
    _indicator.hidesWhenStopped = YES;
    [_container addSubview:_indicator];

    self.elementControl = _container;
  }
  return self;
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  // A `UIProgressView` has a fixed intrinsic height and ignores attempts to
  // stretch it, so it is centred in whatever box the element was given rather
  // than pinned to the top of it.
  const CGRect bounds = _container.bounds;
  const CGFloat progressHeight = _progressView.intrinsicContentSize.height;
  _progressView.frame = CGRectMake(0, (CGRectGetHeight(bounds) - progressHeight) / 2, CGRectGetWidth(bounds), progressHeight);
  _indicator.center = CGPointMake(CGRectGetMidX(bounds), CGRectGetMidY(bounds));
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldProgressProps = static_cast<const ElementProgressProps &>(*_props);
  const auto &newProgressProps = static_cast<const ElementProgressProps &>(*props);

  const bool wasIndeterminate = oldProgressProps.isIndeterminate();
  const bool isIndeterminate = newProgressProps.isIndeterminate();

  if (!_isInitialValueSet || wasIndeterminate != isIndeterminate) {
    _progressView.hidden = isIndeterminate;
    if (isIndeterminate) {
      [_indicator startAnimating];
    } else {
      [_indicator stopAnimating];
    }
  }

  if (!isIndeterminate &&
      (!_isInitialValueSet || oldProgressProps.value != newProgressProps.value ||
       oldProgressProps.minimum != newProgressProps.minimum || oldProgressProps.maximum != newProgressProps.maximum)) {
    // Animated only after the first application: a bar that slides up from zero
    // every time a list scrolls a row into view reads as activity that is not
    // happening.
    [_progressView setProgress:(float)newProgressProps.fraction() animated:_isInitialValueSet];
  }

  _isInitialValueSet = YES;

  [super updateProps:props oldProps:oldProps];

  // Reported as a static value rather than as an adjustable: this is a readout,
  // and VoiceOver should not offer to change it. `UIProgressView` says as much
  // itself, so the forwarding in the base class does the work — this only adds
  // the percentage, which the platform control does not derive from a range.
  if (!isIndeterminate) {
    self.accessibilityValue =
        [NSString stringWithFormat:@"%d%%", (int)std::lround(newProgressProps.fraction() * 100.0)];
  } else {
    self.accessibilityValue = nil;
  }
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _props = ElementProgressShadowNode::defaultSharedProps();
  _isInitialValueSet = NO;
  [_progressView setProgress:0 animated:NO];
  [_indicator stopAnimating];
  _progressView.hidden = NO;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ElementProgressComponentDescriptor>();
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end
