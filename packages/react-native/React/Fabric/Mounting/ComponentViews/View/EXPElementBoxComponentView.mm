/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementBoxComponentView.h"

#import <React/RCTComponentViewFactory.h>
#import <React/RCTConversions.h>
#import <react/renderer/components/view/ElementBoxShadowNode.h>

#import "EXPCornerShape.h"
#import "EXPElementMenu.h"
#import "EXPMaterialSurface.h"
#import "EXPPeekInteraction.h"
#import "EXPTextLinkInteraction.h"

using namespace facebook::react;

// `UILongPressGestureRecognizer`'s default, so a hold here lasts as long as a
// hold anywhere else on the system
static const NSTimeInterval EXPElementBoxHoldDuration = 0.5;

@implementation EXPElementBoxComponentView {
  EXPTextLinkInteraction *_boxLinkInteraction;
  EXPPeekInteraction *_peek;
  BOOL _wantsContextMenu;
  // The lifted outline, given by a child that draws one
  UIBezierPath * (^_peekShapeProvider)(void);
  BOOL _holdPending;
  NSUInteger _holdGeneration;
}

#pragma mark - contextmenu

/*
 * The platform's hold, for a box that asked for it through a prop: whether the
 * element has a `contextmenu` listener is invisible here, since the event
 * bubbles and React keeps the handler. With the prop, the hold duration, the
 * movement slop, the scroll-cancels-the-hold rule, the lift and the haptic are
 * UIKit's (`UIContextMenuInteraction`, the same interaction the platform's chat
 * uses for a balloon). Without it the timer below still publishes `contextmenu`.
 */
- (void)_installContextMenuInteraction
{
  if (_peek == nil) {
    __weak __typeof(self) weakSelf = self;
    _peek = [[EXPPeekInteraction alloc] initWithView:self
        visiblePath:^UIBezierPath * {
          // A child's outline if one gave it, else the box's own rectangle
          __typeof(self) strongSelf = weakSelf;
          if (strongSelf == nil || strongSelf->_peekShapeProvider == nil) {
            return nil;
          }
          return strongSelf->_peekShapeProvider();
        }
        onPeek:^{
          [weakSelf _emitContextMenuIfUnpresented];
        }];
  }
  _peek.enabled = _wantsContextMenu;
  [self _updatePeekCommands];
}

- (void)exp_setPeekShapeProvider:(UIBezierPath *_Nullable (^_Nullable)(void))provider
{
  _peekShapeProvider = [provider copy];
}

// The fallback hold, timed from the touches this view already receives: by
// `touchesBegan` an enclosing scroll view has decided whether this is a scroll,
// and `touchesCancelled` arrives if the finger leaves. A generation counter
// stands in for cancelling the `dispatch_after`.
- (void)touchesBegan:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  [super touchesBegan:touches withEvent:event];
  if (_wantsContextMenu || event.allTouches.count > 1) {
    // The interaction owns the hold, or a second finger is not a second hold
    return;
  }
  _holdPending = YES;
  const NSUInteger generation = ++_holdGeneration;
  __weak __typeof(self) weakSelf = self;
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(EXPElementBoxHoldDuration * NSEC_PER_SEC)),
      dispatch_get_main_queue(),
      ^{
        __typeof(self) strongSelf = weakSelf;
        if (strongSelf == nil || !strongSelf->_holdPending || strongSelf->_holdGeneration != generation) {
          return;
        }
        strongSelf->_holdPending = NO;
        [strongSelf _emitContextMenu];
      });
}

- (void)touchesEnded:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  [super touchesEnded:touches withEvent:event];
  _holdPending = NO;
}

- (void)touchesCancelled:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  [super touchesCancelled:touches withEvent:event];
  // Usually an enclosing scroll claiming the gesture, which is the hold that
  // must not fire
  _holdPending = NO;
}

// Plain dictionaries rather than the C++ struct: the interaction is shared
// with views whose props have no such shape
- (void)_updatePeekCommands
{
  const auto &props = static_cast<const ElementBoxProps &>(*_props);
  NSArray<NSDictionary<NSString *, id> *> *commands = EXPElementMenuCommands(props.menuCommands);
  __weak __typeof(self) weakSelf = self;
  [_peek setCommands:commands
            onChoose:^(NSString *identifier) {
              [weakSelf _emitCommand:identifier];
            }];
}

- (void)_emitCommand:(NSString *)identifier
{
  if (const auto emitter = std::static_pointer_cast<const facebook::react::ElementBoxEventEmitter>(_eventEmitter)) {
    emitter->onCommand(std::string(identifier.UTF8String));
  }
}

- (void)_emitContextMenu
{
  if (const auto emitter = std::static_pointer_cast<const facebook::react::ElementBoxEventEmitter>(_eventEmitter)) {
    emitter->onContextMenu();
  }
}

// Reported only when the platform is not already presenting a menu for the
// hold; a box with a `<menu>` would otherwise get the app's picker over UIKit's
- (void)_emitContextMenuIfUnpresented
{
  const auto &props = static_cast<const facebook::react::ElementBoxProps &>(*_props);
  if (!props.menuCommands.empty()) {
    return;
  }
  [self _emitContextMenu];
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ElementBoxShadowNode::defaultSharedProps();
  }
  return self;
}

// With a material, the colour goes to it rather than to the layer: CSS paints a
// background over a backdrop, a layer paints under every subview, and a glass
// press scales the material's host but not the layer. A fill alone keeps the
// layer, where border metrics and non-uniform corner radii shape it.
- (nullable UIColor *)exp_backgroundColorForLayer:(nullable UIColor *)resolved
{
  EXPMaterialSurface *material = self.exp_material;
  if (!material.hasEffect) {
    [material setFill:nil];
    return resolved;
  }
  [material setFill:resolved];
  return nil;
}

- (void)_updateMaterial:(const ElementBoxProps &)props
{
  [self exp_applyMaterialKeyword:[NSString stringWithUTF8String:props.appleVisualEffect.c_str()]
                            fade:props.appleVisualEffectFade];
}

// The DOM's accessible-name computation: an element with a role you land on is
// one accessibility element, named from its contents by the label walk, which
// React Native runs only for a view that is an element. Roles that merely
// describe text, such as a heading, stay out of it.
- (void)_beNamedByContentsIfItHasARole
{
  const UIAccessibilityTraits landable = UIAccessibilityTraitLink | UIAccessibilityTraitButton;
  if ((self.accessibilityTraits & landable) == 0) {
    return;
  }
  // Only ever turned on: an author's `accessible={false}` stands
  self.accessibilityElement.isAccessibilityElement = YES;
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  [super updateProps:props oldProps:oldProps];

  // After super, which turns the role into traits
  [self _beNamedByContentsIfItHasARole];

  const auto &newProps = static_cast<const ElementBoxProps &>(*props);
  [self _updateMaterial:newProps];

  if (newProps.wantsContextMenu != _wantsContextMenu) {
    _wantsContextMenu = newProps.wantsContextMenu;
    // A box can start or stop wanting one without moving
    [self _installContextMenuInteraction];
  } else if (_peek != nil) {
    // Every commit: `super updateProps:` has already assigned `_props`, so the
    // new and old commands cannot be compared here. The menu itself is built
    // lazily when a hold completes.
    [self _updatePeekCommands];
  }

  const std::string &href = newProps.href;
  if (href.empty()) {
    [_boxLinkInteraction setInstalled:NO];
    return;
  }

  if (_boxLinkInteraction == nil) {
    __weak __typeof(self) weakSelf = self;
    _boxLinkInteraction = [[EXPTextLinkInteraction alloc]
        initWithView:self
            resolver:^id _Nullable(
                CGPoint point, NSMutableArray<NSValue *> *rects, UIView *_Nullable *_Nullable outLinkView) {
              __typeof(self) strongSelf = weakSelf;
              if (strongSelf == nil || !CGRectContainsPoint(strongSelf.bounds, point)) {
                return nil;
              }
              // Re-read from props: a recycled view keeps this block and is
              // handed a different anchor
              const auto &current = static_cast<const ElementBoxProps &>(*strongSelf->_props);
              if (current.href.empty()) {
                return nil;
              }
              // A block link lifts the whole box, so the box is both the shape
              // and the view; a resolver that reports no view resolves no link
              [rects addObject:[NSValue valueWithCGRect:strongSelf.bounds]];
              if (outLinkView != nullptr) {
                *outLinkView = strongSelf;
              }
              NSString *string = [NSString stringWithUTF8String:current.href.c_str()];
              return [NSURL URLWithString:string] ?: string;
            }];
  }
  [_boxLinkInteraction setInstalled:YES];
}

- (void)prepareForRecycle
{
  _peek.enabled = NO;
  _wantsContextMenu = NO;
  _peekShapeProvider = nil;
  // A pending hold belongs to the content that is going away
  _holdPending = NO;
  _holdGeneration++;
  [_boxLinkInteraction setInstalled:NO];
  [super prepareForRecycle];
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  [self _installContextMenuInteraction];
  if (self.window == nil) {
    // A box that has left the screen must not still be lifted above it
    [_boxLinkInteraction dismissMenuIfPresenting];
  }
}

+ (facebook::react::ComponentDescriptorProvider)componentDescriptorProvider
{
  return facebook::react::concreteComponentDescriptorProvider<facebook::react::ElementBoxComponentDescriptor>();
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end
