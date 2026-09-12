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
 * How far to LIFT a title so its ink is centred rather than its line box.
 *
 * `UIButtonConfiguration` centres the title's line box, and a line box is not
 * symmetric about the glyphs inside it: it reserves descender space below the
 * baseline that a `+` — or any character without a descender — does not use. So
 * a `+` centred by its line box is drawn low. Measured on the composer's three
 * buttons: the two that draw their glyph as a text run land 0.17 points below
 * centre, and this one landed 1.50 points below, which is what a reader sees as
 * "the icons aren't all centred".
 *
 * The correction is the difference between the two centres. The line box's
 * centre sits `ascender - lineHeight/2` above the baseline; the ink's centre
 * comes from Core Text's own bounding rect for the string's glyphs, so this is
 * right for a word, a symbol or a `+` rather than tuned for one of them.
 *
 * Applied as a CONTENT INSET rather than a baseline offset, and that is not a
 * detail. A baseline offset moves the text inside its line box and grows the
 * box by the same amount, so the box's centre follows and the ink travels some
 * fraction of what was asked — measured at roughly half, and not linearly.
 * Content insets shrink the area the content is centred in, so a bottom inset
 * of `2L` moves the centre up by exactly `L`.
 *
 * Returns 0 when there are no glyphs to measure, which leaves UIKit's own
 * centring in place rather than inventing a number for nothing.
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
    // A character the font cannot draw. Leaving it to UIKit is better than
    // offsetting by a rect that describes something else.
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
  /*
   * The glass, on iOS 26: a `UIVisualEffectView` with an interactive
   * `UIGlassEffect`, with the button inside it. The same construction as a
   * glass field beside it, which is what lets the two merge in a
   * `UIGlassContainerEffect` — glass merges only with its own kind, and a
   * `glassButtonConfiguration` is another kind: on a phone the pressed `+`
   * never merged into the system chat-like field. The button inside takes the
   * touch, and the effect's press follows it; the effect view is what a
   * presentation zooms out of.
   */
  UIVisualEffectView *_glass;
  /** `_glass`'s effect, on it only for the `glass` configuration. */
  UIVisualEffect *_glassEffect;
  /*
   * An invisible second button that exists only to be LIFTED.
   *
   * Present when this view sits in a window above the one UIKit draws a menu's
   * lift in — an accessory's, at level 10000001 against the lift's 1. There the
   * lift is drawn beneath the bar it came from, so a menu presented from the
   * real button makes the real button disappear for as long as the menu is up.
   * Lifting an empty view instead costs nothing, and the real button keeps its
   * own touches, which is where its glass press comes from.
   */
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
    /*
     * The button is the TARGET, not a picture of one: it is hit-tested itself,
     * so it gets the platform's own press — the glass grows and brightens, on
     * the platform's curve, with nothing measured or reproduced — and a
     * `<button>`'s `click`, which React's pointer system dispatches from the
     * element's own touches, is not needed here.
     */
    _button.showsMenuAsPrimaryAction = YES;
    [_button addTarget:self action:@selector(_buttonTapped) forControlEvents:UIControlEventTouchUpInside];
    _button.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    /*
     * HIDDEN, not merely "not an element".
     *
     * `isAccessibilityElement = NO` says this view is not itself a target; it
     * says nothing about what is inside it, and a configured `UIButton` puts its
     * title back as one. Read out of the accessibility tree, the control
     * appeared twice: once as this component view and once as a `Button` whose
     * name was the decorative glyph — announced as "plus" rather than as what
     * the button does.
     *
     * `accessibilityElementsHidden` takes the whole subtree out, which is the
     * thing that was wanted.
     */
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
  // The anchor is what the menu is positioned against, so it has to be where
  // the button is — not merely present. An anchor left at a zero frame put the
  // menu's pointer on the wrong corner of the screen.
  _menuAnchor.frame = self.bounds;
}

/**
 * Whether UIKit's LIFT will be visible from this view's window.
 *
 * Presenting a menu lifts its source out of the tree and draws it in a
 * `UITextEffectsWindow` — measured at window level 1, against the app's own
 * window at level 0, which is why the lift reads as the button rising off the
 * screen. A view in a window ABOVE that level is still lifted, but underneath
 * the window it came from, so nothing of it is seen. An accessory is exactly
 * that case: `UIRemoteKeyboardWindow`, measured at level 10000001.
 */
- (BOOL)_menuLiftWouldBeVisible
{
  return self.window == nil || self.window.windowLevel <= UIWindowLevelNormal;
}

/**
 * Where the menu is presented FROM: the button itself, or the anchor.
 *
 * The button, wherever its lift can be seen — that is the platform's own
 * behaviour and the morph from button to panel is part of it. The anchor
 * everywhere else, driven by the button's own `touchUpInside` through
 * `performPrimaryAction`, which is UIKit's way of asking a menu button to do
 * what a tap would. So the touch still belongs to the real button — and so,
 * therefore, does the glass press — while the thing UIKit takes away is empty.
 */
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
    /*
     * Never a target and never announced: it is a position, not a control.
     *
     * Hidden as well as excluded, for the same reason as the button above — and
     * with a visible consequence of its own: an anchor is not interactive, so
     * anything that reached it in the tree read as a DISABLED button sitting on
     * top of a working one.
     */
    _menuAnchor.userInteractionEnabled = NO;
    _menuAnchor.isAccessibilityElement = NO;
    _menuAnchor.accessibilityElementsHidden = YES;
    _menuAnchor.frame = self.bounds;
    [self addSubview:_menuAnchor];
  }
  /*
   * OFF the real button, or both would open: `showsMenuAsPrimaryAction` and a
   * `touchUpInside` handler are two separate paths to the same tap.
   */
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
  // The `+`'s own feedback: a selection generator, as the platform's own `+` uses.
  [EXPElementHaptics selectionChanged];
  if (@available(iOS 17.4, *)) {
    [_menuAnchor performPrimaryAction];
  }
}

/*
 * The choice depends on which WINDOW this view is in, and at the first update
 * it is usually in none.
 */
- (void)didMoveToWindow
{
  [super didMoveToWindow];
  [self _installMenuSource];
  [self _applyMenu];
}

/*
 * Registered as host chrome, not merely added.
 *
 * The mutation stream numbers a view's children, and a subview it does not know
 * about shifts every index after it — which is how two other elements in this
 * tree learned to abort on unmount. This element has no React children today,
 * and saying so here is what keeps that true if it ever gains some.
 */
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

  /*
   * THIS view is the control, as far as anything assistive is concerned.
   *
   * `RCTViewComponentView` only makes a view an accessibility element when the
   * author asks with `accessible`, which is the right default for a box and the
   * wrong one for a control: without it VoiceOver walked past this view into its
   * subviews and announced the button as "plus", the decorative glyph, instead
   * of the label the author gave it. See `accessible-name-from-contents`.
   *
   * Set after `super`, because that is what applies the accessibility props and
   * would otherwise overwrite this.
   */
  self.isAccessibilityElement = YES;
  self.accessibilityTraits |= UIAccessibilityTraitButton;
  if (self.accessibilityLabel.length == 0 && !next.title.empty()) {
    // A fallback rather than the answer: an author who names the control wins,
    // and this only keeps an unnamed one from being silent.
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
 * The button's configuration, by UIKit's own names (`configuration` in the
 * props). `glass` is a plain configuration inside the glass effect view (see
 * `_glass`); every other name is the stock configuration, with the effect
 * view drawing nothing (hiding it would hide the button inside it). Before
 * iOS 26 `glass` is `tinted` and `prominentGlass` is `filled`, what the system
 * used for the same job. The label goes INTO the configuration rather than
 * being added as a subview, so the button draws it.
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
      /*
       * Through the configuration's transformer, which is where a
       * `UIButtonConfiguration` lets its title's attributes be set. Assigning
       * `titleLabel.font` instead is ignored: a configured button rebuilds the
       * label from the configuration on every update.
       */
      UIFont *const font = [UIFont systemFontOfSize:_appliedTitleSize];
      config.titleTextAttributesTransformer =
          ^NSDictionary<NSAttributedStringKey, id> *(NSDictionary<NSAttributedStringKey, id> *incoming)
      {
        NSMutableDictionary *attributes = [incoming mutableCopy];
        attributes[NSFontAttributeName] = font;
        return attributes;
      };
      /*
       * Centred by its INK, which is what a reader means by centred.
       *
       * A bottom inset of twice the correction moves the centred content up by
       * the correction itself. Only ever a lift here — a title whose ink already
       * sits above centre is left alone rather than pushed down, because the
       * insets would then have to come off the top and a button this size has no
       * room to spare in either direction for a correction nobody can see.
       */
      const CGFloat lift = EXPInkCentringOffset(font, config.title);
      if (lift > 0) {
        config.contentInsets = NSDirectionalEdgeInsetsMake(0, 0, 2 * lift, 0);
      }
    }
  }
  _button.configuration = config;
}

/**
 * The menu, rebuilt whenever the commands change.
 *
 * `UIMenu` is immutable, so there is no editing one in place — and the guard in
 * `updateProps` is what keeps that from meaning a rebuild on every commit.
 */
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
