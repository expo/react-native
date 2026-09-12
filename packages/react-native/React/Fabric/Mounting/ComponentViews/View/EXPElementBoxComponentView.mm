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

/**
 * How long a finger rests before it is a `contextmenu`.
 *
 * `UILongPressGestureRecognizer`'s own default, which is the number the platform
 * has already decided a hold is — 0.5 seconds. Taken from there rather than
 * chosen, so a hold on one of these boxes lasts exactly as long as a hold
 * anywhere else on the system.
 */
static const NSTimeInterval EXPElementBoxHoldDuration = 0.5;

@implementation EXPElementBoxComponentView {
  EXPTextLinkInteraction *_boxLinkInteraction;
  EXPMaterialSurface *_material;
  EXPPeekInteraction *_peek;
  BOOL _wantsContextMenu;
  /** The lifted outline, given by a child that draws one — see the setter. */
  UIBezierPath * (^_peekShapeProvider)(void);
  /** Cancelled the moment the touch ends or is taken away. */
  BOOL _holdPending;
  NSUInteger _holdGeneration;
}

#pragma mark - contextmenu

/*
 * The platform's OWN hold, not a timer of ours.
 *
 * This was a `dispatch_after` armed in `touchesBegan` and disarmed in
 * `touchesEnded`/`touchesCancelled`. It fired at the right moment and did
 * nothing else: no lift, no blur behind, no haptic, and no accessibility. A
 * reader holding a balloon got a picker that simply appeared.
 *
 * `UIContextMenuInteraction` is the peek API — the one that replaced 3D Touch's
 * peek and pop — and it is the one the platform's own chat uses for a balloon:
 * a `UIContextMenuInteractionDelegate` providing
 * `previewForHighlightingContextMenuWithConfiguration:`, with the reaction row
 * hung above the menu. Using it means the hold duration, the movement slop, the
 * scroll-cancels-the-hold rule, the lift, and the haptic are all the system's
 * rather than reimplemented here — and the haptic is why no generator is fired
 * for this the way one is for the `+`.
 *
 * The configuration carries NO menu. A `nil` from the action provider is how
 * UIKit is asked for a preview alone, which is the peek without a menu attached
 * — the element publishes `contextmenu` and whatever listens to it draws the
 * rest, exactly as before.
 */
/*
 * The platform's hold, for a box that asked for it.
 *
 * The gate is a prop rather than a guess. The condition that actually matters —
 * "this element has a `contextmenu` listener" — is invisible from here, because
 * `contextmenu` is a bubbling event and React keeps the handler on its own side.
 * Two guesses were tried and both were wrong: installing on every box lifted
 * whatever was under a long finger, including the wrapper around a message; and
 * installing on boxes whose SHAPE is a balloon put the interaction on the
 * balloon's surface, which is drawn behind the text and never gets the touch —
 * measured, as a hold that opened nothing at all.
 *
 * With the prop, the hold duration, the movement slop, the
 * scroll-cancels-the-hold rule, the lift and the haptic are all UIKit's — the
 * same interaction the platform's own chat uses. Without it the timer below still publishes
 * `contextmenu`, so a box that has not opted in behaves as it always did.
 */
- (void)_installContextMenuInteraction
{
  if (_peek == nil) {
    __weak __typeof(self) weakSelf = self;
    _peek = [[EXPPeekInteraction alloc] initWithView:self
                                         visiblePath:^UIBezierPath *{
                                           // A child's outline if one gave it — a balloon's,
                                           // tail included. Otherwise the box's own rectangle,
                                           // which is all a box that is not a balloon has.
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

/*
 * The fallback hold, for a box that has not asked for the platform's.
 *
 * Timed from the touches this view already receives rather than from a
 * recogniser: by `touchesBegan` an enclosing scroll view has already decided
 * whether this is a scroll, and `touchesCancelled` arrives if the finger starts
 * to leave — so "a hold that becomes a scroll must not fire" is free here.
 *
 * A generation counter rather than a cancellable timer, because `dispatch_after`
 * cannot be cancelled and a block that checks whether it is still current is
 * both cheaper and impossible to leak.
 */
- (void)exp_setPeekShapeProvider:(UIBezierPath *_Nullable (^_Nullable)(void))provider
{
  _peekShapeProvider = [provider copy];
}

- (void)touchesBegan:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  [super touchesBegan:touches withEvent:event];
  if (_wantsContextMenu || event.allTouches.count > 1) {
    // The interaction owns the hold, or a second finger is not a second hold.
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
  // The usual reason to be here is an enclosing scroll claiming the gesture,
  // which is exactly the hold that must not fire — whichever of the two is
  // waiting on it.
  _holdPending = NO;
}

/**
 * The peek's own menu, from the element's `<menu>`.
 *
 * Converted to plain dictionaries rather than handing the C++ struct across:
 * the interaction is shared with views that have no props of this shape, and a
 * list of strings is the smaller thing to agree on.
 */
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

/**
 * The hold, reported only when the PLATFORM is not already presenting it.
 *
 * A box with a `<menu>` gets UIKit's lift, dim and platter, and that IS the
 * event happening: an app told about it as well would draw its own picker over
 * the platform's, which is precisely what it did — the demo's replica and
 * UIKit's menu on screen at once, from one press.
 *
 * A box with no menu gets the lift alone, and then the app is the only thing
 * that can say what a hold means, so it hears about it. That is the same
 * division `<button>` makes with its menu, and it is why `contextmenu` is worth
 * having on an element that also takes a `<menu>`.
 */
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

/*
 * An `<a>` that generates a BOX gets the same platform interaction its inline
 * form gets — press and hold to lift it, with Open / Copy / Share.
 *
 * What differs is the shape of the lift, and it is right that it differs. An
 * inline link lifts its glyphs, because that is what the link is; a block link
 * lifts the WHOLE BOX, which is what iOS does to a tappable row or card. So the
 * resolver names this view as the link's view and its bounds as the link's
 * shape, and the lift then wears the box's own corners and colour.
 */
/*
 * An element that carries a ROLE is something to land on, and its name comes
 * from its CONTENTS.
 *
 * That is the DOM's accessible-name computation and it had no equivalent here.
 * React Native decides `isAccessibilityElement` from the `accessible` prop
 * alone, and `RCTRecursiveAccessibilityLabel` — the walk that collects the text
 * a container draws — only runs for a view that is one. So a `<a href>` whose
 * display generates a box was ANNOUNCED, because the role gives it
 * `UIAccessibilityTraitLink`, and never NAMED: VoiceOver reached a row and said
 * "link". Measured on the demo's navigation rows, and true whether the anchor's
 * content was a bare string or `<span>`s — the text was there, nothing was
 * asking for it.
 *
 * Fixing it here rather than in the anchor makes it the rule it should be: any
 * element that gains a role gets named from whatever it contains, `<span>`,
 * `<b>`, `<i>` and bare strings alike, because the walk already collects every
 * one of those. Inline elements are unaffected — a link that is a range of
 * glyphs is named by its text run, which knows the fragment's own string.
 *
 * Limited to roles you LAND on. A role that merely describes text — a heading,
 * say — is not a target, and making it an element would take its contents out
 * of the reading order to no purpose.
 */
/**
 * The material, as a view BEHIND everything this box draws.
 *
 * All of the mechanism is in `EXPMaterialSurface`, because the keyboard
 * accessory needs the same thing and a bar's surface cannot be a child box —
 * see that class. What is left here is the wiring.
 */
/**
 * The colour goes to the MATERIAL, not to the layer, whenever there is one.
 *
 * CSS paints a background over a backdrop; a layer paints its background under
 * every subview, and the material is a subview. So the two were coming out in
 * the wrong order, which was written down as
 * `DOM-CSS-LIMITATION(backdrop-under-background)` and is what this closes.
 *
 * It is also what makes a glass surface RESPOND to a finger. The press is a
 * 1.05x scale of the material's host; a colour left on the layer does not scale
 * with it, so a glass box with a background — which is most of them — pressed
 * invisibly. Measured before the change, a two-second press on the composer's
 * field moved fewer than one level of grey.
 *
 * Only when there is an EFFECT. A fill on its own would still form a host, and a
 * plain box's background belongs on the layer, where the border metrics shape it
 * and non-uniform corner radii work.
 */
/**
 * This view's material, when it is a glass CONTAINER — the hook a descendant's
 * material walks the view tree looking for.
 *
 * On `RCTViewComponentView` rather than on the element box alone, because the
 * walk is over VIEWS and whatever sits between two elements may be either.
 * Answering nil is the ordinary case and costs a message send on a walk that
 * only runs for a glass surface's layout.
 */
- (nullable UIView *)exp_glassChildContainerView
{
  return _material.childContainerView;
}

- (nullable UIView *)exp_materialHostView
{
  return _material.hostView;
}

- (nullable UIColor *)exp_backgroundColorForLayer:(nullable UIColor *)resolved
{
  if (!_material.hasEffect) {
    [_material setFill:nil];
    return resolved;
  }
  [_material setFill:resolved];
  return nil;
}

- (void)_updateMaterial:(const ElementBoxProps &)props
{
  if (_material == nil) {
    if (props.appleVisualEffect.empty()) {
      return;
    }
    _material = [EXPMaterialSurface new];
  }
  [_material applyKeyword:[NSString stringWithUTF8String:props.appleVisualEffect.c_str()]
                     fade:props.appleVisualEffectFade
              inContainer:self.chromeContainerView];
  [_material layOutInContainer:self.chromeContainerView
                  cornerRadius:self.layer.cornerRadius
                   cornerCurve:self.layer.cornerCurve];
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  [_material layOutInContainer:self.chromeContainerView
                  cornerRadius:self.layer.cornerRadius
                   cornerCurve:self.layer.cornerCurve];
}

- (void)_beNamedByContentsIfItHasARole
{
  const UIAccessibilityTraits landable = UIAccessibilityTraitLink | UIAccessibilityTraitButton;
  if ((self.accessibilityTraits & landable) == 0) {
    return;
  }
  // Only ever turned ON: `accessible={false}` on an element with a role is a
  // deliberate contradiction, and the author's is the answer that stands.
  self.accessibilityElement.isAccessibilityElement = YES;
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  [super updateProps:props oldProps:oldProps];

  // After super, which is what turns the role into traits.
  [self _beNamedByContentsIfItHasARole];

  const auto &newProps = static_cast<const ElementBoxProps &>(*props);
  [self _updateMaterial:newProps];

  if (newProps.wantsContextMenu != _wantsContextMenu) {
    _wantsContextMenu = newProps.wantsContextMenu;
    // Revisited on the prop rather than only on entering a window, because a box
    // can start or stop wanting one without moving.
    [self _installContextMenuInteraction];
  } else if (_peek != nil) {
    /*
     * Unconditionally, and the comparison that used to be here is why.
     *
     * It read `newProps.menuCommands != _props->menuCommands` — and `super
     * updateProps:` has already assigned `_props = props` by this line, so the
     * two were the same object and the branch never ran. The commands reached
     * the view once, at install time, when there were none yet: the peek lifted
     * a balloon and presented an empty menu, which UIKit draws as no menu at
     * all.
     *
     * Cheap enough to do every commit: this builds an array of small
     * dictionaries and hands it over. The MENU is built lazily, in the action
     * provider, only when a hold actually completes.
     */
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
              // Re-read from props each time rather than capturing: a recycled
              // view keeps this block and is handed a different anchor.
              const auto &current = static_cast<const ElementBoxProps &>(*strongSelf->_props);
              if (current.href.empty()) {
                return nil;
              }
              // The box IS the link, so it is both the shape that lifts and the
              // view that lifts. Naming itself is not optional: a resolver that
              // reports no view resolves no link, and the anchor would offer no
              // menu at all.
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
  /*
   * The interaction is torn down with the view it belonged to.
   *
   * A recycled box becomes a different message, and an interaction left in place
   * would carry the old one's delegate state into it. Removing it also means a
   * box that stops listening for `contextmenu` stops holding one.
   */
  _peek.enabled = NO;
  _wantsContextMenu = NO;
  _peekShapeProvider = nil;
  // A pending hold belongs to the message that is going away, not to whichever
  // one this view is about to become.
  _holdPending = NO;
  _holdGeneration++;
  [_boxLinkInteraction setInstalled:NO];
  // The material is a subview this view added, so recycling has to take it back
  // out — a recycled box would otherwise inherit the last one's glass.
  [_material applyKeyword:nil fade:0 inContainer:self.chromeContainerView];
  _material = nil;
  [super prepareForRecycle];
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  [self _installContextMenuInteraction];
  if (self.window == nil) {
    // Same rule as the text case above: a box that has left the screen must not
    // still be lifted above it.
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
