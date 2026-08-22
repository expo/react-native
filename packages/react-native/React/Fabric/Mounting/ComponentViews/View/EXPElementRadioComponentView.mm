/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementRadioComponentView.h"

#import <React/RCTConversions.h>
#import <react/renderer/components/view/ElementRadioShadowNode.h>

#import "RCTComponentViewFactory.h"

using namespace facebook::react;

#pragma mark - The control

/*
 * The radio itself: a ring that fills with a dot when chosen.
 *
 * Drawn rather than composed from a UIKit control because there is no UIKit
 * radio to compose from. It is still built out of the platform's own materials
 * — `tintColor` for the chosen state and the separator colour for the ring, so
 * it follows the app's accent colour and both light and dark appearances
 * without being told to — and it reports itself to assistive technology as a
 * button whose selected state is meaningful, which is how UIKit describes a
 * chosen row.
 */
@interface EXPElementRadioControl : UIControl
@property (nonatomic, assign) BOOL isChosen;
@end

@implementation EXPElementRadioControl {
  // The dot, as a layer so it can spring; see `applyDotStateAnimated:`.
  CAShapeLayer *_dotLayer;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    self.backgroundColor = [UIColor clearColor];
    self.isAccessibilityElement = YES;
    self.accessibilityTraits = UIAccessibilityTraitButton;

    /*
     * The dot lives in its own layer rather than in `drawRect`.
     *
     * `drawRect` cannot animate — it redraws, so the dot would appear and
     * disappear instantly. UIKit's own selection indicators spring in, and a
     * control we draw ourselves has to earn that rather than inherit it: this
     * is the one element with no platform counterpart, so nothing supplies the
     * motion for us.
     */
    _dotLayer = [CAShapeLayer layer];
    _dotLayer.fillColor = self.tintColor.CGColor;
    // Scaled about the middle, so the spring grows from the centre outward.
    _dotLayer.anchorPoint = CGPointMake(0.5, 0.5);
    _dotLayer.transform = CATransform3DMakeScale(0, 0, 1);
    _dotLayer.opacity = 0;
    [self.layer addSublayer:_dotLayer];
  }
  return self;
}

- (void)setIsChosen:(BOOL)isChosen
{
  if (_isChosen == isChosen) {
    return;
  }
  _isChosen = isChosen;
  [self setNeedsDisplay];
  [self applyDotStateAnimated:YES];
  self.accessibilityTraits =
      isChosen ? (UIAccessibilityTraitButton | UIAccessibilityTraitSelected) : UIAccessibilityTraitButton;
}

- (void)drawRect:(CGRect)rect
{
  // Sized from the box rather than fixed, so the ring still looks right when an
  // author styles the element larger than the user-agent default.
  const CGFloat side = MIN(CGRectGetWidth(self.bounds), CGRectGetHeight(self.bounds));
  const CGFloat lineWidth = MAX(1.0, side / 12.0);
  const CGRect ring = CGRectInset(
      CGRectMake(
          (CGRectGetWidth(self.bounds) - side) / 2, (CGRectGetHeight(self.bounds) - side) / 2, side, side),
      lineWidth / 2,
      lineWidth / 2);

  UIBezierPath *ringPath = [UIBezierPath bezierPathWithOvalInRect:ring];
  ringPath.lineWidth = lineWidth;
  UIColor *ringColor = self.isEnabled ? [UIColor separatorColor] : [UIColor quaternaryLabelColor];
  [(self.isChosen && self.isEnabled ? self.tintColor : ringColor) setStroke];
  [ringPath stroke];

  // The dot is NOT drawn here — it is a layer, so that it can spring. See
  // `applyDotStateAnimated:`.
}

/*
 * The dot's geometry, kept in step with the ring `drawRect` computes.
 */
- (void)layoutSubviews
{
  [super layoutSubviews];
  const CGFloat side = MIN(CGRectGetWidth(self.bounds), CGRectGetHeight(self.bounds));
  const CGFloat lineWidth = MAX(1.0, side / 12.0);
  const CGRect ring = CGRectInset(
      CGRectMake(
          (CGRectGetWidth(self.bounds) - side) / 2, (CGRectGetHeight(self.bounds) - side) / 2, side, side),
      lineWidth / 2,
      lineWidth / 2);
  const CGRect dot = CGRectInset(ring, CGRectGetWidth(ring) * 0.28, CGRectGetHeight(ring) * 0.28);

  _dotLayer.path = [UIBezierPath bezierPathWithOvalInRect:dot].CGPath;
  // The layer's bounds are the whole view so the path sits where it was
  // computed; the scale transform is what animates. BOUNDS and POSITION, not
  // `frame`: the unchecked dot carries a scale(0) transform, and CALayer's
  // frame setter computes geometry THROUGH the current transform — through a
  // degenerate scale the position came out garbage, and the dot sprang in
  // from the bottom-right of wherever that left it instead of growing from
  // its own centre.
  _dotLayer.bounds = self.bounds;
  _dotLayer.position =
      CGPointMake(CGRectGetMidX(self.bounds), CGRectGetMidY(self.bounds));
  _dotLayer.fillColor =
      (self.isEnabled ? self.tintColor : [UIColor quaternaryLabelColor]).CGColor;
  [self applyDotStateAnimated:NO];
}

/*
 * Grows the dot with a spring on selection, and takes it away plainly.
 *
 * Asymmetric on purpose, which is what makes it feel like UIKit rather than
 * like an animation: choosing is the moment worth acknowledging, so it
 * overshoots very slightly and settles; unchoosing is a consequence of
 * choosing something else and should get out of the way without drawing a
 * second piece of attention to itself.
 */
- (void)applyDotStateAnimated:(BOOL)animated
{
  const CGFloat target = self.isChosen ? 1.0 : 0.0;

  /*
   * The final state is applied FIRST and unconditionally.
   *
   * A reduce-motion guard that wraps the state change instead of just the
   * animation silently stops the control working for the people who enabled
   * it — the dot never appears at all. Here the value is always set; only the
   * way it gets there is conditional.
   */
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _dotLayer.transform = CATransform3DMakeScale(target, target, 1);
  _dotLayer.opacity = self.isChosen ? 1 : 0;
  [CATransaction commit];

  if (!animated || UIAccessibilityIsReduceMotionEnabled()) {
    return;
  }

  if (self.isChosen) {
    CASpringAnimation *spring = [CASpringAnimation animationWithKeyPath:@"transform.scale"];
    spring.fromValue = @0.0;
    spring.toValue = @1.0;
    spring.damping = 14;
    spring.stiffness = 300;
    spring.mass = 1;
    // The spring decides its own duration; anything else truncates the settle
    // and reads as a stutter.
    spring.duration = spring.settlingDuration;
    [_dotLayer addAnimation:spring forKey:@"dot-in"];
  } else {
    CABasicAnimation *out = [CABasicAnimation animationWithKeyPath:@"transform.scale"];
    out.fromValue = @1.0;
    out.toValue = @0.0;
    out.duration = 0.12;
    out.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut];
    [_dotLayer addAnimation:out forKey:@"dot-out"];
  }
}

- (void)tintColorDidChange
{
  [super tintColorDidChange];
  [self setNeedsDisplay];
}

- (void)setEnabled:(BOOL)enabled
{
  [super setEnabled:enabled];
  [self setNeedsDisplay];
}

@end

#pragma mark - Component view

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
