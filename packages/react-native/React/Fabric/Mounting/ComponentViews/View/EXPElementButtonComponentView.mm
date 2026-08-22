/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementButtonComponentView.h"

#import <React/RCTConversions.h>
#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/renderer/components/view/ElementButtonShadowNode.h>

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
 * The button the platform would draw, drawing this one.
 *
 * The chrome is a real `UIButton` with a real `UIButtonConfiguration`, hosted
 * as the bottom subview and stretched to the box. It is UIKit's own rendering
 * of its own control — the exact fills, the capsule, the adaptive colours in
 * dark mode and Increased Contrast, and whatever the next OS restyles buttons
 * into — rather than this component's CSS description of those things, which
 * is what it replaces and which drifted (its gray-button label was UIKit's
 * pre-26 blue; iOS 26 draws it in the label colour).
 *
 * It is chrome ONLY: `userInteractionEnabled` is NO, touch tracking stays at
 * this view's level (see the block comment below — that placement is what
 * makes presses wait out a scroll view's `delaysContentTouches`), and the
 * children — a `<button>` may contain arbitrary markup, which no label-based
 * control can host — are laid out by the renderer and drawn above it.
 *
 * An author style dismisses it. `<button style={{backgroundColor}}>` (or any
 * border) means the author owns the surface, and the platform's drawing under
 * an author's would be neither. The press dim covers feedback either way.
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
  UIButtonConfiguration *config = props.buttonStyle == "prominent"
      ? [UIButtonConfiguration filledButtonConfiguration]
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
 * The press is tracked here, in the view's own touch handling, rather than in a
 * gesture recognizer attached to the view. That is not an implementation
 * detail — it is the whole point.
 *
 * A scroll view's `delaysContentTouches` holds a touch back for a moment to see
 * whether a scroll was meant, and it does so by delaying delivery *to the
 * view*. Gesture recognizers are outside that: UIKit hands them the touch
 * immediately, whatever the scroll view decides later. So a recognizer-driven
 * press highlights the instant the finger lands and un-highlights when the pan
 * takes over — the flicker you see when swiping across a list of buttons in an
 * app that rolled its own touch handling. Observed exactly that way here: with
 * the recognizer, a 120ms swipe starting on a button still registered a press.
 *
 * `UIControl` tracks touches at the view level for this reason, and doing the
 * same puts these elements under the same rule: inside a scrolling container
 * the press waits out the delay and never begins if the finger was leaving;
 * outside one it begins at once. None of that timing is reimplemented here —
 * the platform simply chooses when to deliver the touch.
 *
 * Note this tracking does not *activate* anything: `click` is dispatched by the
 * pointer handler. What it reports is press state, continuously, because that
 * is what `:active` needs — a press that slides off the control un-highlights
 * while staying live, and re-highlights on sliding back, as it does on a
 * `UIButton`.
 */

/*
 * What a press LOOKS like on iOS, measured rather than chosen.
 *
 * A real `UIButton` was rendered in both states on the simulator and the pixels
 * compared. Its highlight multiplies the whole button by alpha 0.75 — the same
 * factor whatever the configuration:
 *
 *     gray    fill  rgba(19,19,20,41)   -> rgba(14,14,15,31)     41/255 -> 31/255
 *             title rgba(0,0,0,252)     -> rgba(4,4,4,197)
 *     filled  fill  rgba(0,136,255,255) -> rgba(0,102,191,191)   255 -> 191
 *
 * 31/41, 197/252 and 191/255 are 0.756, 0.782 and 0.749. The button's own
 * `alpha` property stays at 1 throughout, so this is applied when the content is
 * composited, and a view alpha is the same operation.
 *
 * This used to live in JavaScript as `opacity: 0.6` applied from React state.
 * That put a render between the finger and the feedback, on the one path the
 * view-level touch tracking exists to keep off the JavaScript thread, and 0.6
 * was a guess. Android deliberately does none of this: its press is a ripple,
 * and dimming an Android button would be as wrong as rippling an iOS one.
 */
static const CGFloat EXPElementButtonPressedAlpha = 0.75;

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
 * Two regimes, chosen by whether the platform chrome is on screen.
 *
 * **With chrome**: the press is handed to UIKit — `UIButton.highlighted` — so
 * the fill's highlight is the platform's own, with the platform's animation
 * curve and timing, and it keeps tracking the OS if a future iOS changes what
 * a pressed button looks like. Only the CONTENT above the chrome (the
 * element's children, which a UIButton cannot own) is dimmed here, by the
 * measured x0.75 UIKit applies to its own title.
 * DOM-CSS-DEVIATION(press-dim-on-content): that one factor is a restatement of
 * the platform's current behaviour rather than a delegation to it, because no
 * API dims foreign subviews; if UIKit changes its title treatment, the
 * constant needs re-measuring. Informational, not a warning.
 *
 * **Without chrome** (author-styled surface): the author's box dims as a
 * whole, which is the closest treatment to what UIKit does to a button it
 * draws itself.
 *
 * Alpha is multiplied against the author's own `opacity` rather than assigned
 * over it: `<button style={{opacity: 0.5}}>` is half-transparent because the
 * author said so, and pressing it must dim further, not reset that.
 */
- (void)updatePressedAppearance
{
  const auto &viewProps = static_cast<const ViewProps &>(*_props);
  const BOOL chromeActive = _chromeButton != nil && !_chromeButton.hidden;
  if (chromeActive) {
    self.alpha = viewProps.opacity;
    _chromeButton.highlighted = _pressed;
    const CGFloat contentAlpha = _pressed ? EXPElementButtonPressedAlpha : 1.0;
    for (UIView *subview in self.subviews) {
      if (subview != _chromeButton) {
        subview.alpha = contentAlpha;
      }
    }
  } else {
    self.alpha = viewProps.opacity * (_pressed ? EXPElementButtonPressedAlpha : 1.0);
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

  // A button announces as a button, whether or not it is styled like one — the
  // implicit ARIA role of the HTML element, and the counterpart of
  // `getAccessibilityClassName()` on Android.
  //
  // Applied *after* super on purpose: `RCTViewComponentView` assigns
  // `accessibilityTraits` wholesale from props, so setting this once at init
  // was silently discarded on the element's first prop update. Whether the view
  // is an accessibility element at all is still the `accessible` prop's
  // decision, not this one's.
  self.accessibilityTraits |= UIAccessibilityTraitButton;

  // Suppressing the press is not enough. `click` is dispatched by the pointer
  // handler, which knows nothing about this element's `disabled` prop, so a
  // disabled button was still firing onClick — verified on device. Taking the
  // view out of hit-testing is what actually matches the DOM, where a disabled
  // control is not an event target at all.
  //
  // Derived from *both* inputs on every update, rather than written only when
  // `disabled` changes: `RCTViewComponentView` assigns `userInteractionEnabled`
  // solely when `pointerEvents` changes, so a bare `!isDisabled` here would
  // re-enable interaction on a `<button pointerEvents="none">` the moment it
  // was enabled again, and nothing would put it back.
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
  _props = ElementButtonShadowNode::defaultSharedProps();
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
