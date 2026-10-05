/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementSelectComponentView.h"

#import <React/RCTAssert.h>

#import "EXPElementControlMetricsProbe.h"

#import <React/RCTConversions.h>
#import <react/renderer/components/text/DomElementsRegistry.h>
#import <react/renderer/components/view/ElementSelectShadowNode.h>

#import "RCTComponentViewFactory.h"

using namespace facebook::react;

/*
 * A stock pop-up UIButton. DOM-CSS-DEVIATION(select-dismissal-ghost): the
 * platter hanging at its pre-scroll position while a finger drags during the
 * dismissal is UIKit's own (reproduced in a pure-UIKit app; a programmatic
 * scroll tracks), and on iOS 26 the platter renders out of process, beyond
 * any in-process remedy. The subclass knows when the menu is on screen: a
 * selection's commit rebuilds the immutable UIMenu, and the rebuild waits
 * until the menu has left; `changesSelectionAsPrimaryAction` already shows
 * the chosen title.
 */
@interface EXPElementSelectButton : UIButton
@property (nonatomic, assign, getter=isMenuOnScreen) BOOL menuOnScreen;
@property (nonatomic, copy, nullable) void (^onMenuFullyDismissed)(void);
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

// Shared with the probe, so the measured chrome is the mounted button's
UIButton *EXPMakeElementSelectButton(void)
{
  // A pop-up button: the system's own control for choosing one of a short
  // list. `showsMenuAsPrimaryAction` is what makes a single tap open the menu
  // rather than requiring a long press, which is the difference between a
  // pop-up button and a context menu.
  UIButtonConfiguration *configuration = [UIButtonConfiguration borderedButtonConfiguration];
  configuration.cornerStyle = UIButtonConfigurationCornerStyleMedium;
  EXPElementSelectButton *button = [EXPElementSelectButton buttonWithConfiguration:configuration primaryAction:nil];
  button.showsMenuAsPrimaryAction = YES;
  // The menu marks the current choice with a checkmark, which is only correct
  // if UIKit is told the selection is single-valued.
  button.changesSelectionAsPrimaryAction = YES;
  return button;
}

@implementation EXPElementSelectComponentView {
  EXPElementSelectButton *_button;
  BOOL _isInitialValueSet;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ElementSelectShadowNode::defaultSharedProps();

    _button = EXPMakeElementSelectButton();

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
  // A configuration-based `UIButton` wraps its title by default; a pop-up
  // button and `<select>` in iOS Safari both truncate. `titleLineBreakMode`
  // is iOS 16; the `titleLabel` fallback covers the 15.1 deployment target
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

// Published as the whole control's width for a probe title, not as a chrome:
// layout subtracts the text engine's width of the same string, so the two
// engines' disagreement cancels
void EXPProbeSelectMetrics(facebook::react::ElementControlMetrics &metrics)
{
  RCTAssertMainQueue();
  NSString *title = [NSString stringWithUTF8String:facebook::react::elementSelectProbeTitle().c_str()];
  UIButton *button = EXPMakeElementSelectButton();
  UIButtonConfiguration *configuration = button.configuration;
  configuration.title = title;
  button.configuration = configuration;
  button.menu = [UIMenu menuWithTitle:@""
                             children:@[ [UIAction actionWithTitle:title
                                                             image:nil
                                                        identifier:nil
                                                           handler:^(__unused UIAction *action){
                                                           }] ]];

  // Traits descend from a window, and a button outside one keeps whatever it
  // was born with — which for a title font that follows the reader's text-size
  // setting is the difference between the app's size and a default.
  UIWindow *window = [[UIWindow alloc] initWithFrame:CGRectMake(0, 0, 400, 200)];
  [window addSubview:button];
  [window layoutIfNeeded];
  [button sizeToFit];
  [button layoutIfNeeded];
  const CGSize size = button.bounds.size;
  UIFont *titleFont = button.titleLabel.font;
  const CGFloat baseline = EXPTextBaselineInView(button.titleLabel, button);
  [button removeFromSuperview];

  if (size.width > 0 && size.height > 0) {
    metrics.selectProbeIntrinsicWidth = static_cast<facebook::react::Float>(size.width);
    metrics.selectBlockSize = static_cast<facebook::react::Float>(size.height);
    metrics.selectBaseline = static_cast<facebook::react::Float>(baseline);
  }
  if (titleFont != nil && titleFont.pointSize > 0) {
    metrics.selectLabelFontSize = static_cast<facebook::react::Float>(titleFont.pointSize);
  }
}
