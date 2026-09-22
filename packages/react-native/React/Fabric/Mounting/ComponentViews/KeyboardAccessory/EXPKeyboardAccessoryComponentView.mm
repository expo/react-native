/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPKeyboardAccessoryComponentView.h"

#import "../View/EXPElementTextAreaComponentView.h"
#import "../View/EXPKeyboardInsets.h"
#import "../View/EXPKeyboardTrace.h"
#import "../View/EXPMaterialSurface.h"

#import <React/RCTComponentViewFactory.h>
#import <React/RCTConversions.h>
#import <React/RCTUtils.h>
#import <react/renderer/components/view/ExpoKeyboardAccessoryShadowNode.h>

#include <algorithm>

using namespace facebook::react;

/*
 * The composer is the screen's, on the keyboard layout guide: a subview of its
 * screen's view with its bottom on `keyboardLayoutGuide.topAnchor` while a
 * field inside it is editing, and on the screen's bottom edge otherwise, so it
 * travels with its screen's card through a navigation as the platform's own
 * composer does. Across a push the covered screen's bar lets its field go
 * unless the arriving composer asks for the keyboard, see
 * `EXPComposerScreenWatcher`.
 *
 * Not an input accessory: UIKit hides every input accessory for the length of
 * an interactive pop. The reach an accessory gives, a transcript drag that
 * begins dismissing when it reaches the composer, is the guide's
 * `keyboardDismissPadding` (iOS 17), set to the bar's height.
 */

// The first view under `root`, breadth first, for which `matches` holds;
// subtrees for which `descends` is NO are skipped, nil descends into everything
static UIView *_Nullable EXPFirstDescendant(
    UIView *_Nullable root,
    BOOL (^matches)(UIView *view),
    BOOL (^_Nullable descends)(UIView *view))
{
  NSMutableArray<UIView *> *queue = [root.subviews mutableCopy];
  while (queue.count > 0) {
    UIView *view = queue.firstObject;
    [queue removeObjectAtIndex:0];
    if (matches(view)) {
      return view;
    }
    if (descends == nil || descends(view)) {
      [queue addObjectsFromArray:view.subviews];
    }
  }
  return nil;
}

// How far the bar's material runs past its bottom edge, enough to cover the
// radius of the keyboard's top corners
static const CGFloat EXPKeyboardAccessoryMaterialOverhang = 20;

// How far the material begins above the bar. What rises above the bar is
// outside it and cannot be hit.
static const CGFloat EXPKeyboardAccessoryMaterialRise = 12;

// The rise for a fade of `fade` points; zero when there is no fade to soften
static CGFloat EXPKeyboardAccessoryMaterialRiseForFade(CGFloat fade)
{
  return fade > 0 ? EXPKeyboardAccessoryMaterialRise : 0;
}

/**
 * The bar: the view React's children live in, sized to their layout plus the
 * strip of the home indicator it reserves when nothing is below it.
 *
 * A `UIInputView`, not a plain `UIView`, so a bar with no surface of its own is
 * drawn on the keyboard's material rather than on nothing; a bar that carries a
 * surface hides that backdrop and draws its own.
 */
@interface EXPKeyboardAccessoryContentView : UIInputView

/** The height React laid the bar's content out at. The safe area is added to it, not taken from it. */
@property (nonatomic, assign) CGFloat contentHeight;

/**
 * Where React's children go, and ONLY React's children.
 *
 * Named, not an override of `insertSubview:atIndex:`. A `UIInputView` inserts
 * subviews of its own — a full-width backdrop among them — and a blanket
 * override would redirect those into the content container too, where placed
 * after React's children it covers the whole bar.
 */
- (void)insertContentSubview:(UIView *)view atIndex:(NSInteger)index;

/**
 * The bar's surface, which is the WHOLE bar.
 *
 * On this view rather than on a child box, because a docked bar is taller than
 * the content React laid out: it reaches through the home indicator's strip to
 * the bottom of the screen. A child could only ever be as tall as its own
 * layout, so a material written on one stops at the content's edge and leaves
 * the last thirty-four points bare — a visible seam under the bar.
 */
- (void)setMaterial:(nullable NSString *)keyword
               fade:(CGFloat)fade
               fill:(nullable UIColor *)fill
           strength:(CGFloat)strength;

/**
 * The strip of the home indicator the bar reserves below its content, from the
 * keyboard's height: the part of the indicator's band the keys do not cover.
 *
 *     reserve = clamp(safeArea - max(obstruction - safeArea, 0), 0, safeArea)
 *
 * The obstruction already includes the strip (34 with the keys down, which is
 * the strip itself), so only what stands above the strip eats into it. Down:
 * the whole strip is reserved and the bar clears the indicator. Up: none is,
 * and the bar sits on the keys. Continuous in between, over the last
 * thirty-four points of the keys' travel, which is the only part of the journey
 * where the indicator is uncovered. Called once a frame while the keyboard
 * moves, because UIKit moves the keyboard by translating its window and a
 * translation lays nothing out. *
 * DOM-CSS-LIMITATION(accessory-drifts-while-the-keyboard-rises): the reserve
 * is applied by making the bar TALLER, and UIKit animates the input view's
 * height across its own keyboard transition, so the bar's content slides 18
 * points against the keys on the way up instead of tracking them frame by
 * frame.
 */
- (void)updateBottomReserveForObstruction:(CGFloat)obstruction safeArea:(CGFloat)safeArea;

/** The same, from the bar's own resting frame, for a layout pass with no sampler running. */
- (void)updateBottomReserve;
/** Forget the obstruction this bar was docked against; for a bar about to serve another element. */
- (void)forgetObstruction;

/** The strip of the home indicator this bar is currently reserving, in points. */
@property (nonatomic, readonly) CGFloat bottomReserve;

/**
 * Whether that strip is added to the bar's HEIGHT.
 *
 * It is measured either way, because `onDockChange` publishes it and an author
 * who owns the strip needs the number more than one who does not. Off makes the
 * bar exactly as tall as its content, and everything below the content is the
 * author's to pay for. See `automaticInsets` in
 * `ExpoKeyboardAccessoryShadowNode.h`.
 */
@property (nonatomic, assign) BOOL reservesBottom;

/** The bottom safe area the reserve is a fraction OF. */
@property (nonatomic, readonly) CGFloat appSafeArea;

@end

@implementation EXPKeyboardAccessoryContentView {
  UIView *_insetContainer;
  EXPMaterialSurface *_material;
  // The fade the author asked for, which decides how far the material rises
  CGFloat _appliedFade;
  NSLayoutConstraint *_heightConstraint;
  // How much of the home indicator's strip the bar reserves, in points; a
  // quantity, so the bar's height does not change by the whole safe area in one frame
  CGFloat _bottomReserve;
  CGFloat _appSafeArea;
  // The keyboard's height as last sampled, and whether a sampler has run at all
  CGFloat _obstruction;
  BOOL _reserveFollowsObstruction;
  // UIKit's own backdrop, found once; hidden while a material of ours is drawn
  __weak UIView *_backdrop;
  BOOL _reservesBottom;
  // The last field-frame line recorded, see `-_recordFieldFrame`
  NSString *_lastFieldFrameLine;
  // The last material state the trace saw, so it is only written on change
  NSString *_lastRecordedMaterialState;
}

- (BOOL)reservesBottom
{
  return _reservesBottom;
}

- (void)setReservesBottom:(BOOL)reservesBottom
{
  if (_reservesBottom == reservesBottom) {
    return;
  }
  _reservesBottom = reservesBottom;
  [self _updateHeightIfNeeded];
  [self setNeedsLayout];
}

- (CGFloat)bottomReserve
{
  return _bottomReserve;
}

- (CGFloat)appSafeArea
{
  return _appSafeArea;
}

- (instancetype)init
{
  // `UIInputView` takes its style at construction
  if (self = [super initWithFrame:CGRectZero inputViewStyle:UIInputViewStyleKeyboard]) {
    self.translatesAutoresizingMaskIntoConstraints = NO;
    // The prop's default, so the strip is reserved from the first layout pass
    _reservesBottom = YES;
    // A height constraint, written when the number changes and never during
    // layout, where a `setFrame:` loops
    _heightConstraint = [self.heightAnchor constraintEqualToConstant:0];
    _heightConstraint.active = YES;
    _insetContainer = [UIView new];
    [self addSubview:_insetContainer];
  }
  return self;
}

- (CGSize)intrinsicContentSize
{
  EXP_ATTRIBUTE_LAYOUT();
  return CGSizeMake(UIViewNoIntrinsicMetric, [self _wantedHeight]);
}

- (CGFloat)_wantedHeight
{
  EXP_ATTRIBUTE_LAYOUT();
  return _contentHeight + (_reservesBottom ? _bottomReserve : 0);
}

static CGFloat EXPKeyboardAccessoryReserveForObstruction(CGFloat obstruction, CGFloat safeArea)
{
  const CGFloat keysAboveTheStrip = MAX(obstruction - safeArea, 0);
  return MIN(MAX(safeArea - keysAboveTheStrip, 0), safeArea);
}

- (void)updateBottomReserveForObstruction:(CGFloat)obstruction safeArea:(CGFloat)safeArea
{
  EXP_ATTRIBUTE_LAYOUT();
  _appSafeArea = safeArea;
  _obstruction = obstruction;
  _reserveFollowsObstruction = YES;
  [self _applyBottomReserve:EXPKeyboardAccessoryReserveForObstruction(obstruction, safeArea)];
}

// Before any sampler has run the bar's own resting frame says what is below it;
// afterwards the remembered obstruction is re-derived against the host's safe area
- (void)forgetObstruction
{
  _obstruction = 0;
  _reserveFollowsObstruction = NO;
}

- (void)updateBottomReserve
{
  EXP_ATTRIBUTE_LAYOUT();
  UIView *host = self.superview;
  if (host == nil || self.window == nil) {
    return;
  }
  const CGFloat safeArea = host.safeAreaInsets.bottom;
  _appSafeArea = safeArea;
  if (_reserveFollowsObstruction) {
    [self _applyBottomReserve:EXPKeyboardAccessoryReserveForObstruction(_obstruction, safeArea)];
    return;
  }
  const CGRect inHost = [self convertRect:self.bounds toView:host];
  const CGFloat keysBelow = MAX(CGRectGetHeight(host.bounds) - CGRectGetMaxY(inHost), 0);
  [self _applyBottomReserve:MIN(MAX(safeArea - keysBelow, 0), safeArea)];
}

// Guarded on the answer changing, so a layout pass settles in one more rather than every one
- (void)_applyBottomReserve:(CGFloat)wanted
{
  // Sub-half-point changes are not worth a layout, except to land exactly on an
  // endpoint, or the bar is reported as never quite docked
  const BOOL atAnEndpoint = wanted == 0 || wanted == _appSafeArea;
  if (_bottomReserve == wanted || (!atAnEndpoint && fabs(_bottomReserve - wanted) < 0.5)) {
    return;
  }
  _bottomReserve = wanted;
  [self _updateHeightIfNeeded];
  [self setNeedsLayout];
}

// Guarded on the height changing, because it is reached from layout
- (void)_updateHeightIfNeeded
{
  EXP_ATTRIBUTE_LAYOUT();
  const CGFloat wanted = [self _wantedHeight];
  if (fabs(_heightConstraint.constant - wanted) < 0.5) {
    return;
  }
  _heightConstraint.constant = wanted;
  [self invalidateIntrinsicContentSize];
}

- (void)setContentHeight:(CGFloat)contentHeight
{
  EXP_ATTRIBUTE_LAYOUT();
  if (_contentHeight == contentHeight) {
    return;
  }
  _contentHeight = contentHeight;
  [self _updateHeightIfNeeded];
  [self setNeedsLayout];
}

- (void)didMoveToWindow
{
  EXP_ATTRIBUTE_LAYOUT();
  [super didMoveToWindow];
  [self _recordMaterialState:@"window-move"];
}

// The material's state plus the bar's subview inventory, to the trace, on every
// change; a `UIInputView` inserts subviews of its own
- (void)_recordMaterialState:(NSString *)why
{
  if (![EXPKeyboardTrace isRecording]) {
    return;
  }
  NSMutableString *subviews = [NSMutableString string];
  for (UIView *sub in self.subviews) {
    [subviews appendFormat:@" %@(%.0f,%.0f %.0fx%.0f h=%d a=%.2f)",
                           NSStringFromClass(sub.class),
                           sub.frame.origin.x,
                           sub.frame.origin.y,
                           sub.frame.size.width,
                           sub.frame.size.height,
                           (int)sub.hidden,
                           sub.alpha];
  }
  NSString *state = [[_material stateDescription] stringByAppendingFormat:@" subviews:%@", subviews];
  if (state == nil || [state isEqualToString:_lastRecordedMaterialState]) {
    return;
  }
  _lastRecordedMaterialState = state;
  [EXPKeyboardTrace recordPinned:@"%@ [%@ in %@]",
                                 state,
                                 why,
                                 self.window == nil ? @"no-window" : NSStringFromClass(self.window.class)];
}

- (void)safeAreaInsetsDidChange
{
  [super safeAreaInsetsDidChange];
  [self _updateHeightIfNeeded];
  [self setNeedsLayout];
}

- (void)layoutSubviews
{
  EXP_ATTRIBUTE_LAYOUT();
  [super layoutSubviews];

  // A `UIInputView` inserts a full-width backdrop of its own, a second surface
  // under a bar that draws its own with `_material`. Hidden every pass, because
  // UIKit re-adds and re-orders it.
  if (_backdrop == nil) {
    for (UIView *sub in self.subviews) {
      if ([NSStringFromClass(sub.class) containsString:@"Backdrop"]) {
        _backdrop = sub;
        break;
      }
    }
  }
  // Only while a material of ours is drawn; otherwise the bar keeps UIKit's backdrop
  const BOOL hideBackdrop = _material.isInstalled;
  if (_backdrop != nil && _backdrop.hidden != hideBackdrop) {
    _backdrop.hidden = hideBackdrop;
  }

  // The content sits at the top of the bar and the reserve is left below it
  _insetContainer.frame = CGRectMake(0, 0, self.bounds.size.width, _contentHeight);
  // The material is the bar's surface, reserve included, overhanging the
  // keyboard's rounded top corners
  [_material layOutInContainer:self
                  cornerRadius:0
                   cornerCurve:kCACornerCurveCircular
                   topOverhang:EXPKeyboardAccessoryMaterialRiseForFade(_appliedFade)
                bottomOverhang:EXPKeyboardAccessoryMaterialOverhang];

  [self updateBottomReserve];

  [self _recordMaterialState:@"layout"];
  [self _recordFieldFrame];
}

// Where the field sits inside the bar, whenever that changes, next to the bar's
// height and the reserve
- (void)_recordFieldFrame
{
  if (![EXPKeyboardTrace isRecording]) {
    return;
  }
  UIView *field = EXPFirstDescendant(
      _insetContainer,
      ^BOOL(UIView *view) {
        return [view isKindOfClass:UITextView.class];
      },
      nil);
  if (field == nil) {
    return;
  }
  const CGRect inBar = [field convertRect:field.bounds toView:self];
  NSString *line = [NSString
      stringWithFormat:
          @"field in bar x=%.1f y=%.1f w=%.1f h=%.1f | bar h=%.1f content=%.1f reserve=%.1f inset=%.1f textOffset=%.1f",
          CGRectGetMinX(inBar),
          CGRectGetMinY(inBar),
          CGRectGetWidth(inBar),
          CGRectGetHeight(inBar),
          CGRectGetHeight(self.bounds),
          _contentHeight,
          _bottomReserve,
          CGRectGetHeight(_insetContainer.bounds),
          ((UIScrollView *)field).contentOffset.y];
  if ([line isEqualToString:_lastFieldFrameLine]) {
    return;
  }
  _lastFieldFrameLine = line;
  [EXPKeyboardTrace record:@"%@", line];
}

- (void)setMaterial:(NSString *)keyword fade:(CGFloat)fade fill:(UIColor *)fill strength:(CGFloat)strength
{
  _appliedFade = fade;
  if (_material == nil) {
    if (keyword.length == 0 && fill == nil) {
      return;
    }
    _material = [EXPMaterialSurface new];
  }
  // The fill first: the surface tears itself down when asked for neither an
  // effect nor a colour. The strength before the keyword: an effect view born at
  // full strength and dimmed afterwards flashes on the first commit.
  [_material setFill:fill];
  [_material setStrength:strength];
  // Into self at index 0, behind the inset container that holds React's children
  [_material applyKeyword:keyword fade:fade inContainer:self];
  // The bar must not clip, or the overhang below it is trimmed off
  self.clipsToBounds = NO;
  [_material layOutInContainer:self
                  cornerRadius:0
                   cornerCurve:kCACornerCurveCircular
                   topOverhang:EXPKeyboardAccessoryMaterialRiseForFade(_appliedFade)
                bottomOverhang:EXPKeyboardAccessoryMaterialOverhang];
}

// The bar's surface is not a target, its controls are: a finger on the bar's
// background falls through to the transcript beneath, as in the platform's chat
- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event
{
  UIView *hit = [super hitTest:point withEvent:event];
  if (hit == self || hit == _insetContainer) {
    return nil;
  }
  return hit;
}

- (void)insertContentSubview:(UIView *)view atIndex:(NSInteger)index
{
  [_insetContainer insertSubview:view atIndex:index];
}

@end

@class EXPKeyboardAccessoryComponentView;

/**
 * A child of the screen's view controller, for one callback: a screen covered
 * by a push lets its field go, or keeps it for the screen arriving over it, as
 * the push begins.
 *
 * As it begins, because of what UIKit does with a field still first responder
 * when a push starts: it pins the input views and carries the keys off with the
 * card, the screen's `keyboardLayoutGuide` collapses while the keys are still
 * visible, and the resign UIKit performs flags the field to become first
 * responder again when its view next enters a window, so the screen comes back
 * with a guide reporting a keyboard that is never drawn. A plain, unanimated
 * resign here sets no such flag.
 *
 * When the arriving composer asks for the keyboard the field is kept: the
 * arriving field's claim falls in the same transition block and the keyboard
 * changes owner with the keys never leaving the screen, which is what the
 * platform's chat does. A screen being popped keeps its field; UIKit slides its
 * keyboard with the card and restores it if the pop is cancelled.
 */
@interface EXPComposerScreenWatcher : UIViewController
@property (nonatomic, weak) EXPKeyboardAccessoryComponentView *accessory;
@end

@interface EXPKeyboardAccessoryComponentView () <EXPKeyboardObstructingView>
// The screen this bar is in is about to be covered by another
- (void)screenWillBeCoveredBy:(nullable UIViewController *)arriving;
@end

@implementation EXPComposerScreenWatcher

- (void)loadView
{
  UIView *view = [[UIView alloc] initWithFrame:CGRectZero];
  view.hidden = YES;
  view.userInteractionEnabled = NO;
  self.view = view;
}

- (void)viewWillDisappear:(BOOL)animated
{
  [super viewWillDisappear:animated];
  // react-native-screens pops by rewriting the navigation controller's list,
  // which does not mark the screen as moving from its parent
  UIViewController *screen = self.parentViewController;
  UINavigationController *stack = screen.navigationController;
  const BOOL leaving = screen.isBeingDismissed || screen.isMovingFromParentViewController ||
      (stack != nil && ![stack.viewControllers containsObject:screen]);
  if (!leaving) {
    // On a push the stack's top is the arriving screen; under a presentation it
    // is still this screen
    UIViewController *top = stack.topViewController;
    [self.accessory screenWillBeCoveredBy:(top != screen ? top : nil)];
  }
}

@end

@implementation EXPKeyboardAccessoryComponentView {
  EXPKeyboardAccessoryContentView *_contentView;
  /** Hears the screen's appearance callbacks; see `EXPComposerScreenWatcher`. */
  EXPComposerScreenWatcher *_watcher;
  /** The bar spans the host's width. */
  NSArray<NSLayoutConstraint *> *_hostEdgeConstraints;
  /** The bar's bottom on the keyboard layout guide's top: on the keys, or on the screen's bottom edge. */
  NSLayoutConstraint *_dockedToKeyboardConstraint;
  /** The bar's bottom on the screen's bottom edge. */
  NSLayoutConstraint *_restingOnScreenConstraint;
  /** Which of the two holds: YES while this bar's field has, or is losing, the keyboard. */
  BOOL _shouldDockToKeyboard;

  EXPKeyboardInsets *_insets;
  /**
   * The last strip reported to JavaScript, so the same answer is not sent twice.
   * Seeded to a value no reserve can take: ZERO is a real state.
   */
  /** The bar's drawn top as last published — see `-_emitDockChangeWithTop:`. */
  CGFloat _emittedTop;
  CGFloat _emittedReserve;
  /** Which bar a trace line is about: a counter, readable in a dump, unlike a reused address. */
  NSInteger _barId;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ExpoKeyboardAccessoryShadowNode::defaultSharedProps();
    _contentView = [EXPKeyboardAccessoryContentView new];
    _emittedReserve = -1;
    static NSInteger nextBarId = 1;
    _barId = nextBarId++;
  }
  return self;
}

- (void)didMoveToWindow
{
  EXP_ATTRIBUTE_LAYOUT();
  [super didMoveToWindow];
  if (self.window == nil) {
    // Covered or popped: the bar stays in its screen's view
    return;
  }
  // The screen's sampler first: hosting records which screen this bar is on
  _insets = [EXPKeyboardInsets insetsForView:self];
  [self _hostInTheScreen];
  [self _observe:YES];
  [_insets addObstructingView:self];
  // The bar arrived with its screen, not with a keyboard, so nothing else wakes the sampler
  [_insets obstructingViewsDidChange];
}

// The controller of the screen this bar is mounted in; its view is the bar's host
- (UIViewController *)_owningViewController
{
  UIResponder *responder = self.nextResponder;
  while (responder != nil && ![responder isKindOfClass:UIViewController.class]) {
    responder = responder.nextResponder;
  }
  return (UIViewController *)responder;
}

// Puts the bar in its screen's view; idempotent, and a recycled view handed to
// another screen is re-hosted
- (void)_hostInTheScreen
{
  UIViewController *screen = [self _owningViewController];
  UIView *host = screen.viewIfLoaded;
  if (host == nil) {
    [EXPKeyboardTrace record:@"accessory#%ld no screen view to host in", (long)_barId];
    return;
  }
  [self _watchScreen:screen];
  if (_contentView.superview == host) {
    [host bringSubviewToFront:_contentView];
    return;
  }
  [NSLayoutConstraint deactivateConstraints:_hostEdgeConstraints ?: @[]];
  _dockedToKeyboardConstraint.active = NO;
  _restingOnScreenConstraint.active = NO;
  [_contentView removeFromSuperview];
  [host addSubview:_contentView];
  _hostEdgeConstraints = @[
    [_contentView.leadingAnchor constraintEqualToAnchor:host.leadingAnchor],
    [_contentView.trailingAnchor constraintEqualToAnchor:host.trailingAnchor],
  ];
  [NSLayoutConstraint activateConstraints:_hostEdgeConstraints];
  // The guide rests on the screen's bottom edge, not the safe area's: the bar
  // reserves the home indicator's strip inside its own height
  if (@available(iOS 17.0, *)) {
    host.keyboardLayoutGuide.usesBottomSafeArea = NO;
  }
  _dockedToKeyboardConstraint = [_contentView.bottomAnchor constraintEqualToAnchor:host.keyboardLayoutGuide.topAnchor];
  _restingOnScreenConstraint = [_contentView.bottomAnchor constraintEqualToAnchor:host.bottomAnchor];
  [self _updateDismissPadding];
  _shouldDockToKeyboard = [self _editingFieldInBar] != nil;
  _dockedToKeyboardConstraint.active = _shouldDockToKeyboard;
  _restingOnScreenConstraint.active = !_shouldDockToKeyboard;
  [EXPKeyboardTrace recordPinned:@"accessory#%ld hosted in %@, %@, screen#%ld",
                                 (long)_barId,
                                 NSStringFromClass(host.class),
                                 _shouldDockToKeyboard ? @"docked to keyboard" : @"resting on screen",
                                 (long)_insets.identifier];
}

// Joins the screen's view controller as a child, once
- (void)_watchScreen:(UIViewController *)screen
{
  if (_watcher == nil) {
    _watcher = [EXPComposerScreenWatcher new];
    _watcher.accessory = self;
  }
  if (_watcher.parentViewController == screen) {
    return;
  }
  [self _stopWatching];
  [screen addChildViewController:_watcher];
  [screen.view addSubview:_watcher.view];
  [_watcher didMoveToParentViewController:screen];
}

- (void)_stopWatching
{
  if (_watcher.parentViewController == nil) {
    return;
  }
  [_watcher willMoveToParentViewController:nil];
  [_watcher.view removeFromSuperview];
  [_watcher removeFromParentViewController];
}

- (void)screenWillBeCoveredBy:(UIViewController *)arriving
{
  UIView *field = [self _editingFieldInBar];
  if (field == nil) {
    // Nothing of ours is editing, or UIKit already resigned it by taking the
    // view out of the window
    [EXPKeyboardTrace record:@"accessory#%ld covered; no editing field to let go", (long)_barId];
    return;
  }
  // Handed over, not dismissed, when the arriving composer is going to take it;
  // dismissed here, the keys could not come back before the transition ends
  UIView *arrivingView = arriving.isViewLoaded ? arriving.view : nil;
  if ([EXPKeyboardAccessoryComponentView _barInScreen:arrivingView].asksForKeyboardOnArrival) {
    [EXPKeyboardTrace record:@"accessory#%ld covered; keyboard left for the arriving composer", (long)_barId];
    return;
  }
  // Unanimated, or the keyboard slides down across the arriving screen
  __block BOOL letGo = NO;
  [UIView performWithoutAnimation:^{
    letGo = [field resignFirstResponder];
  }];
  [EXPKeyboardTrace record:@"accessory#%ld covered; field let go=%d (no animation)", (long)_barId, (int)letGo];
}

// The drag that dismisses the keyboard begins when it reaches the bar, not the
// keys: the guide's dismiss padding is the bar's content height
- (void)_updateDismissPadding
{
  EXP_ATTRIBUTE_LAYOUT();
  if (@available(iOS 17.0, *)) {
    _contentView.superview.keyboardLayoutGuide.keyboardDismissPadding = MAX(_contentView.contentHeight, 0);
  }
}

/**
 * Which anchor holds. `keyboardLayoutGuide` follows the keyboard, whoever's it
 * is, so a bar follows the guide only while the keyboard is its own: from a
 * field inside it beginning editing until `UIKeyboardDidHide`. A keyboard
 * rising for someone else's field docks it at once.
 */
- (void)_setShouldDockToKeyboard:(BOOL)shouldDock why:(NSString *)why
{
  EXP_ATTRIBUTE_LAYOUT();
  if (_contentView.superview == nil || _dockedToKeyboardConstraint == nil) {
    return;
  }
  if (shouldDock == _shouldDockToKeyboard && _dockedToKeyboardConstraint.active == shouldDock &&
      _restingOnScreenConstraint.active != shouldDock) {
    return;
  }
  _shouldDockToKeyboard = shouldDock;
  _dockedToKeyboardConstraint.active = shouldDock;
  _restingOnScreenConstraint.active = !shouldDock;
  // The reserve, and the docked fraction JavaScript lays out from, is otherwise
  // re-derived only while the keyboard moves
  [self _refreshReserve];
  [_insets obstructingViewsDidChange];
  [EXPKeyboardTrace record:@"accessory#%ld bottom=%@ (%@)", (long)_barId, shouldDock ? @"keyboard" : @"screen", why];
}

/**
 * The reserve from the keyboard as sampled now: the keys cover this screen's
 * strip only while the bar is docked to them.
 */
- (void)_refreshReserve
{
  UIView *host = _contentView.superview;
  if (host == nil) {
    return;
  }
  const CGFloat obstruction = _insets != nil ? _insets.geometry.height : 0;
  const CGFloat mine = _shouldDockToKeyboard ? MAX(obstruction, 0) : 0;
  [_contentView updateBottomReserveForObstruction:mine safeArea:host.safeAreaInsets.bottom];
  [self _emitDockChange];
}

- (void)_observe:(BOOL)observing
{
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  [center removeObserver:self];
  if (!observing) {
    return;
  }
  for (NSNotificationName name in
       @[ UITextViewTextDidBeginEditingNotification, UITextFieldTextDidBeginEditingNotification ]) {
    [center addObserver:self selector:@selector(_fieldDidBeginEditing:) name:name object:nil];
  }
  for (NSNotificationName name in
       @[ UITextViewTextDidEndEditingNotification, UITextFieldTextDidEndEditingNotification ]) {
    [center addObserver:self selector:@selector(_fieldDidEndEditing:) name:name object:nil];
  }
  [center addObserver:self selector:@selector(_keyboardDidHide:) name:UIKeyboardDidHideNotification object:nil];
  [center addObserver:self selector:@selector(_keyboardWillShow:) name:UIKeyboardWillShowNotification object:nil];
  [center addObserver:self
             selector:@selector(_keyboardWillShow:)
                 name:UIKeyboardWillChangeFrameNotification
               object:nil];
}

- (void)_fieldDidBeginEditing:(NSNotification *)notification
{
  EXP_ATTRIBUTE_LAYOUT();
  UIView *field = [notification.object isKindOfClass:UIView.class] ? notification.object : nil;
  if (field == nil || ![field isDescendantOfView:_contentView]) {
    return;
  }
  [self _setShouldDockToKeyboard:YES why:@"field began editing"];
}

// Only recorded: the bar stays docked until the keyboard has gone, so it lands
// with the keys rather than jumping ahead of them
- (void)_fieldDidEndEditing:(NSNotification *)notification
{
  UIView *field = [notification.object isKindOfClass:UIView.class] ? notification.object : nil;
  if (field == nil || ![field isDescendantOfView:_contentView] || ![EXPKeyboardTrace isRecording]) {
    return;
  }
  [EXPKeyboardTrace recordPinned:@"editing ENDED on %@ %p in accessory#%ld win=%d <- %@",
                                 NSStringFromClass(field.class),
                                 field,
                                 (long)_barId,
                                 (int)(field.window != nil),
                                 EXPKeyboardTrace.callers];
}

- (void)_keyboardDidHide:(NSNotification *)notification
{
  if ([self _editingFieldInBar] == nil) {
    [self _setShouldDockToKeyboard:NO why:@"keyboard hidden"];
  }
}

// A keyboard rising or moving for a field that is not in this bar
- (void)_keyboardWillShow:(NSNotification *)notification
{
  EXP_ATTRIBUTE_LAYOUT();
  if ([self _editingFieldInBar] != nil || _contentView.window == nil) {
    return;
  }
  const CGRect end = [notification.userInfo[UIKeyboardFrameEndUserInfoKey] CGRectValue];
  const CGRect screen = _contentView.window.screen.bounds;
  if (CGRectGetMinY(end) < CGRectGetMaxY(screen) - 0.5) {
    [self _setShouldDockToKeyboard:NO why:@"someone else's keyboard"];
  }
}

// The first responder inside the bar, asked of UIKit rather than remembered:
// two screens' fields can each have begun editing
- (nullable UIView *)_editingFieldInBar
{
  return EXPFirstDescendant(
      _contentView,
      ^BOOL(UIView *view) {
        return view.isFirstResponder;
      },
      nil);
}

- (BOOL)asksForKeyboardOnArrival
{
  return EXPFirstDescendant(
             _contentView,
             ^BOOL(UIView *view) {
               return [view isKindOfClass:EXPElementTextAreaComponentView.class] &&
                   ((EXPElementTextAreaComponentView *)view).asksForKeyboardOnArrival;
             },
             nil) != nil;
}

// The composer bar in a screen's view; a composer is never inside a scroll view,
// so those are not searched
+ (nullable EXPKeyboardAccessoryComponentView *)_barInScreen:(nullable UIView *)screenView
{
  return (EXPKeyboardAccessoryComponentView *)EXPFirstDescendant(
      screenView,
      ^BOOL(UIView *view) {
        return [view isKindOfClass:EXPKeyboardAccessoryComponentView.class];
      },
      ^BOOL(UIView *view) {
        return ![view isKindOfClass:UIScrollView.class];
      });
}

// Whether the keyboard on screen belongs to this bar's screen
- (BOOL)_ownsTheKeyboard
{
  return [self _editingFieldInBar] != nil;
}

- (void)_leaveTheScreen
{
  [NSLayoutConstraint deactivateConstraints:_hostEdgeConstraints ?: @[]];
  _dockedToKeyboardConstraint.active = NO;
  _restingOnScreenConstraint.active = NO;
  _hostEdgeConstraints = nil;
  _dockedToKeyboardConstraint = nil;
  _restingOnScreenConstraint = nil;
  // The guide is the screen's; what this bar set on it goes with the bar.
  if (@available(iOS 17.0, *)) {
    _contentView.superview.keyboardLayoutGuide.usesBottomSafeArea = YES;
    _contentView.superview.keyboardLayoutGuide.keyboardDismissPadding = 0;
  }
  [_contentView removeFromSuperview];
  [self _stopWatching];
  _shouldDockToKeyboard = NO;
}

#pragma mark - RCTComponentViewProtocol

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ExpoKeyboardAccessoryComponentDescriptor>();
}

- (void)mountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  [_contentView insertContentSubview:childComponentView atIndex:index];
}

- (void)unmountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  [childComponentView removeFromSuperview];
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &newViewProps = static_cast<const ViewProps &>(*props);
  // Decided before super, which replaces `_props`
  const BOOL backgroundChanged =
      newViewProps.backgroundColor != static_cast<const ViewProps &>(*_props).backgroundColor;
  const BOOL fillChanged = (static_cast<const ExpoKeyboardAccessoryProps &>(*props).appleVisualEffectFade > 0) !=
      (static_cast<const ExpoKeyboardAccessoryProps &>(*_props).appleVisualEffectFade > 0);

  [super updateProps:props oldProps:oldProps];

  const auto &accessoryProps = static_cast<const ExpoKeyboardAccessoryProps &>(*props);
  _contentView.reservesBottom = accessoryProps.automaticInsets;

  // The background goes to the drawn view, this one being a hidden handle, and
  // to the surface rather than the layer once there is a fade, since a layer's
  // background is drawn below the mask that softens the top edge
  const BOOL fillGoesToTheSurface = accessoryProps.appleVisualEffectFade > 0;
  if (backgroundChanged || fillChanged || fillGoesToTheSurface) {
    _contentView.backgroundColor = fillGoesToTheSurface ? nil : RCTUIColorFromSharedColor(newViewProps.backgroundColor);
  }

  [_contentView setMaterial:[NSString stringWithUTF8String:accessoryProps.appleVisualEffect.c_str()]
                       fade:accessoryProps.appleVisualEffectFade
                       fill:fillGoesToTheSurface ? RCTUIColorFromSharedColor(newViewProps.backgroundColor) : nil
                   strength:accessoryProps.appleVisualEffectOpacity];

  // A handle, not a box: visible, it would paint the bar twice
  self.hidden = YES;
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics
           oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  EXP_ATTRIBUTE_LAYOUT();
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  // Only the height is React's to say; the width is the screen's and the
  // position the guide's. The frame, not the content frame, which excludes padding.
  const CGFloat height = RCTCGRectFromRect(layoutMetrics.frame).size.height;
  if (height != _contentView.contentHeight) {
    _contentView.contentHeight = height;
    [self _updateDismissPadding];
    // A taller or shorter bar is a different obstruction for the transcript
    [_insets obstructingViewsDidChange];
  }
}

- (void)prepareForRecycle
{
  // A recycled bar has told nobody anything, see `_emittedReserve`
  _emittedReserve = -1;
  [_contentView forgetObstruction];
  [super prepareForRecycle];
  [self _observe:NO];
  [_insets removeObstructingView:self];
  _insets = nil;
  [self _leaveTheScreen];
}

- (void)dealloc
{
  [self _leaveTheScreen];
  [NSNotificationCenter.defaultCenter removeObserver:self];
  [_insets removeObstructingView:self];
}

#pragma mark - EXPKeyboardObstructingView

// The on-screen y of a point `offsetFromTop` below a view's top this frame; NaN in no window
- (CGFloat)_edgeOnScreenNow:(CGFloat)offsetFromTop ofView:(UIView *)view
{
  UIWindow *window = view.window;
  if (view == nil || window == nil) {
    return NAN;
  }
  CALayer *now = view.layer.presentationLayer ?: view.layer;
  CALayer *windowNow = window.layer.presentationLayer ?: window.layer;
  const CGPoint inWindow = [now convertPoint:CGPointMake(0, offsetFromTop) toLayer:windowNow];
  return CGRectGetMinY(windowNow.frame) + inWindow.y;
}

// Publishes how docked this bar is whenever the answer changes by a quarter
// point: the reserve is the docked-ness
- (void)_emitDockChange
{
  [self _emitDockChangeWithTop:CGFLOAT_MAX];
}

// `top` is the bar's drawn top in the window, which the per-frame sampler has
// measured; published because a caller drawing over this bar cannot compute it
// mid-animation from the layout
- (void)_emitDockChangeWithTop:(CGFloat)top
{
  const auto emitter = std::static_pointer_cast<const ExpoKeyboardAccessoryEventEmitter>(_eventEmitter);
  if (emitter == nullptr) {
    return;
  }
  const CGFloat reserve = _contentView.bottomReserve;
  const CGFloat safeArea = _contentView.appSafeArea;
  const BOOL topMoved = top != CGFLOAT_MAX && fabs(top - _emittedTop) >= 0.25;
  if (fabs(reserve - _emittedReserve) < 0.25 && !topMoved) {
    return;
  }
  _emittedReserve = reserve;
  if (top != CGFLOAT_MAX) {
    _emittedTop = top;
  }
  ExpoKeyboardDockEvent event;
  event.reserve = reserve;
  event.top = static_cast<Float>(_emittedTop);
  event.height = static_cast<Float>(CGRectGetHeight(_contentView.bounds));
  // A safe area of zero is a screen with no home indicator: docked or not, with
  // no strip to measure the transition against
  event.docked = safeArea > 0 ? std::clamp<Float>(reserve / safeArea, 0, 1) : (reserve > 0 ? 1 : 0);
  emitter->onDockChange(event);
}

// The top of the bar in the window, measured on the presentation tree this
// frame. The reserve is re-derived here too, since this is the only thing that
// runs every frame the keyboard moves.
- (CGFloat)topInWindowForObstructionHeight:(CGFloat)obstructionHeight
{
  EXP_ATTRIBUTE_LAYOUT();
  UIWindow *appWindow = self.window;
  if (appWindow == nil || _contentView.window == nil || CGRectGetHeight(_contentView.bounds) <= 0) {
    return CGFLOAT_MAX;
  }
  [self _reserveForObstruction:_shouldDockToKeyboard ? MAX(obstructionHeight, 0) : 0];
  const CGFloat top =
      [appWindow convertPoint:CGPointMake(0, [self _edgeOnScreenNow:0 ofView:_contentView]) fromWindow:nil].y;
  if ([EXPKeyboardTrace isRecording]) {
    [self _traceDockAt:top forObstructionHeight:obstructionHeight inWindow:appWindow];
  }
  // Published from here, because this is the only thing that runs every frame
  // the keyboard moves — see `-_emitDockChangeWithTop:`.
  [self _emitDockChangeWithTop:top];
  return top;
}

/**
 * The strip the bar keeps clear below its content for the obstruction it is
 * docked against, and — because the strip is what JavaScript is told about —
 * the dock event, sent from here so it follows the change that causes it.
 */
- (void)_reserveForObstruction:(CGFloat)obstruction
{
  UIView *host = _contentView.superview;
  const CGFloat safeArea = host != nil ? host.safeAreaInsets.bottom : self.safeAreaInsets.bottom;
  [_contentView updateBottomReserveForObstruction:obstruction safeArea:safeArea];
  [self _emitDockChange];
}

// The dock reading, once per change, and a bar that owns the keyboard yet is off screen
- (void)_traceDockAt:(CGFloat)top forObstructionHeight:(CGFloat)obstructionHeight inWindow:(UIWindow *)appWindow
{
  const CGFloat modelTop = CGRectGetMinY([_contentView convertRect:_contentView.bounds toView:appWindow]);
  const CGFloat winHeight = CGRectGetHeight(appWindow.bounds);
  const CGFloat barHeight = CGRectGetHeight(_contentView.bounds);
  const CGFloat barBottom = [self _edgeOnScreenNow:barHeight ofView:_contentView];
  NSString *bar = [NSString stringWithFormat:@"accessory#%ld", (long)_barId];
  [EXPKeyboardTrace recordChanged:[bar stringByAppendingString:@" dock"]
                           pinned:NO
                           format:
                               @"dock top=%.1f resting=%.1f err=%.1f | guideWouldSay=%.1f barH=%.1f content=%.1f "
                               @"reserve=%.1f winH=%.1f barBottom=%.1f shouldDock=%d",
                               top,
                               modelTop,
                               top - modelTop,
                               winHeight - obstructionHeight,
                               barHeight,
                               _contentView.contentHeight,
                               _contentView.bottomReserve,
                               winHeight,
                               barBottom,
                               (int)_shouldDockToKeyboard];
  if ([self _ownsTheKeyboard] && (top >= winHeight - 0.5 || barBottom <= 0.5)) {
    [EXPKeyboardTrace recordChanged:[bar stringByAppendingString:@" off screen"]
                             pinned:YES
                             format:@"%@ %@ (top %.1f, bottom %.1f, screen %.1f)",
                                    bar,
                                    EXPKeyboardTrace.barOffScreenMarker,
                                    top,
                                    barBottom,
                                    winHeight];
  }
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end
