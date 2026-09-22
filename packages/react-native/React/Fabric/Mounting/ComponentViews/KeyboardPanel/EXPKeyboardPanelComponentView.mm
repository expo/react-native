/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPKeyboardPanelComponentView.h"
#import "../View/EXPKeyboardTrace.h"

#import <React/RCTComponentViewFactory.h>
#import <React/RCTConversions.h>
#import <React/RCTSurfaceTouchHandler.h>
#import <React/RCTViewComponentView.h>
#import <react/renderer/components/view/ExpoKeyboardPanelShadowNode.h>

using namespace facebook::react;

// React's children, already laid out in this view's coordinates, inside the
// `UIInputView` below, which supplies the keyboard's backdrop. Fabric flattens a
// drawless wrapper, so the children can be several, and nothing repositions them.
@interface EXPKeyboardPanelContentView : UIView
@end

@implementation EXPKeyboardPanelContentView

// The panel's own surface is never a target: the box is bigger than the card in
// it, and the margin around the card is the backdrop, whose taps dismiss
- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event
{
  UIView *hit = [super hitTest:point withEvent:event];
  return hit == self ? nil : hit;
}

@end

// The view UIKit is handed as an `inputView`: a `UIInputView` with the
// keyboard's style, so a panel without a background is drawn on the keyboard's
// material. The height is React's, published as the intrinsic size.
@interface EXPKeyboardPanelInputView : UIInputView
@property (nonatomic, assign) CGFloat contentHeight;
@property (nonatomic, strong, nullable) UIView *content;
@end

@implementation EXPKeyboardPanelInputView

- (instancetype)init
{
  // The style is fixed at construction
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
  // The field currently showing this panel; weak, since it can be torn down focused
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
    // Its own touch handler: an input view is outside the surface's hierarchy
    _touchHandler = [RCTSurfaceTouchHandler new];
    [_touchHandler attachToView:_contentView];
  }
  return self;
}

// React's children go into the panel's own view; this view is a hidden handle.
// Unmount is overridden too, since the base class asserts the child's superview
// is this view.
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

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics
           oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  // `UIView+ComponentViewProtocol` just set `hidden` from the display type, and
  // the order against `updateProps` is not fixed, so the handle is hidden here too
  self.hidden = YES;
  // The frame, not the content frame, which excludes the padding
  _contentSize = RCTCGRectFromRect(layoutMetrics.frame).size;
  _inputHost.contentHeight = _contentSize.height;
}

// The field being typed into, found by walking because the composer owns it and
// the panel may be mounted before it
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

// Shows or hides the panel by giving the field its input view or taking it back;
// `reloadInputViews`, sent to the responder, is what makes UIKit ask again
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
    // Undo both paths, the field's input view and this view's own responder:
    // which one opened the panel can differ from what has the responder now
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
    // Nothing is being typed into, so the panel becomes the responder itself, as
    // the platform's chat raises its panel with the keyboard down
    [self becomeFirstResponder];
    return;
  }

  _host = field;
  [(id)field setInputView:_inputHost];
  [(UIResponder *)field reloadInputViews];
}

- (BOOL)canBecomeFirstResponder
{
  // Only when it has something to show
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
  // A handle, not a box: visible, it would be an empty rectangle in the screen's flow
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
  // Still a handle: `prepareForRecycle` returns `hidden` to NO
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
