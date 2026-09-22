/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "RCTSurfaceTouchHandler.h"

#import <React/EXPKeyboardTrace.h>
#import <React/RCTIdentifierPool.h>
#import <React/RCTUtils.h>
#import <React/RCTViewComponentView.h>

#import "RCTConversions.h"
#import "RCTSurfacePointerHandler.h"
#import "RCTTouchableComponentViewProtocol.h"

#if !TARGET_OS_TV

using namespace facebook::react;

typedef NS_ENUM(NSInteger, RCTTouchEventType) {
  RCTTouchEventTypeTouchStart,
  RCTTouchEventTypeTouchMove,
  RCTTouchEventTypeTouchEnd,
  RCTTouchEventTypeTouchCancel,
};

struct ActiveTouch {
  Touch touch;
  SharedTouchEventEmitter eventEmitter;

  /*
   * A component view on which the touch was begun.
   */
  __strong UIView<RCTComponentViewProtocol> *componentView = nil;

  struct Hasher {
    size_t operator()(const ActiveTouch &activeTouch) const
    {
      return std::hash<decltype(activeTouch.touch.identifier)>()(activeTouch.touch.identifier);
    }
  };

  struct Comparator {
    bool operator()(const ActiveTouch &lhs, const ActiveTouch &rhs) const
    {
      return lhs.touch.identifier == rhs.touch.identifier;
    }
  };
};

static void UpdateActiveTouchWithUITouch(
    ActiveTouch &activeTouch,
    UITouch *uiTouch,
    UIView *rootComponentView,
    CGPoint rootViewOriginOffset)
{
  CGPoint offsetPoint = [uiTouch locationInView:activeTouch.componentView];
  CGPoint pagePoint = [uiTouch locationInView:rootComponentView];
  CGPoint screenPoint = [rootComponentView convertPoint:pagePoint
                                      toCoordinateSpace:rootComponentView.window.screen.coordinateSpace];
  pagePoint = CGPointMake(pagePoint.x + rootViewOriginOffset.x, pagePoint.y + rootViewOriginOffset.y);

  activeTouch.touch.offsetPoint = RCTPointFromCGPoint(offsetPoint);
  activeTouch.touch.screenPoint = RCTPointFromCGPoint(screenPoint);
  activeTouch.touch.pagePoint = RCTPointFromCGPoint(pagePoint);

  activeTouch.touch.timestamp = uiTouch.timestamp;
  activeTouch.touch.timeStamp = RCTHighResTimeStampFromSeconds(uiTouch.timestamp);

  if (RCTForceTouchAvailable()) {
    activeTouch.touch.force = RCTZeroIfNaN(uiTouch.force / uiTouch.maximumPossibleForce);
  }
}

static ActiveTouch CreateTouchWithUITouch(UITouch *uiTouch, UIView *rootComponentView, CGPoint rootViewOriginOffset)
{
  ActiveTouch activeTouch = {};

  // Find closest Fabric-managed touchable view
  UIView *componentView = uiTouch.view;
  while (componentView) {
    if ([componentView respondsToSelector:@selector(touchEventEmitterAtPoint:)]) {
      activeTouch.eventEmitter = [(id<RCTTouchableComponentViewProtocol>)componentView
          touchEventEmitterAtPoint:[uiTouch locationInView:componentView]];
      activeTouch.touch.target = (Tag)componentView.tag;
      activeTouch.componentView = componentView;
      break;
    }
    componentView = componentView.superview;
  }

  UpdateActiveTouchWithUITouch(activeTouch, uiTouch, rootComponentView, rootViewOriginOffset);
  return activeTouch;
}

static BOOL AllTouchesAreCancelledOrEnded(NSSet<UITouch *> *touches)
{
  for (UITouch *touch in touches) {
    if (touch.phase == UITouchPhaseBegan || touch.phase == UITouchPhaseMoved || touch.phase == UITouchPhaseStationary) {
      return NO;
    }
  }
  return YES;
}

static BOOL AnyTouchesChanged(NSSet<UITouch *> *touches)
{
  for (UITouch *touch in touches) {
    if (touch.phase == UITouchPhaseBegan || touch.phase == UITouchPhaseMoved) {
      return YES;
    }
  }
  return NO;
}

/**
 * Surprisingly, `__unsafe_unretained id` pointers are not regular pointers
 * and `std::hash<>` cannot hash them.
 * This is quite trivial but decent implementation of hasher function
 * inspired by this research: https://stackoverflow.com/a/21062520/496389.
 */
template <typename PointerT>
struct PointerHasher {
  constexpr std::size_t operator()(const PointerT &value) const
  {
    return reinterpret_cast<size_t>(value);
  }
};

@interface RCTSurfaceTouchHandler () <UIGestureRecognizerDelegate>
@end

@implementation RCTSurfaceTouchHandler {
  std::unordered_map<__unsafe_unretained UITouch *, ActiveTouch, PointerHasher<__unsafe_unretained UITouch *>>
      _activeTouches;

  /*
   * We hold the view weakly to prevent a retain cycle.
   */
  __weak UIView *_rootComponentView;
  RCTIdentifierPool<17> _identifierPool;

  RCTSurfacePointerHandler *_pointerHandler;
}

- (instancetype)init
{
  if (self = [super initWithTarget:nil action:nil]) {
    // `cancelsTouchesInView` and `delaysTouches*` are needed in order
    // to be used as a top level event delegated recognizer.
    // Otherwise, lower-level components not built using React Native,
    // will fail to recognize gestures.
    self.cancelsTouchesInView = NO;
    self.delaysTouchesBegan = NO; // This is default value.
    self.delaysTouchesEnded = NO;

    self.delegate = self;

    if (RCTGetDispatchW3CPointerEvents()) {
      _pointerHandler = [[RCTSurfacePointerHandler alloc] init];
    }
  }

  return self;
}

RCT_NOT_IMPLEMENTED(-(instancetype)initWithTarget : (id)target action : (SEL)action)

- (void)attachToView:(UIView *)view
{
  RCTAssert(self.view == nil, @"RCTTouchHandler already has attached view.");

  [view addGestureRecognizer:self];
  _rootComponentView = view;

  if (_pointerHandler != nil) {
    [_pointerHandler attachToView:view];
  }
}

- (void)detachFromView:(UIView *)view
{
  RCTAssertParam(view);
  RCTAssert(self.view == view, @"RCTTouchHandler attached to another view.");

  [view removeGestureRecognizer:self];
  _rootComponentView = nil;

  if (_pointerHandler != nil) {
    [_pointerHandler detachFromView:view];
  }
}

- (void)_registerTouches:(NSSet<UITouch *> *)touches
{
  for (UITouch *touch in touches) {
    auto activeTouch = CreateTouchWithUITouch(touch, _rootComponentView, _viewOriginOffset);
    activeTouch.touch.identifier = _identifierPool.dequeue();
    _activeTouches.emplace(touch, activeTouch);
  }
}

- (void)_updateTouches:(NSSet<UITouch *> *)touches
{
  for (UITouch *touch in touches) {
    auto iterator = _activeTouches.find(touch);
    RCTAssert(iterator != _activeTouches.end(), @"Inconsistency between local and UIKit touch registries");
    if (iterator == _activeTouches.end()) {
      continue;
    }

    UpdateActiveTouchWithUITouch(iterator->second, touch, _rootComponentView, _viewOriginOffset);
  }
}

- (void)_unregisterTouches:(NSSet<UITouch *> *)touches
{
  for (UITouch *touch in touches) {
    auto iterator = _activeTouches.find(touch);
    RCTAssert(iterator != _activeTouches.end(), @"Inconsistency between local and UIKit touch registries");
    if (iterator == _activeTouches.end()) {
      continue;
    }
    auto &activeTouch = iterator->second;
    _identifierPool.enqueue(activeTouch.touch.identifier);
    _activeTouches.erase(touch);
  }
}

- (std::vector<ActiveTouch>)_activeTouchesFromTouches:(NSSet<UITouch *> *)touches
{
  std::vector<ActiveTouch> activeTouches;
  activeTouches.reserve(touches.count);

  for (UITouch *touch in touches) {
    auto iterator = _activeTouches.find(touch);
    RCTAssert(iterator != _activeTouches.end(), @"Inconsistency between local and UIKit touch registries");
    if (iterator == _activeTouches.end()) {
      continue;
    }
    activeTouches.push_back(iterator->second);
  }

  return activeTouches;
}

- (void)_dispatchActiveTouches:(std::vector<ActiveTouch>)activeTouches eventType:(RCTTouchEventType)eventType
{
  TouchEvent event = {};
  std::unordered_set<ActiveTouch, ActiveTouch::Hasher, ActiveTouch::Comparator> changedActiveTouches = {};
  std::unordered_set<SharedTouchEventEmitter> uniqueEventEmitters = {};
  BOOL isEndishEventType = eventType == RCTTouchEventTypeTouchEnd || eventType == RCTTouchEventTypeTouchCancel;

  for (const auto &activeTouch : activeTouches) {
    if (!activeTouch.eventEmitter) {
      continue;
    }

    changedActiveTouches.insert(activeTouch);
    event.changedTouches.insert(activeTouch.touch);
    uniqueEventEmitters.insert(activeTouch.eventEmitter);
  }

  for (const auto &pair : _activeTouches) {
    if (!pair.second.eventEmitter) {
      continue;
    }

    if (isEndishEventType && event.changedTouches.find(pair.second.touch) != event.changedTouches.end()) {
      continue;
    }

    event.touches.insert(pair.second.touch);
  }

  for (const auto &eventEmitter : uniqueEventEmitters) {
    event.targetTouches.clear();

    for (const auto &pair : _activeTouches) {
      if (pair.second.eventEmitter == eventEmitter) {
        event.targetTouches.insert(pair.second.touch);
      }
    }

    switch (eventType) {
      case RCTTouchEventTypeTouchStart:
        eventEmitter->onTouchStart(event);
        break;
      case RCTTouchEventTypeTouchMove:
        eventEmitter->onTouchMove(event);
        break;
      case RCTTouchEventTypeTouchEnd:
        eventEmitter->onTouchEnd(event);
        break;
      case RCTTouchEventTypeTouchCancel:
        eventEmitter->onTouchCancel(event);
        break;
    }
  }
}

/*
 * The arbitration, said out loud — see `EXPKeyboardTrace.touchTracing`.
 *
 * This recognizer reaches `Began` on the FIRST TOUCH, before any movement, so
 * it always recognizes before a scroll view's pan can. What keeps it from
 * eating every drag is that it declines to prevent anyone
 * (`canPreventGestureRecognizer:` → NO) and sets `cancelsTouchesInView = NO`,
 * leaving UIKit free to let the pan recognize later and cancel these touches.
 *
 * That is a contract between four separate decisions, three of which are
 * UIKit's, and when a drag fails to scroll there is nothing in any log that
 * says which of them went the other way. These lines are that record: what the
 * finger did, what this recognizer's state did, and what it answered when UIKit
 * asked about somebody else's.
 */
static NSString *EXPTouchStateName(UIGestureRecognizerState state)
{
  switch (state) {
    case UIGestureRecognizerStatePossible:
      return @"possible";
    case UIGestureRecognizerStateBegan:
      return @"began";
    case UIGestureRecognizerStateChanged:
      return @"changed";
    case UIGestureRecognizerStateEnded:
      return @"ended";
    case UIGestureRecognizerStateCancelled:
      return @"cancelled";
    case UIGestureRecognizerStateFailed:
      return @"failed";
  }
  return @"?";
}

static void EXPRecordTouch(NSString *what, UIGestureRecognizer *self_, NSSet<UITouch *> *touches)
{
  if (!EXPKeyboardTrace.touchTracing) {
    return;
  }
  UITouch *touch = touches.anyObject;
  const CGPoint at = [touch locationInView:self_.view];
  [EXPKeyboardTrace record:@"touch %@ n=%lu at=%.0f,%.0f state=%@ on=%@",
                           what,
                           (unsigned long)touches.count,
                           at.x,
                           at.y,
                           EXPTouchStateName(self_.state),
                           NSStringFromClass(touch.view.class)];
}

#pragma mark - `UIResponder`-ish touch-delivery methods

- (void)touchesBegan:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  [super touchesBegan:touches withEvent:event];

  EXPRecordTouch(@"began", self, touches);

  [self _registerTouches:touches];
  [self _dispatchActiveTouches:[self _activeTouchesFromTouches:touches] eventType:RCTTouchEventTypeTouchStart];

  if (self.state == UIGestureRecognizerStatePossible) {
    self.state = UIGestureRecognizerStateBegan;
  } else if (self.state == UIGestureRecognizerStateBegan) {
    self.state = UIGestureRecognizerStateChanged;
  }
}

- (void)touchesMoved:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  [super touchesMoved:touches withEvent:event];

  EXPRecordTouch(@"moved", self, touches);

  [self _updateTouches:touches];
  [self _dispatchActiveTouches:[self _activeTouchesFromTouches:touches] eventType:RCTTouchEventTypeTouchMove];

  self.state = UIGestureRecognizerStateChanged;
}

- (void)touchesEnded:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  [super touchesEnded:touches withEvent:event];

  EXPRecordTouch(@"ended", self, touches);

  [self _updateTouches:touches];
  [self _dispatchActiveTouches:[self _activeTouchesFromTouches:touches] eventType:RCTTouchEventTypeTouchEnd];
  [self _unregisterTouches:touches];

  if (AllTouchesAreCancelledOrEnded(event.allTouches)) {
    self.state = UIGestureRecognizerStateEnded;
  } else if (AnyTouchesChanged(event.allTouches)) {
    self.state = UIGestureRecognizerStateChanged;
  }
}

- (void)touchesCancelled:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  [super touchesCancelled:touches withEvent:event];

  EXPRecordTouch(@"cancelled", self, touches);

  [self _updateTouches:touches];
  [self _dispatchActiveTouches:[self _activeTouchesFromTouches:touches] eventType:RCTTouchEventTypeTouchCancel];
  [self _unregisterTouches:touches];

  if (AllTouchesAreCancelledOrEnded(event.allTouches)) {
    self.state = UIGestureRecognizerStateCancelled;
  } else if (AnyTouchesChanged(event.allTouches)) {
    self.state = UIGestureRecognizerStateChanged;
  }
}

- (void)reset
{
  [super reset];

  if (!_activeTouches.empty()) {
    std::vector<ActiveTouch> activeTouches;
    activeTouches.reserve(_activeTouches.size());

    for (const auto &pair : _activeTouches) {
      activeTouches.push_back(pair.second);
    }

    [self _dispatchActiveTouches:activeTouches eventType:RCTTouchEventTypeTouchCancel];

    // Force-unregistering all the touches.
    _activeTouches.clear();
    _identifierPool.reset();
  }
}

- (BOOL)canPreventGestureRecognizer:(__unused UIGestureRecognizer *)preventedGestureRecognizer
{
  return NO;
}

- (BOOL)canBePreventedByGestureRecognizer:(UIGestureRecognizer *)preventingGestureRecognizer
{
  // We fail in favour of other external gesture recognizers.
  // iOS will ask `delegate`'s opinion about this gesture recognizer little bit later.
  const BOOL answer = ![preventingGestureRecognizer.view isDescendantOfView:self.view];
  if (EXPKeyboardTrace.touchTracing) {
    // NO here means "a scroll view inside this surface cannot stand me down",
    // which is the normal answer and the one the whole contract rests on.
    [EXPKeyboardTrace record:@"touch canBePreventedBy %@ (%@) -> %@",
                             NSStringFromClass(preventingGestureRecognizer.class),
                             NSStringFromClass(preventingGestureRecognizer.view.class),
                             answer ? @"YES" : @"NO"];
  }
  return answer;
}

#pragma mark - UIGestureRecognizerDelegate

- (BOOL)gestureRecognizer:(__unused UIGestureRecognizer *)gestureRecognizer
    shouldRequireFailureOfGestureRecognizer:(UIGestureRecognizer *)otherGestureRecognizer
{
  // Same condition for `failure of` as for `be prevented by`.
  return [self canBePreventedByGestureRecognizer:otherGestureRecognizer];
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer
    shouldRecognizeSimultaneouslyWithGestureRecognizer:(UIGestureRecognizer *)otherGestureRecognizer
{
  BOOL canBePrevented = [self canBePreventedByGestureRecognizer:otherGestureRecognizer];
  if (EXPKeyboardTrace.touchTracing) {
    // The other recognizer's own state matters as much as the answer: a pan
    // that is still `possible` here has not taken the gesture, and a drag that
    // never scrolls is a pan that never left that state.
    [EXPKeyboardTrace record:@"touch simultaneous? %@ state=%@ cancelsInView=%d prevented=%d -> NO",
                             NSStringFromClass(otherGestureRecognizer.class),
                             EXPTouchStateName(otherGestureRecognizer.state),
                             otherGestureRecognizer.cancelsTouchesInView,
                             canBePrevented];
  }
  if (canBePrevented && otherGestureRecognizer.cancelsTouchesInView) {
    [self _cancelTouches];
  }
  return NO;
}

#pragma mark -

- (void)_cancelTouches
{
  [self setEnabled:NO];
  [self setEnabled:YES];
}

@end

#endif // !TARGET_OS_TV
