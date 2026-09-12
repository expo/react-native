/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPMaterialSurface.h"

#import <React/RCTViewComponentView.h>

/**
 * The UIKit effect for WebKit's material keyword (`CSSValueKeywords.in`): the
 * blur materials are `UIBlurEffect` styles, the glass ones `UIGlassEffect` on
 * iOS 26, with the closest blur as the fallback before that. Nil for an
 * unknown or empty keyword.
 */
static UIVisualEffect *_Nullable EXPVisualEffectForKeyword(NSString *_Nullable name)
{
  if (name.length == 0) {
    return nil;
  }

  static NSDictionary<NSString *, NSNumber *> *blurStyles = @{
    @"-apple-system-blur-material-ultra-thin" : @(UIBlurEffectStyleSystemUltraThinMaterial),
    @"-apple-system-blur-material-thin" : @(UIBlurEffectStyleSystemThinMaterial),
    @"-apple-system-blur-material" : @(UIBlurEffectStyleSystemMaterial),
    @"-apple-system-blur-material-thick" : @(UIBlurEffectStyleSystemThickMaterial),
    @"-apple-system-blur-material-chrome" : @(UIBlurEffectStyleSystemChromeMaterial),
  };

  NSNumber *blur = blurStyles[name];
  if (blur != nil) {
    return [UIBlurEffect effectWithStyle:(UIBlurEffectStyle)blur.integerValue];
  }

#if defined(__IPHONE_26_0) && __IPHONE_OS_VERSION_MAX_ALLOWED >= __IPHONE_26_0
  if (@available(iOS 26.0, *)) {
    if ([name isEqualToString:@"-apple-system-glass-container"]) {
      // A group of glass surfaces rendered as one shape. `spacing` is the
      // distance at which they begin to merge: 12, the composer row's gap, so a
      // pressed field (grown 1.05x) merges with the button beside it; the
      // default of 0 merges only on contact

      UIGlassContainerEffect *container = [UIGlassContainerEffect new];
      container.spacing = 12;
      return container;
    }
  }
#endif

  if (![name hasPrefix:@"-apple-system-glass-material"]) {
    return nil;
  }

#if defined(__IPHONE_26_0) && __IPHONE_OS_VERSION_MAX_ALLOWED >= __IPHONE_26_0
  if (@available(iOS 26.0, *)) {
    // `-clear` is the see-through variant; every other glass keyword, including
    // the media-controls names that differ only in tint, takes the regular one
    const BOOL clear = [name containsString:@"-clear"];
    UIGlassEffect *glass = [UIGlassEffect effectWithStyle:clear ? UIGlassEffectStyleClear : UIGlassEffectStyleRegular];
    // Interactive glass grows about 1.05x and brightens under a finger, the
    // platform's own press, and does so for touches delivered to a subview too.
    // WebKit's keyword set has no interactive variant, so every glass surface
    // takes the platform default rather than an invented keyword.
    // DOM-CSS-DEVIATION(glass-surface-press-is-the-platforms): a box with a glass
    // material answers a press with the OS's own glass-effect press — it swells and
    // brightens a little under a finger, less than a glass button does — where a CSS box
    // does not react to a press at all. How much is the OS's and can change by version.
    glass.interactive = YES;
    return glass;
  }
#endif
  // Before iOS 26 there is no glass; the thin blur did the same job
  return [UIBlurEffect effectWithStyle:UIBlurEffectStyleSystemThinMaterial];
}

@implementation EXPMaterialSurface {
  UIView *_host;
  UIVisualEffectView *_effectView;
  UIView *_fillView;
  UIColor *_fill;
  CAGradientLayer *_fadeMask;
  NSString *_appliedKeyword;
  CGFloat _appliedFade;
  // 0 is a legitimate strength, so a flag records whether one was set
  CGFloat _strength;
  BOOL _hasStrength;
  BOOL _interactive;
  BOOL _isContainer;
  // Whether the element's children belong inside the effect view (glass only)
  BOOL _wraps;
}

- (nullable UIView *)childContainerView
{
  return _wraps ? _effectView.contentView : nil;
}

- (nullable UIView *)hostView
{
  return _host;
}

- (nullable UIVisualEffectView *)effectView
{
  return _effectView.effect != nil ? _effectView : nil;
}

- (BOOL)isInstalled
{
  return _host != nil;
}

- (BOOL)hasEffect
{
  return _effectView.effect != nil;
}

- (void)setFill:(UIColor *)fill
{
  if (fill == _fill || [fill isEqual:_fill]) {
    return;
  }
  _fill = fill;
  [self _applyFill];
}

// The fill sits inside the host so the host's fade mask covers the fill and
// the effect with one gradient
- (void)_applyFill
{
  if (_host == nil) {
    return;
  }
  if (_wraps) {
    // A wrapper's fill is the effect's own tint: `UIGlassEffect.tintColor` is
    // part of what the effect renders, so it grows with the glass under a
    // press, where a background on the content view would stay at rest
    [_fillView removeFromSuperview];
    _fillView = nil;
    _effectView.contentView.backgroundColor = nil;
#if defined(__IPHONE_26_0) && __IPHONE_OS_VERSION_MAX_ALLOWED >= __IPHONE_26_0
    if (@available(iOS 26.0, *)) {
      if ([_effectView.effect isKindOfClass:UIGlassEffect.class]) {
        UIGlassEffect *glass = (UIGlassEffect *)_effectView.effect;
        if (glass.tintColor != _fill && ![glass.tintColor isEqual:_fill]) {
          glass.tintColor = _fill;
          // Re-assigned rather than mutated in place: a `UIVisualEffectView`
          // reads its effect only when it is set
          _effectView.effect = glass;
        }
      }
    }
#endif
    return;
  }
  if (_fill == nil) {
    [_fillView removeFromSuperview];
    _fillView = nil;
    return;
  }
  if (_fillView == nil) {
    _fillView = [[UIView alloc] initWithFrame:_host.bounds];
    _fillView.userInteractionEnabled = NO;
    _fillView.isAccessibilityElement = NO;
    _fillView.accessibilityElementsHidden = YES;
    _fillView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    [_host addSubview:_fillView];
  }
  _fillView.backgroundColor = _fill;
}

- (void)setStrength:(CGFloat)strength
{
  const CGFloat wanted = MIN(MAX(strength, 0), 1);
  if (_hasStrength && wanted == _strength) {
    return;
  }
  _hasStrength = YES;
  _strength = wanted;
  // The effect view may not exist yet; `-applyKeyword:` applies it on creation
  _effectView.alpha = wanted;
}

- (void)applyKeyword:(NSString *)keyword fade:(CGFloat)fade inContainer:(UIView *)container
{
  NSString *wanted = keyword.length == 0 ? nil : keyword;
  const BOOL sameKeyword = (wanted == nil && _appliedKeyword == nil) || [wanted isEqualToString:_appliedKeyword];
  if (sameKeyword && fade == _appliedFade) {
    return;
  }
  const BOOL keywordChanged = !sameKeyword;
  _appliedKeyword = wanted;
  _appliedFade = fade;

  UIVisualEffect *effect = keywordChanged ? EXPVisualEffectForKeyword(wanted) : _effectView.effect;
#if defined(__IPHONE_26_0) && __IPHONE_OS_VERSION_MAX_ALLOWED >= __IPHONE_26_0
  if (@available(iOS 26.0, *)) {
    _interactive = [effect isKindOfClass:UIGlassEffect.class];
    _isContainer = [effect isKindOfClass:UIGlassContainerEffect.class];
    _wraps = _interactive || _isContainer;
  }
#endif
  // A fill with no effect is still a surface; the host carries its fade
  if (effect == nil && _fill == nil) {
    // A wrapper's host holds the element's children. They come out first,
    // because the mounting layer addresses children by index into the
    // container view and the next unmount would reach past the end
    for (UIView *subview in [_effectView.contentView.subviews copy]) {
      [container addSubview:subview];
    }
    [_host removeFromSuperview];
    _host = nil;
    _effectView = nil;
    _fillView = nil;
    _fadeMask = nil;
    _wraps = NO;
    return;
  }

  if (_host == nil) {
    _host = [[UIView alloc] initWithFrame:CGRectZero];
    // Pixels only: the material must not appear in the accessibility tree
    _host.isAccessibilityElement = NO;
    _host.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;

    if (effect != nil) {
      _effectView = [[UIVisualEffectView alloc] initWithEffect:effect];
      _effectView.alpha = _hasStrength ? _strength : 1;
      _effectView.isAccessibilityElement = NO;
      _effectView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
      [_host addSubview:_effectView];
    }
    [self _applyFill];

    // Registered as host chrome where the container supports it: a subview the
    // mutation stream does not know about would shift every mount index after
    // it. The accessory's bar is not a component view and keeps the plain insert
    if ([container respondsToSelector:@selector(addHostChromeSubview:)]) {
      [(RCTViewComponentView *)container addHostChromeSubview:_host];
    } else {
      [container insertSubview:_host atIndex:0];
    }
  } else if (keywordChanged) {
    _effectView.effect = effect;
  }

  // Set on every apply, since the keyword can change under an existing host. A
  // backdrop must not swallow touches; a wrapper must take them, both so its
  // children hit-test and so interactive glass sees the touch
  _host.userInteractionEnabled = _wraps;
  _effectView.userInteractionEnabled = _wraps;

  // `accessibilityElementsHidden` hides everything below the view: right for a
  // backdrop, wrong for a wrapper, whose subtree is the element's content
  _host.accessibilityElementsHidden = !_wraps;
  _effectView.accessibilityElementsHidden = !_wraps;

  [self _applyFill];

  [self layOutInContainer:container cornerRadius:_host.layer.cornerRadius cornerCurve:_host.layer.cornerCurve];
}

- (void)layOutInContainer:(UIView *)container cornerRadius:(CGFloat)radius cornerCurve:(CALayerCornerCurve)curve
{
  [self layOutInContainer:container cornerRadius:radius cornerCurve:curve topOverhang:0 bottomOverhang:0];
}

- (void)layOutInContainer:(UIView *)container
             cornerRadius:(CGFloat)radius
              cornerCurve:(CALayerCornerCurve)curve
              topOverhang:(CGFloat)topOverhang
           bottomOverhang:(CGFloat)bottomOverhang
{
  if (_host == nil) {
    return;
  }
  const CGFloat above = MAX(topOverhang, 0);
  CGRect frame = container.bounds;
  frame.origin.y -= above;
  frame.size.height += above + MAX(bottomOverhang, 0);
  // `bounds` and `center` rather than `frame`: glass scales itself under a
  // finger, and writing `frame` to a transformed view would undo the press
  _host.bounds = CGRectMake(0, 0, CGRectGetWidth(frame), CGRectGetHeight(frame));
  _host.center = CGPointMake(CGRectGetMidX(frame), CGRectGetMidY(frame));
  _effectView.frame = _host.bounds;
  // The owner's corners, or a material would square off a rounded field
  _host.layer.cornerRadius = radius;
  _host.layer.cornerCurve = curve;
  // A backdrop is clipped to its rounded shape because a blur has none of its
  // own. Glass is never clipped: a press grows its rendering past the resting
  // bounds, and a clip would cut that growth off at the original footprint
  _host.clipsToBounds = radius > 0 && !_wraps;
  // Glass draws a rim along its own edges, so the effect is told its shape
  // through `cornerConfiguration` and the rim follows the curve; a blur has no
  // rim and the clip is enough
  if (@available(iOS 26.0, *)) {
    if (_interactive && radius > 0) {
      _effectView.cornerConfiguration =
          [UICornerConfiguration configurationWithUniformRadius:[UICornerRadius fixedRadius:radius]];
    }
  }
  [self _updateFadeMask];
}

static NSString *EXPDescribeColor(UIColor *color, UITraitCollection *traits)
{
  if (color == nil) {
    return @"nil";
  }
  CGFloat r = 0, g = 0, b = 0, a = 0;
  UIColor *resolved = [color resolvedColorWithTraitCollection:traits];
  if (![resolved getRed:&r green:&g blue:&b alpha:&a]) {
    return @"unconvertible";
  }
  return [NSString stringWithFormat:@"%.2f,%.2f,%.2f,%.2f", r, g, b, a];
}

// The chain from the host to its window, one frame per link: a position is the
// sum of the chain, and only naming each link shows which view carries an offset
static NSString *EXPDescribeAncestry(UIView *view)
{
  NSMutableArray<NSString *> *links = [NSMutableArray array];
  for (UIView *node = view; node != nil && links.count < 12; node = node.superview) {
    CGAffineTransform t = node.transform;
    NSString *transform = CGAffineTransformIsIdentity(t)
        ? @""
        : [NSString stringWithFormat:@" t=[%.2f %.2f %.2f %.2f %.1f %.1f]", t.a, t.b, t.c, t.d, t.tx, t.ty];
    [links addObject:[NSString stringWithFormat:@"%@(%.1f,%.1f %.0fx%.0f%@%@%@)",
                                                NSStringFromClass(node.class),
                                                node.frame.origin.x,
                                                node.frame.origin.y,
                                                node.frame.size.width,
                                                node.frame.size.height,
                                                transform,
                                                node.hidden ? @" HIDDEN" : @"",
                                                node.alpha < 0.99 ? [NSString stringWithFormat:@" a=%.2f", node.alpha]
                                                                  : @""]];
  }
  return [links componentsJoinedByString:@" < "];
}

- (NSString *)stateDescription
{
  UIView *host = _host;
  if (host == nil) {
    return @"material: no host";
  }
  CALayer *mask = host.layer.mask;
  NSString *maskState;
  if (mask == nil) {
    maskState = @"nil";
  } else if ([mask isKindOfClass:CAGradientLayer.class]) {
    CAGradientLayer *gradient = (CAGradientLayer *)mask;
    maskState = [NSString stringWithFormat:@"%.0fx%.0f end=%.3f stops=%lu%@",
                                           gradient.frame.size.width,
                                           gradient.frame.size.height,
                                           gradient.endPoint.y,
                                           (unsigned long)gradient.colors.count,
                                           mask == _fadeMask ? @"" : @" FOREIGN"];
  } else {
    maskState = [NSString stringWithFormat:@"FOREIGN %@", NSStringFromClass(mask.class)];
  }
  UITraitCollection *traits = host.traitCollection;
  return [NSString
      stringWithFormat:
          // The window's own frame and the host's position on screen are
          // recorded too: a host can be in its window, drawn, and off screen
          // because the window moved
          @"material: fade=%.1f strength=%.2f mask=%@ hostBounds=%.0fx%.0f hostWindow=%@ winFrame=%@ onScreen=%@ "
          @"hostAlpha=%.2f hostHidden=%d "
          @"hostIndex=%ld effect=%@ fill=%@ fillViewBg=%@ containerBg=%@ style=%ld chain=%@",
          _appliedFade,
          // A prop that never arrived and a prop at its default draw the same;
          // the trace tells them apart
          _hasStrength ? _strength : 1.0,
          maskState,
          host.bounds.size.width,
          host.bounds.size.height,
          host.window == nil ? @"nil" : NSStringFromClass(host.window.class),
          host.window == nil ? @"nil" : NSStringFromCGRect(host.window.frame),
          host.window == nil ? @"nil" : NSStringFromCGRect([host convertRect:host.bounds toView:nil]),
          host.alpha,
          (int)host.hidden,
          (long)[host.superview.subviews indexOfObject:host],
          _effectView == nil
              ? @"none"
              : (_effectView.effect == nil ? @"view-no-effect" : NSStringFromClass(_effectView.effect.class)),
          EXPDescribeColor(_fill, traits),
          EXPDescribeColor(_fillView.backgroundColor, traits),
          EXPDescribeColor(host.superview.backgroundColor, traits),
          (long)traits.userInterfaceStyle,
          EXPDescribeAncestry(host)];
}

- (void)_updateFadeMask
{
  if (_host == nil) {
    return;
  }
  if (_appliedFade <= 0) {
    _host.layer.mask = nil;
    _fadeMask = nil;
    return;
  }

  const CGRect bounds = _host.bounds;
  if (CGRectGetHeight(bounds) <= 0) {
    return;
  }

  if (_fadeMask == nil) {
    _fadeMask = [CAGradientLayer layer];
    // A mask rather than a gradient drawn over the material, so the fade is
    // whatever the blur produces in either appearance. Sampled from a smoothstep
    // so neither end of the ramp reads as an edge; eight steps is below the
    // banding a `CAGradientLayer` shows between stops
    NSMutableArray *colours = [NSMutableArray array];
    NSMutableArray *stops = [NSMutableArray array];
    static const NSInteger steps = 8;
    for (NSInteger i = 0; i <= steps; i++) {
      const CGFloat t = (CGFloat)i / steps;
      [colours addObject:(__bridge id)[UIColor colorWithWhite:0 alpha:t * t * (3 - 2 * t)].CGColor];
      [stops addObject:@(t)];
    }
    _fadeMask.colors = colours;
    _fadeMask.locations = stops;
    _fadeMask.startPoint = CGPointMake(0.5, 0.0);
    _fadeMask.endPoint = CGPointMake(0.5, 1.0);
  }
  // `frame` and `endPoint` are animatable and this runs during layout; an
  // implicit animation would trail the content by a quarter second
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  // The stops are the curve's shape; the fade's length is the end point
  _fadeMask.frame = bounds;
  const CGFloat span = MIN(_appliedFade / CGRectGetHeight(bounds), 1.0);
  _fadeMask.endPoint = CGPointMake(0.5, span);
  _host.layer.mask = _fadeMask;
  [CATransaction commit];
}

@end
