/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementSelectComponentView.h"

#import <React/RCTConversions.h>
#import <react/renderer/components/text/DomElementsRegistry.h>
#import <react/renderer/components/view/ElementSelectShadowNode.h>

#import "RCTComponentViewFactory.h"

using namespace facebook::react;

/*
 * As close to a STOCK pop-up UIButton as it can be.
 *
 * The scroll-during-close ghost (the platter hanging at its pre-scroll
 * position while a finger drags) is UIKit'S OWN: reproduced on a real
 * device in a pure-UIKit screen with no React Native views and in a
 * standalone dependency-free app, while every PROGRAMMATIC scroll during
 * the dismissal tracks perfectly in the same probes — the distinguishing
 * variable is the drag's UITrackingRunLoopMode. Documented as
 * DOM-CSS-DEVIATION(select-dismissal-ghost); stock behavior is what every
 * native app exhibits, so stock is what this element does. Two earlier
 * "fixes" are therefore gone: a dismissal UITargetedPreview (stock already
 * resolves against the live view) and freezing ancestor scroll views (it
 * fought the user's scroll, and a props update re-applying scrollEnabled
 * could silently undo it mid-close anyway). No in-process remedy can exist
 * at all on iOS 26: with a menu open, every window-enumeration route
 * (connected scenes, UIApplication.windows, the key window's scene) sees
 * only the app's own window — the platter renders out of process, beyond
 * any transform this side of the boundary.
 *
 * What the subclass still does is KNOW when the menu is on screen. A Fabric
 * commit lands the moment a selection event does — exactly during the
 * dismissal animation — and rebuilds the menu (UIMenu is immutable; the
 * checkmark can only move by replacement). A whole commit's worth of
 * mounting around that reassignment is the one thing the standalone probe
 * cannot reproduce, so the rebuild waits until the menu has fully left the
 * screen; UIKit already shows the chosen title itself
 * (changesSelectionAsPrimaryAction), so nothing visible waits with it.
 */
@interface EXPElementSelectButton : UIButton
@property(nonatomic, assign, getter=isMenuOnScreen) BOOL menuOnScreen;
@property(nonatomic, copy, nullable) void (^onMenuFullyDismissed)(void);
@end

@implementation EXPElementSelectButton

- (void)contextMenuInteraction:(UIContextMenuInteraction *)interaction
    willDisplayMenuForConfiguration:(UIContextMenuConfiguration *)configuration
                           animator:(id<UIContextMenuInteractionAnimating>)animator
{
  self.menuOnScreen = YES;
  [super contextMenuInteraction:interaction willDisplayMenuForConfiguration:configuration animator:animator];
}

- (void)contextMenuInteraction:(UIContextMenuInteraction *)interaction
       willEndForConfiguration:(UIContextMenuConfiguration *)configuration
                      animator:(id<UIContextMenuInteractionAnimating>)animator
{
  __weak EXPElementSelectButton *weakSelf = self;
  void (^finished)(void) = ^{
    EXPElementSelectButton *strongSelf = weakSelf;
    if (strongSelf == nil) {
      return;
    }
    strongSelf.menuOnScreen = NO;
    void (^pending)(void) = strongSelf.onMenuFullyDismissed;
    strongSelf.onMenuFullyDismissed = nil;
    if (pending != nil) {
      pending();
    }
  };
  if (animator != nil) {
    [animator addCompletion:finished];
  } else {
    finished();
  }
  [super contextMenuInteraction:interaction willEndForConfiguration:configuration animator:animator];
}

// Unmounted mid-menu: nothing left to defer for.
- (void)willMoveToWindow:(UIWindow *)newWindow
{
  if (newWindow == nil) {
    self.menuOnScreen = NO;
    self.onMenuFullyDismissed = nil;
  }
  [super willMoveToWindow:newWindow];
}

@end

@implementation EXPElementSelectComponentView {
  EXPElementSelectButton *_button;
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
  // what assigns the new props object. While the menu is on screen —
  // including its dismissal animation, which is exactly when the
  // selection's own commit lands — the rebuild waits: replacing an
  // in-flight presentation's menu is the one interference a Fabric commit
  // adds over the probed stock behaviour, and the content only matters for
  // the NEXT open. rebuildMenu reads _props at call time, so the deferred
  // run always builds from the latest.
  if (!_isInitialValueSet || optionsChanged || valueChanged) {
    if (_button.isMenuOnScreen) {
      __weak EXPElementSelectComponentView *weakSelf = self;
      _button.onMenuFullyDismissed = ^{
        [weakSelf rebuildMenu];
      };
    } else {
      [self rebuildMenu];
    }
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
  _button.menuOnScreen = NO;
  _button.onMenuFullyDismissed = nil;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  // The MEASURED descriptor (DomElementsRegistry): shrink-to-fit needs the
  // text-side label measurer injected on adopt.
  return concreteComponentDescriptorProvider<dom::ElementSelectMeasuredComponentDescriptor>();
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end
