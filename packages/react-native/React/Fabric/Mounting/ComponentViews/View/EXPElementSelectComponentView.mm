/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementSelectComponentView.h"

#import <React/RCTConversions.h>
#import <react/renderer/components/view/ElementSelectShadowNode.h>

#import "RCTComponentViewFactory.h"

using namespace facebook::react;

/*
 * The pop-up's dismissal must follow the button, not the button's OLD spot.
 *
 * UIButton presents its menu through a context-menu interaction, and the
 * dismissal animation collapses the menu into a targeted preview. Left to
 * the default, that target is resolved from geometry captured when the
 * interaction began — so picking an option and then scrolling while the menu
 * closed shrank the menu into the position the button held BEFORE the scroll.
 * UIButton documents these delegate methods as subclass override points; a
 * VIEW-based UITargetedPreview makes UIKit resolve the target against the
 * live view at dismissal time, so the closing menu tracks the scroll.
 */
@interface EXPElementSelectButton : UIButton
@property(nonatomic, strong) NSHashTable<UIScrollView *> *pausedScrollViews;
@end

@implementation EXPElementSelectButton

- (UITargetedPreview *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
    previewForDismissingMenuWithConfiguration:(UIContextMenuConfiguration *)configuration
{
  if (self.window == nil) {
    return [super contextMenuInteraction:interaction previewForDismissingMenuWithConfiguration:configuration];
  }
  return [[UITargetedPreview alloc] initWithView:self];
}

/*
 * A pop-up's anchor does not move. The dismissal target is resolved ONCE
 * when the close begins (probed: previewForDismissing fires exactly once),
 * so a scroll that continues THROUGH the ~0.3s animation still leaves the
 * platter collapsing toward where the button used to be — which is the
 * "menu is not aware of the scroll view" glitch. Native pop-ups do not have
 * the problem because their overlay owns every touch while the menu is up.
 * So: freeze the ancestor scroll views for the menu's whole lifecycle, and
 * give them back only after the dismissal ANIMATION completes.
 */
- (void)pauseAncestorScrolling
{
  if (self.pausedScrollViews == nil) {
    self.pausedScrollViews = [NSHashTable weakObjectsHashTable];
  }
  UIView *ancestor = self.superview;
  while (ancestor != nil) {
    if ([ancestor isKindOfClass:[UIScrollView class]]) {
      UIScrollView *scrollView = (UIScrollView *)ancestor;
      if (scrollView.scrollEnabled) {
        scrollView.scrollEnabled = NO;
        [self.pausedScrollViews addObject:scrollView];
      }
    }
    ancestor = ancestor.superview;
  }
}

- (void)resumeAncestorScrolling
{
  for (UIScrollView *scrollView in self.pausedScrollViews.allObjects) {
    scrollView.scrollEnabled = YES;
  }
  [self.pausedScrollViews removeAllObjects];
}

- (void)contextMenuInteraction:(UIContextMenuInteraction *)interaction
    willDisplayMenuForConfiguration:(UIContextMenuConfiguration *)configuration
                           animator:(id<UIContextMenuInteractionAnimating>)animator
{
  [self pauseAncestorScrolling];
  [super contextMenuInteraction:interaction willDisplayMenuForConfiguration:configuration animator:animator];
}

- (void)contextMenuInteraction:(UIContextMenuInteraction *)interaction
       willEndForConfiguration:(UIContextMenuConfiguration *)configuration
                      animator:(id<UIContextMenuInteractionAnimating>)animator
{
  __weak EXPElementSelectButton *weakSelf = self;
  if (animator != nil) {
    [animator addCompletion:^{
      [weakSelf resumeAncestorScrolling];
    }];
  } else {
    [self resumeAncestorScrolling];
  }
  [super contextMenuInteraction:interaction willEndForConfiguration:configuration animator:animator];
}

// Whatever else happens (interaction torn down, view unmounted mid-menu),
// scrolling must come back.
- (void)willMoveToWindow:(UIWindow *)newWindow
{
  if (newWindow == nil) {
    [self resumeAncestorScrolling];
  }
  [super willMoveToWindow:newWindow];
}

@end

@implementation EXPElementSelectComponentView {
  UIButton *_button;
  BOOL _isInitialValueSet;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ElementSelectShadowNode::defaultSharedProps();

    // A pop-up button: the system's own control for choosing one of a short
    // list. `showsMenuAsPrimaryAction` is what makes a single tap open the menu
    // rather than requiring a long press, which is the difference between a
    // pop-up button and a context menu.
    UIButtonConfiguration *configuration = [UIButtonConfiguration borderedButtonConfiguration];
    configuration.cornerStyle = UIButtonConfigurationCornerStyleMedium;
    _button = [EXPElementSelectButton buttonWithConfiguration:configuration primaryAction:nil];
    _button.showsMenuAsPrimaryAction = YES;
    // The menu marks the current choice with a checkmark, which is only correct
    // if UIKit is told the selection is single-valued.
    _button.changesSelectionAsPrimaryAction = YES;

    self.elementControl = _button;
  }
  return self;
}

/*
 * Rebuilt whenever the options or the selection change, because `UIMenu` is
 * immutable — a menu cannot be edited in place, so the checkmark on the current
 * choice can only move by replacing the whole menu.
 */
- (void)rebuildMenu
{
  const auto &props = static_cast<const ElementSelectProps &>(*_props);
  const int selected = props.selectedIndex();

  NSMutableArray<UIAction *> *actions = [NSMutableArray arrayWithCapacity:props.options.size()];
  for (size_t i = 0; i < props.options.size(); i++) {
    const auto &option = props.options[i];
    NSString *title = RCTNSStringFromString(option.label.empty() ? option.value : option.label);
    __weak __typeof(self) weakSelf = self;
    const std::string value = option.value;
    const int index = static_cast<int>(i);

    UIAction *action = [UIAction actionWithTitle:title
                                           image:nil
                                      identifier:nil
                                         handler:^(__kindof UIAction *_Nonnull) {
                                           [weakSelf optionChosen:value atIndex:index];
                                         }];
    action.state = (index == selected) ? UIMenuElementStateOn : UIMenuElementStateOff;
    // A disabled `<option>` is still listed — it is part of the choice on
    // offer — but cannot be picked, which is what HTML means by it.
    action.attributes = option.disabled ? UIMenuElementAttributesDisabled : 0;
    [actions addObject:action];
  }

  _button.menu = [UIMenu menuWithTitle:@"" children:actions];

  // The button's own label is the current choice, the way a pop-up button reads
  // when the menu is closed.
  NSString *title = @"";
  if (selected >= 0 && selected < (int)props.options.size()) {
    const auto &option = props.options[selected];
    title = RCTNSStringFromString(option.label.empty() ? option.value : option.label);
  }
  UIButtonConfiguration *configuration = _button.configuration;
  configuration.title = title;
  /*
   * One line, truncated with an ellipsis.
   *
   * A configuration-based `UIButton` WRAPS its title by default, so a long
   * option rendered as two centred lines and the control's height clipped them.
   * Neither platform grows a closed select to fit its text: a UIKit pop-up
   * button truncates, and so does `<select>` in iOS Safari — so native UX and
   * the web agree here, and truncation is what both mean by "too long".
   *
   * `titleLineBreakMode` is iOS 16; the `titleLabel` fallback covers 15.1,
   * which is still the deployment target.
   */
  if (@available(iOS 16.0, *)) {
    configuration.titleLineBreakMode = NSLineBreakByTruncatingTail;
  }
  _button.configuration = configuration;
  _button.titleLabel.numberOfLines = 1;
  _button.titleLabel.lineBreakMode = NSLineBreakByTruncatingTail;
}

- (void)optionChosen:(const std::string &)value atIndex:(int)index
{
  if (!_eventEmitter) {
    return;
  }
  std::static_pointer_cast<const ElementSelectEventEmitter>(_eventEmitter)->onElementChange(value, index);
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldSelectProps = static_cast<const ElementSelectProps &>(*_props);
  const auto &newSelectProps = static_cast<const ElementSelectProps &>(*props);

  const bool optionsChanged = oldSelectProps.options != newSelectProps.options;
  const bool valueChanged = oldSelectProps.value != newSelectProps.value;

  if (!_isInitialValueSet || oldSelectProps.disabled != newSelectProps.disabled) {
    _button.enabled = !newSelectProps.disabled;
    self.userInteractionEnabled = !newSelectProps.disabled;
  }

  [super updateProps:props oldProps:oldProps];

  // After `super`, because the menu is rebuilt from `_props` and `super` is
  // what assigns the new props object.
  if (!_isInitialValueSet || optionsChanged || valueChanged) {
    [self rebuildMenu];
  }
  _isInitialValueSet = YES;
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _props = ElementSelectShadowNode::defaultSharedProps();
  _isInitialValueSet = NO;
  _button.enabled = YES;
  _button.menu = nil;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ElementSelectComponentDescriptor>();
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end
