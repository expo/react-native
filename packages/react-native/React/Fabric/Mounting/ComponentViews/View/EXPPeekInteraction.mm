/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPPeekInteraction.h"

NSNotificationName const EXPPeekWillBeginNotification = @"EXPPeekWillBegin";
NSNotificationName const EXPPeekDidEndNotification = @"EXPPeekDidEnd";

#import "EXPElementMenu.h"

@interface EXPPeekInteraction () <UIContextMenuInteractionDelegate>
@end

@implementation EXPPeekInteraction {
  NSArray<NSDictionary<NSString *, id> *> *_commands;
  void (^_onChoose)(NSString *);
  /*
   * Weak, because the view owns this and this installs itself on the view: a
   * strong reference here is a cycle that outlives both.
   */
  __weak UIView *_view;
  UIBezierPath * (^_visiblePath)(void);
  void (^_onPeek)(void);
  UIContextMenuInteraction *_interaction;
  /*
   * Whether a peek this object began is still open.
   *
   * The end notification stands bars back up, so posting one that no begin
   * preceded is a responder claim arriving out of nowhere. Unguarded, `dealloc`
   * and interaction-removal both post — and a balloon is deallocated whenever a
   * row recycles, so ordinary scrolling announces a peek ending. Landing while a
   * field is being focused, that re-claim takes the responder before the
   * keyboard can rise.
   */
  BOOL _peekIsOpen;
}

- (instancetype)initWithView:(UIView *)view
                 visiblePath:(UIBezierPath * (^)(void))visiblePath
                      onPeek:(void (^)(void))onPeek
{
  if (self = [super init]) {
    _view = view;
    _visiblePath = [visiblePath copy];
    _onPeek = [onPeek copy];
  }
  return self;
}

- (void)setEnabled:(BOOL)enabled
{
  if (_enabled == enabled) {
    return;
  }
  _enabled = enabled;
  UIView *view = _view;
  if (view == nil) {
    return;
  }
  if (enabled) {
    _interaction = [[UIContextMenuInteraction alloc] initWithDelegate:self];
    [view addInteraction:_interaction];
  } else if (_interaction != nil) {
    [view removeInteraction:_interaction];
    _interaction = nil;
    // A peek cannot be in flight once the interaction is gone; tell anything that
    // stood aside for THIS one to come back, and only then.
    [self _endPeekIfOpen];
  }
}

- (void)dealloc
{
  [self _endPeekIfOpen];
}

/** Post the end exactly once, and only for a peek this object opened. */
- (void)_endPeekIfOpen
{
  if (!_peekIsOpen) {
    return;
  }
  _peekIsOpen = NO;
  [NSNotificationCenter.defaultCenter postNotificationName:EXPPeekDidEndNotification object:nil];
}

- (UIContextMenuConfiguration *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
                        configurationForMenuAtLocation:(CGPoint)location
{
  if (_onPeek != nil) {
    _onPeek();
  }

  __weak __typeof(self) weakSelf = self;
  return [UIContextMenuConfiguration configurationWithIdentifier:nil
                                                 previewProvider:nil
                                                  actionProvider:^UIMenu *(NSArray *suggested) {
                                                    return [weakSelf _menu];
                                                  }];
}

/**
 * The menu is PRESENTING, and this is where the bar stands down.
 *
 * NOT `configurationForMenuAtLocation:`. UIKit asks for a configuration when it
 * merely CONSIDERS a long press and abandons it the moment the finger moves, so
 * a drag that begins with a short press would tear the composer out for a menu
 * that never opens — and `willEndForConfiguration:` arrives only sometimes (see
 * the header), so it would not come back. This call means the menu is really
 * coming, and it is the partner of the end.
 *
 * The KEYBOARD is UIKit's to move, and this does not touch it: presenting a
 * context menu takes it down and dismissing the menu brings it back, both in
 * step with the menu's own animation. Resigning the field here instead — which
 * is what this used to do — hands us a keyboard UIKit no longer owns, and
 * putting it back by hand runs after the balloon has landed.
 *
 * The notification is for what UIKit cannot see: the bar's own responder claim,
 * which is not a text input and so holds the bar up through the lift unless it
 * is released.
 */
- (void)contextMenuInteraction:(UIContextMenuInteraction *)interaction
    willDisplayMenuForConfiguration:(UIContextMenuConfiguration *)configuration
                           animator:(id<UIContextMenuInteractionAnimating>)animator
{
  _peekIsOpen = YES;
  [NSNotificationCenter.defaultCenter postNotificationName:EXPPeekWillBeginNotification object:nil];
}

- (void)contextMenuInteraction:(UIContextMenuInteraction *)interaction
       willEndForConfiguration:(UIContextMenuConfiguration *)configuration
                      animator:(id<UIContextMenuInteractionAnimating>)animator
{
  /*
   * The bar comes back WITH the dismissal, not after it: on the animator's
   * completion it would wait for the balloon to land, and the keyboard UIKit is
   * already bringing up would arrive to a bar that is still down.
   */
  [self _endPeekIfOpen];
}

/*
 * The lift: the view, clipped to the outline a child gave for it — a balloon's,
 * tail included — or to its own bounds. Behind it the system background, which
 * is the page a balloon sits on, so a fill with alpha keeps its colour over it.
 * The same preview serves the highlight and the dismissal, so the balloon leaves
 * and returns as one shape.
 */
- (nullable UITargetedPreview *)_preview
{
  UIView *view = _view;
  if (view == nil || view.window == nil) {
    // `UITargetedPreview` throws for a view that is not in a window. Unanswered,
    // UIKit lifts its own default preview: the view's plain bounds.
    return nil;
  }
  UIPreviewParameters *parameters = [UIPreviewParameters new];
  UIBezierPath *path = _visiblePath != nil ? _visiblePath() : nil;
  if (path != nil) {
    parameters.visiblePath = path;
    /*
     * A view that supplies its own outline draws its own surface, and gets no
     * platter. The platter is UIKit's `_UIContentPlatterView`: it takes the
     * lifted view's bounds with no corner radius and no mask, so `visiblePath`
     * shapes the content and leaves the platter square — behind a balloon, a
     * grey rectangle around it. Giving it nothing to draw is what removes it.
     *
     * The cost: the lifted thing must be opaque where it means to look opaque,
     * since the dimmed page is what shows through it now.
     *
     * A box that offers no outline is a rectangle anyway and keeps the
     * platform's platter, which is what an arbitrary lifted box should have.
     */
    parameters.backgroundColor = UIColor.clearColor;
  }
  return [[UITargetedPreview alloc] initWithView:view parameters:parameters];
}

#if !defined(__IPHONE_OS_VERSION_MIN_REQUIRED) || __IPHONE_OS_VERSION_MIN_REQUIRED < 160000

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-implementations"

- (nullable UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
           previewForHighlightingMenuWithConfiguration:(UIContextMenuConfiguration *)configuration
{
  return [self _preview];
}

- (nullable UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
             previewForDismissingMenuWithConfiguration:(UIContextMenuConfiguration *)configuration
{
  return [self _preview];
}

#pragma clang diagnostic pop

#endif // deployment target below iOS 16

- (nullable UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
                                         configuration:(UIContextMenuConfiguration *)configuration
                 highlightPreviewForItemWithIdentifier:(id<NSCopying>)identifier
{
  return [self _preview];
}

- (nullable UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
                                         configuration:(UIContextMenuConfiguration *)configuration
                 dismissalPreviewForItemWithIdentifier:(id<NSCopying>)identifier
{
  return [self _preview];
}

- (void)setCommands:(NSArray<NSDictionary<NSString *, id> *> *)commands
           onChoose:(void (^)(NSString *))onChoose
{
  _commands = [commands copy];
  _onChoose = [onChoose copy];
}

/**
 * The menu, from the shared builder — see `EXPElementMenu.h`.
 *
 * Nothing about a peek's menu differs from a button's: the same `<menu>`, the
 * same groups, the same compact row. What differs is who opens it.
 */
- (nullable UIMenu *)_menu
{
  __weak __typeof(self) weakSelf = self;
  return EXPElementMenuFromCommands(_commands, ^(NSString *identifier) {
    __typeof(self) strongSelf = weakSelf;
    if (strongSelf != nil && strongSelf->_onChoose != nil) {
      strongSelf->_onChoose(identifier);
    }
  });
}

@end
