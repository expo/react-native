/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "../View/EXPKeyboardTrace.h"
#import "EXPKeyboardPanelComponentView.h"

#import <React/RCTComponentViewFactory.h>
#import <React/RCTConversions.h>
#import <React/RCTViewComponentView.h>
#import <React/RCTSurfaceTouchHandler.h>
#import <react/renderer/components/view/ExpoKeyboardPanelShadowNode.h>

using namespace facebook::react;

/**
 * React's children, and nothing else.
 *
 * A plain view inside the `UIInputView` below, which supplies a keyboard's
 * backdrop; this only holds the children.
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

@implementation EXPKeyboardPanelComponentView {
  EXPKeyboardPanelContentView *_contentView;
  EXPKeyboardPanelInputView *_inputHost;
  /** The field currently showing this panel. Weak: it can be torn down focused. */
  __weak UIView *_host;
  BOOL _visible;
  RCTSurfaceTouchHandler *_touchHandler;
  CGSize _contentSize;
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
    if (self.isFirstResponder) {
      [self resignFirstResponder];
    }
    return;
  }

  UIWindow *window = self.window;
  UIView *field = window != nil ? [self _currentField:window] : nil;

  [EXPKeyboardTrace record:@"panel SHOW field=%p visible=%d", field, (int)_visible];

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

- (BOOL)canBecomeFirstResponder
{
  // Only when it has something to show; a panel with nothing in it has no
  // business taking the responder away from whatever had it.
  return _visible;
}

- (UIView *)inputView
{
  return _visible ? _inputHost : nil;
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  [super updateProps:props oldProps:oldProps];
  const auto &panelProps = static_cast<const ExpoKeyboardPanelProps &>(*props);
  // A handle, not a box: leaving it visible would lay out an empty rectangle in
  // the screen's flow.
  self.hidden = YES;
  [self _applyVisible:panelProps.visible];
}

- (void)dealloc
{
  [_contentView removeFromSuperview];
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
