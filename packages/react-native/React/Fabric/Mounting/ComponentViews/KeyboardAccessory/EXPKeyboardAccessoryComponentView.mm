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
 * THE COMPOSER IS THE SCREEN'S, ON THE KEYBOARD LAYOUT GUIDE.
 *
 * The bar is a subview of its screen's view, its bottom pinned to
 * `keyboardLayoutGuide.topAnchor` while a field inside it is being typed into,
 * and to the screen's bottom edge otherwise. UIKit moves the guide with
 * the keyboard — the spring of a reveal, a finger dragging the keys down, the
 * settle after. The bar is never re-hosted: it travels with its screen's card
 * through a navigation. This is how the platform's own chat composer is hosted.
 *
 * Across a push the keyboard is the covered screen's to give up. As the push
 * begins its bar lets its field go, without animation, so the keys are gone
 * before the arriving card is drawn over them — unless the arriving screen's
 * composer asks for the keyboard (`autoFocus`), in which case the field is
 * kept and UIKit hands the keyboard over inside the transition, the keys never
 * leaving the screen. A screen being popped keeps its field; UIKit slides its
 * keyboard off with the card. See `EXPComposerScreenWatcher`.
 *
 * It is NOT an input accessory: UIKit hides every input accessory for the
 * length of an interactive pop while sliding only the keys with the card, so a
 * composer that is the accessory disappears for the whole gesture. The reach an
 * accessory gives — a drag on the transcript that begins dismissing the
 * keyboard when it reaches the COMPOSER rather than the keys — is
 * `keyboardDismissPadding` on the guide (iOS 17), set to the bar's height, as
 * the platform's own composer does.
 */

/**
 * The first view under `root`, breadth first, for which `matches` holds; `root`
 * itself is not a candidate. Subtrees for which `descends` is NO are skipped;
 * nil descends into everything.
 */
static UIView *_Nullable EXPFirstDescendant(UIView *_Nullable root,
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

/**
 * How far the bar's material runs past its own bottom edge, in points.
 *
 * Enough to clear the radius of the keyboard's top corners, which is what the
 * overhang exists to cover.
 */
static const CGFloat EXPKeyboardAccessoryMaterialOverhang = 20;

/**
 * How far the material begins ABOVE the bar, in points.
 *
 * The native composer measures four (sampled over a white page: the darkening begins four
 * points above its bar's top, full strength thirty in). Twelve is this app's
 * preference — "the fade should overflow the box of the accessory" — bounded
 * above by an eighteen-point wash, which is too much. What rises above the bar
 * is outside it and cannot be hit, which is why the number can move at all.
 */
static const CGFloat EXPKeyboardAccessoryMaterialRise = 12;

/** The rise for a fade of `fade` points; zero when there is no fade to soften. */
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
 * translation lays nothing out.
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
  /** The fade the author asked for, which decides how far the material rises. */
  CGFloat _appliedFade;
  NSLayoutConstraint *_heightConstraint;
  /**
   * How much of the home indicator's strip the bar reserves, in points.
   *
   * A QUANTITY, not a boolean. The boolean asked "is the bar resting on the
   * bottom of the screen", so the bar's height changed by the whole safe area in
   * a single frame — measured in a drag trace as `barH` going 76 to 110 between
   * two consecutive samples, taking the scroll view's bottom inset with it.
   */
  CGFloat _bottomReserve;
  CGFloat _appSafeArea;
  /** The keyboard's height as last sampled, and whether a sampler has run at all. */
  CGFloat _obstruction;
  BOOL _reserveFollowsObstruction;
  /** UIKit's own backdrop, found once; hidden while a material of ours is drawn. */
  __weak UIView *_backdrop;
  BOOL _reservesBottom;
  /** The last field-frame line recorded; see `-_recordFieldFrame`. */
  NSString *_lastFieldFrameLine;
  /** The last material state the trace saw, so it is only written on change. */
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
  // `UIInputView` takes its style at construction and cannot be told later.
  if (self = [super initWithFrame:CGRectZero inputViewStyle:UIInputViewStyleKeyboard]) {
    self.translatesAutoresizingMaskIntoConstraints = NO;
    // The prop's default, so the strip is reserved from the first layout pass
    // rather than from the first `-updateProps:`.
    _reservesBottom = YES;
    // A height CONSTRAINT, written when the number changes and never during
    // layout; a `setFrame:` from inside a layout pass once spun the main thread
    // at 100% for the length of a drag.
    _heightConstraint = [self.heightAnchor constraintEqualToConstant:0];
    _heightConstraint.active = YES;
    _insetContainer = [UIView new];
    [self addSubview:_insetContainer];
  }
  return self;
}

- (CGSize)intrinsicContentSize
{
  return CGSizeMake(UIViewNoIntrinsicMetric, [self _wantedHeight]);
}

- (CGFloat)_wantedHeight
{
  return _contentHeight + (_reservesBottom ? _bottomReserve : 0);
}

static CGFloat EXPKeyboardAccessoryReserveForObstruction(CGFloat obstruction, CGFloat safeArea)
{
  const CGFloat keysAboveTheStrip = MAX(obstruction - safeArea, 0);
  return MIN(MAX(safeArea - keysAboveTheStrip, 0), safeArea);
}

- (void)updateBottomReserveForObstruction:(CGFloat)obstruction safeArea:(CGFloat)safeArea
{
  _appSafeArea = safeArea;
  _obstruction = obstruction;
  _reserveFollowsObstruction = YES;
  [self _applyBottomReserve:EXPKeyboardAccessoryReserveForObstruction(obstruction, safeArea)];
}

/**
 * Before any sampler has run — the first layout — the bar's own resting frame
 * says what is below it: nothing but the strip when its bottom is the screen's,
 * keys when it is higher. Once a sampler has run the remembered obstruction is
 * re-derived against the host's safe area, read fresh.
 */
- (void)forgetObstruction
{
  _obstruction = 0;
  _reserveFollowsObstruction = NO;
}

- (void)updateBottomReserve
{
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

/** Guarded on the answer CHANGING, so a layout pass settles in one more rather than every one. */
- (void)_applyBottomReserve:(CGFloat)wanted
{
  // Sub-half-point changes are not worth a layout, except to land exactly on
  // an endpoint: a strip resting at 33.7 of 34 is drawn short and reported to
  // JavaScript as never quite docked.
  const BOOL atAnEndpoint = wanted == 0 || wanted == _appSafeArea;
  if (_bottomReserve == wanted || (!atAnEndpoint && fabs(_bottomReserve - wanted) < 0.5)) {
    return;
  }
  _bottomReserve = wanted;
  [self _updateHeightIfNeeded];
  [self setNeedsLayout];
}

/** Guarded on the height actually changing, because it is reached from layout. */
- (void)_updateHeightIfNeeded
{
  const CGFloat wanted = [self _wantedHeight];
  if (fabs(_heightConstraint.constant - wanted) < 0.5) {
    return;
  }
  _heightConstraint.constant = wanted;
  [self invalidateIntrinsicContentSize];
}

- (void)setContentHeight:(CGFloat)contentHeight
{
  if (_contentHeight == contentHeight) {
    return;
  }
  _contentHeight = contentHeight;
  [self _updateHeightIfNeeded];
  [self setNeedsLayout];
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  [self _recordMaterialState:@"window-move"];
}

/**
 * The material's full state plus the bar's subview inventory, to the trace, on
 * every change: a device report of a flat or covered surface then names the
 * view that did it — a `UIInputView` inserts subviews of its own.
 */
- (void)_recordMaterialState:(NSString *)why
{
  if (![EXPKeyboardTrace isRecording]) {
    return;
  }
  NSMutableString *subviews = [NSMutableString string];
  for (UIView *sub in self.subviews) {
    [subviews appendFormat:@" %@(%.0f,%.0f %.0fx%.0f h=%d a=%.2f)",
                           NSStringFromClass(sub.class),
                           sub.frame.origin.x, sub.frame.origin.y,
                           sub.frame.size.width, sub.frame.size.height,
                           (int)sub.hidden, sub.alpha];
  }
  NSString *state =
      [[_material stateDescription] stringByAppendingFormat:@" subviews:%@", subviews];
  if (state == nil || [state isEqualToString:_lastRecordedMaterialState]) {
    return;
  }
  _lastRecordedMaterialState = state;
  [EXPKeyboardTrace recordPinned:@"%@ [%@ in %@]", state, why,
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
  [super layoutSubviews];

  /*
   * A `UIInputView` inserts a full-width backdrop of its own, and under a bar
   * that draws its whole surface with `_material` it is a SECOND surface that
   * does not composite our clear blur — seen on a device as "the background
   * without the blur" showing through. Hidden every pass, because UIKit re-adds
   * and re-orders it; only when there is a material, so a surfaceless bar keeps
   * UIKit's.
   */
  if (_backdrop == nil) {
    for (UIView *sub in self.subviews) {
      if ([NSStringFromClass(sub.class) containsString:@"Backdrop"]) {
        _backdrop = sub;
        break;
      }
    }
  }
  // Hidden only while a material of ours is drawn; without one — including after
  // a material has been taken away — the bar keeps UIKit's backdrop.
  const BOOL hideBackdrop = _material.isInstalled;
  if (_backdrop != nil && _backdrop.hidden != hideBackdrop) {
    _backdrop.hidden = hideBackdrop;
  }

  // The content sits at the TOP of the bar and the reserve is left below it,
  // which is where the home indicator is.
  _insetContainer.frame = CGRectMake(0, 0, self.bounds.size.width, _contentHeight);
  // The material is the bar's surface, reserve included, and runs a little past
  // it: the keyboard's top corners are rounded and the overhang fills them.
  [_material layOutInContainer:self
                  cornerRadius:0
                   cornerCurve:kCACornerCurveCircular
                   topOverhang:EXPKeyboardAccessoryMaterialRiseForFade(_appliedFade)
                bottomOverhang:EXPKeyboardAccessoryMaterialOverhang];

  [self updateBottomReserve];

  [self _recordMaterialState:@"layout"];
  [self _recordFieldFrame];
}

/**
 * Where the field sits inside the bar, whenever that changes: the one number a
 * "the text shifted" report needs, next to the bar's own height and the reserve.
 */
- (void)_recordFieldFrame
{
  if (![EXPKeyboardTrace isRecording]) {
    return;
  }
  UIView *field = EXPFirstDescendant(_insetContainer, ^BOOL(UIView *view) {
    return [view isKindOfClass:UITextView.class];
  }, nil);
  if (field == nil) {
    return;
  }
  const CGRect inBar = [field convertRect:field.bounds toView:self];
  NSString *line = [NSString stringWithFormat:@"field in bar x=%.1f y=%.1f w=%.1f h=%.1f | bar h=%.1f content=%.1f reserve=%.1f inset=%.1f textOffset=%.1f",
                                              CGRectGetMinX(inBar), CGRectGetMinY(inBar), CGRectGetWidth(inBar), CGRectGetHeight(inBar),
                                              CGRectGetHeight(self.bounds), _contentHeight, _bottomReserve, CGRectGetHeight(_insetContainer.bounds),
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
  // The fill FIRST: the surface tears itself down when asked for neither an
  // effect nor a colour. The strength BEFORE the keyword: an effect view born at
  // full strength and dimmed afterwards is a visible flash on the first commit.
  [_material setFill:fill];
  [_material setStrength:strength];
  // Into SELF, at index 0, behind the inset container that holds React's children.
  [_material applyKeyword:keyword fade:fade inContainer:self];
  // The bar must not clip, or the overhang below it is trimmed off again.
  self.clipsToBounds = NO;
  [_material layOutInContainer:self
                  cornerRadius:0
                   cornerCurve:kCACornerCurveCircular
                   topOverhang:EXPKeyboardAccessoryMaterialRiseForFade(_appliedFade)
                bottomOverhang:EXPKeyboardAccessoryMaterialOverhang];
}

/**
 * The bar's SURFACE is not a target; its controls are. A finger on the bar's
 * own background falls through to the transcript beneath, so a drag begun on
 * the composer's surface scrolls and dismisses the way it does in the native chat app.
 */
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
 * A child of the screen's view controller, for one callback: a screen COVERED
 * by a push lets its field go — or keeps it for the screen arriving over it —
 * as the push begins.
 *
 * As it begins, and not at its end, because of what UIKit does with a field
 * that is still first responder when a push starts. It pins the input views
 * and carries the keys off with the outgoing card — and two things break.
 * The screen's `keyboardLayoutGuide` collapses to the bottom edge the moment
 * the keys are pinned, while they are still visibly there riding the card, so
 * a bar that follows the guide snaps out from under them. And the resign UIKit
 * performs while pinning flags the field to become first responder again when
 * its view is next in a window — the start of the pop — so the screen comes
 * back with its guide reporting a keyboard that is never drawn and its
 * composer floating mid-screen. A plain resign
 * here sets no such flag; done without animation the keys are gone on the next
 * frame and the bar takes its resting height in the same pass, so nothing is
 * drawn across the arriving card.
 *
 * Unless the arriving screen's composer asks for the keyboard. Then the field
 * is kept: UIKit's resign while pinning and the arriving field's claim fall in
 * the same transition block, and the keyboard changes owner with the keys never
 * leaving the screen. A dismissal could not have come back before the push
 * ended — UIKit holds responder events for its duration.
 *
 * The platform's own chat does both: it dismisses the keyboard on a push whose
 * destination does not have one up, and keeps it up when the destination does.
 * A screen being POPPED keeps its field: UIKit slides its keyboard with the
 * card and restores it if the pop is cancelled.
 */
@interface EXPComposerScreenWatcher : UIViewController
@property (nonatomic, weak) EXPKeyboardAccessoryComponentView *accessory;
@end

@interface EXPKeyboardAccessoryComponentView () <EXPKeyboardObstructingView>
/** The screen this bar is in is about to be covered by another. */
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
  // which does not mark the screen as moving from its parent; the list itself
  // says whether the screen is still in the stack.
  UIViewController *screen = self.parentViewController;
  UINavigationController *stack = screen.navigationController;
  const BOOL leaving = screen.isBeingDismissed || screen.isMovingFromParentViewController ||
      (stack != nil && ![stack.viewControllers containsObject:screen]);
  if (!leaving) {
    // The stack's top is the arriving screen on a push. Covered by a
    // presentation instead, the top is still this screen, and nothing arrives
    // in the stack.
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
  [super didMoveToWindow];
  if (self.window == nil) {
    // Covered, or popped: the bar stays in its screen's view, which is where it
    // is drawn if the screen comes back.
    return;
  }
  // The screen's sampler first: hosting records which screen this bar is on,
  // and the answer is the sampler's identity.
  _insets = [EXPKeyboardInsets insetsForView:self];
  [self _hostInTheScreen];
  [self _observe:YES];
  [_insets addObstructingView:self];
  // The bar arrived with its screen, not with a keyboard: nothing else wakes the
  // sampler that puts its height into the transcript's inset.
  [_insets obstructingViewsDidChange];
}

/**
 * The controller of the SCREEN this bar is mounted in, walked from the responder
 * chain. Its view is the bar's host: the view a navigation transition moves.
 */
- (UIViewController *)_owningViewController
{
  UIResponder *responder = self.nextResponder;
  while (responder != nil && ![responder isKindOfClass:UIViewController.class]) {
    responder = responder.nextResponder;
  }
  return (UIViewController *)responder;
}

/**
 * Put the bar in its screen's view, once: its bottom on the keyboard layout
 * guide's top while its field has the keyboard, on the screen's bottom edge
 * otherwise. Idempotent, so every return to the window is the same as the
 * first; a recycled view handed to another screen is re-hosted.
 */
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
  /*
   * The guide rests on the screen's BOTTOM edge when the keyboard is gone, not
   * on the safe area's: the bar reserves the home indicator's strip inside its
   * own height (see the content view), so its bottom is the screen's in both
   * states and its content ends where the keys begin or where the strip does.
   */
  if (@available(iOS 17.0, *)) {
    host.keyboardLayoutGuide.usesBottomSafeArea = NO;
  }
  _dockedToKeyboardConstraint = [_contentView.bottomAnchor constraintEqualToAnchor:host.keyboardLayoutGuide.topAnchor];
  _restingOnScreenConstraint = [_contentView.bottomAnchor constraintEqualToAnchor:host.bottomAnchor];
  [self _updateDismissPadding];
  _shouldDockToKeyboard = [self _editingFieldInBar] != nil;
  _dockedToKeyboardConstraint.active = _shouldDockToKeyboard;
  _restingOnScreenConstraint.active = !_shouldDockToKeyboard;
  [EXPKeyboardTrace recordPinned:@"accessory#%ld hosted in %@, %@, screen#%ld", (long)_barId,
                                 NSStringFromClass(host.class),
                                 _shouldDockToKeyboard ? @"docked to keyboard" : @"resting on screen",
                                 (long)_insets.identifier];
}

/** Join the screen's view controller as a child, once; standard containment. */
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
    // Nothing of ours is editing — or UIKit already resigned it by taking the
    // view out of the window, which is the case that sets the flag this exists
    // to pre-empt. The trace tells the two apart by the line before it.
    [EXPKeyboardTrace record:@"accessory#%ld covered; no editing field to let go", (long)_barId];
    return;
  }
  /*
   * Handed over, not dismissed, when the arriving screen's composer is going
   * to take it. Its field claims first responder as its view enters the window,
   * inside the transition, and UIKit moves the keyboard from one field to the
   * other with the keys never leaving the screen. Dismissed here instead, they
   * could not come back before the transition ends: UIKit holds responder
   * events for its duration.
   */
  UIView *arrivingView = arriving.isViewLoaded ? arriving.view : nil;
  if ([EXPKeyboardAccessoryComponentView _barInScreen:arrivingView].asksForKeyboardOnArrival) {
    [EXPKeyboardTrace record:@"accessory#%ld covered; keyboard left for the arriving composer", (long)_barId];
    return;
  }
  // Unanimated: an ordinary resign slides the keyboard down in its own window,
  // across the screen arriving from the right. Resigned here the keys are gone
  // on the next frame and the bar takes its resting height in the same pass.
  __block BOOL letGo = NO;
  [UIView performWithoutAnimation:^{
    letGo = [field resignFirstResponder];
  }];
  [EXPKeyboardTrace record:@"accessory#%ld covered; field let go=%d (no animation)", (long)_barId, (int)letGo];
}

/**
 * The drag that dismisses the keyboard begins when it reaches the BAR, not the
 * keys: the guide's dismiss padding is the bar's content height, so the region
 * UIKit measures a transcript drag against is the composer's own footprint.
 */
- (void)_updateDismissPadding
{
  if (@available(iOS 17.0, *)) {
    _contentView.superview.keyboardLayoutGuide.keyboardDismissPadding = MAX(_contentView.contentHeight, 0);
  }
}

/**
 * Which anchor holds.
 *
 * `keyboardLayoutGuide` follows THE keyboard, not "this screen's keyboard" —
 * every view in the window gets the same answer — so a bar follows the guide
 * only while the keyboard is its own: from the moment a field inside it begins
 * editing until the keyboard has gone (`UIKeyboardDidHide`), so it follows the
 * keys down and lands where the guide rests, on the screen's bottom edge.
 * A keyboard rising or moving for someone else's field docks it at once.
 */
- (void)_setShouldDockToKeyboard:(BOOL)shouldDock why:(NSString *)why
{
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
  // The reserve — and the docked fraction JavaScript lays out from — is
  // otherwise re-derived only while the keyboard MOVES. A bar that changes
  // anchor under a keyboard that stays put (its field lost or regained the
  // keyboard) kept its old reserve and its old shape until the next motion.
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
  for (NSNotificationName name in @[ UITextViewTextDidBeginEditingNotification, UITextFieldTextDidBeginEditingNotification ]) {
    [center addObserver:self selector:@selector(_fieldDidBeginEditing:) name:name object:nil];
  }
  for (NSNotificationName name in @[ UITextViewTextDidEndEditingNotification, UITextFieldTextDidEndEditingNotification ]) {
    [center addObserver:self selector:@selector(_fieldDidEndEditing:) name:name object:nil];
  }
  [center addObserver:self selector:@selector(_keyboardDidHide:) name:UIKeyboardDidHideNotification object:nil];
  [center addObserver:self selector:@selector(_keyboardWillShow:) name:UIKeyboardWillShowNotification object:nil];
  [center addObserver:self selector:@selector(_keyboardWillShow:) name:UIKeyboardWillChangeFrameNotification object:nil];
}

- (void)_fieldDidBeginEditing:(NSNotification *)notification
{
  UIView *field = [notification.object isKindOfClass:UIView.class] ? notification.object : nil;
  if (field == nil || ![field isDescendantOfView:_contentView]) {
    return;
  }
  [self _setShouldDockToKeyboard:YES why:@"field began editing"];
}

/**
 * Only recorded: the bar stays docked until the keyboard has actually gone, so
 * it lands docked with the keys rather than jumping there ahead of them. A
 * device report of a keyboard that vanished needs the frames of whoever ended
 * the editing, which is the one thing this pins.
 */
- (void)_fieldDidEndEditing:(NSNotification *)notification
{
  UIView *field = [notification.object isKindOfClass:UIView.class] ? notification.object : nil;
  if (field == nil || ![field isDescendantOfView:_contentView] || ![EXPKeyboardTrace isRecording]) {
    return;
  }
  [EXPKeyboardTrace recordPinned:@"editing ENDED on %@ %p in accessory#%ld win=%d <- %@", NSStringFromClass(field.class),
                                 field, (long)_barId, (int)(field.window != nil), EXPKeyboardTrace.callers];
}

- (void)_keyboardDidHide:(NSNotification *)notification
{
  if ([self _editingFieldInBar] == nil) {
    [self _setShouldDockToKeyboard:NO why:@"keyboard hidden"];
  }
}

/** A keyboard rising or moving for a field that is not in this bar. */
- (void)_keyboardWillShow:(NSNotification *)notification
{
  if ([self _editingFieldInBar] != nil || _contentView.window == nil) {
    return;
  }
  const CGRect end = [notification.userInfo[UIKeyboardFrameEndUserInfoKey] CGRectValue];
  const CGRect screen = _contentView.window.screen.bounds;
  if (CGRectGetMinY(end) < CGRectGetMaxY(screen) - 0.5) {
    [self _setShouldDockToKeyboard:NO why:@"someone else's keyboard"];
  }
}

/**
 * The view inside the bar that is first responder, asked of UIKit itself
 * rather than remembered: two screens' fields can each have begun editing.
 */
- (nullable UIView *)_editingFieldInBar
{
  return EXPFirstDescendant(_contentView, ^BOOL(UIView *view) {
    return view.isFirstResponder;
  }, nil);
}

- (BOOL)asksForKeyboardOnArrival
{
  return EXPFirstDescendant(_contentView, ^BOOL(UIView *view) {
    return [view isKindOfClass:EXPElementTextAreaComponentView.class] &&
        ((EXPElementTextAreaComponentView *)view).asksForKeyboardOnArrival;
  }, nil) != nil;
}

/** The composer bar in a screen's view, if it has one. A composer is never inside a scroll view, so those are not searched. */
+ (nullable EXPKeyboardAccessoryComponentView *)_barInScreen:(nullable UIView *)screenView
{
  return (EXPKeyboardAccessoryComponentView *)EXPFirstDescendant(screenView, ^BOOL(UIView *view) {
    return [view isKindOfClass:EXPKeyboardAccessoryComponentView.class];
  }, ^BOOL(UIView *view) {
    return ![view isKindOfClass:UIScrollView.class];
  });
}

/** Whether the keyboard now on screen belongs to THIS bar's screen. */
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
  // Decided BEFORE super: it replaces `_props`, and after a recycle that was the
  // old props object's last owner.
  const BOOL backgroundChanged =
      newViewProps.backgroundColor != static_cast<const ViewProps &>(*_props).backgroundColor;
  const BOOL fillChanged = (static_cast<const ExpoKeyboardAccessoryProps &>(*props).appleVisualEffectFade > 0) !=
      (static_cast<const ExpoKeyboardAccessoryProps &>(*_props).appleVisualEffectFade > 0);

  [super updateProps:props oldProps:oldProps];

  const auto &accessoryProps = static_cast<const ExpoKeyboardAccessoryProps &>(*props);
  _contentView.reservesBottom = accessoryProps.automaticInsets;

  /*
   * The bar's own background is carried ACROSS to the view that is drawn: this
   * view is a hidden handle. It goes to the SURFACE rather than to the content
   * view's layer once there is a fade to apply, because a layer's background is
   * drawn below the mask that softens the top edge.
   */
  const BOOL fillGoesToTheSurface = accessoryProps.appleVisualEffectFade > 0;
  if (backgroundChanged || fillChanged || fillGoesToTheSurface) {
    _contentView.backgroundColor =
        fillGoesToTheSurface ? nil : RCTUIColorFromSharedColor(newViewProps.backgroundColor);
  }

  [_contentView setMaterial:[NSString stringWithUTF8String:accessoryProps.appleVisualEffect.c_str()]
                       fade:accessoryProps.appleVisualEffectFade
                       fill:fillGoesToTheSurface ? RCTUIColorFromSharedColor(newViewProps.backgroundColor)
                                                : nil
                   strength:accessoryProps.appleVisualEffectOpacity];

  // A handle, not a box: leaving it visible would paint the bar twice.
  self.hidden = YES;
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  // Only the height is React's to say; the width is the screen's and the
  // position is the guide's. The FRAME, not the content frame: the content frame
  // is the box inside the padding, and a bar with `paddingVertical: 8` reported
  // itself 16 points shorter than it is.
  const CGFloat height = RCTCGRectFromRect(layoutMetrics.frame).size.height;
  if (height != _contentView.contentHeight) {
    _contentView.contentHeight = height;
    [self _updateDismissPadding];
    // A taller or shorter bar is a different obstruction for the transcript.
    [_insets obstructingViewsDidChange];
  }
}

- (void)prepareForRecycle
{
  // A recycled bar has told nobody anything; see `_emittedReserve`.
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

/** The on-screen y of a point `offsetFromTop` below a view's top, this frame; NaN for a view in no window. */
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

/**
 * Publishes how docked this bar is, whenever the answer changes, from the
 * per-frame sampler: the reserve IS the docked-ness, and a quarter of a point
 * is finer than anything an author can lay out against.
 */
- (void)_emitDockChange
{
  const auto emitter = std::static_pointer_cast<const ExpoKeyboardAccessoryEventEmitter>(_eventEmitter);
  if (emitter == nullptr) {
    return;
  }
  const CGFloat reserve = _contentView.bottomReserve;
  const CGFloat safeArea = _contentView.appSafeArea;
  if (fabs(reserve - _emittedReserve) < 0.25) {
    return;
  }
  _emittedReserve = reserve;
  ExpoKeyboardDockEvent event;
  event.reserve = reserve;
  // A safe area of zero is a screen with no home indicator: docked or not,
  // with no strip to measure the transition against.
  event.docked = safeArea > 0 ? std::clamp<Float>(reserve / safeArea, 0, 1) : (reserve > 0 ? 1 : 0);
  emitter->onDockChange(event);
}

/**
 * The top of the bar in the window, MEASURED on the presentation tree this
 * frame: the line content must not go below. The reserve is re-derived here
 * too, because this is the only thing that runs every frame the keyboard moves.
 */
- (CGFloat)topInWindowForObstructionHeight:(CGFloat)obstructionHeight
{
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

/** The dock reading, once per change; and a bar that owns the keyboard yet is off screen, which is never right. */
- (void)_traceDockAt:(CGFloat)top forObstructionHeight:(CGFloat)obstructionHeight inWindow:(UIWindow *)appWindow
{
  const CGFloat modelTop = CGRectGetMinY([_contentView convertRect:_contentView.bounds toView:appWindow]);
  const CGFloat winHeight = CGRectGetHeight(appWindow.bounds);
  const CGFloat barHeight = CGRectGetHeight(_contentView.bounds);
  const CGFloat barBottom = [self _edgeOnScreenNow:barHeight ofView:_contentView];
  NSString *bar = [NSString stringWithFormat:@"accessory#%ld", (long)_barId];
  [EXPKeyboardTrace recordChanged:[bar stringByAppendingString:@" dock"]
                           pinned:NO
                           format:@"dock top=%.1f resting=%.1f err=%.1f | guideWouldSay=%.1f barH=%.1f content=%.1f "
                                  @"reserve=%.1f winH=%.1f barBottom=%.1f shouldDock=%d",
                                  top, modelTop, top - modelTop, winHeight - obstructionHeight, barHeight,
                                  _contentView.contentHeight, _contentView.bottomReserve, winHeight, barBottom,
                                  (int)_shouldDockToKeyboard];
  if ([self _ownsTheKeyboard] && (top >= winHeight - 0.5 || barBottom <= 0.5)) {
    [EXPKeyboardTrace recordChanged:[bar stringByAppendingString:@" off screen"]
                             pinned:YES
                             format:@"%@ bar OFF SCREEN (top %.1f, bottom %.1f, screen %.1f)", bar, top, barBottom, winHeight];
  }
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end
