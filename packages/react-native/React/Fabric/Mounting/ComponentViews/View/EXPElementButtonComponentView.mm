/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementButtonComponentView.h"

#import <React/RCTAssert.h>
#import <React/RCTConversions.h>

#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/renderer/components/view/ElementButtonShadowNode.h>
#import "EXPElementControlMetricsProbe.h"

#import <React/EXPElementDragOwnership.h>

#import "RCTComponentViewFactory.h"

using namespace facebook::react;

#pragma mark - Component view

/*
 * How far outside its bounds a touch may stray and still count as on the
 * control. UIKit uses a margin of this order for its own controls; a press does
 * not end the instant the finger leaves the frame.
 */
static const CGFloat EXPElementPressSlop = 16.0;

@interface EXPElementButtonComponentView () <EXPElementDragOwnership>
@end

@implementation EXPElementButtonComponentView {
  BOOL _ownsDragGesture;
  BOOL _pressed;
  BOOL _tracking;
  UIButton *_chromeButton;
}

#pragma mark - Platform chrome

/*
 * The chrome is a `UIButton` with a `UIButtonConfiguration`, hosted as the
 * bottom subview and stretched to the box, so the fills, capsule and adaptive
 * colours are UIKit's own. Chrome only: `userInteractionEnabled` is NO, touch
 * tracking stays at this view's level, and the children are laid out by the
 * renderer above it. An author background or border dismisses it, and the
 * press feedback with it; see `updatePressedAppearance`.
 */
- (void)updateChromeButton
{
  const auto &props = static_cast<const ElementButtonProps &>(*_props);

  // Computed in JavaScript next to the style prop it reads (`authorStatesSurface`
  // in Button.js), so both platforms answer the question identically.
  if (props.hasAuthorChrome || props.buttonStyle.empty()) {
    if (_chromeButton != nil) {
      _chromeButton.hidden = YES;
    }
    return;
  }

  if (_chromeButton == nil) {
    _chromeButton = [UIButton buttonWithType:UIButtonTypeSystem];
    _chromeButton.userInteractionEnabled = NO;
    // Never announced: the component view is the accessibility element, with
    // the button trait already on it. A second, label-less button underneath
    // it would read as an unlabelled control.
    _chromeButton.isAccessibilityElement = NO;
    _chromeButton.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    [self insertSubview:_chromeButton atIndex:0];
  }
  _chromeButton.hidden = NO;
  _chromeButton.frame = self.bounds;
  // The invariant, restated here as well as after run attach in the base
  // class: chrome draws below the element's content, whatever order props,
  // state and recycling interleaved in.
  [self sendSubviewToBack:_chromeButton];

  /*
   * The platform's two prominences, chosen by HTML's semantics upstream:
   * "prominent" is the filled configuration the HIG gives a primary action,
   * everything else is the neutral gray. The title stays empty — the label is
   * the element's children, drawn by the renderer.
   */
  UIButtonConfiguration *config = props.buttonStyle == "prominent" ? [UIButtonConfiguration filledButtonConfiguration]
                                                                   : [UIButtonConfiguration grayButtonConfiguration];
  _chromeButton.configuration = config;
  _chromeButton.enabled = !props.disabled;
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  if (_chromeButton != nil) {
    _chromeButton.frame = self.bounds;
  }
}

/*
 * The mount-index bookkeeping in `RCTViewComponentView` must not count the
 * chrome as a mounted child — see `isHostChromeSubview:` in the header.
 */
- (BOOL)hasHostChromeSubviews
{
  return _chromeButton != nil;
}

- (BOOL)isHostChromeSubview:(UIView *)view
{
  return view == _chromeButton;
}

#pragma mark - Press tracking

/*
 * The press is tracked in the view's own touch handling, as `UIControl` does,
 * rather than in a gesture recognizer: a scroll view's `delaysContentTouches`
 * delays delivery to the view, while a recognizer receives the touch at once
 * and would highlight every button a swipe starts on. The tracking reports
 * press state only, continuously, for `:active`; `click` is dispatched by the
 * pointer handler.
 */

// UIKit dims a pressed button's own fill and title, and no API dims subviews
// a control does not own, so the factor is read off a real pressed button at
// startup by `EXPProbeButtonMetrics` and applied to the children here
static CGFloat EXPElementButtonPressedAlpha(void)
{
  return facebook::react::elementControlMetrics().buttonPressedContentAlpha;
}

- (void)setPressed:(BOOL)pressed
{
  if (_pressed == pressed) {
    return;
  }
  _pressed = pressed;
  [self updatePressedAppearance];
  [self emitPressChange:pressed];
}

/*
 * With chrome, the press is handed to `UIButton.highlighted` and only the
 * content above the chrome is dimmed here, by the measured factor UIKit
 * applies to its own title. DOM-CSS-DEVIATION(press-dim-on-content): that
 * factor restates the platform's behaviour rather than delegating to it,
 * since no API dims foreign subviews. Without chrome, the platform dims only
 * when the author's styles do not answer the press themselves; an author who
 * writes `:active` would otherwise get two feedbacks on different clocks.
 * Alpha multiplies the author's own `opacity` rather than replacing it.
 */

/*
 * The rule for an author-surfaced button, as a pure function so it can be
 * tested without building a props tree: a press dims unless the author's own
 * styles are answering it.
 */
+ (CGFloat)pressedAlphaWhenPressed:(BOOL)pressed authorStatesPressFeedback:(BOOL)authorStatesPressFeedback
{
  return (pressed && !authorStatesPressFeedback) ? EXPElementButtonPressedAlpha() : 1.0;
}

- (void)updatePressedAppearance
{
  const auto &viewProps = static_cast<const ViewProps &>(*_props);
  const BOOL chromeActive = _chromeButton != nil && !_chromeButton.hidden;
  if (chromeActive) {
    self.alpha = viewProps.opacity;
    _chromeButton.highlighted = _pressed;
    const CGFloat contentAlpha = _pressed ? EXPElementButtonPressedAlpha() : 1.0;
    for (UIView *subview in self.subviews) {
      if (subview != _chromeButton) {
        subview.alpha = contentAlpha;
      }
    }
  } else {
    // `authorStatesPressFeedback` is computed where the styles are, next to the
    // state that resolved them
    const auto &buttonProps = static_cast<const ElementButtonProps &>(*_props);
    const CGFloat pressedAlpha = [[self class] pressedAlphaWhenPressed:_pressed
                                             authorStatesPressFeedback:buttonProps.authorStatesPressFeedback];
    self.alpha = viewProps.opacity * pressedAlpha;
    for (UIView *subview in self.subviews) {
      subview.alpha = 1.0;
    }
  }
}

- (BOOL)isTouchInside:(UITouch *)touch
{
  CGRect bounds = CGRectInset(self.bounds, -EXPElementPressSlop, -EXPElementPressSlop);
  return CGRectContainsPoint(bounds, [touch locationInView:self]);
}

- (void)touchesBegan:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  if (!ReactNativeFeatureFlags::enableNativeGestureRecognizers()) {
    [super touchesBegan:touches withEvent:event];
    return;
  }
  // A second finger on an already-pressed control is not a second press.
  if (_tracking || event.allTouches.count > 1) {
    return;
  }
  _tracking = YES;
  [self setPressed:YES];
}

- (void)touchesMoved:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  if (!_tracking) {
    [super touchesMoved:touches withEvent:event];
    return;
  }
  [self setPressed:[self isTouchInside:touches.anyObject]];
}

- (void)touchesEnded:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  if (!_tracking) {
    [super touchesEnded:touches withEvent:event];
    return;
  }
  _tracking = NO;
  [self setPressed:NO];
}

- (void)touchesCancelled:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  if (!_tracking) {
    [super touchesCancelled:touches withEvent:event];
    return;
  }
  // The usual reason to be here is an enclosing scroll view claiming the
  // gesture once the finger has moved far enough to be a scroll. The press must
  // release, and must not activate.
  _tracking = NO;
  [self setPressed:NO];
}

#pragma mark - EXPElementDragOwnership

- (BOOL)elementOwnsDragGesture
{
  // A disabled control owns nothing: it must not hold a gesture hostage that
  // an enclosing scroll view wants.
  return _ownsDragGesture && self.userInteractionEnabled;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ElementButtonShadowNode::defaultSharedProps();
  }
  return self;
}

- (void)emitPressChange:(BOOL)pressed
{
  if (!_eventEmitter) {
    return;
  }
  std::static_pointer_cast<const ElementButtonEventEmitter>(_eventEmitter)->onElementPressChange(pressed);
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  // Read both as plain values before `super` — it reassigns `_props`, so a
  // reference into the old props object would dangle afterwards. Comparing
  // against `_props` rather than the `oldProps` argument follows the convention
  // the other component views use, and avoids the copy that a
  // `cond ? lvalue : ElementButtonProps{}` ternary would make of the whole
  // (ViewProps-sized) props object on every update.
  const bool wasDisabled = static_cast<const ElementButtonProps &>(*_props).disabled;
  const auto &newButtonProps = static_cast<const ElementButtonProps &>(*props);
  const bool isDisabled = newButtonProps.disabled;

  // `touch-action: none` is the DOM's way of saying this element owns a gesture
  // that starts on it. Anything else leaves the scroll container in charge.
  _ownsDragGesture = newButtonProps.touchAction == "none";

  [super updateProps:props oldProps:oldProps];

  // The element's implicit button role, after super because
  // `RCTViewComponentView` assigns `accessibilityTraits` wholesale from props
  self.accessibilityTraits |= UIAccessibilityTraitButton;

  // A disabled control is not an event target, and `click` is dispatched by
  // the pointer handler, so the view leaves hit-testing. Derived from both
  // inputs on every update: `RCTViewComponentView` assigns
  // `userInteractionEnabled` only when `pointerEvents` changes
  const auto &newViewProps = static_cast<const ViewProps &>(*props);
  self.userInteractionEnabled = !isDisabled && newViewProps.pointerEvents != PointerEventsMode::None;

  if (isDisabled != wasDisabled) {
    if (isDisabled) {
      self.accessibilityTraits |= UIAccessibilityTraitNotEnabled;
    } else {
      self.accessibilityTraits &= ~UIAccessibilityTraitNotEnabled;
    }
  }

  // `super` has just assigned `self.alpha` straight from the `opacity` prop, so
  // a press in flight would be undone by any unrelated prop update. Re-derive it
  // from both.
  [self updatePressedAppearance];

  [self updateChromeButton];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  // Keep `_props`: it is the baseline the next element's props are diffed against, and every
  // attribute the diff does not touch is otherwise left as the previous element set it
  _pressed = NO;
  _tracking = NO;
  self.userInteractionEnabled = YES;
  // A view recycled mid-press would otherwise carry the dim into whatever
  // element it is reused for.
  self.alpha = 1.0;
  // The chrome is derived entirely from props, so tear it down rather than
  // trusting the next element's first update to reconfigure every field.
  [_chromeButton removeFromSuperview];
  _chromeButton = nil;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ElementButtonComponentDescriptor>();
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end

// The dim is a ratio of the title's pressed and rest alphas, since the rest
// colour is not always opaque
void EXPProbeButtonMetrics(facebook::react::ElementControlMetrics &metrics)
{
  RCTAssertMainQueue();
  // Read off the configuration `<button>` mounts
  UIButtonConfiguration *chrome = [UIButtonConfiguration filledButtonConfiguration];
  const NSDirectionalEdgeInsets insets = chrome.contentInsets;
  if (insets.top >= 0 && insets.leading >= 0) {
    metrics.buttonPaddingBlock = static_cast<facebook::react::Float>((insets.top + insets.bottom) / 2.0);
    metrics.buttonPaddingInline = static_cast<facebook::react::Float>((insets.leading + insets.trailing) / 2.0);
  }

  UIButtonConfiguration *configuration = [UIButtonConfiguration filledButtonConfiguration];
  configuration.title = @"A";
  UIButton *button = [UIButton buttonWithConfiguration:configuration primaryAction:nil];
  UIWindow *window = [[UIWindow alloc] initWithFrame:CGRectMake(0, 0, 200, 100)];
  [window addSubview:button];
  [window layoutIfNeeded];

  const CGFloat rest = CGColorGetAlpha(button.titleLabel.textColor.CGColor);
  button.highlighted = YES;
  [window layoutIfNeeded];
  const CGFloat pressed = CGColorGetAlpha(button.titleLabel.textColor.CGColor);
  button.highlighted = NO;
  [button removeFromSuperview];

  // A control that answered nonsense keeps the default rather than publishing
  // a press nobody can see, or one that blanks the content entirely.
  if (rest > 0.01 && pressed > 0.01 && pressed <= rest) {
    metrics.buttonPressedContentAlpha = static_cast<facebook::react::Float>(pressed / rest);
  }
}
