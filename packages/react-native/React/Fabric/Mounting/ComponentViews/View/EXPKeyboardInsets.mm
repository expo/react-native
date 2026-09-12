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
  /**
   * The whole obstruction's top as of the last frame anyone was told about.
   *
   * Kept beside the geometry because it is a different quantity: the geometry is
   * the keyboard, this is the keyboard AND the views resting on it. See `-_tick`.
   */
  CGFloat _obstructionTop;
  /** The ramped answer, and the frame it was last advanced on. See `-obstructionTopInWindowForObstruction:`. */
  CGFloat _reportedTop;
  CFTimeInterval _rampedAtFrame;
  /** When UIKit says the dismissal it is running will be over. Zero when none is. */
  CFTimeInterval _dismissalEndsAt;
  /**
   * When the display link parks. It runs while anything is changing and for a
   * grace period after it was last woken, then stops after a few frames in
   * which nothing moved — unless a tracker holds it: `beginTracking` adds a
   * hold, `endTracking` removes one, and a held sampler never parks.
   */
  NSInteger _stableFrames;
  CFTimeInterval _wokeAt;
  NSInteger _holds;
  /**
   * The one-frame prediction, and the sample it was built from. See `-_tick`.
   *
   * `_advance` is in points of obstruction: positive while the obstruction is
   * growing, and it is what every reader this frame is moved BY, so it has to be
   * cleared the moment the sampler stops advancing it.
   */
  CGFloat _advance;
  /**
   * The obstructing views' answer at the last frame, and whether it moved: their
   * top is predicted only while it is moving. Decided once per FRAME, because
   * every observer and then the tick ask within the same one and must hear the
   * same answer.
   */
  CGFloat _lastObstructingViewTop;
  CFTimeInterval _obstructingViewSampledAtFrame;
  BOOL _obstructingViewIsMoving;
  /**
   * The keyboard's shown height at the last sample and when it was taken, which
   * is what the one-frame prediction in `-_advanceFor:` extrapolates from. A
   * sample older than a tenth of a second is not extrapolated: the keyboard
   * was still, or this is a fresh wake.
   */
  CGFloat _shownHeight;
  CFTimeInterval _shownAt;
}

+ (UIWindow *)keyboardWindow
{
  return EXPKeyboardWindow;
}

/*
 * Watching from `+load`, which is what makes this reliable.
 *
 * The keyboard's window becomes visible the first time a field is focused, and
 * that can be before anything in this file has been instantiated — an observer
 * installed when the first instance is made would miss it, and there is no
 * second announcement.
 */
+ (void)load
{
  [NSNotificationCenter.defaultCenter
      addObserverForName:UIWindowDidBecomeVisibleNotification
                  object:nil
                   queue:NSOperationQueue.mainQueue
              usingBlock:^(NSNotification *note) {
                UIWindow *window = [note.object isKindOfClass:UIWindow.class] ? note.object : nil;
                // Every window in the app posts this, so the class is the
                // filter. Weak: the keyboard's window is UIKit's, and holding it
                // would keep alive something we do not own.
                if (window != nil && [NSStringFromClass(window.class) containsString:@"RemoteKeyboard"]) {
                  EXPKeyboardWindow = window;
                }
              }];
}

/** The view a sampler is shared through: the nearest view controller's view. See the header. */
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

    // An empty, untouchable view whose only job is to be animated by UIKit as
    // part of the keyboard's own animation. It draws nothing and takes no hits.
    _follower = [[UIView alloc] init];
    _follower.userInteractionEnabled = NO;
    _follower.hidden = YES;
    _follower.translatesAutoresizingMaskIntoConstraints = NO;

    // The guide has to belong to a view inside the hierarchy, not to the window.
    // A UIWindow has a `keyboardLayoutGuide` like any other view and it compiles
    // and activates without complaint, but it never moves: measured, its frame
    // stays at the origin through an entire show animation while the same
    // constraints against a view in the hierarchy track the keyboard exactly.
    [self _hostFollowerIn:host];

    // The notifications are useless as a description of the motion, but they are
    // a reliable signal that motion is ABOUT to start — which is all they are
    // used for here: waking the link that does the actual measuring, and giving
    // the follower a chance to re-attach if the window has grown a root view
    // controller since this observer was made.
    NSNotificationCenter *nc = [NSNotificationCenter defaultCenter];
    [nc addObserver:self selector:@selector(_wake) name:UIKeyboardWillChangeFrameNotification object:nil];
    // The show and the hide carry something this class uses beyond the wake, in
    // opposite directions — see `-obstructionTopInWindowForObstruction:`.
    [nc addObserver:self selector:@selector(_willShow) name:UIKeyboardWillShowNotification object:nil];
    [nc addObserver:self selector:@selector(_willHide:) name:UIKeyboardWillHideNotification object:nil];
  }
  return self;
}

/**
 * Attach the follower to the view whose guide can actually move.
 *
 * Re-attachable on purpose. The observer is created the first time anything asks
 * for it, which can be before the window has a root view controller — and the
 * fallback host is the window itself, whose own `keyboardLayoutGuide` never
 * moves at all. Left alone, an observer created a moment too early would report
 * a constant zero for the rest of its life. It also matters on iPad, where a
 * window's root can be replaced while the app is running.
 */
- (void)_hostFollowerIn:(UIView *)host
{
  if (_follower.superview == host) {
    return;
  }
  [_follower removeFromSuperview];
  [host addSubview:_follower];

  UIKeyboardLayoutGuide *guide = host.keyboardLayoutGuide;
  guide.followsUndockedKeyboard = NO;
  /*
   * An undocked or floating keyboard is not a bottom obstruction.
   *
   * On an iPad the keyboard can be split, undocked, or floated anywhere on the
   * screen, and there is then no honest answer to "how much of the bottom edge
   * does it cover" — content below it is fine, content behind it is not, and
   * neither is a function of the bottom inset. UIKit already takes this view:
   * the guide ignores such a keyboard and rests on the bottom safe area, so the
   * obstruction reports the safe area alone. Set explicitly so it survives
   * someone reasonably assuming the guide should follow the keyboard everywhere.
   */
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

/**
 * A dismissal has started, and this is how long UIKit says it will take.
 *
 * The only thing taken from the notification: not the frame it advertises, not
 * the curve, and not the geometry — those are the parts that drift, and the
 * whole class exists because of it. The duration is used to bound a ramp, and a
 * ramp that runs slightly long or short is still a ramp.
 *
 * A zero duration means UIKit is not animating — an app dismissing the keyboard
 * while backgrounded, or a rotation — and then there is nothing to ramp over and
 * the measurement should be taken as it is.
 */
- (void)_willHide:(NSNotification *)notification
{
  const NSTimeInterval duration =
      [notification.userInfo[UIKeyboardAnimationDurationUserInfoKey] doubleValue];
  _dismissalEndsAt = duration > 0 ? CACurrentMediaTime() + duration : 0;
  [self _wake];
}

/**
 * A show cancels any ramp a dismissal left running.
 *
 * Focusing something the instant after flicking the keyboard away is an ordinary
 * thing to do, and the ramp is only correct while the position cannot be
 * measured. A show CAN be measured — it tracks exactly — so leaving the ramp
 * armed would damp a perfectly good animation with a guess.
 */
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
  // Do not park here. The gesture that just ended is usually the start of the
  // keyboard's own settling animation, which still has to be followed.
  _wokeAt = CACurrentMediaTime();
}

- (void)addObserver:(id<EXPKeyboardInsetObserving>)observer
{
  [_observers addObject:observer];
  /*
   * Told where things ARE, not only where they go next. The tick publishes on
   * change, and a scroll view that registers while the obstruction happens to be
   * what it already was — the screen it came from had a bar the same height —
   * would otherwise hear nothing: its bottom inset stays at the safe area and
   * the newest message sits under the composer, until the keyboard next moves.
   * Measured at one hosting in nine. The Android `addListener` has always done
   * this.
   */
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
 * The top of everything obstructing the bottom edge.
 *
 * A DOCK's answer wins whenever one is given, and the guide is the fallback.
 * NOT the minimum of the two, because of what the guide reports: UIKit's summary
 * of whatever accessory it has CURRENTLY INSTALLED, which can belong to a screen
 * you have navigated away from. Measured on the chat, at rest, before the
 * keyboard has moved once — the guide says the obstruction is 133 points while
 * the bar on screen is 110, because the outgoing screen's bar is still installed
 * and its own home indicator strip is counted twice. The first frame of the first
 * keyboard animation corrects it, and the transcript steps backwards by
 * twenty-three points just as the keyboard begins to rise.
 *
 * An obstructing view cannot make that mistake: it reports where its own top
 * edge IS, from the presentation tree, and it declines to answer at all when it
 * is not on a visible screen. Taking the minimum lets the stale, larger answer
 * win — the minimum is only the right combination when both answers are about
 * the same keyboard.
 *
 * The guide still matters, and is still the answer when nothing rests on the
 * keyboard: it is the only thing that knows about the KEYS. An obstructing view
 * always sits on top of them, so wherever one answers, its top is the
 * obstruction's top by construction.
 */
- (CGFloat)_measuredObstructionTopForObstruction:(CGFloat)obstructionHeight
{
  UIWindow *window = _follower.window;
  CGFloat top = CGFLOAT_MAX;
  for (id<EXPKeyboardObstructingView> view in [_obstructingViews allObjects]) {
    // A view that is not on the obstruction — or not on a visible screen —
    // answers `CGFLOAT_MAX` and so cannot win this.
    top = MIN(top, [view topInWindowForObstructionHeight:obstructionHeight]);
  }
  if (top != CGFLOAT_MAX) {
    /*
     * Moved by the same prediction as the keyboard, because such a view moves
     * WITH the keyboard: it reads its own presentation tree, which is the frame
     * already on screen, so it is behind by exactly what the keyboard is behind
     * by. The fallback below needs no such correction — it is derived from a
     * height that has already been predicted by `-_tick`.
     *
     * And only WHILE it is moving. The prediction is the guide's velocity, and
     * the guide can move when the keys do not: a field that resigns and becomes
     * first responder again in one turn sends it on a phantom animation of
     * several hundred points while the keyboard stays exactly where it was.
     * A view whose own reading has not changed since the last sample is at
     * rest, and a resting view predicted by a moving guide is a transcript
     * that dips and recovers for no reason the reader can see.
     */
    const CFTimeInterval frame = _link != nil ? _link.timestamp : CACurrentMediaTime();
    if (frame != _obstructingViewSampledAtFrame) {
      _obstructingViewSampledAtFrame = frame;
      _obstructingViewIsMoving =
          _lastObstructingViewTop != CGFLOAT_MAX && fabs(top - _lastObstructingViewTop) > 0.01;
      _lastObstructingViewTop = top;
    }
    return _obstructingViewIsMoving ? top - _advance : top;
  }
  _lastObstructingViewTop = CGFLOAT_MAX;
  _obstructingViewIsMoving = NO;
  return CGRectGetHeight(window.bounds) - MAX(obstructionHeight, 0);
}

/**
 * The obstruction, RAMPED across the one phase where it cannot be measured.
 *
 * Everywhere else this is the measurement and nothing else, which is the whole
 * design of this class: the keyboard's notifications describe a spring with a
 * cubic and drift against the thing they are describing, so the position is read
 * from the presentation layer every frame instead.
 *
 * A dismissal ends outside that. Under the finger the keyboard's window is moved
 * in this process and the reading tracks it exactly, ten points a frame. The
 * moment the finger lifts, the completion is run by the keyboard's own process:
 * our presentation tree jumps to the resting value and stays there, while the
 * keys are visibly still on screen for another three frames. Traced on the
 * simulator, the bar's top goes 640 to 764 between two consecutive samples and
 * the scroll view's bottom inset goes 234 to 110 with it — a hundred and twenty
 * four points of transcript revealed in one frame, with two more messages
 * appearing while the keyboard is still there.
 *
 * So this is not a retreat to the notifications as a description of the motion.
 * It is using the ONE thing they say that is both true and otherwise unavailable
 * — that a dismissal is in flight, and for how long — to refuse to teleport
 * during it. Outside that window the measurement is returned untouched, so the
 * show animation, the drag, and every resting state are the measurement and
 * nothing else.
 *
 * Linear rather than eased, because what is being replaced is a step: the
 * difference between a ramp and the right curve is invisible next to that, and a
 * curve would be a second guess about motion this cannot see.
 */
- (CGFloat)obstructionTopInWindowForObstruction:(CGFloat)obstructionHeight
{
  const CGFloat measured = [self _measuredObstructionTopForObstruction:obstructionHeight];
  const CFTimeInterval now = CACurrentMediaTime();
  if (now >= _dismissalEndsAt || _reportedTop == 0) {
    _reportedTop = measured;
    return measured;
  }
  /*
   * Advanced once per FRAME, not once per call. Every observer asks this
   * question and the tick asks it again, so advancing per call would run the
   * ramp at the rate of whoever happened to be listening.
   */
  const CFTimeInterval frame = _link != nil ? _link.timestamp : now;
  if (frame != _rampedAtFrame) {
    _rampedAtFrame = frame;
    // In the link's own frames: at 120 Hz there are twice as many left as at 60.
    const CFTimeInterval perFrame =
        (_link != nil && _link.targetTimestamp > now) ? _link.targetTimestamp - now : 1.0 / 60.0;
    const CGFloat framesLeft = MAX((_dismissalEndsAt - now) / perFrame, 1);
    _reportedTop += (measured - _reportedTop) / framesLeft;
  }
  return _reportedTop;
}

/**
 * Reads what is on screen right now.
 *
 * The presentation layer is the animated value; `frame` would be the model one,
 * which on show has already jumped to its destination. When there is no
 * presentation layer yet — before the view has ever been drawn — the model value
 * is the honest answer rather than a guess.
 */
- (EXPKeyboardGeometry)sample
{
  CALayer *presentation = _follower.layer.presentationLayer;
  return [self _geometryForFollowerFrame:presentation != nil ? presentation.frame : _follower.frame];
}

/**
 * Where the follower has been ASKED to be, which on show is the destination.
 *
 * The model frame is at the end of the animation from its first frame — the
 * fact `-obstructionTopInWindowForObstruction:` exists to work around — and that
 * makes it exactly the bound a one-frame prediction needs. See `-_tick`.
 */
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
  // A follower that has not been laid out yet has an empty frame at the origin,
  // which would read as a keyboard the height of the window. That is the frame
  // a sampler made in `didMoveToWindow` sees. Not measured yet means at rest.
  if (CGRectIsEmpty(frame)) {
    const CGFloat safeArea = MAX(window.safeAreaInsets.bottom, 0);
    return (EXPKeyboardGeometry){safeArea, safeArea};
  }
  // The follower lives in the screen's view, so its frame is in that view's space.
  CGRect inWindow = [_follower.superview convertRect:frame toView:window];
  return EXPKeyboardGeometryFromFollower(
      inWindow, CGRectGetHeight(window.bounds), window.safeAreaInsets.bottom);
}

EXPKeyboardGeometry
EXPKeyboardGeometryFromFollower(CGRect followerInWindow, CGFloat windowHeight, CGFloat safeAreaBottom)
{
  EXPKeyboardGeometry geometry = {0, 0};
  geometry.safeArea = MAX(safeAreaBottom, 0);
  // Never less than the safe area: the height is the WHOLE obstruction, keys or
  // strip, and a guide the bar has set `usesBottomSafeArea = NO` on rests at the
  // window's bottom edge rather than the strip's top. The floor also covers the
  // follower sitting below the window between the moment the keyboard is asked
  // to hide and the moment the guide stops moving, which would otherwise read
  // downstream as a scroll view that needs its content pushed DOWN.
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
  // and the second one predicts. Nothing is lost: the wake arrives before the
  // motion it predicts, so there is always a fresh pair by the time it moves.
  _shownAt = 0;
  _advance = 0;
  _link = [CADisplayLink displayLinkWithTarget:self selector:@selector(_tick)];
  /*
   * At the DISPLAY's rate, not the default one.
   *
   * A display link left to itself runs at the rate the app is allowed to render
   * at, and on a ProMotion iPhone an app is allowed 60 until its Info.plist says
   * `CADisableMinimumFrameDurationOnPhone`. The keyboard's own window is not so
   * limited, so the keys rise at 120 while everything following them is sampled
   * at 60 — which is half the frames, each twice as large a step, and reads as
   * the content stuttering a frame behind the keyboard.
   *
   * Asking for the screen's maximum is right in both cases: it is 60 on a screen
   * that is 60, and on one that is 120 it is 120 as soon as the app has opted in.
   * The minimum is half of it so the system may still drop the rate when nothing
   * is moving fast, which is the whole point of a range.
   */
  const float maximum = (float)host.window.screen.maximumFramesPerSecond;
  if (maximum > 0) {
    _link.preferredFrameRateRange = CAFrameRateRangeMake(maximum / 2, maximum, maximum);
  }
  [_link addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
}

/**
 * How much further the obstruction will have moved by the frame being drawn.
 *
 * `presentationLayer` is the frame ALREADY ON SCREEN, and work done in a display
 * link callback lands on the NEXT one. Passing the reading straight through
 * therefore puts everything that follows the keyboard exactly one frame behind
 * it for the whole animation, and one frame is not a small quantity here: traced
 * on a device, the obstruction grows by up to 48 points between two samples at
 * 60Hz. That is 48 points of transcript left under the keys, catching up
 * afterwards — the content running a frame behind the keyboard it follows.
 *
 * The prediction is the last frame's velocity carried across the interval the
 * display link says it is drawing for, and it is BOUNDED BY THE DESTINATION: the
 * follower's model frame is at the end of the animation from its first frame —
 * the very fact this class exists to work around — so predicting past it is
 * never right, and a spring that is decelerating would otherwise overshoot every
 * frame of its tail.
 *
 * That bound is also what makes this safe under a finger. An interactive drag
 * has no animation: the model frame IS where the finger has put it, the
 * remaining travel is zero, and the prediction collapses to nothing. Extrapolating
 * a gesture would be a guess about what a hand is going to do next; extrapolating
 * an animation is reading a value the system has already committed to.
 */
- (CGFloat)_advanceFor:(EXPKeyboardGeometry)shown
{
  const CFTimeInterval now = _link.timestamp;
  const CFTimeInterval ahead = _link.targetTimestamp - now;
  const CFTimeInterval since = now - _shownAt;
  const CGFloat moved = shown.height - _shownHeight;
  // A tenth of a second bounds the pair to consecutive frames of one run.
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
  /*
   * The OBSTRUCTION moved, not just the keyboard.
   *
   * The obstruction is the keyboard or whatever is docked above it, whichever is
   * higher, and those two are not on the same clock. `keyboardLayoutGuide` is
   * UIKit's model of where the keyboard is going; a docked bar is a view being
   * animated. Either can move while the other is still.
   *
   * Comparing the guide alone DROPS every frame in which only the bar moves —
   * and the end of an interactive dismissal is made of those. Traced on the
   * simulator: releasing a dragged keyboard takes the guide from 158 to 40.6 in
   * one sample and then back up to 110 over eight, while the bar makes the whole
   * journey to the bottom of the screen in between. Not one frame of that
   * journey reaches an observer that way, so the scroll view's bottom inset goes
   * 234 to 110 in a single step and the transcript reveals a hundred and twenty
   * four points of content while the keys are still on screen.
   *
   * The guide's excursion below its resting place is UIKit's, and harmless: the
   * obstruction is a MIN, so the bar wins it.
   */
  const CGFloat nextTop = [self obstructionTopInWindowForObstruction:next.height];
  BOOL moved = fabs(next.height - _geometry.height) > 0.01 ||
      fabs(next.safeArea - _geometry.safeArea) > 0.01 || fabs(nextTop - _obstructionTop) > 0.01;

  if (moved) {
    _stableFrames = 0;
    _geometry = next;
    _obstructionTop = nextTop;
    for (id<EXPKeyboardInsetObserving> observer in [_observers allObjects]) {
      [observer keyboardGeometryDidChange:next];
    }
    return;
  }

  // Nothing moved, so nothing is predicted: readers between here and the next
  // tick are asking about a keyboard at rest and must get the measurement.
  _advance = 0;

  // Nothing moved, so park — a link left running while the keyboard sits still
  // wakes the run loop at display rate to measure a number that is not changing.
  //
  // The gap this leaves is the interactive drag, which starts with no
  // notification to wake us. That is closed from the other end: whatever can
  // begin such a drag calls `beginTracking` when the finger goes down. Silence
  // is not rest, but the toucher knows the difference and we do not have to
  // spin to find out.
  if (_holds == 0 && ++_stableFrames >= EXPKeyboardStableFramesBeforeParking &&
      CACurrentMediaTime() - _wokeAt > EXPKeyboardGraceAfterWake) {
    [_link invalidate];
    _link = nil;
  }
}

@end
