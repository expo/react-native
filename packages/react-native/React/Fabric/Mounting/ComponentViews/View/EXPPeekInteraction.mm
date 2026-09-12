/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPPeekInteraction.h"

const NSNotificationName EXPPeekWillBeginNotification = @"EXPPeekWillBegin";
const NSNotificationName EXPPeekDidEndNotification = @"EXPPeekDidEnd";

#import "EXPElementMenu.h"

@interface EXPPeekInteraction () <UIContextMenuInteractionDelegate>
@end

@implementation EXPPeekInteraction {
  NSArray<NSDictionary<NSString *, id> *> *_commands;
  void (^_onChoose)(NSString *);
  // Weak: the view owns this object
  __weak UIView *_view;
  UIBezierPath * (^_visiblePath)(void);
  void (^_onPeek)(void);
  UIContextMenuInteraction *_interaction;
  // The end notification stands bars back up, so it is posted only for a peek
  // this object began; `dealloc` runs on every recycled row
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
    // A peek cannot be in flight once the interaction is gone
    [self _endPeekIfOpen];
  }
}

- (void)dealloc
{
  [self _endPeekIfOpen];
}

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

// The bar stands down here, not in `configurationForMenuAtLocation:`, which
// UIKit also asks when it merely considers a long press. The keyboard is left
// to UIKit, which takes it down and brings it back with the menu's own
// animation; the notification is for the bar's responder claim, which UIKit
// cannot see.
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
  // With the dismissal, not on the animator's completion: the keyboard UIKit is
  // already bringing up would otherwise arrive to a bar that is still down
  [self _endPeekIfOpen];
}

// The view clipped to the outline a child gave for it, else its bounds. The same
// preview serves the highlight and the dismissal.
- (nullable UITargetedPreview *)_preview
{
  UIView *view = _view;
  if (view == nil || view.window == nil) {
    // `UITargetedPreview` throws for a view that is not in a window; unanswered,
    // UIKit lifts the view's plain bounds
    return nil;
  }
  UIPreviewParameters *parameters = [UIPreviewParameters new];
  UIBezierPath *path = _visiblePath != nil ? _visiblePath() : nil;
  if (path != nil) {
    parameters.visiblePath = path;
    // A view with its own outline gets no platter: UIKit's platter takes the
    // lifted view's bounds unmasked and would show as a rectangle around a
    // shaped preview. The lifted view must then be opaque where it means to be.
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

- (void)setCommands:(NSArray<NSDictionary<NSString *, id> *> *)commands onChoose:(void (^)(NSString *))onChoose
{
  _commands = [commands copy];
  _onChoose = [onChoose copy];
}

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
