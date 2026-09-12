/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "../View/EXPKeyboardTrace.h"
#import "../KeyboardAccessory/EXPKeyboardAccessoryComponentView.h"
#import "EXPKeyboardPanelComponentView.h"

#import <React/RCTComponentViewFactory.h>
#import <React/RCTConversions.h>
#import <React/RCTSurfaceTouchHandler.h>
#import <react/renderer/components/view/ExpoKeyboardPanelShadowNode.h>
#import "EXPKeyboardInsets.h"
#import "EXPElementHaptics.h"

using namespace facebook::react;

/**
 * React's children, and nothing else.
 *
 * A plain view rather than a `UIInputView`, because a panel is presented two
 * different ways and only one of them wants a keyboard's backdrop. This holds
 * the children in both, and whoever presents it supplies the surface.
 *
 * NOTHING repositions the children: they arrive already laid out, in this
 * view's coordinates. It used to set every subview to the full bounds, on the
 * assumption that React mounts exactly one child. It does not — a wrapper
 * `<div>` that draws nothing is flattened away by Fabric, so the panel's
 * buttons arrive as direct children, and every one of them was then given the
 * whole panel. They drew on top of each other, which reads as the panel
 * rendering one garbled line.
 */
@interface EXPKeyboardPanelContentView : UIView
@end

@implementation EXPKeyboardPanelContentView

/*
 * The panel's own surface is never a target.
 *
 * A panel is a BOX with a card in it, and the box is usually bigger — the card
 * is inset, and everything around it is meant to be the backdrop. A plain view
 * returns itself for any point inside its bounds, so that margin swallowed the
 * taps that were supposed to dismiss the panel, and tapping just beside the
 * card did nothing at all.
 *
 * Same rule as the accessory bar, for the same reason.
 */
- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event
{
  UIView *hit = [super hitTest:point withEvent:event];
  return hit == self ? nil : hit;
}

@end

/**
 * The view UIKit is handed as an `inputView`.
 *
 * A `UIInputView` with the keyboard's style, so a panel with no background of
 * its own is drawn on the keyboard's material — the same reasoning as the
 * accessory's content view, and the reason a panel looks like it belongs to the
 * keyboard rather than sitting in front of it.
 *
 * The height is React's, published as an intrinsic size AND written to the
 * frame: UIKit sizes a plain input view from its frame, and the intrinsic size
 * only participates under Auto Layout, which this deliberately is not.
 */
@interface EXPKeyboardPanelInputView : UIInputView
@property (nonatomic, assign) CGFloat contentHeight;
@property (nonatomic, strong, nullable) UIView *content;
@end

@implementation EXPKeyboardPanelInputView

- (instancetype)init
{
  // The style is fixed at construction and cannot be changed later.
  if (self = [super initWithFrame:CGRectZero inputViewStyle:UIInputViewStyleKeyboard]) {
    self.translatesAutoresizingMaskIntoConstraints = NO;
    self.allowsSelfSizing = YES;
  }
  return self;
}

- (void)setContent:(UIView *)content
{
  if (_content == content) {
    return;
  }
  [_content removeFromSuperview];
  _content = content;
  if (content != nil) {
    [self addSubview:content];
  }
  [self setNeedsLayout];
}

- (CGSize)intrinsicContentSize
{
  return CGSizeMake(UIViewNoIntrinsicMetric, _contentHeight);
}

- (void)setContentHeight:(CGFloat)contentHeight
{
  if (_contentHeight == contentHeight) {
    return;
  }
  _contentHeight = contentHeight;
  [self invalidateIntrinsicContentSize];
  [self setNeedsLayout];
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  _content.frame = self.bounds;
}

@end

/**
 * How far a panel's card sits above the button it grew out of.
 *
 * Measured off the native chat app: the card's bottom edge is at 827 and the `+`'s box
 * begins at 840, so the gap is 13 points.
 */
static const CGFloat EXPKeyboardPanelAnchorGap = 13;

/**
 * How dark the page goes behind an overlay panel: NOT AT ALL.
 *
 * Measured, with the native chat app's send menu open on the simulator: the page beside
 * the card reads (255, 255, 255) and the page above it reads (255, 255, 255).
 * The only thing darkening anything is the card's own shadow, which reaches
 * about ten points and takes the page to 245 at its foot. This was 0.12 — a
 * twelfth off everything on screen — and it is the difference between a menu and
 * a modal.
 *
 * The backdrop VIEW stays, because it is what a tap outside lands on. It is
 * transparent rather than absent, and its alpha stays at 1: a view at alpha 0 is
 * skipped by hit-testing, so fading it out would take the way out with it.
 */
static const CGFloat EXPKeyboardPanelDimming = 0;

/**
 * How long the card's ink and the page's dimming take, either way.
 *
 * Shorter than the morph on purpose. The card's SHAPE is a spring and settles in
 * about eight tenths of a second; its opacity is not, because an opacity that
 * overshoots has nowhere to overshoot to — it would go past opaque and come
 * back, which is a flash.
 */
static const NSTimeInterval EXPKeyboardPanelFade = 0.22;

/**
 * A spring stated in the platform's own terms.
 *
 * `UIViewPropertyAnimator`'s `UISpringTimingParameters` carries mass, stiffness
 * and damping, and `CASpringAnimation` takes the same three — so a spring
 * measured from a `UIViewPropertyAnimator` transfers here without being
 * converted into UIKit's normalised damping ratio, which loses the mass.
 *
 * `settlingDuration` rather than a stated duration: a spring's length is a
 * consequence of its constants, and CoreAnimation will work it out.
 */
/**
 * How small the card's CONTENT is when the morph begins.
 *
 * The height's ratio, on both axes. Uniform because the platform's own is — a
 * row icon is round on every frame of its `+` opening — and taken from the height
 * because that is the axis the measurement follows: the content scale tracked
 * the card's height ratio to within the error of reading a bounding box off a
 * recording, and the width's ratio was consistently too large.
 */
static CGFloat EXPKeyboardPanelMiniature(CGSize start, CGSize card)
{
  if (card.height <= 0 || start.height <= 0) {
    return 1;
  }
  return MIN(1, start.height / card.height);
}

static CASpringAnimation *EXPKeyboardPanelSpring(
    NSString *keyPath,
    CGFloat mass,
    CGFloat stiffness,
    CGFloat damping,
    id fromValue,
    id toValue)
{
  CASpringAnimation *spring = [CASpringAnimation animationWithKeyPath:keyPath];
  spring.mass = mass;
  spring.stiffness = stiffness;
  spring.damping = damping;
  spring.fromValue = fromValue;
  spring.toValue = toValue;
  spring.duration = spring.settlingDuration;
  spring.fillMode = kCAFillModeBackwards;
  return spring;
}

/*
 * The two springs the card's frame is built from, measured from the platform's
 * own popover presentation.
 *
 * Read from the `timingParameters` of the animators that present the system's
 * `+` card, one each for width, height, centre-x and centre-y:
 *
 *     Width, CenterX    mass 2  stiffness 300  damping 36   settles 0.849
 *     Height, CenterY   mass 2  stiffness 320  damping 35   settles 0.866
 *
 * Two springs, not four: width and centre-x share one, height and centre-y the
 * other. That is what makes the card reach its height a little before its
 * width, so it does not arrive as one shape.
 */
#define EXP_PANEL_SPRING_X 2, 300, 36
#define EXP_PANEL_SPRING_Y 2, 320, 35

@interface EXPKeyboardPanelComponentView ()
@end

/*
 * The panel that is currently showing, if any.
 *
 * The native chat app puts BOTH the composer and the panel on ONE responder: its chat
 * controller overrides `inputAccessoryViewController` (the composer) AND `inputViewController`
 * (what replaces the keys). Ours were two separate responders competing for first
 * responder, so with the bar hosted as a real accessory the `+` silently did
 * nothing — measured: same tap opens the panel with the accessory off and not
 * with it on.
 *
 * So the bar has to be able to ASK what the open panel wants shown, rather than
 * the panel taking the responder for itself. Weak, because the panel is a
 * mounted view and may go at any time.
 */
static __weak EXPKeyboardPanelComponentView *EXPOpenPanel = nil;

@implementation EXPKeyboardPanelComponentView {
  EXPKeyboardPanelContentView *_contentView;
  EXPKeyboardPanelInputView *_inputHost;
  /** The field currently showing this panel. Weak: it can be torn down focused. */
  __weak UIView *_host;
  BOOL _visible;
  RCTSurfaceTouchHandler *_touchHandler;
  /** The overlay presentation's pieces; all nil while it is not on screen. */
  __weak UIView *_overlayHostView;
  UIView *_dimmingView;
  BOOL _overlay;
  CGSize _contentSize;
  CGRect _anchor;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const ExpoKeyboardPanelProps>();
    _props = defaultProps;
    _contentView = [EXPKeyboardPanelContentView new];
    /*
     * Its own touch handling, because the panel is in the KEYBOARD'S window.
     *
     * The surface's handler is attached to the surface's own hierarchy, and an
     * input view is not in it — so React never heard about a tap and the
     * panel's buttons did nothing at all. The accessory needs the same thing
     * for the same reason.
     */
    _touchHandler = [RCTSurfaceTouchHandler new];
    [_touchHandler attachToView:_contentView];
  }
  return self;
}

/*
 * React's children go into the panel's own view, never into this one. This view
 * is a handle: it is hidden, and anything drawn here would be drawn nowhere.
 *
 * MOUNTING AND UNMOUNTING, both. Only `insertSubview:` was overridden at first,
 * and the base class's unmount asserts that the child's superview IS this view —
 * so a panel whose screen went away aborted with *Attempt to unmount a view
 * which is mounted inside a different view*. It survived every test because
 * nothing had unmounted a panel with children in it yet: it took walking the
 * screen under AddressSanitizer and pressing Back.
 *
 * The accessory has exactly this pair for exactly this reason.
 */
- (void)insertSubview:(UIView *)view atIndex:(NSInteger)index
{
  [_contentView insertSubview:view atIndex:index];
}

- (void)mountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  [_contentView insertSubview:childComponentView atIndex:index];
}

- (void)unmountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  [childComponentView removeFromSuperview];
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  /*
   * A handle, again — because the base class has just decided otherwise.
   *
   * `UIView+ComponentViewProtocol` sets `hidden` from the display type, and a
   * panel's display type is `flex` like anything else, so it assigns NO. Which
   * of that and `updateProps` lands last is not fixed: on a recycled view the
   * layout pass forces an update and wins, and the handle came back visible as
   * an empty 370x452 rectangle over the screen. Stated in both places rather
   * than relying on an order.
   */
  self.hidden = YES;
  // The FRAME, not the content frame: the content frame is the box inside the
  // padding, so a panel with vertical padding would report itself short.
  _contentSize = RCTCGRectFromRect(layoutMetrics.frame).size;
  _inputHost.contentHeight = _contentSize.height;
  [self _layOutOverlay];
}

/**
 * The field being typed into, which is the responder whose input view this is.
 *
 * Found by walking rather than tracked, because the panel does not own the
 * responder — the composer does — and the panel may be mounted before it.
 */
- (nullable UIView *)_currentField:(UIView *)root
{
  if (root.isFirstResponder && [root respondsToSelector:@selector(setInputView:)]) {
    return root;
  }
  for (UIView *subview in root.subviews) {
    UIView *found = [self _currentField:subview];
    if (found != nil) {
      return found;
    }
  }
  return nil;
}

/**
 * Show or hide the panel by giving the field its input view, or taking it back.
 *
 * `reloadInputViews` is the only thing that makes UIKit ask again — the same
 * rule the accessory lives by — and it has to be sent to the responder rather
 * than to the view being installed.
 */
- (void)_applyVisible:(BOOL)visible
{
  if (visible == _visible) {
    return;
  }
  _visible = visible;

  if (_overlay) {
    if (visible) {
      [self _presentOverlay];
    } else {
      [self _dismissOverlay];
    }
    return;
  }

  if (_inputHost == nil) {
    _inputHost = [EXPKeyboardPanelInputView new];
    _inputHost.contentHeight = _contentSize.height;
    _inputHost.content = _contentView;
  }

  if (!visible) {
    /*
     * Put back whatever was there, whichever way it was shown.
     *
     * Hiding has to undo BOTH paths — the field's input view and this view's
     * own responder — because which one was used depends on what had the
     * responder when it opened, and that can differ from what has it now. Only
     * undoing one left the panel unable to open a second time.
     */
    UIView *host = _host;
    if (host != nil) {
      [(id)host setInputView:nil];
      [(UIResponder *)host reloadInputViews];
    }
    _host = nil;
    if (EXPOpenPanel == self) {
      EXPOpenPanel = nil;
    }
    if (self.isFirstResponder) {
      [self resignFirstResponder];
    }
    return;
  }

  UIWindow *window = self.window;
  UIView *field = window != nil ? [self _currentField:window] : nil;

  // Claimable by the bar from here on; see `+openPanelInputView`.
  EXPOpenPanel = self;
  [EXPKeyboardTrace record:@"panel SHOW field=%p overlay=%d visible=%d",
                           field, (int)_overlay, (int)_visible];

  if (field == nil) {
    /*
     * Nothing is being typed into, so the panel becomes the responder ITSELF.
     *
     * Tapping `+` with the keyboard down still opens the panel in the native chat app —
     * it raises it exactly as focusing a field raises a keyboard, because
     * "what is on screen down there" is a property of the first responder and
     * not of whether anyone is typing. Without this the button silently did
     * nothing whenever the composer was not already focused, which is most of
     * the time.
     */
    [self becomeFirstResponder];
    return;
  }

  _host = field;
  [(id)field setInputView:_inputHost];
  [(UIResponder *)field reloadInputViews];
}

/**
 * What the open panel wants shown in place of the keys, or nil.
 *
 * For the bar to answer `-inputView` with it, the way the native chat controller answers
 * `inputViewController` with its own panel.
 */
+ (UIView *)openPanelInputView
{
  EXPKeyboardPanelComponentView *panel = EXPOpenPanel;
  if (panel == nil) {
    return nil;
  }
  return panel->_visible && !panel->_overlay ? panel->_inputHost : nil;
}

- (BOOL)canBecomeFirstResponder
{
  // Only when it has something to show; a panel with nothing in it has no
  // business taking the responder away from whatever had it.
  return _visible && !_overlay;
}

- (UIView *)inputView
{
  return (_visible && !_overlay) ? _inputHost : nil;
}

#pragma mark - The overlay presentation

/**
 * The view an overlay panel is hosted in: THE WINDOW THE KEYS ARE IN.
 *
 * There are three places a view can be relative to the keyboard, and only one
 * of them is over it. Measured with `~/Developer/probes/windowprobe`, which
 * puts a band in each and photographs the result:
 *
 *  - a window of the app's OWN is clamped. Asked for level 10000002 it comes
 *    back at 10000000, one below the keyboard's 10000001, and draws underneath.
 *    No level is obtainable that would do.
 *  - `UITextEffectsWindow` (level 1) shows THROUGH the keyboard's translucent
 *    backdrop but is drawn under the opaque key caps. This is where the panel
 *    used to be hosted, and it is why the card looked cut off at the
 *    accessory's bottom edge — it was not clipped, it was behind the keys.
 *  - `UIRemoteKeyboardWindow` itself, after its `UIInputSetContainerView`,
 *    covers them completely. That is what the native `+` card does, which is
 *    where this started: its card is demonstrably over the keys with the
 *    keyboard still up.
 *
 * So the host is the keyboard's window when there is a keyboard, and this
 * view's own window when there is not — where "under the keys" is not a
 * question and page-level content belongs in the app's window anyway.
 *
 * The keyboard's window cannot be looked up: it is not in
 * `UIWindowScene.windows`. `EXPKeyboardInsets` catches it as it becomes
 * visible, which is the one moment it announces itself, and is already the
 * object that knows about the keyboard.
 */
- (UIView *)_overlayHost
{
  UIWindow *keys = [EXPKeyboardInsets keyboardWindow];
  // `isHidden` because the window survives the keyboard going down: a panel
  // opened with no keyboard belongs in the app's window, not in an empty one
  // parked off screen.
  if (keys != nil && !keys.isHidden) {
    return keys;
  }
  return self.window;
}

/**
 * The accessory bar's frame in the host, or `CGRectNull` when there is no bar.
 *
 * The card sits just above the composer, and the composer IS the accessory —
 * so this is the measurement that places it, rather than a coordinate passed
 * in from JavaScript. It has to be: the bar is in the keyboard's window, and a
 * position measured on the JavaScript side is in the app's, which are the same
 * numbers only while the keyboard is down.
 */
- (CGRect)_barFrameInHost:(UIView *)host
{
  /*
   * The accessory this panel is INSIDE, walked up the tree — not whichever one
   * the focused field happens to be showing.
   *
   * Same correction as the host above, for the same reason: the two questions
   * are "which bar am I part of" and "which bar is on screen", and they are only
   * the same question in an app with one of them. A `UIInputView` is what UIKit
   * makes an accessory's content view, so the nearest ancestor that is one is
   * the bar this panel belongs to.
   */
  UIView *bar = nil;
  for (UIView *ancestor = self.superview; ancestor != nil; ancestor = ancestor.superview) {
    if ([ancestor isKindOfClass:UIInputView.class]) {
      bar = ancestor;
      break;
    }
  }
  if (bar == nil || bar.window == nil) {
    return CGRectNull;
  }
  return [host convertRect:bar.bounds fromView:bar];
}

- (void)_presentOverlay
{
  UIView *host = [self _overlayHost];
  if (host == nil) {
    return;
  }
  /*
   * The same feedback the `+` gives when it opens a menu.
   *
   * A panel and a menu are the same gesture to a reader — a control was tapped
   * and something took the screen — so they should not feel different. The native
   * chat app fires its selection generator for the `+` whatever it goes on to show.
   */
  [EXPElementHaptics selectionChanged];

  if (_dimmingView == nil) {
    _dimmingView = [UIView new];
    _dimmingView.backgroundColor = UIColor.clearColor;
    UITapGestureRecognizer *tap = [[UITapGestureRecognizer alloc] initWithTarget:self
                                                                          action:@selector(_backdropTapped)];
    [_dimmingView addGestureRecognizer:tap];
  }
  // Re-added every time: the host can differ between presentations, because
  // whether there is a keyboard can differ between presentations.
  [host addSubview:_dimmingView];
  [host addSubview:_contentView];
  // Interaction is dropped while a previous dismiss shrinks (see
  // `-_dismissOverlay`); a fresh present takes it back.
  _dimmingView.userInteractionEnabled = YES;
  _contentView.userInteractionEnabled = YES;
  _overlayHostView = host;

  [self _layOutOverlay];

  /*
   * The morph is a WINDOW that grows and a content that SCALES inside it.
   *
   * The window first. The native send menu presents its popover with four
   * animators — width, height, centre x and centre y — each of them a property
   * animator on the popover's FRAME, so the card's outline is a frame
   * animation and its width and height run on their own springs — which is why
   * it changes shape on the way, from something nearly square to something
   * tall.
   *
   * And the content is a MINIATURE while that happens, which this denied for a
   * while. It was written as a frame animation alone, on the reasoning that a
   * frame animation leaves its contents at the size they were laid out — true,
   * and not what the native one does. Measured off a recording of the native `+`
   * at 24fps: a row icon is 15 pixels across on the first frame the card can be
   * seen and 39 when it settles, and the row pitch goes 54.5 to 68. The content
   * is scaled to about four tenths and grows with the card.
   *
   * The reason it was taken out was real, and it was the SHAPE of the scale
   * rather than the scale: scaling the card to the button's forty-point square
   * meant scaling x and y by different amounts, and the list came out squashed.
   * The native one is UNIFORM — its icons stay circular the whole way — so this is
   * one factor, taken from the height, applied to both axes, about the card's
   * bottom-left corner so it grows out of the same corner the window does.
   *
   * `anchorPoint` at the bottom-left is what makes the window reveal the corner
   * nearest the button rather than the far one. The bounds ORIGIN travels with
   * the size for the same reason: a window whose origin stayed at zero would
   * uncover the card's top-left while sitting at its bottom-left, which is the
   * card sliding under itself.
   */
  CALayer *layer = _contentView.layer;
  layer.anchorPoint = CGPointMake(0, 1);
  [self _positionContent];
  _contentView.alpha = 0;

  const CGSize card = _contentView.bounds.size;
  const CGPoint end = layer.position;

  /*
   * Where the card starts, in the HOST's coordinates.
   *
   * The anchor rect the app measured is in the APP's window and this view is in
   * the keyboard's, and converting between the two is the step that has been
   * wrong twice. So only the horizontal is taken from it — the bar spans the
   * full width of both windows, so an x is an x — and the vertical comes from
   * the bar's own frame here, on the same rule `-_positionContent` already
   * uses: the `+` is centred in the bar.
   */
  CGRect start = CGRectMake(end.x, end.y, card.width, card.height);
  const CGRect bar = [self _barFrameInHost:host];
  if (!CGRectIsEmpty(_anchor) && card.width > 0 && card.height > 0) {
    start.size = _anchor.size;
    start.origin.x = CGRectGetMinX(_anchor);
    start.origin.y = CGRectIsNull(bar) ? end.y : CGRectGetMidY(bar) + CGRectGetHeight(_anchor) / 2;
  }

  /*
   * And the window is CLIPPED to the card's own corner, or the card would be
   * drawn whole from the first frame and there would be no morph at all.
   *
   * The radius is read off the card rather than declared here: the panel's own
   * child IS the card — that is what the element's children are — and the shape
   * being morphed into is the shape it will have. Cleared on completion so
   * nothing the card draws outside itself is trimmed afterwards.
   */
  UIView *cardView = _contentView.subviews.firstObject;
  layer.cornerRadius = cardView.layer.cornerRadius;
  layer.cornerCurve = cardView.layer.cornerCurve;
  layer.masksToBounds = YES;

  [CATransaction begin];
  [CATransaction setCompletionBlock:^{
    layer.masksToBounds = NO;
  }];
  [self _scaleContent:cardView from:EXPKeyboardPanelMiniature(start.size, card) forKey:@"EXPPanelMorphScale"];
  [layer addAnimation:EXPKeyboardPanelSpring(
                          @"bounds.size.width", EXP_PANEL_SPRING_X, @(start.size.width), @(card.width))
               forKey:@"EXPPanelMorphW"];
  [layer addAnimation:EXPKeyboardPanelSpring(
                          @"position.x", EXP_PANEL_SPRING_X, @(start.origin.x), @(end.x))
               forKey:@"EXPPanelMorphX"];
  [layer addAnimation:EXPKeyboardPanelSpring(
                          @"bounds.size.height", EXP_PANEL_SPRING_Y, @(start.size.height), @(card.height))
               forKey:@"EXPPanelMorphH"];
  /*
   * The bounds' origin holds the window against the card's BOTTOM edge, so the
   * rows nearest the button are the ones already there.
   */
  [layer addAnimation:EXPKeyboardPanelSpring(
                          @"bounds.origin.y",
                          EXP_PANEL_SPRING_Y,
                          @(card.height - start.size.height),
                          @0)
               forKey:@"EXPPanelMorphOY"];
  [layer addAnimation:EXPKeyboardPanelSpring(
                          @"position.y", EXP_PANEL_SPRING_Y, @(start.origin.y), @(end.y))
               forKey:@"EXPPanelMorphY"];
  [CATransaction commit];
  /*
   * The card's ink and the page behind it are on a CURVE, and a short one.
   *
   * Not a spring: an opacity that overshoots has nowhere to overshoot to — it
   * would go past opaque and come back, which is a flash. And not the morph's
   * length either, because a card that is still fading in when it has stopped
   * moving reads as slow. See `EXPKeyboardPanelFade`.
   */
  _dimmingView.backgroundColor = UIColor.clearColor;
  [UIView animateWithDuration:EXPKeyboardPanelFade
                        delay:0
                      options:UIViewAnimationOptionCurveEaseOut |
                              UIViewAnimationOptionAllowUserInteraction
                   animations:^{
                     self->_contentView.alpha = 1;
                     self->_dimmingView.backgroundColor =
                         [UIColor colorWithWhite:0 alpha:EXPKeyboardPanelDimming];
                   }
                   completion:nil];
}

/**
 * Scale the card about its BOTTOM-LEFT corner, from `scale` to its own size.
 *
 * The corner rather than the centre, and the same corner the window's
 * `anchorPoint` uses: both grow out of the button, so both have to be pinned to
 * the side the button is on. A layer's transform is applied about its centre,
 * so the corner is reached by translating there and back around the scale.
 *
 * Nothing is written to the layer's model transform. The card has no transform
 * of its own — the animation runs from a miniature to the identity the model
 * already holds — so a commit landing mid-flight cannot fight it.
 */
- (void)_scaleContent:(UIView *)cardView from:(CGFloat)scale forKey:(NSString *)key
{
  if (cardView == nil || scale >= 1) {
    return;
  }
  const CGSize size = cardView.bounds.size;
  CATransform3D from = CATransform3DIdentity;
  from = CATransform3DTranslate(from, -size.width / 2, size.height / 2, 0);
  from = CATransform3DScale(from, scale, scale, 1);
  from = CATransform3DTranslate(from, size.width / 2, -size.height / 2, 0);
  [cardView.layer addAnimation:EXPKeyboardPanelSpring(
                                   @"transform",
                                   EXP_PANEL_SPRING_Y,
                                   [NSValue valueWithCATransform3D:from],
                                   [NSValue valueWithCATransform3D:CATransform3DIdentity])
                        forKey:key];
}

- (void)_dismissOverlay
{
  if (_overlayHostView == nil) {
    return;
  }
  /*
   * Stop intercepting the moment the dismiss BEGINS, so the `+` is tappable
   * again immediately rather than after the shrink finishes.
   *
   * The card and its backdrop stay mounted for the whole ~0.75s shrink spring
   * (they are removed in the transaction's completion), and while they are up
   * the backdrop takes every touch — so a tap on the `+` during the collapse
   * landed on the departing panel, not the button. Reported as the `+` not
   * being interruptible when the menu closes. Dropping interaction here lets
   * the touch fall straight through to the composer, so a second tap reopens
   * the panel mid-close. Re-enabled on the next present.
   */
  _dimmingView.userInteractionEnabled = NO;
  _contentView.userInteractionEnabled = NO;
  CALayer *layer = _contentView.layer;
  const CGSize card = _contentView.bounds.size;
  const CGPoint here = layer.position;
  /*
   * The same window as the presentation, running the other way — see the morph
   * in `-_presentOverlay` for why it is a frame rather than a scale.
   */
  CGRect gone = CGRectMake(here.x, here.y, card.width, card.height);
  const CGRect bar = [self _barFrameInHost:_overlayHostView];
  if (!CGRectIsEmpty(_anchor) && card.width > 0 && card.height > 0) {
    gone.size = _anchor.size;
    gone.origin.x = CGRectGetMinX(_anchor);
    gone.origin.y = CGRectIsNull(bar) ? here.y : CGRectGetMidY(bar) + CGRectGetHeight(_anchor) / 2;
  }
  UIView *cardView = _contentView.subviews.firstObject;
  layer.cornerRadius = cardView.layer.cornerRadius;
  layer.cornerCurve = cardView.layer.cornerCurve;
  layer.masksToBounds = YES;
  /*
   * Going away is a different pair of springs, more damped than the pair that
   * brought it: the platform's own dismissal is mass 2 / stiffness
   * 300 / damping 50 and its `Height` twin damping 47, settling in 0.75 and
   * 0.71 seconds. A dismissal that wobbles is a dismissal that has not finished,
   * which is why Apple damps this one harder than the presentation.
   *
   * It was a flat 0.22-second curve, three times too fast and with no spring at
   * all.
   */
  /*
   * The teardown hangs off the TRANSACTION, not off the fade.
   *
   * The ink is gone in a fifth of a second and the shape keeps shrinking for
   * another half; taking the views out when the fade ends would cut the spring
   * off partway and leave the next presentation starting from a frame that is
   * not the one it thinks it is. A transaction's completion block runs when the
   * animations added inside it finish, which is exactly the right moment.
   */
  /*
   * The content shrinks back with it, or the card leaves at full size inside a
   * window closing over it — which reads as the list being wiped away rather
   * than put back in the button.
   *
   * Held at the end and removed by hand, because the model transform is the
   * identity: an animation that vanished on completion would snap the card back
   * to full size for the frame before the views are taken out.
   */
  const CGFloat miniature = EXPKeyboardPanelMiniature(gone.size, card);
  if (cardView != nil && miniature < 1) {
    const CGSize size = cardView.bounds.size;
    CATransform3D to = CATransform3DIdentity;
    to = CATransform3DTranslate(to, -size.width / 2, size.height / 2, 0);
    to = CATransform3DScale(to, miniature, miniature, 1);
    to = CATransform3DTranslate(to, size.width / 2, -size.height / 2, 0);
    CASpringAnimation *shrink = EXPKeyboardPanelSpring(
        @"transform",
        2,
        300,
        47,
        [NSValue valueWithCATransform3D:CATransform3DIdentity],
        [NSValue valueWithCATransform3D:to]);
    shrink.fillMode = kCAFillModeForwards;
    shrink.removedOnCompletion = NO;
    [cardView.layer addAnimation:shrink forKey:@"EXPPanelMorphScale"];
  }

  __weak EXPKeyboardPanelComponentView *weakSelf = self;
  [CATransaction begin];
  [CATransaction setCompletionBlock:^{
    [cardView.layer removeAnimationForKey:@"EXPPanelMorphScale"];
    EXPKeyboardPanelComponentView *strongSelf = weakSelf;
    // Guard: the panel can have been re-opened while it was going away, and
    // taking the views out then would remove a panel the app believes is up.
    if (strongSelf != nil && !strongSelf->_visible) {
      [strongSelf->_contentView removeFromSuperview];
      [strongSelf->_dimmingView removeFromSuperview];
      strongSelf->_overlayHostView = nil;
    }
    layer.masksToBounds = NO;
  }];
  /*
   * The MODEL goes where the animation ends, or the card would snap back to
   * full size for the frame between the spring finishing and the view being
   * taken out. It is invisible by then — the ink is long gone — but a layer
   * left holding a frame it is not showing is what makes the NEXT presentation
   * start from the wrong place.
   */
  layer.bounds = CGRectMake(0, card.height - gone.size.height, gone.size.width, gone.size.height);
  layer.position = gone.origin;
  [layer addAnimation:EXPKeyboardPanelSpring(@"bounds.size.width", 2, 300, 50, @(card.width), @(gone.size.width))
               forKey:@"EXPPanelMorphW"];
  [layer addAnimation:EXPKeyboardPanelSpring(@"position.x", 2, 300, 50, @(here.x), @(gone.origin.x))
               forKey:@"EXPPanelMorphX"];
  [layer addAnimation:EXPKeyboardPanelSpring(@"bounds.size.height", 2, 300, 47, @(card.height), @(gone.size.height))
               forKey:@"EXPPanelMorphH"];
  [layer addAnimation:EXPKeyboardPanelSpring(
                          @"bounds.origin.y", 2, 300, 47, @0, @(card.height - gone.size.height))
               forKey:@"EXPPanelMorphOY"];
  [layer addAnimation:EXPKeyboardPanelSpring(@"position.y", 2, 300, 47, @(here.y), @(gone.origin.y))
               forKey:@"EXPPanelMorphY"];
  [CATransaction commit];
  [UIView animateWithDuration:EXPKeyboardPanelFade
                        delay:0
                      options:UIViewAnimationOptionCurveEaseIn
                   animations:^{
                     self->_contentView.alpha = 0;
                     self->_dimmingView.backgroundColor = UIColor.clearColor;
                   }
                   completion:nil];
}

- (void)_backdropTapped
{
  if (const auto emitter = std::static_pointer_cast<const ExpoKeyboardPanelEventEmitter>(_eventEmitter)) {
    emitter->onClose();
  }
}

/**
 * The card's frame and the backdrop's, recomputed whenever either could change.
 *
 * Inside a `CATransaction` with actions off, because this runs on EVERY commit
 * and `frame` and `position` are animatable. A commit that lands during the
 * presentation spring would otherwise start a second, default-curve animation of
 * the same properties and fight it — the same trap the accessory's material fade
 * hit, where a bar that grew by a line animated its own gradient a quarter
 * second behind the content it belonged to.
 */
- (void)_layOutOverlay
{
  UIView *host = _overlayHostView;
  if (host == nil) {
    return;
  }
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _dimmingView.frame = host.bounds;
  [self _positionContent];
  [CATransaction commit];
}

- (void)_positionContent
{
  UIView *host = _overlayHostView;
  if (host == nil) {
    return;
  }
  const CGSize size = _contentSize;
  const CGRect bounds = host.bounds;
  const CGRect bar = [self _barFrameInHost:host];
  const CGFloat width = size.width > 0 ? size.width : CGRectGetWidth(bounds);
  const CGFloat wanted = size.height > 0 ? size.height : CGRectGetHeight(bounds);
  /*
   * Never into the status bar, and never past the bottom of the screen.
   *
   * The safe area comes from the APP's window. The keyboard's own reports none —
   * it is a full-screen window that draws nothing near the top — so reading it
   * there gives zero and the card climbs over the status bar, which is what the
   * first build did. The list scrolls, so giving up height costs visible rows
   * and nothing else.
   */
  const CGFloat limitTop = CGRectGetMinY(bounds) + self.window.safeAreaInsets.top + EXPKeyboardPanelAnchorGap;
  const CGFloat limitBottom =
      CGRectGetMaxY(bounds) - self.window.safeAreaInsets.bottom - EXPKeyboardPanelAnchorGap;
  const CGFloat height = MIN(wanted, MAX(limitBottom - limitTop, 0));
  /*
   * CENTRED ON THE BUTTON, and free to lie over the keys.
   *
   * It used to sit entirely above the composer, its bottom thirteen points clear
   * of the bar. Measured against a recording of the native chat app on an 852 point screen,
   * that is not where the real one goes: its card runs from y 265 to y 700, and
   * the keys begin at 516 — so it covers more than half the keyboard and the
   * composer with it. Thirteen points above the bar puts ours two hundred points
   * too high, which is the whole of "the menu positioning is wrong".
   *
   * DOM-CSS-LIMITATION(overlay-cannot-cover-the-keys): and placing it there is
   * as far as this can go, because it does not PAINT there. Measured with the
   * card's frame at 275..727 on an 874 point screen: the pixels stop dead at
   * 541, which is the accessory's own bottom edge. UIKit composites the
   * ACCESSORY above the keys; a view that merely shares its window is not
   * composited with it, and everything past the accessory's bounds is behind
   * the keyboard. An earlier note here read "the accessory's window is the only
   * way over the keys", which is true of the accessory and not of its window.
   *
   * The native menu is therefore not drawn by the app: it is a system menu, in
   * a window the app does not own, which is why it can lie over the keyboard
   * and why it is translucent rather than a card. `<button>` already supports
   * `<menu>` with `showsMenuAsPrimaryAction`, so matching it is a deletion —
   * but it means giving the platform the menu's position and its styling, which
   * is a decision rather than a fix.
   *
   * The rule that reproduces it is the button's own centre. The `+` sits at
   * about 491 and the card's centre is 482 — eight points, which is inside the
   * error of reading a corner off a video. Anchoring to the centre also explains
   * why a menu invoked from the bottom of the screen is allowed to cover the
   * keyboard at all: it is not a popover placed above its anchor, it is a sheet
   * placed AT it.
   *
   * The BAR's centre rather than the anchor rect the app measured: the `+` is
   * centred in the bar, and the bar is already in this host's coordinates, so
   * this needs no conversion between the app's window and the keyboard's — which
   * is the step that has been wrong twice.
   */
  CGFloat centre;
  if (!CGRectIsNull(bar)) {
    centre = CGRectGetMidY(bar);
  } else if (!CGRectIsEmpty(_anchor)) {
    centre = CGRectGetMidY(_anchor);
  } else {
    centre = CGRectGetMaxY(bounds) - height / 2;
  }
  CGFloat bottom = centre + height / 2;
  bottom = MIN(bottom, limitBottom);
  bottom = MAX(bottom, limitTop + height);
  _contentView.bounds = CGRectMake(0, 0, width, height);
  /*
   * `position` rather than `frame`, because the anchor point has been moved.
   *
   * A layer's `position` is where its ANCHOR sits, and the anchor is the card's
   * bottom-left — so this places that corner, which is the corner the animation
   * holds still. Setting `frame` with a non-centre anchor is the classic way to
   * end up with a view that jumps by half its size.
   */
  _contentView.layer.position = CGPointMake(CGRectGetMinX(bounds), bottom);
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  [super updateProps:props oldProps:oldProps];
  const auto &panelProps = static_cast<const ExpoKeyboardPanelProps &>(*props);
  // A handle, not a box: leaving it visible would lay out an empty rectangle in
  // the screen's flow.
  self.hidden = YES;
  _overlay = panelProps.presentation == "overlay";
  _anchor = CGRectMake(panelProps.anchorX, panelProps.anchorY, panelProps.anchorWidth, panelProps.anchorHeight);
  // Before `_applyVisible:`, so the first presentation is already aimed, and
  // again on every commit after, so an anchor that moves while the panel is up
  // is followed.
  [self _layOutOverlay];
  [self _applyVisible:panelProps.visible];
}

/**
 * The overlay lives in someone ELSE's hierarchy, so it has to be taken out on the
 * way out — twice over.
 *
 * `prepareForRecycle` covers the usual path, where Fabric puts the view back in
 * its pool. This covers the other one: a view that is released rather than
 * recycled would otherwise leave a card floating over the keyboard with nothing
 * left alive to dismiss it.
 */
- (void)dealloc
{
  [_contentView removeFromSuperview];
  [_dimmingView removeFromSuperview];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  if (_visible) {
    UIView *field = _host;
    _visible = NO;
    [(id)field setInputView:nil];
    [(UIResponder *)field reloadInputViews];
  }
  _host = nil;
  // The overlay lives in ANOTHER view's hierarchy, so it outlives this view
  // unless it is taken out here — a recycled panel would otherwise leave a card
  // floating over the app with nothing left to dismiss it.
  [_contentView removeFromSuperview];
  [_dimmingView removeFromSuperview];
  _overlayHostView = nil;
  _overlay = NO;
  _anchor = CGRectZero;
  /*
   * Still a handle on the way out.
   *
   * `prepareForRecycle` returns a view to its defaults, and the default for
   * `hidden` is NO — so a recycled panel came back VISIBLE and laid an empty
   * 370x452 rectangle over the screen until the next commit set it again.
   * Measured after three round trips between screens.
   */
  self.hidden = YES;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ExpoKeyboardPanelComponentDescriptor>();
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end
