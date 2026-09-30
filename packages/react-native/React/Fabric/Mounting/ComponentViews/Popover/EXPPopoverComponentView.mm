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

/**
 * React's children, and nothing else.
 *
 * A plain view: the surface is the popover's own glass platter, and this only
 * holds the children where the card controller puts them.
 *
 * NOTHING repositions the children: they arrive already laid out, in this
 * view's coordinates. It used to set every subview to the full bounds, on the
 * assumption that React mounts exactly one child. It does not — a wrapper
 * `<div>` that draws nothing is flattened away by Fabric, so the panel's
 * buttons arrive as direct children, and every one of them was then given the
 * whole panel. They drew on top of each other, which reads as the panel
 * rendering one garbled line.
 */
@interface EXPPopoverContentView : UIView
@end

@implementation EXPPopoverContentView

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
 * The controller the popover presents. Its view is the card's CONTENT, sized to
 * the card: the box React laid out, shifted so the card — the box's first
 * child, inset by its margins — fills the view exactly and the box's margins
 * hang outside it. The surface is the popover's own glass platter behind it.
 *
 * The view has to be exactly the card's size: the zoom morphs the presented
 * view as a whole, and presented window-sized and clear around the card it
 * was a window-sized ghost growing out of the `+` with the card somewhere
 * inside. And the content must draw no glass of its own: UIKit morphs the
 * button into the popover's platter, and a second glass inside the platter
 * was a card inside a card.
 */
@interface EXPPopoverCardController : UIViewController
@property (nonatomic, strong, nullable) UIView *content;
/** React's layout of the box; a zero width or height means "the window's". */
@property (nonatomic, assign) CGSize contentSize;
@property (nonatomic, copy, nullable) void (^onDismissed)(void);
/// The box's size in a room of `room`, and the card's rectangle inside the box.
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

/*
 * Hidden until the transition's first animation frame.
 *
 * The card is laid out at its full size before the zoom applies its starting
 * state, and in the keyboard's window that layout reached the screen: an
 * empty, full-size card for one frame, then the morph. Reported from a
 * device. Shown from inside the transition's own animation, which is the
 * same transaction as the zoom's start.
 */
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

/// Every way out ends here — ours, and the transition's own pull-to-dismiss.
- (void)viewDidDisappear:(BOOL)animated
{
  [super viewDidDisappear:animated];
  if (self.onDismissed != nil) {
    self.onDismissed();
  }
}

@end

/**
 * The keys as they were, from the bar's bottom down, held in the app's window
 * while the keyboard is stood down — and the obstruction they stand for, so
 * the transcript keeps the room it had. See `_standDownTheKeyboardIn:`.
 */
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
  /*
   * The keyboard, stood down behind a picture of the keys while the card is
   * up, and the field it is given back to. See `_standDownTheKeyboardIn:`.
   * Nil while the keyboard was not up.
   */
  EXPPopoverKeysPicture *_keysPicture;
  /** The bar held in place for the picture, to release when the keys return. */
  __weak EXPKeyboardAccessoryComponentView *_heldBar;
  /** Whether `_present` began device orientation notifications, to end them once. */
  BOOL _watchingOrientation;
  /** A second picture of the keys, for the keyboard's own window on the way back. */
  UIView *_keysPictureForReturn;
  __weak UIView *_fieldToRefocus;
  /** The field was asked to blur while stood down: the keys leave as a keyboard does, not at once. */
  BOOL _blurAsked;
  /** The keys are on their way back, from the card's leaving or its report of being gone. */
  BOOL _keysReturning;
  /*
   * A presentation asked for while the keys were still returning from the last
   * one. Presented then, the card met a live keyboard: the stand-down had
   * nothing to do with a picture still up, UIKit's popover layout parked the
   * card above the keys, and the return's end took the keyboard down under it.
   * So it waits for `_keysDidReturn:` and runs the whole sequence then.
   */
  BOOL _presentWhenKeysReturn;
  /*
   * The return's fallback, to cancel: one return's timer fired into the NEXT
   * stand-down and took its picture and the bar's hold away under an open card.
   */
  dispatch_block_t _returnFallback;
  /*
   * The card went away on its own — a tap outside, a pull, a rotation — and
   * JavaScript, which owns `visible`, has not yet said so. A commit that lands
   * in between still says `visible`, and presented the card a second time
   * over the first's dismissal. Cleared by the first commit that says otherwise.
   */
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
    /*
     * Its own touch handling, because the card's content is outside the
     * surface's hierarchy, in the popover. The surface's handler is attached
     * to the surface's own hierarchy, so React never heard about a tap and the
     * card's buttons did nothing at all. The accessory needs the same thing
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

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics
           oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  /*
   * A handle, again — because the base class has just decided otherwise.
   *
   * `UIView+ComponentViewProtocol` sets `hidden` from the display type, and this
   * box's display type is `flex` like anything else, so it assigns NO. Which
   * of that and `updateProps` lands last is not fixed: on a recycled view the
   * layout pass forces an update and wins, and the handle came back visible as
   * an empty 370x452 rectangle over the screen. Stated in both places rather
   * than relying on an order.
   */
  self.hidden = YES;
  // The FRAME, not the content frame: the content frame is the box inside the
  // padding, so a panel with vertical padding would report itself short.
  _contentSize = RCTCGRectFromRect(layoutMetrics.frame).size;
  [self _layOut];
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

/**
 * The card is a POPOVER with the ZOOM transition, in the app's window, over
 * a keyboard that has been stood down behind a picture of itself.
 *
 * That is the system chat's own construction, read out of ChatKit: its send
 * menu presentation applies popover chrome to the card's controller, takes the
 * popover's zoom transition (`_popoverZoomTransitionIfEnabled`), and asks the
 * keyboard for a snapshot to dismiss behind
 * (`requestDismissKeyboardSnapshotForSendMenuIfNeeded`,
 * `isPreventingKeyboardPresentation`). `UIViewController.preferredTransition =
 * zoom` grows a presented controller out of a source view and shrinks it back,
 * and the source is the `+`'s own glass, so the card — the popover's own
 * glass platter — is the button's disc grown to a card: at its first frame the
 * card IS the disc. The pull-to-dismiss and the tap outside are the popover's.
 *
 * Why not simply over the keys, in the keyboard's window, where the card used
 * to be presented: a popover there asserts inside UIKit (`LiquidMorphAnimation`:
 * a pivot morph to a view that is not in the view hierarchy —
 * `UIRemoteKeyboardWindow`), and every other presentation shows a receding
 * copy of the keys behind the card for the length of the zoom. And the keys
 * cannot simply stay: the app's window is under the keyboard's, so a card in
 * it is under the keys, and a keyboard whose window is merely hidden is still
 * a keyboard to a popover's layout, which parks the card above it. So the
 * field gives the keyboard up, without animation, behind a picture that holds
 * the keys' place and the transcript's room until the card is gone — and then
 * takes it back under a second picture, placed in the keyboard's own window
 * for the length of its return.
 */

/**
 * The accessory bar this popover is INSIDE, walked up the tree — not whichever
 * one the focused field happens to be showing. A `UIInputView` is what UIKit
 * makes an accessory's content view, so the nearest ancestor that is one is
 * the bar this popover belongs to. Nil for a popover outside any bar.
 */
- (nullable UIView *)_bar
{
  for (UIView *ancestor = self.superview; ancestor != nil; ancestor = ancestor.superview) {
    if ([ancestor isKindOfClass:UIInputView.class]) {
      return ancestor;
    }
  }
  return nil;
}

/**
 * The `+`'s rect in the bar's own window: x and size from the anchor
 * JavaScript measured when the button was tapped, y from the bar AS DRAWN.
 *
 * The y JavaScript measures is the layout's, and the bar is lifted onto the
 * keyboard by an Auto Layout constraint the layout never hears about — so with
 * the keyboard up JavaScript said 818 for a button drawn at 490. The bar spans
 * the window's width, so an x is an x. `CGRectNull` for a panel in no bar.
 */
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

/**
 * The glass of the button under the anchor, or nil.
 *
 * The zoom morphs from a VIEW, and it has to be the `+`'s own glass: the
 * transition lifts a source view by drawing it into the growing card, and
 * what it draws is the view's own rendering. Given the control around the
 * glass, it snapshotted the control without its glass — the disc vanished at
 * the first frame and only the glyph travelled. Given an empty stand-in at
 * the rect, it cross-faded a copy of the card with the card, which read as
 * two menus.
 *
 * The button is not this popover's to hand over, so it is found: the deepest
 * view under the anchor's centre in the bar's window, walked up to the button
 * element it belongs to, and the glass asked of that.
 */
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

/// The controller to present from: the window's root, or whatever it has presented on top — never a card of ours.
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
 * The keyboard, stood down behind a picture of the keys.
 *
 * The keyboard's window is pictured — a snapshot of the screen came back
 * blank for it — into a view in the presenter's view from the bar's bottom
 * down, which registers as the keyboard's obstruction so the transcript keeps
 * its room. Both windows are the screen's size, so the keyboard's frame is
 * placed as it is rather than converted; UIKit's conversion of a rect between
 * the two came back 321 points off. The bar holds its place above the picture,
 * and the field lets the keyboard go WITHOUT ANIMATION, which UIKit honours on
 * the way down. Nothing when the keyboard is not up.
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
  /*
   * The keys only, from the bar's bottom down. The bar itself holds its place
   * (below) and stays real above the picture — a picture of the bar as well
   * lay over the real button, and a press's glass showed only where it grew
   * past the picture's top edge, which read as the button being clipped.
   */
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
 * The keyboard, given back to its field under the picture.
 *
 * Its return animates whatever `UIView` is told, and it would rise in plain
 * sight over the picture — the keyboard's window is above the app's, and it
 * is a NEW window each time, so nothing set on the old one reaches it, and
 * `hidden` or `alpha` set on the new one as the keyboard begins is undone by
 * UIKit as it shows the window; measured as two keyboards, one rising over the
 * picture of the other. So a second picture of the keys goes INTO the new
 * window as the keyboard begins to show, over the rising keys, and comes out
 * once they have arrived, with the app's picture, over pixels that match. A
 * keyboard that never arrives — the field gone, the screen popped — is
 * cleaned up after all the same, a second later.
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

/**
 * The keys leave the way a keyboard does: the picture slides down over the
 * keyboard's duration, the bar released inside the same animation so it lands
 * on the screen's edge with them, and the transcript follows the picture as
 * drawn. Dropping the picture at once read as the keyboard vanishing a beat
 * after the card had closed.
 */
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
  /*
   * The popover's OWN chrome is the card: on iOS 26 UIKit installs a glass
   * platter in it, and its zoom transition morphs the source button into that
   * platter and nothing else. A chrome drawn as nothing with a glass of the
   * card's own inside it read as the morph on the simulator, whose glass is a
   * stand-in, and on a phone the button never went anywhere: it stayed lifted
   * and highlighted while the card simply appeared.
   */
  card.modalPresentationStyle = UIModalPresentationPopover;
  UIPopoverPresentationController *popover = card.popoverPresentationController;
  popover.delegate = self;
  /*
   * Anchored on the `+` itself, with no arrow: UIKit then centres the card on
   * the button and moves it only as far as the screen's edges require. That is
   * where the system chat's card sits, measured on a phone: at the left margin,
   * its vertical centre on the `+`, over the keys, however tall it is. The
   * popover's default layout margins are the system chat's too — its card is
   * ten points in from the screen's edges — so none are set here.
   */
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
  /*
   * A rotation while the card is up takes it down — see `_deviceTurned:`. Not
   * the controller's `viewWillTransitionToSize:`, which UIKit also sends a
   * popover's content as it is presented, with the card's own size.
   */
  [UIDevice.currentDevice beginGeneratingDeviceOrientationNotifications];
  _watchingOrientation = YES;
  [NSNotificationCenter.defaultCenter addObserver:self
                                         selector:@selector(_deviceTurned:)
                                             name:UIDeviceOrientationDidChangeNotification
                                           object:nil];
  if (glass != nil) {
    // The transition's own dimming: the system chat's page and keys darken
    // behind its card, recorded on a phone
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

/**
 * The keys, back as the card starts to close rather than when UIKit reports
 * it gone.
 *
 * The zoom fades the card off the keys in about a fifth of a second, then
 * settles it on the `+` for another second, and UIKit reports the dismissal
 * only after that. The keys' return costs the main thread a turn or two, and a
 * second late it lands in the reader's next scroll. Asked for in the next
 * turn, once the transition has begun and can say what kind it is: a
 * dismissal the reader is still dragging, or one they let go of, is left to
 * the report.
 */
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

/// A dismissal the reader made: a tap outside, or the transition's own pull.
- (void)presentationControllerWillDismiss:(UIPresentationController *)presentationController
{
  [self _bringBackTheKeyboardAsTheCardCloses:_cardController];
}

/**
 * The device is turning under the card. Nothing here survives that: the
 * pictures are of the keys as they were, the card's box is laid out for the
 * old width, and the zoom's source stands where the button was. So the card
 * goes at once, without its morph, the pictures with it, and the keyboard
 * comes back the way UIKit brings it: the system chat's send menu goes on a
 * rotation too.
 */
- (void)_deviceTurned:(NSNotification *)notification
{
  EXPPopoverCardController *card = _cardController;
  const UIDeviceOrientation orientation = UIDevice.currentDevice.orientation;
  if (card == nil || !(UIDeviceOrientationIsPortrait(orientation) || UIDeviceOrientationIsLandscape(orientation))) {
    return;
  }
  const BOOL landscape = UIDeviceOrientationIsLandscape(orientation);
  const CGSize window = self.window.bounds.size;
  // Only a turn the window will follow: face up, face down and the same way
  // round again change nothing
  if (landscape == (window.width > window.height)) {
    return;
  }
  [EXPKeyboardTrace record:@"panel WINDOW turning under the card"];
  card.onDismissed = nil;
  _cardController = nil;
  [card.presentingViewController dismissViewControllerAnimated:NO completion:nil];
  // The pictures first, at once, and the keyboard back to its field without
  // one; then the rest of the way out
  UIView *field = _fieldToRefocus;
  _fieldToRefocus = nil;
  [self _keysDidReturn:nil];
  if (field != nil && field.window != nil) {
    [field becomeFirstResponder];
  }
  [self _cardWentAway:nil];
}

/**
 * The card is off screen, whichever way it went. The content comes home — a
 * recycled panel must not leave it in a dead controller's view — the keyboard
 * comes back under its picture, and a dismissal that was not asked for here
 * (a tap outside, the transition's own pull) is reported to JavaScript, which
 * owns `visible`.
 */
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

/// A popover on every size class: the default adapts to a sheet on a phone.
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

/**
 * The box's size, recomputed on every commit: a panel whose content changes
 * while it is up is followed.
 */
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
  // A handle, not a box: leaving it visible would lay out an empty rectangle in
  // the screen's flow.
  self.hidden = YES;
  if (!popoverProps.visible) {
    _closedByPlatform = NO;
  }
  _anchor = CGRectMake(popoverProps.anchorX, popoverProps.anchorY, popoverProps.anchorWidth, popoverProps.anchorHeight);
  // On every commit, so a size change while the card is up is followed
  [self _layOut];
  [self _applyVisible:popoverProps.visible];
}

/**
 * The card lives in someone ELSE's hierarchy, so it has to be taken out on the
 * way out — twice over.
 *
 * `prepareForRecycle` covers the usual path, where Fabric puts the view back in
 * its pool. This covers the other one: a view that is released rather than
 * recycled would otherwise leave a card floating over the keyboard with nothing
 * left alive to dismiss it.
 */
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
  // The card lives in ANOTHER view's hierarchy, so it outlives this view
  // unless it is taken out here — a recycled popover would otherwise leave a
  // card floating over the app with nothing left to dismiss it.
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
  /*
   * Still a handle on the way out: `prepareForRecycle` returns a view to its
   * defaults, and the default for `hidden` is NO, so a recycled popover came
   * back VISIBLE and laid an empty rectangle over the screen.
   */
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
