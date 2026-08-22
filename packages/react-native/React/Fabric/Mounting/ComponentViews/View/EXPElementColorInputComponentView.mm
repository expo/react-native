/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementColorInputComponentView.h"

#import <React/RCTAssert.h>
#import <React/RCTConversions.h>

#import <react/renderer/components/view/ElementColorInputShadowNode.h>
#import "EXPElementControlMetricsProbe.h"

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

@interface EXPElementColorInputComponentView ()
@end

@implementation EXPElementColorInputComponentView {
  UIColorWell *_well;
  /* The picker the WELL put up, watched so `change` can be told when it goes. */
  __weak UIViewController *_openPicker;
  CADisplayLink *_pickerWatch;
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

    /*
     * The platform's own colour control, not a swatch that resembles one.
     *
     * A `UIColorWell` draws the current colour the way the OS draws it, sizes
     * itself, and presents the system picker on its own. What was here before
     * was a `UIButton` with a corner radius and a border chosen by hand, which
     * looked like a colour well the way anything square and coloured does.
     */
    _well = [[UIColorWell alloc] initWithFrame:CGRectZero];
    // No alpha: `<input type="color">` has none, and offering one would let the
    // user choose something the element cannot represent.
    _well.supportsAlpha = NO;
    [_well addTarget:self action:@selector(wellChanged) forControlEvents:UIControlEventValueChanged];
    // A swatch is a colour, not a label — it has nothing to read out, so it says
    // what it is and lets the value carry the colour.
    _well.accessibilityLabel = @"Colour";

    self.elementControl = _well;
  }
  return self;
}

- (void)wellChanged
{
  if (!_eventEmitter) {
    return;
  }
  // Every step of a drag is an `input`, which is exactly the DOM's rule — a
  // 1.2-second pass across the spectrum reports 56 times, measured.
  NSString *hex = RCTHexFromColor(_well.selectedColor);
  std::static_pointer_cast<const ElementColorInputEventEmitter>(_eventEmitter)
      ->onElementInput(RCTStringFromNSString(hex));
  [self watchForThePickerClosing];
}

/*
 * `change` is the colour the user SETTLED on, and the well will not say when
 * that is.
 *
 * A `UIColorWell` presents its own picker and is a bare `UIControl`: no
 * delegate, no lifecycle, and — measured — nothing at all emitted when the
 * picker is dismissed. Only `valueChanged`, continuously. So committing on
 * every one of those would fire `change` twenty-odd times for one colour,
 * which is not what `change` means.
 *
 * The dismissal is a real state change rather than a moment to guess at, so it
 * is WATCHED rather than waited for: the picker the well put up is found once,
 * and when it is no longer presented the settled colour is committed. That is
 * the same lesson as the composer's — a deadline is not a quiet moment, and
 * the host knows when it has stopped.
 *
 * Nothing starts until a colour actually changes, so opening the picker and
 * closing it again commits nothing, which is also correct.
 */
- (void)watchForThePickerClosing
{
  if (_pickerWatch != nil) {
    return;
  }
  UIViewController *presented = self.window.rootViewController;
  while (presented.presentedViewController != nil) {
    presented = presented.presentedViewController;
  }
  if (presented == nil || presented == self.window.rootViewController) {
    return;
  }
  _openPicker = presented;
  _pickerWatch = [CADisplayLink displayLinkWithTarget:self selector:@selector(checkThePicker)];
  [_pickerWatch addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
}

- (void)checkThePicker
{
  UIViewController *picker = _openPicker;
  if (picker != nil && picker.presentingViewController != nil && picker.viewIfLoaded.window != nil) {
    return;
  }
  [self stopWatchingThePicker];

  if (!_eventEmitter) {
    return;
  }
  NSString *hex = RCTHexFromColor(_well.selectedColor);
  if (![hex isEqualToString:_lastCommittedColor]) {
    _lastCommittedColor = hex;
    std::static_pointer_cast<const ElementColorInputEventEmitter>(_eventEmitter)
        ->onElementChange(RCTStringFromNSString(hex));
  }
}

- (void)stopWatchingThePicker
{
  [_pickerWatch invalidate];
  _pickerWatch = nil;
  _openPicker = nil;
}

#pragma mark - RCTComponentViewProtocol

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldColorProps = static_cast<const ElementColorInputProps &>(*_props);
  const auto &newColorProps = static_cast<const ElementColorInputProps &>(*props);

  if (!_isInitialValueSet || oldColorProps.value != newColorProps.value) {
    UIColor *color = RCTColorFromHex(RCTNSStringFromString(newColorProps.value));
    _well.selectedColor = color;
    _well.accessibilityValue = RCTNSStringFromString(newColorProps.value);
  }

  if (!_isInitialValueSet || oldColorProps.disabled != newColorProps.disabled) {
    _well.enabled = !newColorProps.disabled;
    self.userInteractionEnabled = !newColorProps.disabled;
  }

  _isInitialValueSet = YES;

  [super updateProps:props oldProps:oldProps];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _isInitialValueSet = NO;
  _lastCommittedColor = nil;
  [self stopWatchingThePicker];
  _well.enabled = YES;
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

/*
 * `<input type=color>`: what a real colour well measures.
 *
 * Constant for the life of the app — a well shows a colour, not content — so
 * unlike the fields and the file button this needs no reporting back from the
 * mounted control.
 */
void EXPProbeColorWellMetrics(facebook::react::ElementControlMetrics &metrics)
{
  RCTAssertMainQueue();
  UIColorWell *well = [[UIColorWell alloc] initWithFrame:CGRectZero];
  UIWindow *window = [[UIWindow alloc] initWithFrame:CGRectMake(0, 0, 200, 200)];
  [window addSubview:well];
  [window layoutIfNeeded];
  const CGSize intrinsic = well.intrinsicContentSize;
  [well removeFromSuperview];

  if (intrinsic.width > 0 && intrinsic.height > 0) {
    metrics.colorWellWidth = static_cast<facebook::react::Float>(intrinsic.width);
    metrics.colorWellHeight = static_cast<facebook::react::Float>(intrinsic.height);
  }
}
