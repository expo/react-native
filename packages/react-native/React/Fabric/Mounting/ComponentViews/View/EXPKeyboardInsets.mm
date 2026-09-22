/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPKeyboardInsets.h"

#import <objc/runtime.h>

/**
 * The keyboard is idle far more often than it moves. Sampling every frame
 * forever would keep a display link — and therefore the main run loop — awake
 * for nothing, so the link runs only while something is in flight and parks
 * itself once the geometry has held still for a few frames.
 *
 * Three frames rather than one: the spring's tail moves by less than a tenth of
 * a point per frame before it settles, and a single stable frame is reachable
 * mid-flight when the curve crosses a rounding boundary.
 */
static const NSInteger EXPKeyboardStableFramesBeforeParking = 3;

/**
 * How long after being woken the link keeps sampling even if nothing has moved.
 *
 * A wake arrives BEFORE the motion it predicts: `keyboardWillShow` is posted
 * while the keyboard is still at rest, so the first frames after it are
 * legitimately stable. Parking on that stability would switch the sampler off at
 * the exact moment the animation starts.
 *
 * The measured spring settles in a little over 0.4s, so this is that with room
 * to spare. A finger-driven drag can pause for longer than this, but that case
 * re-wakes the link on every scroll callback rather than relying on the grace.
 */
static const CFTimeInterval EXPKeyboardGraceAfterWake = 0.6;

@interface EXPKeyboardInsets ()
/** The screen's view this sampler belongs to; the follower lives in it, on its guide. */
@property (nonatomic, weak) UIView *host;
@property (nonatomic, strong) UIView *follower;
@property (nonatomic, strong, nullable) CADisplayLink *link;
@end

/*
 * The keyboard's window, weakly, for the whole process.
 *
 * Static rather than per-instance: an instance is created when something first
 * asks about a window, which is long after the keyboard's window became visible,
 * so a per-instance observer never sees the notification it needs. There is one
 * keyboard, and the observer for it has to be running before anyone asks.
 */
static __weak UIWindow *EXPKeyboardWindow = nil;

@implementation EXPKeyboardInsets {
  NSHashTable<id<EXPKeyboardInsetObserving>> *_observers;
  NSHashTable<id<EXPKeyboardObstructingView>> *_obstructingViews;
  EXPKeyboardGeometry _geometry;
  // The whole obstruction's top as of the last frame anyone was told about: the
  // keyboard and the views resting on it, see `-_tick`
  CGFloat _obstructionTop;
  // The ramped answer and the frame it was last advanced on, see `-obstructionTopInWindowForObstruction:`
  CGFloat _reportedTop;
  CFTimeInterval _rampedAtFrame;
  // When UIKit says the dismissal it is running will be over; zero when none is
  CFTimeInterval _dismissalEndsAt;
  // The link parks after a few still frames past the grace period, unless a
  // tracker holds it through `beginTracking`/`endTracking`
  NSInteger _stableFrames;
  CFTimeInterval _wokeAt;
  NSInteger _holds;
  // The one-frame prediction in points of obstruction, positive while growing;
  // cleared the moment the sampler stops advancing it
  CGFloat _advance;
  // The obstructing views' answer at the last frame and whether it moved,
  // decided once per frame so every reader in it hears the same answer
  CGFloat _lastObstructingViewTop;
  CFTimeInterval _obstructingViewSampledAtFrame;
  BOOL _obstructingViewIsMoving;
  // The shown height at the last sample and when, which `-_advanceFor:`
  // extrapolates from; a sample older than a tenth of a second is not extrapolated
  CGFloat _shownHeight;
  CFTimeInterval _shownAt;
}

+ (UIWindow *)keyboardWindow
{
  return EXPKeyboardWindow;
}

+ (void)load
{
  [NSNotificationCenter.defaultCenter
      addObserverForName:UIWindowDidBecomeVisibleNotification
                  object:nil
                   queue:NSOperationQueue.mainQueue
              usingBlock:^(NSNotification *note) {
                UIWindow *window = [note.object isKindOfClass:UIWindow.class] ? note.object : nil;
                // Every window posts this, so the class is the filter
                if (window != nil && [NSStringFromClass(window.class) containsString:@"RemoteKeyboard"]) {
                  EXPKeyboardWindow = window;
                }
              }];
}

// The view a sampler is shared through: the nearest view controller's view
static UIView *EXPKeyboardSamplerHostForView(UIView *view)
{
  UIResponder *responder = view.nextResponder;
  while (responder != nil && ![responder isKindOfClass:UIViewController.class]) {
    responder = responder.nextResponder;
  }
  UIView *host = ((UIViewController *)responder).viewIfLoaded;
  return host ?: view.window.rootViewController.view ?: view.window;
}

+ (instancetype)insetsForView:(UIView *)view
{
  UIView *host = EXPKeyboardSamplerHostForView(view);
  static const void *kKey = &kKey;
  EXPKeyboardInsets *existing = objc_getAssociatedObject(host, kKey);
  if (existing != nil) {
    return existing;
  }
  EXPKeyboardInsets *insets = [[self alloc] initWithHost:host];
  objc_setAssociatedObject(host, kKey, insets, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  return insets;
}

- (instancetype)initWithHost:(UIView *)host
{
  if (self = [super init]) {
    _host = host;
    static NSInteger nextIdentifier = 1;
    _identifier = nextIdentifier++;
    _observers = [NSHashTable weakObjectsHashTable];
    _obstructingViews = [NSHashTable weakObjectsHashTable];

    _lastObstructingViewTop = CGFLOAT_MAX;

    // An empty view whose only job is to be animated by UIKit with the keyboard
    _follower = [[UIView alloc] init];
    _follower.userInteractionEnabled = NO;
    _follower.hidden = YES;
    _follower.translatesAutoresizingMaskIntoConstraints = NO;

    // The guide must belong to a view inside the hierarchy: a UIWindow's own
    // `keyboardLayoutGuide` activates without complaint and never moves
    [self _hostFollowerIn:host];

    // The notifications do not describe the motion, which the link measures,
    // but they say it is about to start
    NSNotificationCenter *nc = [NSNotificationCenter defaultCenter];
    [nc addObserver:self selector:@selector(_wake) name:UIKeyboardWillChangeFrameNotification object:nil];
    // The show and the hide also bound the ramp, see `-obstructionTopInWindowForObstruction:`
    [nc addObserver:self selector:@selector(_willShow) name:UIKeyboardWillShowNotification object:nil];
    [nc addObserver:self selector:@selector(_willHide:) name:UIKeyboardWillHideNotification object:nil];
  }
  return self;
}

// Attaches the follower to the host's guide; re-attachable because the fallback
// host before a root view controller exists is the window, whose guide never
// moves, and an iPad can replace its root while running
- (void)_hostFollowerIn:(UIView *)host
{
  if (_follower.superview == host) {
    return;
  }
  [_follower removeFromSuperview];
  [host addSubview:_follower];

  UIKeyboardLayoutGuide *guide = host.keyboardLayoutGuide;
  guide.followsUndockedKeyboard = NO;
  // An undocked or floating iPad keyboard is not a bottom obstruction; the guide
  // then rests on the bottom safe area, and the obstruction reports that alone
  [NSLayoutConstraint activateConstraints:@[
    [_follower.topAnchor constraintEqualToAnchor:guide.topAnchor],
    [_follower.bottomAnchor constraintEqualToAnchor:guide.bottomAnchor],
    [_follower.leadingAnchor constraintEqualToAnchor:guide.leadingAnchor],
    [_follower.trailingAnchor constraintEqualToAnchor:guide.trailingAnchor],
  ]];
  _geometry = [self sample];
}

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  [_link invalidate];
}

- (EXPKeyboardGeometry)geometry
{
  return _geometry;
}

// A dismissal has started, and this is how long UIKit says it will take: the
// only thing taken from the notification, since its frame and curve drift from
// the animation. Zero means UIKit is not animating and there is nothing to ramp over.
- (void)_willHide:(NSNotification *)notification
{
  const NSTimeInterval duration = [notification.userInfo[UIKeyboardAnimationDurationUserInfoKey] doubleValue];
  _dismissalEndsAt = duration > 0 ? CACurrentMediaTime() + duration : 0;
  [self _wake];
}

// A show cancels any ramp a dismissal left running: a show can be measured
- (void)_willShow
{
  _dismissalEndsAt = 0;
  [self _wake];
}

- (void)beginTracking
{
  _holds++;
  [self _wake];
}

- (void)endTracking
{
  if (_holds > 0) {
    _holds--;
  }
  // Not parked here: the gesture that ended usually starts the keyboard's own settling animation
  _wokeAt = CACurrentMediaTime();
}

- (void)addObserver:(id<EXPKeyboardInsetObserving>)observer
{
  [_observers addObject:observer];
  // Told where things are, not only where they go next: the tick publishes on
  // change, and an observer registering under an unchanged obstruction would
  // otherwise hear nothing until the keyboard next moves
  [observer keyboardGeometryDidChange:_geometry];
  [self _wake];
}

- (void)removeObserver:(id<EXPKeyboardInsetObserving>)observer
{
  [_observers removeObject:observer];
}

- (void)addObstructingView:(id<EXPKeyboardObstructingView>)view
{
  [_obstructingViews addObject:view];
}

- (void)removeObstructingView:(id<EXPKeyboardObstructingView>)view
{
  [_obstructingViews removeObject:view];
}

- (void)obstructingViewsDidChange
{
  [self _wake];
}

/**
 * The top of everything obstructing the bottom edge. A docked view's answer wins
 * whenever one is given, and the guide is the fallback, not the minimum of the
 * two: the guide summarises whatever accessory UIKit currently has installed,
 * which can belong to a screen navigated away from, while an obstructing view
 * reports its own top from the presentation tree and declines when it is not on
 * a visible screen. An obstructing view always sits on top of the keys, so its
 * top is the obstruction's top by construction.
 */
- (CGFloat)_measuredObstructionTopForObstruction:(CGFloat)obstructionHeight
{
  UIWindow *window = _follower.window;
  CGFloat top = CGFLOAT_MAX;
  for (id<EXPKeyboardObstructingView> view in [_obstructingViews allObjects]) {
    // A view not on the obstruction, or not on a visible screen, answers `CGFLOAT_MAX`
    top = MIN(top, [view topInWindowForObstructionHeight:obstructionHeight]);
  }
  if (top != CGFLOAT_MAX) {
    // Moved by the same prediction as the keyboard, since the view reads its
    // presentation tree and is behind by what the keyboard is behind by; the
    // fallback below is derived from an already predicted height. Only while
    // the view is moving: the guide can run a phantom animation while the keys
    // stay put, and a resting view must not be predicted along.
    const CFTimeInterval frame = _link != nil ? _link.timestamp : CACurrentMediaTime();
    if (frame != _obstructingViewSampledAtFrame) {
      _obstructingViewSampledAtFrame = frame;
      _obstructingViewIsMoving = _lastObstructingViewTop != CGFLOAT_MAX && fabs(top - _lastObstructingViewTop) > 0.01;
      _lastObstructingViewTop = top;
    }
    return _obstructingViewIsMoving ? top - _advance : top;
  }
  _lastObstructingViewTop = CGFLOAT_MAX;
  _obstructingViewIsMoving = NO;
  return CGRectGetHeight(window.bounds) - MAX(obstructionHeight, 0);
}

/**
 * The obstruction, ramped across the one phase where it cannot be measured.
 *
 * Everywhere else this is the measurement: the keyboard's notifications describe
 * a spring with a cubic and drift from it, so the position is read from the
 * presentation layer every frame. The end of a dismissal is the exception: once
 * the finger lifts, the completion runs in the keyboard's own process and this
 * process's presentation tree jumps to rest while the keys are still visibly on
 * screen. The notification's duration bounds a linear ramp over that window;
 * outside it the measurement is returned untouched.
 */
- (CGFloat)obstructionTopInWindowForObstruction:(CGFloat)obstructionHeight
{
  const CGFloat measured = [self _measuredObstructionTopForObstruction:obstructionHeight];
  const CFTimeInterval now = CACurrentMediaTime();
  if (now >= _dismissalEndsAt || _reportedTop == 0) {
    _reportedTop = measured;
    return measured;
  }
  // Advanced once per frame, not per call: every observer asks, and then the tick
  const CFTimeInterval frame = _link != nil ? _link.timestamp : now;
  if (frame != _rampedAtFrame) {
    _rampedAtFrame = frame;
    // In the link's own frames: at 120 Hz there are twice as many left as at 60
    const CFTimeInterval perFrame =
        (_link != nil && _link.targetTimestamp > now) ? _link.targetTimestamp - now : 1.0 / 60.0;
    const CGFloat framesLeft = MAX((_dismissalEndsAt - now) / perFrame, 1);
    _reportedTop += (measured - _reportedTop) / framesLeft;
  }
  return _reportedTop;
}

// Reads what is on screen now: the presentation layer, since the model frame on
// show has already jumped to its destination; before the first draw the model is all there is
- (EXPKeyboardGeometry)sample
{
  CALayer *presentation = _follower.layer.presentationLayer;
  return [self _geometryForFollowerFrame:presentation != nil ? presentation.frame : _follower.frame];
}

// Where the follower has been asked to be, which on show is the destination and
// the bound a one-frame prediction needs
- (EXPKeyboardGeometry)_destination
{
  return [self _geometryForFollowerFrame:_follower.frame];
}

- (EXPKeyboardGeometry)_geometryForFollowerFrame:(CGRect)frame
{
  UIWindow *window = _host.window;
  if (window == nil) {
    return (EXPKeyboardGeometry){0, 0};
  }
  // A follower not yet laid out has an empty frame at the origin, which would
  // read as a keyboard the height of the window; not measured yet means at rest
  if (CGRectIsEmpty(frame)) {
    const CGFloat safeArea = MAX(window.safeAreaInsets.bottom, 0);
    return (EXPKeyboardGeometry){safeArea, safeArea};
  }
  // The follower lives in the screen's view, so its frame is in that view's space
  CGRect inWindow = [_follower.superview convertRect:frame toView:window];
  return EXPKeyboardGeometryFromFollower(inWindow, CGRectGetHeight(window.bounds), window.safeAreaInsets.bottom);
}

EXPKeyboardGeometry
EXPKeyboardGeometryFromFollower(CGRect followerInWindow, CGFloat windowHeight, CGFloat safeAreaBottom)
{
  EXPKeyboardGeometry geometry = {0, 0};
  geometry.safeArea = MAX(safeAreaBottom, 0);
  // Never less than the safe area: the height is the whole obstruction, keys or
  // strip, and a guide with `usesBottomSafeArea = NO` rests at the window's edge.
  // The floor also covers the follower sitting below the window at the end of a hide.
  geometry.height = MAX(windowHeight - CGRectGetMinY(followerInWindow), geometry.safeArea);
  return geometry;
}

- (void)_wake
{
  UIView *host = _host;
  if (host != nil) {
    [self _hostFollowerIn:host];
  }
  _wokeAt = CACurrentMediaTime();
  if (_link != nil) {
    _stableFrames = 0;
    return;
  }
  _stableFrames = 0;
  // A velocity across a park is meaningless, so the first tick of a run measures
  // and the second predicts; the wake arrives before the motion
  _shownAt = 0;
  _advance = 0;
  _link = [CADisplayLink displayLinkWithTarget:self selector:@selector(_tick)];
  // At the display's rate: a display link defaults to the app's allowed rate,
  // 60 on a ProMotion phone without `CADisableMinimumFrameDurationOnPhone`,
  // while the keyboard's own window rises at 120. The minimum is half so the
  // system may still drop the rate.
  const float maximum = (float)host.window.screen.maximumFramesPerSecond;
  if (maximum > 0) {
    _link.preferredFrameRateRange = CAFrameRateRangeMake(maximum / 2, maximum, maximum);
  }
  [_link addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
}

/**
 * How much further the obstruction will have moved by the frame being drawn.
 * `presentationLayer` is the frame already on screen and a display link's work
 * lands on the next one, so passing the reading through puts everything that
 * follows the keyboard a frame behind it. The prediction is the last frame's
 * velocity over the interval being drawn for, bounded by the destination, which
 * the model frame holds from the animation's first frame; under a finger the
 * remaining travel is zero and the prediction collapses to nothing.
 */
- (CGFloat)_advanceFor:(EXPKeyboardGeometry)shown
{
  const CFTimeInterval now = _link.timestamp;
  const CFTimeInterval ahead = _link.targetTimestamp - now;
  const CFTimeInterval since = now - _shownAt;
  const CGFloat moved = shown.height - _shownHeight;
  // A tenth of a second bounds the pair to consecutive frames of one run
  const BOOL usable = _shownAt > 0 && since > 0 && since < 0.1 && ahead > 0;
  _shownHeight = shown.height;
  _shownAt = now;
  if (!usable) {
    return 0;
  }
  const CGFloat remaining = [self _destination].height - shown.height;
  const CGFloat predicted = moved / since * ahead;
  return MAX(MIN(predicted, MAX(remaining, (CGFloat)0)), MIN(remaining, (CGFloat)0));
}

- (void)_tick
{
  const EXPKeyboardGeometry shown = [self sample];
  _advance = [self _advanceFor:shown];
  EXPKeyboardGeometry next = shown;
  next.height += _advance;
  // The obstruction moved, not just the keyboard: the guide and a docked bar are
  // not on the same clock, and the end of an interactive dismissal is made of
  // frames in which only the bar moves
  const CGFloat nextTop = [self obstructionTopInWindowForObstruction:next.height];
  BOOL moved = fabs(next.height - _geometry.height) > 0.01 || fabs(next.safeArea - _geometry.safeArea) > 0.01 ||
      fabs(nextTop - _obstructionTop) > 0.01;

  if (moved) {
    _stableFrames = 0;
    _geometry = next;
    _obstructionTop = nextTop;
    for (id<EXPKeyboardInsetObserving> observer in [_observers allObjects]) {
      [observer keyboardGeometryDidChange:next];
    }
    return;
  }

  // Nothing moved, so nothing is predicted: readers until the next tick get the measurement
  _advance = 0;

  // Park. An interactive drag starts with no notification to wake us, so
  // whatever begins one calls `beginTracking` when the finger goes down.
  if (_holds == 0 && ++_stableFrames >= EXPKeyboardStableFramesBeforeParking &&
      CACurrentMediaTime() - _wokeAt > EXPKeyboardGraceAfterWake) {
    [_link invalidate];
    _link = nil;
  }
}

@end
