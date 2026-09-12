/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementButtonComponentView.h"
#import "EXPKeyboardTrace.h"

#import <React/RCTAssert.h>
#import <React/RCTConversions.h>

#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/renderer/components/view/ElementButtonShadowNode.h>
#import "EXPElementControlMetricsProbe.h"
#import "EXPElementMenu.h"

#import <React/EXPElementDragOwnership.h>

#import "EXPElementHaptics.h"
#import "EXPMaterialSurface.h"
#import "EXPMenuAnchorButton.h"
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
  /**
   * Whether the surface is glass: the chrome's glass configuration where the
   * platform draws the button, the material's effect view where an author
   * surface does — see `updateChromeButton` and `updateProps`.
   */
  BOOL _surfaceIsGlass;
  /*
   * The menu's invoker, present only when this button HAS a menu.
   *
   * A separate, interactive button on top rather than a flag on the chrome one:
   * an author who styles the button away has no chrome button at all, while
   * still expecting the menu to open.
   *
   * `showsMenuAsPrimaryAction` is what makes ONE TAP open the menu instead of
   * requiring a long press, which is the difference between a menu button and a
   * context menu.
   */
  UIButton *_menuButton;
  /*
   * The invisible source, made only when the chrome cannot be the source. Held
   * separately from `_menuButton` so that "which view is the source" and "is
   * there an overlay to tear down" stay two different questions — they were one
   * variable, and the answer to the second was `_menuButton != _chromeButton`,
   * which is also true when there is no menu at all.
   */
  UIButton *_menuAnchor;
  std::vector<ElementMenuCommand> _appliedCommands;
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
 * It takes the touch (see the block comment below), and the children — a
 * `<button>` may contain arbitrary markup, which no label-based control can
 * host — are laid out by the renderer and drawn above it.
 *
 * An author style dismisses it. `<button style={{backgroundColor}}>` (or any
 * border) means the author owns the surface, and the platform's drawing under
 * an author's would be neither — and the press feedback goes with it, because
 * the feedback belongs to the drawing. See `updatePressedAppearance`.
 */
- (void)updateChromeButton
{
  const auto &props = static_cast<const ElementButtonProps &>(*_props);

  /*
   * GLASS is the chrome's: a `glassButtonConfiguration`, the platform's own
   * Liquid Glass button, which is what the system chat's `+` is
   * (`CKGlassSendMenuButton`, a `UIButton`).
   *
   * It was the material's for a while — `EXPMaterialSurface` wrapping the
   * content in a `UIGlassEffect` view with `interactive` on, under this
   * element's own touch tracking, so that the glass would merge with the
   * field's in the bar's container and grow under a finger. Both were measured
   * on the iOS 27 SIMULATOR, whose glass is a stand-in renderer. On a phone the
   * real compositor drew neither the press nor the zoom transition's morph
   * from an effect view wrapping React children with no control inside it: the
   * touch arrived and UIKit accepted the zoom, and nothing moved. A `UIControl`
   * gets both from the platform, because its own tracking drives them; an
   * effect view AROUND a control is what `<native:button>` does, and what
   * merges with a glass field.
   */
  // Computed in JavaScript next to the style prop it reads (`authorStatesSurface`
  // in Button.js), so both platforms answer the question identically.
  if (![self _wantsChrome:props]) {
    if (_chromeButton != nil) {
      _chromeButton.hidden = YES;
    }
    return;
  }

  if (_chromeButton == nil) {
    _chromeButton = [UIButton buttonWithType:UIButtonTypeSystem];
    /*
     * The platform's button gets the TOUCH, not just the paint.
     *
     * A gray or filled button's highlight is driven by `UIControl`'s own
     * tracking, and a control that never receives a touch never tracks; there
     * is no state to set instead, and forwarding the touch methods by hand
     * recurses into `UIControl`'s own forwarding and overflows the stack.
     *
     * So the control events come back the other way. `UIControlEventTouchDown`,
     * `…DragEnter`, `…DragExit`, `…UpInside`, `…UpOutside` and `…Cancel` are
     * wired to the element's press state below, which is what `:active`,
     * `onPressChange` and the content dim read. The
     * platform's own composer hears about its `+` through the same control
     * events — down inside, drag enter, up outside and cancel.
     *
     * `click` is NOT emitted from here. `RCTSurfacePointerHandler` dispatches it
     * from the surface's own recognizer, which observes the touches whichever
     * view is hit-tested, and emitting a second one would fire every handler
     * twice.
     */
    _chromeButton.userInteractionEnabled = YES;
    [_chromeButton addTarget:self
                      action:@selector(_chromePressBegan)
            forControlEvents:UIControlEventTouchDown | UIControlEventTouchDragEnter];
    [_chromeButton addTarget:self
                      action:@selector(_chromePressEnded)
            forControlEvents:UIControlEventTouchDragExit | UIControlEventTouchUpOutside | UIControlEventTouchCancel];
    [_chromeButton addTarget:self action:@selector(_chromePressActivated) forControlEvents:UIControlEventTouchUpInside];
    // Never announced: the component view is the accessibility element, with
    // the button trait already on it. A second, label-less button underneath
    // it would read as an unlabelled control.
    _chromeButton.isAccessibilityElement = NO;
    _chromeButton.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    [self insertSubview:_chromeButton atIndex:0];
  }
  _chromeButton.hidden = NO;
  // `bounds` and `center` rather than `frame`, because the press scales this
  // view and `frame` is not meaningful on a transformed one — assigning it
  // would silently undo the scale mid-press.
  _chromeButton.bounds = CGRectMake(0, 0, CGRectGetWidth(self.bounds), CGRectGetHeight(self.bounds));
  _chromeButton.center = CGPointMake(CGRectGetMidX(self.bounds), CGRectGetMidY(self.bounds));
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
  const BOOL prominent = props.buttonStyle == "prominent";
  UIButtonConfiguration *config =
      prominent ? [UIButtonConfiguration filledButtonConfiguration] : [UIButtonConfiguration grayButtonConfiguration];
  if (_surfaceIsGlass) {
    if (@available(iOS 26.0, *)) {
      config = prominent ? [UIButtonConfiguration prominentGlassButtonConfiguration]
                         : [UIButtonConfiguration glassButtonConfiguration];
    }
  }
  /*
   * The author's own corner radius, honoured on the platform's surface.
   *
   * A configuration's default corner style is the platform's, which is right
   * for an ordinary button and wrong for a circular one: the native composer's `+` is a
   * 40-point circle, and `cornerStyle` has no "whatever the author said". Fixed
   * plus the view's own radius is that.
   */
  if (self.layer.cornerRadius > 0) {
    /*
     * CAPSULE when the author's radius rounds the whole side, FIXED otherwise.
     *
     * A fixed radius is drawn with the platform's continuous curve — a
     * squircle — which is right for a rounded rectangle and wrong for a circle:
     * a 40-point button asking for a radius of 20 wants a circle, and a
     * squircle at that radius is visibly not one. `Capsule` is the corner style
     * that means "as round as this side allows".
     */
    const CGFloat side = MIN(CGRectGetWidth(self.bounds), CGRectGetHeight(self.bounds));
    if (side > 0 && self.layer.cornerRadius * 2 >= side - 0.5) {
      config.cornerStyle = UIButtonConfigurationCornerStyleCapsule;
    } else {
      config.cornerStyle = UIButtonConfigurationCornerStyleFixed;
      UIBackgroundConfiguration *background = config.background;
      background.cornerRadius = self.layer.cornerRadius;
      config.background = background;
    }
  }
  _chromeButton.configuration = config;
  _chromeButton.enabled = !props.disabled;
}

/// Whether the platform draws this button: an author style or a `<button>`
/// with no style of its own dismisses the chrome.
- (BOOL)_wantsChrome:(const ElementButtonProps &)props
{
  return !props.hasAuthorChrome && !props.buttonStyle.empty();
}

/**
 * The glass to zoom a presentation out of: the platform's glass button when
 * that is what draws this one, otherwise the material's effect view.
 */
- (nullable UIView *)exp_glassView
{
  if (_surfaceIsGlass && _chromeButton != nil && !_chromeButton.hidden) {
    return _chromeButton;
  }
  return [super exp_glassView];
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  if (_chromeButton != nil) {
    _chromeButton.bounds = CGRectMake(0, 0, CGRectGetWidth(self.bounds), CGRectGetHeight(self.bounds));
    _chromeButton.center = CGPointMake(CGRectGetMidX(self.bounds), CGRectGetMidY(self.bounds));
  }
  /*
   * The menu's anchor has to be THIS view's bounds, and it has to be set here.
   *
   * It was set once, at creation, when the view had no bounds yet — and an
   * autoresizing mask cannot grow a zero-sized frame into anything. UIKit then
   * anchored the menu to a degenerate rect, which showed up as the panel
   * wearing its pointer on the wrong side entirely: a notch cut out of the
   * bottom-right corner while the button it belongs to is on the far left.
   * Reported as "the menu has this weird nub".
   */
  if (_menuAnchor != nil) {
    _menuAnchor.frame = self.bounds;
  }
}

/*
 * The mount-index bookkeeping in `RCTViewComponentView` must not count the
 * chrome as a mounted child — see `isHostChromeSubview:` in the header.
 */
- (BOOL)hasHostChromeSubviews
{
  // `super` too: the base class keeps a registry for chrome installed from
  // outside, which a subclass with chrome of its own must not hide
  return _chromeButton != nil || _menuAnchor != nil || [super hasHostChromeSubviews];
}

/*
 * The menu button counts as chrome too.
 *
 * It happened to be harmless while it was always the LAST subview — an extra
 * view at the end shifts no index before it — but that is luck rather than a
 * rule, and the rule is the one the header states: a subview the mutation
 * stream does not know about must not be counted as a mounted child. The same
 * omission in the material surface aborted the app on
 * `unmountChildComponentView:index:` the moment a box with one had children
 * that came and went.
 */
- (BOOL)isHostChromeSubview:(UIView *)view
{
  return view == _chromeButton || view == _menuAnchor || [super isHostChromeSubview:view];
}

/*
 * The menu's source depends on which WINDOW this view is in, and at the first
 * update it is usually in none. Deciding once, at prop time, put the composer's
 * menu on the chrome button — correct for the window it had then (nil) and
 * wrong for the accessory it was about to be mounted into.
 */
- (void)didMoveToWindow
{
  [super didMoveToWindow];
  if (_menuButton != nil) {
    [self _installMenuSource];
  }
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
 * What a press LOOKS like on iOS, ASKED rather than chosen.
 *
 * UIKit dims a pressed button — its own fill and its own title — and the
 * element's children are neither: no API dims subviews a control does not own,
 * so this one factor has to be reproduced here. Reproduced, not remembered:
 * `EXPProbeButtonMetrics` reads it off a real button in the pressed state at
 * startup, so a future iOS that presses differently is followed rather than
 * drifted away from. The button's own `alpha` stays 1 throughout, so what is
 * being matched is a composite, and a view alpha is that same operation.
 *
 * This used to live in JavaScript as `opacity: 0.6` applied from React state.
 * That put a render between the finger and the feedback, on the one path the
 * view-level touch tracking exists to keep off the JavaScript thread, and 0.6
 * was a guess. Android deliberately does none of this: its press is a ripple,
 * and dimming an Android button would be as wrong as rippling an iOS one.
 */
static CGFloat EXPElementButtonPressedAlpha(void)
{
  return facebook::react::elementControlMetrics().buttonPressedContentAlpha;
}

- (void)_chromePressBegan
{
  [self setPressed:YES];
}

- (void)_chromePressEnded
{
  [self setPressed:NO];
}

/**
 * The release, from the button that took the touch.
 *
 * Only the press state and the menu happen here. The activation is the pointer
 * handler's, as it always was.
 */
- (void)_chromePressActivated
{
  [self setPressed:NO];
  /*
   * The menu, when the chrome is not hosting it.
   *
   * `_installMenuSource` gives the menu to the chrome button where its lift
   * would be visible, and UIKit opens it from the same tap. Where it cannot —
   * inside a keyboard accessory, where the lift goes to a window the menu
   * cannot reach — an invisible anchor holds it and nothing is listening, so it
   * is opened here. That used to be `touchesEnded:`, which no longer runs now
   * that the button has the touch.
   */
  if (_menuAnchor != nil) {
    // The same feedback the native composer's `+` gives, and from the same family:
    // it holds a `UISelectionFeedbackGenerator` for this button.
    [EXPElementHaptics selectionChanged];
    if (@available(iOS 17.4, *)) {
      [_menuAnchor performPrimaryAction];
    }
  }
}

- (void)setPressed:(BOOL)pressed
{
  if (_surfaceIsGlass && pressed != _pressed) {
    // What the platform's press has to work with: the window the touch is in,
    // and where the glass is. See the note above `updatePressedAppearance`.
    [EXPKeyboardTrace record:@"button PRESS %d window=%@ glass=%@ inWindow=%@",
                             (int)pressed,
                             NSStringFromClass(self.window.class),
                             NSStringFromClass([self exp_glassView].class),
                             NSStringFromCGRect([self convertRect:self.bounds toView:nil])];
  }
  if (_pressed == pressed) {
    return;
  }
  if (pressed && _menuAnchor != nil) {
    // Warmed on the press, fired on the release: a generator asked cold is a
    // haptic that arrives after the menu.
    [EXPElementHaptics prepareSelection];
  }
  _pressed = pressed;
  [self updatePressedAppearance];
  [self emitPressChange:pressed];
}

/*
 * The press feedback belongs to whoever drew the button.
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
 * **Without chrome** (author-styled surface): NOTHING is dimmed. The dim is
 * what UIKit does to the fill IT draws, and once the author has claimed the
 * surface there is no platform drawing left to give feedback for — the same
 * reason the insets, the minimum height and the label typography withdraw with
 * the platter (`buttonUAStyle`, `button-chrome-withdraws-as-a-unit`). It is
 * also what both other platforms this code answers to do: a custom-drawn UIKit
 * view gets no automatic highlight, and on the web a `<button>` with an author
 * background is unchanged by a press unless the author writes `:active`.
 *
 * Dimming anyway is not neutral. An author who DOES write `:active` gets two
 * feedbacks at once, on different clocks: ours lands instantly at x0.75 while
 * theirs transitions over its own duration — reported from the device as a
 * button that "goes dark on press and then changes blue again", which is
 * exactly those two effects arriving in sequence. Astryx writes `:active` on
 * every interactive component, so this was every Astryx button.
 *
 * Alpha is multiplied against the author's own `opacity` rather than assigned
 * over it: `<button style={{opacity: 0.5}}>` is half-transparent because the
 * author said so, and the chrome case must dim further rather than reset it.
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

/*
 * The press feedback belongs to whoever drew the surface.
 *
 * GLASS: UIKit's. The glass button's own tracking grows and brightens it (the
 * material's interactive effect, for an author-surfaced glass), so nothing is
 * added or dimmed here — a dimmed glyph on a brightening surface reads as two
 * things happening.
 *
 * GRAY and FILLED: the chrome's highlight is UIKit's, and only the CONTENT
 * above it is treated here — the element's children are foreign subviews a
 * `UIButton` cannot own, dimmed by the measured x0.75 UIKit applies to its own
 * title — see `pressedAlphaWhenPressed:authorStatesPressFeedback:` for the
 * deviation that records.
 */
- (void)updatePressedAppearance
{
  const auto &viewProps = static_cast<const ViewProps &>(*_props);
  const BOOL chromeActive = _chromeButton != nil && !_chromeButton.hidden;
  if (_surfaceIsGlass) {
    self.alpha = viewProps.opacity;
    for (UIView *subview in self.subviews) {
      subview.alpha = 1.0;
    }
  } else if (chromeActive) {
    self.alpha = viewProps.opacity;
    const CGFloat contentAlpha = _pressed ? EXPElementButtonPressedAlpha() : 1.0;
    for (UIView *subview in self.subviews) {
      if (subview != _chromeButton) {
        subview.alpha = contentAlpha;
      }
    }
  } else {
    /*
     * An author surface, and nobody drawing the press.
     *
     * The dim used to stop here entirely, on the grounds that the feedback
     * belongs to whoever drew the button. That is right when the author DID
     * answer the press — `:active`, or any declaration that varies with the
     * interaction state — and wrong when nobody did: a `<button>` with a
     * background and a finger on it looked exactly like one with no finger on
     * it, which reads as a control that is not responding rather than as a
     * design decision.
     *
     * So the platform answers only when the author has not. `props.authorStatesPressFeedback`
     * is computed where the styles are, next to the state that resolved them.
     */
    const auto &buttonProps = static_cast<const ElementButtonProps &>(*_props);
    const CGFloat pressedAlpha = [[self class] pressedAlphaWhenPressed:_pressed
                                             authorStatesPressFeedback:buttonProps.authorStatesPressFeedback];
    self.alpha = viewProps.opacity * pressedAlpha;
    for (UIView *subview in self.subviews) {
      subview.alpha = 1.0;
      subview.transform = CGAffineTransformIdentity;
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
  // A touch that landed on the children rather than on the chrome is tracked
  // here, under the chrome's rule: the finger leaving ends the press
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
  /*
   * The tap IS the menu, when the menu is anchored rather than hosted.
   *
   * Only reachable for a button the PLATFORM did not draw: where there is chrome
   * it has the touch and opens the menu from `_chromePressActivated`, and these
   * methods do not run at all.
   */
  if (_menuAnchor != nil && [self isTouchInside:touches.anyObject]) {
    // The same feedback the native composer's `+` gives, and from the same family:
    // it holds a `UISelectionFeedbackGenerator` for this button.
    [EXPElementHaptics selectionChanged];
    if (@available(iOS 17.4, *)) {
      [_menuAnchor performPrimaryAction];
    }
  }
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

/**
 * Whether UIKit's LIFT will be visible from this view's window.
 *
 * Presenting a menu lifts its source view out of the tree and draws it in a
 * `UITextEffectsWindow` — measured at window level 1, against the app's own
 * window at level 0, which is why the lift reads as the button rising off the
 * screen. A view in a window ABOVE that level is still lifted, but the lift is
 * drawn underneath the window it came from, so nothing of it is seen.
 *
 * The composer's `+` is exactly that case: an accessory lives in
 * `UIRemoteKeyboardWindow`, measured at level 10000001.
 */
- (BOOL)_menuLiftWouldBeVisible
{
  return self.window == nil || self.window.windowLevel <= UIWindowLevelNormal;
}

/**
 * Which view the menu is presented FROM.
 *
 * The CHROME button, where the lift can be seen. A menu presented from a bare
 * overlay is drawn with a pointer aimed at its source, and that pointer is the
 * notch on the panel's corner; presented from the button that actually draws
 * the control — the glass one, on iOS 26 — the platform morphs the button into
 * the panel instead, which is what the native chat app does and what makes the pointer
 * unnecessary. It has to become interactive to receive the tap, which is
 * correct for a menu button: opening the menu IS its action, so there is no
 * press for the element to track separately.
 *
 * An INVISIBLE overlay, where the lift cannot. Lifting the chrome button in an
 * accessory does not merely waste the morph, it costs the control: the button
 * vanishes for as long as the menu is up, and — measured — its glass does not
 * come back afterwards, while `hidden`, `alpha`, `layer.opacity` and its
 * configuration all still read normal. Lifting a view with nothing in it has
 * nothing to lose, and the pointer we get instead is what the platform draws
 * for a menu whose source is not a button.
 */
- (void)_installMenuSource
{
  const BOOL onChrome = _chromeButton != nil && !_chromeButton.hidden && [self _menuLiftWouldBeVisible];
  UIButton *wanted = nil;
  /*
   * Read the menu FIRST, because handing it back clears it.
   *
   * Taking it off the old source and then reading it moved a nil across, and
   * the symptom was a `+` that looked right and did nothing at all: the source
   * had swapped on the window change, and only the swap — not the prop update
   * that builds the menu — had run.
   */
  UIMenu *const menu = _menuButton.menu;

  if (onChrome) {
    if (_menuAnchor != nil) {
      [_menuAnchor removeFromSuperview];
      _menuAnchor = nil;
    }
    wanted = _chromeButton;
    wanted.userInteractionEnabled = YES;
    wanted.showsMenuAsPrimaryAction = YES;
  } else {
    if (_chromeButton != nil && _menuButton == _chromeButton) {
      // Handing the menu back: the chrome returns to being chrome, which is
      // not a target.
      _chromeButton.menu = nil;
      _chromeButton.showsMenuAsPrimaryAction = NO;
      _chromeButton.userInteractionEnabled = NO;
    }
    if (_menuAnchor == nil) {
      _menuAnchor = [EXPMenuAnchorButton buttonWithType:UIButtonTypeCustom];
      _menuAnchor.showsMenuAsPrimaryAction = YES;
      _menuAnchor.backgroundColor = UIColor.clearColor;
      /*
       * Never a target: it is a POSITION, not a control.
       *
       * An interactive overlay would open the menu by being tapped, and that
       * was the first shape of this — but it takes the tap away from the
       * element, and the element's touches are where `:active`, `onPressChange`
       * and the press drawing all come from. `touchesEnded:` opens it instead,
       * through `performPrimaryAction`, so the touch stays where it belongs.
       */
      _menuAnchor.userInteractionEnabled = NO;
      // The component view is the accessibility element and already announces
      // as a button; a second, unlabelled one under it would be read out too.
      _menuAnchor.isAccessibilityElement = NO;
      _menuAnchor.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
      _menuAnchor.frame = self.bounds;
      [self addSubview:_menuAnchor];
    }
    wanted = _menuAnchor;
  }

  if (wanted != _menuButton) {
    _menuButton = wanted;
    // The menu itself is rebuilt by the caller when the commands change; moving
    // it across keeps a source swap — which happens on a window change, not a
    // prop change — from leaving the button with no menu at all.
    if (menu != nil) {
      _menuButton.menu = menu;
    }
  }
}

/**
 * The menu, rebuilt when the commands change.
 *
 * `UIMenu` is immutable, so there is no editing one in place — a changed list
 * means a new menu. Guarded on the commands actually differing because
 * `updateProps` runs on every commit that touches this view.
 */
- (void)_updateMenu:(const ElementButtonProps &)props
{
  if (props.menuCommands == _appliedCommands) {
    return;
  }
  _appliedCommands = props.menuCommands;

  if (props.menuCommands.empty()) {
    if (_menuAnchor != nil) {
      [_menuAnchor removeFromSuperview];
      _menuAnchor = nil;
    }
    if (_menuButton == _chromeButton && _chromeButton != nil) {
      _chromeButton.menu = nil;
      _chromeButton.showsMenuAsPrimaryAction = NO;
      _chromeButton.userInteractionEnabled = NO;
    }
    _menuButton = nil;
    return;
  }

  [self updateChromeButton];
  [self _installMenuSource];

  /*
   * The SHARED builder, so a `<menu>` on a button is the same menu it would be
   * on a balloon: icons from `system:` sources, nested `<menu>`s as inline
   * groups, and UIKit's compact row for a group that is all glyphs. This built
   * its own before, with `image:nil` and no notion of a group, so the same
   * markup drew glyphs in one place and words in the other.
   */
  __weak __typeof(self) weakSelf = self;
  _menuButton.menu = EXPElementMenuFromCommands(EXPElementMenuCommands(props.menuCommands), ^(NSString *identifier) {
    [weakSelf emitCommand:RCTStringFromNSString(identifier)];
  });
}

- (void)emitCommand:(const std::string &)identifier
{
  if (!_eventEmitter) {
    return;
  }
  std::static_pointer_cast<const ElementButtonEventEmitter>(_eventEmitter)->onElementCommand(identifier);
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

  [self _updateMenu:newButtonProps];

  /*
   * The material, whichever keyword, except glass on a button the platform
   * draws: that glass is the chrome's (`updateChromeButton`), and a material
   * as well would put a second glass around the first. A blur goes BEHIND the
   * content as a backdrop; glass on an author-surfaced button still wraps it.
   */
  _surfaceIsGlass = newButtonProps.appleVisualEffect.find("glass") != std::string::npos;
  const BOOL glassIsTheChromes = _surfaceIsGlass && [self _wantsChrome:newButtonProps];
  [self exp_applyMaterialKeyword:glassIsTheChromes
            ? nil
            : [NSString stringWithUTF8String:newButtonProps.appleVisualEffect.c_str()]
                            fade:newButtonProps.appleVisualEffectFade];

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
  /*
   * And the menu with it. `_appliedCommands` is what `_updateMenu:` compares
   * against, so leaving it set meant a view recycled into an element with the
   * SAME commands kept the old element's source view and never rebuilt one —
   * and the source view was the chrome button that has just been destroyed.
   */
  [_menuAnchor removeFromSuperview];
  _menuAnchor = nil;
  _menuButton = nil;
  _appliedCommands.clear();
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

/*
 * `<button>`: how far a real control dims its own content when pressed.
 *
 * Read off the title UIKit draws, in both states, and taken as a RATIO — the
 * rest colour is not always opaque, so the pressed alpha on its own would
 * describe the colour rather than the press.
 */
void EXPProbeButtonMetrics(facebook::react::ElementControlMetrics &metrics)
{
  RCTAssertMainQueue();
  /*
   * The control's own content insets, which are a button's padding.
   *
   * Read off the same configuration `<button>` mounts, so the label sits where
   * a native button's label sits rather than where someone once measured it
   * sitting.
   */
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
