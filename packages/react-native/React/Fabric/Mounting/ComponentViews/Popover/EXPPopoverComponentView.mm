/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPPopoverComponentView.h"
#import "../KeyboardAccessory/EXPKeyboardAccessoryComponentView.h"
#import "../View/EXPKeyboardTrace.h"

#import <React/RCTComponentViewFactory.h>
#import <React/RCTConversions.h>
#import <React/RCTSurfaceTouchHandler.h>
#import <React/RCTViewComponentView.h>
#import <react/renderer/components/view/ExpoPopoverShadowNode.h>
#import "EXPKeyboardInsets.h"

using namespace facebook::react;

// React's children, already laid out in this view's coordinates; the surface is
// the popover's own glass platter. Fabric flattens a drawless wrapper, so the
// children can be several, and nothing repositions them.
@interface EXPPopoverContentView : UIView
@end

@implementation EXPPopoverContentView

// The panel's own surface is never a target: the box is bigger than the card in
// it, and the margin around the card is the backdrop, whose taps dismiss
- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event
{
  UIView *hit = [super hitTest:point withEvent:event];
  return hit == self ? nil : hit;
}

@end

/**
 * The controller the popover presents. Its view is sized to the card, the box's
 * first child, with the box's margins hanging outside it, because the zoom
 * morphs the presented view as a whole. The content draws no glass of its own:
 * UIKit morphs the button into the popover's platter.
 */
@interface EXPPopoverCardController : UIViewController
@property (nonatomic, strong, nullable) UIView *content;
// React's layout of the box; a zero width or height means the window's
@property (nonatomic, assign) CGSize contentSize;
@property (nonatomic, copy, nullable) void (^onDismissed)(void);
// The box's size in a room of `room`, and the card's rectangle inside the box
- (CGSize)boxSizeIn:(CGSize)room;
- (CGRect)cardInBox;
@end

@implementation EXPPopoverCardController

- (void)loadView
{
  UIView *view = [UIView new];
  // Clear: the surface is the popover's own glass platter, behind this view
  view.backgroundColor = UIColor.clearColor;
  self.view = view;
}

- (void)viewDidLoad
{
  [super viewDidLoad];
  if (self.content != nil) {
    [self.view addSubview:self.content];
  }
}

// Hidden until the transition's first animation frame: the card is laid out at
// full size before the zoom applies its starting state
- (void)viewWillAppear:(BOOL)animated
{
  [super viewWillAppear:animated];
  id<UIViewControllerTransitionCoordinator> coordinator = self.transitionCoordinator;
  if (!animated || coordinator == nil) {
    return;
  }
  UIView *view = self.view;
  view.hidden = YES;
  [coordinator
      animateAlongsideTransition:^(id<UIViewControllerTransitionCoordinatorContext> context) {
        view.hidden = NO;
      }
      completion:^(id<UIViewControllerTransitionCoordinatorContext> context) {
        view.hidden = NO;
      }];
}

- (CGSize)boxSizeIn:(CGSize)room
{
  CGSize size = self.contentSize;
  if (size.width <= 0) {
    size.width = room.width;
  }
  if (size.height <= 0) {
    size.height = room.height / 2;
  }
  return size;
}

- (CGRect)cardInBox
{
  UIView *card = self.content.subviews.firstObject;
  const CGSize box = [self boxSizeIn:self.view.window.bounds.size];
  return card != nil ? card.frame : CGRectMake(0, 0, box.width, box.height);
}

- (void)viewDidLayoutSubviews
{
  [super viewDidLayoutSubviews];
  const CGRect inBox = [self cardInBox];
  const CGSize box = [self boxSizeIn:self.view.window.bounds.size];
  // The box, offset so the card inside it fills the platter
  self.content.frame = CGRectMake(-CGRectGetMinX(inBox), -CGRectGetMinY(inBox), box.width, box.height);
}

// Every way out ends here, ours and the transition's own pull-to-dismiss
- (void)viewDidDisappear:(BOOL)animated
{
  [super viewDidDisappear:animated];
  if (self.onDismissed != nil) {
    self.onDismissed();
  }
}

@end

// A picture of the keys from the bar's bottom down, held in the app's window
// while the keyboard is stood down, and the obstruction they stand for so the
// transcript keeps its room; see `_standDownTheKeyboardIn:`
@interface EXPPopoverKeysPicture : UIView <EXPKeyboardObstructingView>
@end

@implementation EXPPopoverKeysPicture

- (CGFloat)topInWindowForObstructionHeight:(CGFloat)obstructionHeight
{
  if (self.window == nil || self.superview == nil) {
    return NAN;
  }
  // As drawn, so a transcript following this while it slides away follows the
  // slide rather than jumping to its end
  CALayer *drawn = self.layer.presentationLayer ?: self.layer;
  return CGRectGetMinY([self.superview convertRect:drawn.frame toView:nil]);
}

@end

@interface EXPPopoverComponentView () <UIPopoverPresentationControllerDelegate>
@end

@implementation EXPPopoverComponentView {
  EXPPopoverContentView *_contentView;
  BOOL _visible;
  RCTSurfaceTouchHandler *_touchHandler;
  EXPPopoverCardController *_cardController;
  // The picture the keyboard is stood down behind while the card is up, see
  // `_standDownTheKeyboardIn:`; nil while the keyboard was not up
  EXPPopoverKeysPicture *_keysPicture;
  // The bar held in place for the picture, released when the keys return
  __weak EXPKeyboardAccessoryComponentView *_heldBar;
  // Whether `_present` began device orientation notifications, to end them once
  BOOL _watchingOrientation;
  // A second picture of the keys, for the keyboard's own window on the way back
  UIView *_keysPictureForReturn;
  __weak UIView *_fieldToRefocus;
  // The field was asked to blur while stood down: the keys leave as a keyboard does
  BOOL _blurAsked;
  // The keys are on their way back
  BOOL _keysReturning;
  // A presentation asked for while the keys were still returning; presented
  // then, the card would meet a live keyboard, so it waits for `_keysDidReturn:`
  BOOL _presentWhenKeysReturn;
  // The return's fallback timer, cancelled so it cannot fire into the next stand-down
  dispatch_block_t _returnFallback;
  // The card went away on its own and JavaScript, which owns `visible`, has not
  // said so yet; cleared by the first commit that says otherwise
  BOOL _closedByPlatform;
  CGSize _contentSize;
  CGRect _anchor;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const ExpoPopoverProps>();
    _props = defaultProps;
    _contentView = [EXPPopoverContentView new];
    // Its own touch handler: the card's content is outside the surface's hierarchy
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
  [self _layOut];
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

- (void)_applyVisible:(BOOL)visible
{
  if (visible == _visible) {
    return;
  }
  _visible = visible;
  if (visible && _closedByPlatform) {
    // Not yet: see `_closedByPlatform`
    _visible = NO;
  } else if (visible) {
    [self _present];
  } else {
    [self _dismiss];
  }
}

/*
 * The card is a popover with the zoom transition, in the app's window, over a
 * keyboard stood down behind a picture of itself. That is the system chat's
 * construction, read out of ChatKit: popover chrome on the card's controller,
 * the popover's zoom transition from the `+`'s own glass, and a keyboard
 * snapshot to dismiss behind. A popover in the keyboard's window asserts inside
 * UIKit (`LiquidMorphAnimation` cannot morph to a view outside the hierarchy),
 * a card in the app's window is under the keys, and a merely hidden keyboard
 * still parks a popover above it; so the field gives the keyboard up without
 * animation behind a picture that holds the keys' place and the transcript's
 * room, and takes it back under a second picture in the keyboard's own window.
 */

// The accessory bar this popover is inside, the nearest `UIInputView` ancestor;
// nil for a popover outside any bar
- (nullable UIView *)_bar
{
  for (UIView *ancestor = self.superview; ancestor != nil; ancestor = ancestor.superview) {
    if ([ancestor isKindOfClass:UIInputView.class]) {
      return ancestor;
    }
  }
  return nil;
}

// The `+`'s rect in the bar's window: x and size from the anchor JavaScript
// measured, y from the bar as drawn, since the bar is lifted onto the keyboard
// by a constraint the layout never hears about. `CGRectNull` for a panel in no bar.
- (CGRect)_buttonRectInWindow
{
  UIView *bar = [self _bar];
  if (bar == nil || bar.window == nil) {
    return CGRectNull;
  }
  const CGRect barRect = [bar convertRect:bar.bounds toView:nil];
  if (CGRectIsEmpty(_anchor)) {
    return barRect;
  }
  CGRect rect = _anchor;
  rect.origin.y = CGRectGetMidY(barRect) - CGRectGetHeight(_anchor) / 2;
  return rect;
}

// The glass of the button under the anchor, or nil. The zoom draws its source
// view into the growing card, so the source must be the glass itself rather than
// the control around it or a stand-in; found by hit-testing the anchor's centre
// and walking up to the element that owns a glass.
- (nullable UIView *)_buttonGlassAt:(CGRect)rect
{
  UIWindow *window = self.window;
  if (window == nil || CGRectIsNull(rect) || CGRectIsEmpty(rect)) {
    return nil;
  }
  UIView *hit = [window hitTest:CGPointMake(CGRectGetMidX(rect), CGRectGetMidY(rect)) withEvent:nil];
  for (UIView *view = hit; view != nil && view != window; view = view.superview) {
    if ([view isKindOfClass:RCTViewComponentView.class]) {
      UIView *glass = [(RCTViewComponentView *)view exp_glassView];
      if (glass != nil) {
        return glass;
      }
    }
  }
  return nil;
}

// The controller to present from: the window's root or whatever it has
// presented on top, never a card of ours
- (UIViewController *)_presenter
{
  UIViewController *presenter = self.window.rootViewController;
  while (presenter.presentedViewController != nil && !presenter.presentedViewController.isBeingDismissed &&
         ![presenter.presentedViewController isKindOfClass:EXPPopoverCardController.class]) {
    presenter = presenter.presentedViewController;
  }
  return presenter;
}

/**
 * Stands the keyboard down behind a picture of the keys: the keyboard's window
 * is snapshotted into a view in the presenter's view from the bar's bottom
 * down, which registers as the obstruction so the transcript keeps its room.
 * Both windows are the screen's size, so the frame is placed as is rather than
 * converted. The bar holds its place above the picture and the field resigns
 * without animation. Nothing when the keyboard is not up.
 */
- (void)_standDownTheKeyboardIn:(UIView *)host
{
  UIWindow *keys = [EXPKeyboardInsets keyboardWindow];
  UIWindow *window = self.window;
  if (keys == nil || keys.isHidden || window == nil || host == nil || _keysPicture != nil) {
    return;
  }
  UIView *field = [self _currentField:window];
  if (field == nil) {
    return;
  }
  UIView *bar = [self _bar];
  UIView *keysPicture = [keys snapshotViewAfterScreenUpdates:NO];
  UIView *keysPictureForReturn = [keys snapshotViewAfterScreenUpdates:NO];
  if (keysPicture == nil || keysPictureForReturn == nil) {
    return;
  }
  // The keys only, from the bar's bottom down; the real bar holds its place
  // above the picture so the `+` stays pressable
  const CGRect barInWindow = bar != nil ? [bar convertRect:bar.bounds toView:nil] : CGRectNull;
  const CGFloat top = CGRectIsNull(barInWindow) ? CGRectGetMinY(keys.frame) : CGRectGetMaxY(barInWindow);
  const CGRect inWindow = CGRectMake(0, top, CGRectGetWidth(window.bounds), CGRectGetHeight(window.bounds) - top);
  EXPPopoverKeysPicture *picture = [[EXPPopoverKeysPicture alloc] initWithFrame:[host convertRect:inWindow
                                                                                         fromView:nil]];
  picture.clipsToBounds = YES;
  keysPicture.frame = CGRectOffset(keys.frame, 0, -top);
  [picture addSubview:keysPicture];
  [host addSubview:picture];
  _keysPicture = picture;
  _keysPictureForReturn = keysPictureForReturn;
  _fieldToRefocus = field;
  // A blur asked of the field while it is stood down cancels the return:
  // "Dismiss the keyboard" chosen from the card must end with it down
  [NSNotificationCenter.defaultCenter addObserver:self
                                         selector:@selector(_fieldAskedToBlur:)
                                             name:EXPFieldAskedToBlurNotification
                                           object:nil];
  EXPKeyboardInsets *insets = [EXPKeyboardInsets insetsForView:self];
  [insets addObstructingView:picture];
  // The bar stays where the picture shows it, so the `+` the card grows from
  // is the real one, where it is drawn; released in `_keysDidReturn:`
  _heldBar = [EXPKeyboardAccessoryComponentView barHosting:self];
  _heldBar.holdsItsPlace = YES;
  [UIView setAnimationsEnabled:NO];
  [field resignFirstResponder];
  [UIView setAnimationsEnabled:YES];
  [insets obstructingViewsDidChange];
  [EXPKeyboardTrace record:@"panel KEYS stood down top=%.1f field=%p", top, field];
}

/**
 * Gives the keyboard back to its field under the picture. The keyboard's window
 * is above the app's and new each time, and `hidden` or `alpha` set on it is
 * undone as UIKit shows it, so a second picture of the keys goes into the new
 * window as the keyboard begins to show and comes out, with the app's picture,
 * once the keys have arrived. A keyboard that never arrives is cleaned up a
 * second later.
 */
- (void)_bringBackTheKeyboard
{
  if (_keysPicture == nil || _keysReturning) {
    return;
  }
  _keysReturning = YES;
  UIView *field = _fieldToRefocus;
  _fieldToRefocus = nil;
  if (_blurAsked) {
    _blurAsked = NO;
    [self _slideTheKeysAway];
    return;
  }
  if (field == nil || field.window == nil || self.window == nil) {
    [self _keysDidReturn:nil];
    return;
  }
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  [center addObserver:self selector:@selector(_keysWillReturn:) name:UIKeyboardWillShowNotification object:nil];
  [center addObserver:self selector:@selector(_keysDidReturn:) name:UIKeyboardDidShowNotification object:nil];
  [field becomeFirstResponder];
  __weak EXPPopoverComponentView *weakSelf = self;
  if (_returnFallback != nil) {
    dispatch_block_cancel(_returnFallback);
  }
  _returnFallback = dispatch_block_create(DISPATCH_BLOCK_INHERIT_QOS_CLASS, ^{
    [weakSelf _keysDidReturn:nil];
  });
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), _returnFallback);
  [EXPKeyboardTrace record:@"panel KEYS returning to field=%p", field];
}

- (void)_keysWillReturn:(NSNotification *)notification
{
  UIWindow *keys = [EXPKeyboardInsets keyboardWindow];
  UIView *picture = _keysPictureForReturn;
  if (keys == nil || picture == nil) {
    return;
  }
  picture.frame = keys.bounds;
  [keys addSubview:picture];
  [EXPKeyboardTrace record:@"panel KEYS returning under their picture in %p", keys];
}

- (void)_fieldAskedToBlur:(NSNotification *)notification
{
  if (notification.object == nil || notification.object != _fieldToRefocus) {
    return;
  }
  [EXPKeyboardTrace record:@"panel KEYS not coming back: their field was asked to blur"];
  _fieldToRefocus = nil;
  _blurAsked = YES;
}

// The keys leave the way a keyboard does: the picture slides down over the
// keyboard's duration with the bar released inside the same animation, and the
// transcript follows the picture as drawn
- (void)_slideTheKeysAway
{
  EXPPopoverKeysPicture *picture = _keysPicture;
  UIView *host = picture.superview;
  if (picture == nil || host == nil) {
    [self _keysDidReturn:nil];
    return;
  }
  EXPKeyboardInsets *insets = [EXPKeyboardInsets insetsForView:self];
  [insets beginTracking];
  EXPKeyboardAccessoryComponentView *bar = _heldBar;
  __weak EXPPopoverComponentView *weakSelf = self;
  [EXPKeyboardTrace record:@"panel KEYS sliding away"];
  [UIView animateWithDuration:0.25
      delay:0
      options:UIViewAnimationOptionCurveEaseInOut
      animations:^{
        picture.frame = CGRectOffset(picture.frame, 0, CGRectGetHeight(picture.bounds));
        bar.holdsItsPlace = NO;
        [host layoutIfNeeded];
      }
      completion:^(BOOL finished) {
        [weakSelf _keysDidReturn:nil];
        [insets endTracking];
      }];
}

- (void)_keysDidReturn:(nullable NSNotification *)notification
{
  EXPPopoverKeysPicture *picture = _keysPicture;
  if (picture == nil) {
    return;
  }
  _keysPicture = nil;
  _keysReturning = NO;
  if (_returnFallback != nil) {
    dispatch_block_cancel(_returnFallback);
    _returnFallback = nil;
  }
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  [center removeObserver:self name:EXPFieldAskedToBlurNotification object:nil];
  [center removeObserver:self name:UIKeyboardWillShowNotification object:nil];
  [center removeObserver:self name:UIKeyboardDidShowNotification object:nil];
  [_keysPictureForReturn removeFromSuperview];
  _keysPictureForReturn = nil;
  EXPKeyboardInsets *insets = [EXPKeyboardInsets insetsForView:self];
  [insets removeObstructingView:picture];
  [picture removeFromSuperview];
  _heldBar.holdsItsPlace = NO;
  _heldBar = nil;
  [insets obstructingViewsDidChange];
  [EXPKeyboardTrace record:@"panel KEYS returned announced=%d", (int)(notification != nil)];
  if (_presentWhenKeysReturn) {
    _presentWhenKeysReturn = NO;
    if (_visible && _cardController == nil) {
      [self _present];
    }
  }
}

- (void)_present
{
  UIViewController *presenter = [self _presenter];
  if (presenter == nil || _cardController != nil) {
    return;
  }
  if (_keysPicture != nil) {
    [EXPKeyboardTrace record:@"panel PRESENT deferred: the keys are still returning"];
    _presentWhenKeysReturn = YES;
    return;
  }
  CGRect source = [self _buttonRectInWindow];
  UIView *glass = [self _buttonGlassAt:source];
  if (glass != nil) {
    source = [glass convertRect:glass.bounds toView:nil];
  }
  // The keyboard stood down under a picture of itself, with the bar held
  // where it is drawn, so the `+` stays the card's source
  [self _standDownTheKeyboardIn:presenter.view];

  EXPPopoverCardController *card = [EXPPopoverCardController new];
  card.content = _contentView;
  card.contentSize = _contentSize;
  card.preferredContentSize = [card cardInBox].size;
  // The popover's own chrome is the card: on iOS 26 UIKit installs a glass
  // platter in it, and the zoom morphs the source button into that platter
  card.modalPresentationStyle = UIModalPresentationPopover;
  UIPopoverPresentationController *popover = card.popoverPresentationController;
  popover.delegate = self;
  // Anchored on the `+` with no arrow: UIKit centres the card on the button and
  // moves it only as far as the screen's edges require, which is where the
  // system chat's card sits; the default layout margins match it too
  if (glass != nil) {
    popover.sourceView = glass;
    popover.sourceRect = glass.bounds;
  } else {
    popover.sourceView = presenter.view;
    popover.sourceRect = [presenter.view convertRect:source fromView:nil];
  }
  popover.permittedArrowDirections = 0;
  __weak EXPPopoverComponentView *weakSelf = self;
  __weak EXPPopoverCardController *weakCard = card;
  card.onDismissed = ^{
    [weakSelf _cardWentAway:weakCard];
  };
  // A rotation while the card is up takes it down, see `_deviceTurned:`; not
  // `viewWillTransitionToSize:`, which UIKit also sends on presentation
  [UIDevice.currentDevice beginGeneratingDeviceOrientationNotifications];
  _watchingOrientation = YES;
  [NSNotificationCenter.defaultCenter addObserver:self
                                         selector:@selector(_deviceTurned:)
                                             name:UIDeviceOrientationDidChangeNotification
                                           object:nil];
  if (glass != nil) {
    // The transition's own dimming, as behind the system chat's card
    __weak UIView *weakGlass = glass;
    card.preferredTransition = [UIViewControllerTransition
           zoomWithOptions:nil
        sourceViewProvider:^UIView *_Nullable(UIZoomTransitionSourceViewProviderContext *_Nonnull context) {
          return weakGlass;
        }];
  }
  _cardController = card;
  [EXPKeyboardTrace record:@"panel PRESENT presenter=%@ source=%@ morph=%d keys=%d size=%@",
                           NSStringFromClass(presenter.class),
                           NSStringFromCGRect(source),
                           (int)(glass != nil),
                           (int)(_keysPicture != nil),
                           NSStringFromCGSize(_contentSize)];
  [presenter presentViewController:card animated:YES completion:nil];
}

- (void)_dismiss
{
  _presentWhenKeysReturn = NO;
  EXPPopoverCardController *card = _cardController;
  if (card == nil) {
    return;
  }
  [EXPKeyboardTrace record:@"panel DISMISS"];
  UIViewController *presenter = card.presentingViewController;
  if (presenter == nil) {
    [self _cardWentAway:card];
    return;
  }
  [presenter dismissViewControllerAnimated:YES completion:nil];
  [self _bringBackTheKeyboardAsTheCardCloses:card];
}

// The keys come back as the card starts to close rather than when UIKit reports
// it gone a second later; asked in the next turn, once the transition can say
// whether the reader is still dragging it
- (void)_bringBackTheKeyboardAsTheCardCloses:(EXPPopoverCardController *)card
{
  if (_keysPicture == nil) {
    return;
  }
  __weak EXPPopoverComponentView *weakSelf = self;
  __weak EXPPopoverCardController *weakCard = card;
  dispatch_async(dispatch_get_main_queue(), ^{
    EXPPopoverComponentView *strongSelf = weakSelf;
    id<UIViewControllerTransitionCoordinator> transition = weakCard.transitionCoordinator;
    if (strongSelf == nil || transition == nil || transition.isInteractive || transition.isCancelled) {
      return;
    }
    [EXPKeyboardTrace record:@"panel KEYS returning as the card closes"];
    [strongSelf _bringBackTheKeyboard];
  });
}

// A dismissal the reader made: a tap outside, or the transition's own pull
- (void)presentationControllerWillDismiss:(UIPresentationController *)presentationController
{
  [self _bringBackTheKeyboardAsTheCardCloses:_cardController];
}

// The device is turning under the card. The pictures, the card's box and the
// zoom's source are all for the old orientation, so the card goes at once and
// the keyboard comes back the way UIKit brings it, as the system chat's menu does.
- (void)_deviceTurned:(NSNotification *)notification
{
  EXPPopoverCardController *card = _cardController;
  const UIDeviceOrientation orientation = UIDevice.currentDevice.orientation;
  if (card == nil || !(UIDeviceOrientationIsPortrait(orientation) || UIDeviceOrientationIsLandscape(orientation))) {
    return;
  }
  const BOOL landscape = UIDeviceOrientationIsLandscape(orientation);
  const CGSize window = self.window.bounds.size;
  // Only a turn the window will follow
  if (landscape == (window.width > window.height)) {
    return;
  }
  [EXPKeyboardTrace record:@"panel WINDOW turning under the card"];
  card.onDismissed = nil;
  _cardController = nil;
  [card.presentingViewController dismissViewControllerAnimated:NO completion:nil];
  // The pictures first, and the keyboard back to its field without one
  UIView *field = _fieldToRefocus;
  _fieldToRefocus = nil;
  [self _keysDidReturn:nil];
  if (field != nil && field.window != nil) {
    [field becomeFirstResponder];
  }
  [self _cardWentAway:nil];
}

// The card is off screen, whichever way it went: the content comes home, the
// keyboard comes back, and a dismissal not asked for here is reported to
// JavaScript, which owns `visible`
- (void)_cardWentAway:(EXPPopoverCardController *)card
{
  if (card != nil && card != _cardController) {
    return;
  }
  _cardController = nil;
  [NSNotificationCenter.defaultCenter removeObserver:self name:UIDeviceOrientationDidChangeNotification object:nil];
  if (_watchingOrientation) {
    [UIDevice.currentDevice endGeneratingDeviceOrientationNotifications];
    _watchingOrientation = NO;
  }
  [_contentView removeFromSuperview];
  [self _bringBackTheKeyboard];
  if (_visible) {
    [EXPKeyboardTrace record:@"panel DISMISSED by the platform"];
    _visible = NO;
    _closedByPlatform = YES;
    [self _backdropTapped];
  }
}

// A popover on every size class; the default adapts to a sheet on a phone
- (UIModalPresentationStyle)adaptivePresentationStyleForPresentationController:(UIPresentationController *)controller
                                                               traitCollection:(UITraitCollection *)traitCollection
{
  return UIModalPresentationNone;
}

- (void)_backdropTapped
{
  if (const auto emitter = std::static_pointer_cast<const ExpoPopoverEventEmitter>(_eventEmitter)) {
    emitter->onClose();
  }
}

// The box's size, recomputed on every commit so a panel that changes while up is followed
- (void)_layOut
{
  EXPPopoverCardController *card = _cardController;
  if (card == nil) {
    return;
  }
  card.contentSize = _contentSize;
  card.preferredContentSize = [card cardInBox].size;
  [card.view setNeedsLayout];
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  [super updateProps:props oldProps:oldProps];
  const auto &popoverProps = static_cast<const ExpoPopoverProps &>(*props);
  // A handle, not a box: visible, it would be an empty rectangle in the screen's flow
  self.hidden = YES;
  if (!popoverProps.visible) {
    _closedByPlatform = NO;
  }
  _anchor = CGRectMake(popoverProps.anchorX, popoverProps.anchorY, popoverProps.anchorWidth, popoverProps.anchorHeight);
  // On every commit, so a size change while the card is up is followed
  [self _layOut];
  [self _applyVisible:popoverProps.visible];
}

// The card lives in another hierarchy; a view released rather than recycled
// would otherwise leave it floating with nothing left to dismiss it
- (void)dealloc
{
  [NSNotificationCenter.defaultCenter removeObserver:self];
  if (_returnFallback != nil) {
    dispatch_block_cancel(_returnFallback);
  }
  [_keysPicture removeFromSuperview];
  [_keysPictureForReturn removeFromSuperview];
  _heldBar.holdsItsPlace = NO;
  _cardController.onDismissed = nil;
  [_cardController.presentingViewController dismissViewControllerAnimated:NO completion:nil];
  [_contentView removeFromSuperview];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _visible = NO;
  // The card lives in another hierarchy and outlives this view unless taken out here
  if (_cardController != nil) {
    _cardController.onDismissed = nil;
    [_cardController.presentingViewController dismissViewControllerAnimated:NO completion:nil];
    _cardController = nil;
  }
  [self _cardWentAway:nil];
  _presentWhenKeysReturn = NO;
  _blurAsked = NO;
  _closedByPlatform = NO;
  _anchor = CGRectZero;
  // Still a handle: `prepareForRecycle` returns `hidden` to NO
  self.hidden = YES;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ExpoPopoverComponentDescriptor>();
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end
