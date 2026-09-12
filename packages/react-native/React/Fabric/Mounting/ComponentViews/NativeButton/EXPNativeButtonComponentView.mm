/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPNativeButtonComponentView.h"

#import <CoreText/CoreText.h>

#import <React/EXPElementHaptics.h>
#import <React/EXPMenuAnchorButton.h>
#import <React/RCTComponentViewFactory.h>
#import <React/RCTConversions.h>
#import <react/renderer/components/view/ExpoNativeButtonShadowNode.h>
#include <vector>

using namespace facebook::react;

/**
 * How far to lift a title so its ink is centred rather than its line box.
 * `UIButtonConfiguration` centres the line box, which reserves descender space
 * a `+` does not use, so the glyph lands low. The correction is the line box's
 * centre (`ascender - lineHeight/2` above the baseline) minus the ink's centre
 * from Core Text's bounding rect. Applied as a content inset: a baseline offset
 * also grows the line box, so the ink moves only part of the way. 0 when there
 * are no glyphs to measure.
 */
static CGFloat EXPInkCentringOffset(UIFont *font, NSString *title)
{
  if (font == nil || title.length == 0) {
    return 0;
  }
  NSUInteger length = title.length;
  std::vector<UniChar> characters(length);
  [title getCharacters:characters.data() range:NSMakeRange(0, length)];
  std::vector<CGGlyph> glyphs(length);
  if (!CTFontGetGlyphsForCharacters((__bridge CTFontRef)font, characters.data(), glyphs.data(), (CFIndex)length)) {
    // A character the font cannot draw; UIKit's own centring is better than a
    // rect that describes something else
    return 0;
  }
  const CGRect ink = CTFontGetBoundingRectsForGlyphs(
      (__bridge CTFontRef)font, kCTFontOrientationDefault, glyphs.data(), NULL, (CFIndex)length);
  if (CGRectIsNull(ink) || CGRectIsEmpty(ink)) {
    return 0;
  }
  const CGFloat inkCentreAboveBaseline = CGRectGetMidY(ink);
  const CGFloat boxCentreAboveBaseline = font.ascender - font.lineHeight / 2;
  return boxCentreAboveBaseline - inkCentreAboveBaseline;
}

@implementation EXPNativeButtonComponentView {
  UIButton *_button;
  // On iOS 26, an interactive `UIGlassEffect` view with the button inside it:
  // the same construction as a glass field, which is what lets the two merge
  // in a `UIGlassContainerEffect`, since glass merges only with its own kind
  // and a `glassButtonConfiguration` is another kind
  UIVisualEffectView *_glass;
  // Set on `_glass` only for the `glass` configuration
  UIVisualEffect *_glassEffect;
  // An invisible button that exists only to be lifted, for a view in a window
  // above the one UIKit draws a menu's lift in; the real button keeps its
  // touches and its glass press
  UIButton *_menuAnchor;
  std::vector<ElementMenuCommand> _appliedCommands;
  std::string _appliedTitle;
  std::string _appliedSystemImage;
  Float _appliedTitleSize;
  std::string _appliedConfiguration;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const ExpoNativeButtonProps>();
    _props = defaultProps;

    _button = [UIButton buttonWithType:UIButtonTypeSystem];
    // The button is hit-tested itself, so it gets the platform's own press
    _button.showsMenuAsPrimaryAction = YES;
    [_button addTarget:self action:@selector(_buttonTapped) forControlEvents:UIControlEventTouchUpInside];
    _button.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    // Hidden, not merely not an element: a configured `UIButton` puts its
    // title back as an element named after the decorative glyph
    _button.isAccessibilityElement = NO;
    _button.accessibilityElementsHidden = YES;
#if defined(__IPHONE_26_0) && __IPHONE_OS_VERSION_MAX_ALLOWED >= __IPHONE_26_0
    if (@available(iOS 26.0, *)) {
      UIGlassEffect *glass = [UIGlassEffect effectWithStyle:UIGlassEffectStyleRegular];
      glass.interactive = YES;
      _glassEffect = glass;
      _glass = [[UIVisualEffectView alloc] initWithEffect:glass];
      _glass.cornerConfiguration = [UICornerConfiguration capsuleConfiguration];
      _glass.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
      [_glass.contentView addSubview:_button];
      [self addSubview:_glass];
    }
#endif
    if (_glass == nil) {
      [self addSubview:_button];
    }
  }
  return self;
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  _glass.frame = self.bounds;
  _button.frame = _glass != nil ? _glass.contentView.bounds : self.bounds;
  // The menu is positioned against the anchor, so it has to be where the
  // button is
  _menuAnchor.frame = self.bounds;
}

// Presenting a menu draws its source's lift in a `UITextEffectsWindow` at
// window level 1; a view in a window above that is lifted underneath its own
// window, where nothing of it is seen
- (BOOL)_menuLiftWouldBeVisible
{
  return self.window == nil || self.window.windowLevel <= UIWindowLevelNormal;
}

// The menu is presented from the button where its lift can be seen, and from
// the anchor everywhere else, driven by the button's `touchUpInside` through
// `performPrimaryAction` so the touch and the glass press stay with the button
- (void)_installMenuSource
{
  if ([self _menuLiftWouldBeVisible]) {
    if (_menuAnchor != nil) {
      [_menuAnchor removeFromSuperview];
      _menuAnchor = nil;
    }
    _button.showsMenuAsPrimaryAction = YES;
    return;
  }

  if (_menuAnchor == nil) {
    _menuAnchor = [EXPMenuAnchorButton buttonWithType:UIButtonTypeCustom];
    _menuAnchor.showsMenuAsPrimaryAction = YES;
    _menuAnchor.backgroundColor = UIColor.clearColor;
    // A position, not a control: never a target and hidden from the tree,
    // where it would read as a disabled button over a working one
    _menuAnchor.userInteractionEnabled = NO;
    _menuAnchor.isAccessibilityElement = NO;
    _menuAnchor.accessibilityElementsHidden = YES;
    _menuAnchor.frame = self.bounds;
    [self addSubview:_menuAnchor];
  }
  // Off the real button, or both paths to the same tap would open a menu
  _button.showsMenuAsPrimaryAction = NO;
}

- (void)_buttonTapped
{
  // No commands: the tap is the app's, reported as a press
  if (_appliedCommands.empty()) {
    if (_eventEmitter != nullptr) {
      std::static_pointer_cast<const ExpoNativeButtonEventEmitter>(_eventEmitter)->onPress();
    }
    return;
  }
  if (_menuAnchor == nil) {
    return;
  }
  // A selection generator, as the platform's own menu buttons use
  [EXPElementHaptics selectionChanged];
  if (@available(iOS 17.4, *)) {
    [_menuAnchor performPrimaryAction];
  }
}

// The menu source depends on the window, and at the first update there is none
- (void)didMoveToWindow
{
  [super didMoveToWindow];
  [self _installMenuSource];
  [self _applyMenu];
}

// Host chrome, so the mutation stream's child indices skip these subviews
- (BOOL)hasHostChromeSubviews
{
  return YES;
}

- (BOOL)isHostChromeSubview:(UIView *)view
{
  return view == _button || view == _glass || view == _menuAnchor || [super isHostChromeSubview:view];
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &next = *std::static_pointer_cast<const ExpoNativeButtonProps>(props);
  [super updateProps:props oldProps:oldProps];

  // This view is the control for assistive technology; `RCTViewComponentView`
  // makes a view an element only when the author asks. After `super`, which
  // applies the accessibility props.
  self.isAccessibilityElement = YES;
  self.accessibilityTraits |= UIAccessibilityTraitButton;
  if (self.accessibilityLabel.length == 0 && !next.title.empty()) {
    // A fallback: an author who names the control wins
    self.accessibilityLabel = RCTNSStringFromString(next.title);
  }

  if (next.title != _appliedTitle || next.systemImage != _appliedSystemImage || next.titleSize != _appliedTitleSize ||
      next.configuration != _appliedConfiguration) {
    _appliedTitle = next.title;
    _appliedSystemImage = next.systemImage;
    _appliedTitleSize = next.titleSize;
    _appliedConfiguration = next.configuration;
    [self _applyConfiguration];
  }
  if (next.commands != _appliedCommands) {
    _appliedCommands = next.commands;
    [self _applyMenu];
  }
}

/**
 * The configuration by UIKit's own names. `glass` is a plain configuration
 * inside the glass effect view; every other name leaves the effect view drawing
 * nothing, since hiding it would hide the button inside. Before iOS 26 `glass`
 * is `tinted` and `prominentGlass` is `filled`.
 */
- (void)_applyConfiguration
{
  const std::string &name = _appliedConfiguration;
  UIButtonConfiguration *config = nil;
  BOOL insideGlass = NO;
  if (name == "gray") {
    config = [UIButtonConfiguration grayButtonConfiguration];
  } else if (name == "tinted") {
    config = [UIButtonConfiguration tintedButtonConfiguration];
  } else if (name == "filled") {
    config = [UIButtonConfiguration filledButtonConfiguration];
  } else if (name == "glass" || name == "prominentGlass") {
#if defined(__IPHONE_26_0) && __IPHONE_OS_VERSION_MAX_ALLOWED >= __IPHONE_26_0
    if (@available(iOS 26.0, *)) {
      if (name == "glass") {
        // The label colour of a glass button rather than the plain one's tint
        config = [UIButtonConfiguration plainButtonConfiguration];
        config.baseForegroundColor = UIColor.labelColor;
        insideGlass = _glass != nil;
      } else {
        config = [UIButtonConfiguration prominentGlassButtonConfiguration];
      }
    }
#endif
    if (config == nil) {
      config = name == "glass" ? [UIButtonConfiguration tintedButtonConfiguration]
                               : [UIButtonConfiguration filledButtonConfiguration];
    }
  } else {
    config = [UIButtonConfiguration plainButtonConfiguration];
  }
  _glass.effect = insideGlass ? _glassEffect : nil;
  if (!_appliedSystemImage.empty()) {
    config.image = [UIImage systemImageNamed:RCTNSStringFromString(_appliedSystemImage)];
  } else if (!_appliedTitle.empty()) {
    config.title = RCTNSStringFromString(_appliedTitle);
    if (_appliedTitleSize > 0) {
      // Through the configuration's transformer: a configured button rebuilds
      // its label from the configuration, so `titleLabel.font` is ignored
      UIFont *const font = [UIFont systemFontOfSize:_appliedTitleSize];
      config.titleTextAttributesTransformer =
          ^NSDictionary<NSAttributedStringKey, id> *(NSDictionary<NSAttributedStringKey, id> *incoming)
      {
        NSMutableDictionary *attributes = [incoming mutableCopy];
        attributes[NSFontAttributeName] = font;
        return attributes;
      };
      // A bottom inset of twice the correction moves the centred content up by
      // the correction; a title whose ink already sits high is left alone
      const CGFloat lift = EXPInkCentringOffset(font, config.title);
      if (lift > 0) {
        config.contentInsets = NSDirectionalEdgeInsetsMake(0, 0, 2 * lift, 0);
      }
    }
  }
  _button.configuration = config;
}

// `UIMenu` is immutable, so the menu is rebuilt when the commands change
- (void)_applyMenu
{
  UIButton *const source = _menuAnchor != nil ? _menuAnchor : _button;
  if (source != _button) {
    _button.menu = nil;
  }
  if (_appliedCommands.empty()) {
    source.menu = nil;
    return;
  }
  NSMutableArray<UIAction *> *actions = [NSMutableArray arrayWithCapacity:_appliedCommands.size()];
  for (const auto &command : _appliedCommands) {
    __weak __typeof(self) weakSelf = self;
    const std::string identifier = command.id;
    UIAction *action = [UIAction actionWithTitle:RCTNSStringFromString(command.label)
                                           image:nil
                                      identifier:nil
                                         handler:^(__kindof UIAction *_Nonnull) {
                                           [weakSelf _emitCommand:identifier];
                                         }];
    UIMenuElementAttributes attributes = 0;
    if (command.disabled) {
      attributes |= UIMenuElementAttributesDisabled;
    }
    if (command.destructive) {
      attributes |= UIMenuElementAttributesDestructive;
    }
    action.attributes = attributes;
    [actions addObject:action];
  }
  source.menu = [UIMenu menuWithTitle:@"" children:actions];
}

/// The glass a presentation zooms out of: the effect view around the button
/// where there is one, the button's own glass configuration otherwise.
- (nullable UIView *)exp_glassView
{
  return _glass.effect != nil ? _glass : _button;
}

- (void)_emitCommand:(const std::string &)identifier
{
  if (_eventEmitter == nullptr) {
    return;
  }
  std::static_pointer_cast<const ExpoNativeButtonEventEmitter>(_eventEmitter)->onCommand(identifier);
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  [_menuAnchor removeFromSuperview];
  _menuAnchor = nil;
  _button.menu = nil;
  _button.showsMenuAsPrimaryAction = YES;
  _appliedCommands.clear();
  _appliedTitle.clear();
  _appliedSystemImage.clear();
  _appliedTitleSize = 0;
  _appliedConfiguration.clear();
  _glass.effect = nil;
}

#pragma mark - RCTComponentViewProtocol

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ExpoNativeButtonComponentDescriptor>();
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end
