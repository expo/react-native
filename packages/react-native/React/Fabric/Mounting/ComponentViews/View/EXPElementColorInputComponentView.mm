/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementColorInputComponentView.h"

#import <React/RCTConversions.h>
#import <react/renderer/components/view/ElementColorInputShadowNode.h>

#import "RCTComponentViewFactory.h"

using namespace facebook::react;

#pragma mark - Colour <-> `#rrggbb`

/*
 * The DOM's format, and only that format: seven characters, lowercase, no
 * alpha. `<input type="color">` has no notion of transparency, so an alpha
 * component is dropped rather than encoded — encoding it would produce a value
 * no browser would accept back.
 */
static NSString *RCTHexFromColor(UIColor *color)
{
  CGFloat red = 0, green = 0, blue = 0, alpha = 0;
  if (![color getRed:&red green:&green blue:&blue alpha:&alpha]) {
    return @"#000000";
  }
  const int r = (int)lround(std::clamp(red, (CGFloat)0, (CGFloat)1) * 255);
  const int g = (int)lround(std::clamp(green, (CGFloat)0, (CGFloat)1) * 255);
  const int b = (int)lround(std::clamp(blue, (CGFloat)0, (CGFloat)1) * 255);
  return [NSString stringWithFormat:@"#%02x%02x%02x", r, g, b];
}

static UIColor *RCTColorFromHex(NSString *hex)
{
  if (hex.length != 7 || ![hex hasPrefix:@"#"]) {
    return [UIColor blackColor];
  }
  unsigned int rgb = 0;
  if (![[NSScanner scannerWithString:[hex substringFromIndex:1]] scanHexInt:&rgb]) {
    return [UIColor blackColor];
  }
  return [UIColor colorWithRed:((rgb >> 16) & 0xFF) / 255.0
                         green:((rgb >> 8) & 0xFF) / 255.0
                          blue:(rgb & 0xFF) / 255.0
                         alpha:1.0];
}

#pragma mark - Component view

@interface EXPElementColorInputComponentView () <UIColorPickerViewControllerDelegate>
@end

@implementation EXPElementColorInputComponentView {
  UIButton *_swatch;
  BOOL _isInitialValueSet;

  /*
   * The last colour reported as committed — the value at the moment the picker
   * opened, then whatever `change` last carried.
   *
   * Compared against rather than the opening value alone, because both a
   * discrete pick and dismissing the picker are commits, and a single tap
   * reaches both. Measured before this: one pick fired `change` twice.
   */
  NSString *_lastCommittedColor;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ElementColorInputShadowNode::defaultSharedProps();

    _swatch = [UIButton buttonWithType:UIButtonTypeCustom];
    _swatch.layer.cornerRadius = 6;
    _swatch.layer.borderWidth = 1;
    _swatch.layer.borderColor = [UIColor separatorColor].CGColor;
    _swatch.clipsToBounds = YES;
    [_swatch addTarget:self action:@selector(swatchTapped) forControlEvents:UIControlEventTouchUpInside];
    // A swatch is a colour, not a label — it has nothing to read out, so it says
    // what it is and lets the value carry the colour.
    _swatch.isAccessibilityElement = YES;
    _swatch.accessibilityTraits = UIAccessibilityTraitButton;
    _swatch.accessibilityLabel = @"Colour";

    self.elementControl = _swatch;
  }
  return self;
}

- (void)swatchTapped
{
  const auto &props = static_cast<const ElementColorInputProps &>(*_props);
  _lastCommittedColor = RCTNSStringFromString(props.value);

  UIColorPickerViewController *picker = [UIColorPickerViewController new];
  picker.delegate = self;
  picker.selectedColor = RCTColorFromHex(_lastCommittedColor);
  // No alpha slider: `<input type="color">` has no alpha, and offering one would
  // let the user choose something the element cannot represent.
  picker.supportsAlpha = NO;

  // Presented from whatever is currently on screen. Walking up from the view's
  // own window rather than assuming the root controller keeps this working
  // inside a modal, which is where forms often live.
  UIViewController *presenter = self.window.rootViewController;
  while (presenter.presentedViewController != nil) {
    presenter = presenter.presentedViewController;
  }
  [presenter presentViewController:picker animated:YES completion:nil];
}

#pragma mark - UIColorPickerViewControllerDelegate

- (void)colorPickerViewController:(UIColorPickerViewController *)viewController
            didSelectColor:(UIColor *)color
       continuously:(BOOL)continuously
{
  if (!_eventEmitter) {
    return;
  }
  NSString *hex = RCTHexFromColor(color);
  auto emitter = std::static_pointer_cast<const ElementColorInputEventEmitter>(_eventEmitter);
  // `continuously` is exactly the DOM's distinction: dragging through the
  // spectrum is `input`, and the colour the picker settles on is `change`.
  emitter->onElementInput(RCTStringFromNSString(hex));
  if (!continuously && ![hex isEqualToString:_lastCommittedColor]) {
    _lastCommittedColor = hex;
    emitter->onElementChange(RCTStringFromNSString(hex));
  }
}

- (void)colorPickerViewControllerDidFinish:(UIColorPickerViewController *)viewController
{
  if (!_eventEmitter) {
    return;
  }
  NSString *hex = RCTHexFromColor(viewController.selectedColor);
  // Dismissing is a commit too, but only for a colour that has not already been
  // committed — dragging the spectrum and letting go reports here, while a
  // discrete tap has already reported above.
  if (![hex isEqualToString:_lastCommittedColor]) {
    _lastCommittedColor = hex;
    std::static_pointer_cast<const ElementColorInputEventEmitter>(_eventEmitter)
        ->onElementChange(RCTStringFromNSString(hex));
  }
}

#pragma mark - RCTComponentViewProtocol

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldColorProps = static_cast<const ElementColorInputProps &>(*_props);
  const auto &newColorProps = static_cast<const ElementColorInputProps &>(*props);

  if (!_isInitialValueSet || oldColorProps.value != newColorProps.value) {
    UIColor *color = RCTColorFromHex(RCTNSStringFromString(newColorProps.value));
    _swatch.backgroundColor = color;
    _swatch.accessibilityValue = RCTNSStringFromString(newColorProps.value);
  }

  if (!_isInitialValueSet || oldColorProps.disabled != newColorProps.disabled) {
    _swatch.enabled = !newColorProps.disabled;
    self.userInteractionEnabled = !newColorProps.disabled;
  }

  _isInitialValueSet = YES;

  [super updateProps:props oldProps:oldProps];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _props = ElementColorInputShadowNode::defaultSharedProps();
  _isInitialValueSet = NO;
  _lastCommittedColor = nil;
  _swatch.enabled = YES;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ElementColorInputComponentDescriptor>();
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end
