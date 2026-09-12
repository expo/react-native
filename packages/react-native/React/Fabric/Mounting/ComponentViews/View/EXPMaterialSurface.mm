/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPMaterialSurface.h"

#import <React/RCTViewComponentView.h>

/**
 * WebKit's material keyword, as the effect UIKit draws it with.
 *
 * The names are `CSSValueKeywords.in`'s, and the two families there are two
 * different UIKit classes: the blur materials predate Liquid Glass and are
 * `UIBlurEffect` styles, the glass ones are `UIGlassEffect` and exist only on
 * iOS 26. Asking for glass on an older system falls back to the closest blur
 * rather than drawing nothing, which is what a material is for.
 *
 * Returns nil for an unknown or empty keyword, which is how "no effect" is
 * spelled.
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
      /*
       * A GROUP of glass surfaces, rendered as one shape.
       *
       * Not a variant of the material keyword and not an invention: a
       * `UIGlassContainerEffect` is its own `UIVisualEffect` subclass, and this
       * property exists to name a platform effect in a value. The distinction
       * the material keyword's comment draws — between naming what UIKit has and
       * inventing a flag UIKit does not — falls on this side of the line.
       *
       * `spacing` is the distance at which elements begin to merge. TWELVE, the
       * same as the composer row's own gap: the field is wide enough that its
       * 1.05x press growth carries its edge seven-odd points toward the `+`, so
       * a pressed field crosses well inside the threshold and merges — which is
       * the behaviour the user asked to keep, verbatim: "The issue isn't that
       * they merge when pressed. I want to keep that. … Be very careful with
       * changing the merge distances." The property's own default is 0, which
       * would merge only on contact and lose that press.
       */
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
    // `-clear` is the see-through variant; everything else — including the
    // media-controls names, which differ in TINT rather than in construction —
    // takes the regular one. Where WebKit's keyword set is finer than UIKit's
    // API, the nearest effect is the honest answer.
    const BOOL clear = [name containsString:@"-clear"];
    UIGlassEffect *glass =
        [UIGlassEffect effectWithStyle:clear ? UIGlassEffectStyleClear : UIGlassEffectStyleRegular];
    /*
     * Glass REACTS to a finger, and this is the property that lets it.
     *
     * Measured against a stock 300x40 interactive glass pill, held: it grows to
     * 315.3 x 41.3 — 1.05x in both axes — and brightens, then settles back. Off,
     * as it was, a glass surface is inert under a touch, which on iOS 26 reads
     * as a control that is not responding rather than as a decision. Reported
     * as the composer's field not reacting to a touch down.
     *
     * On for every glass surface, and the alternative was a keyword. WebKit's
     * `-apple-` set has no interactive variant — the names here come from
     * `CSSValueKeywords.in` rather than being invented, and inventing one is the
     * thing this property exists not to do. The platform's own glass controls
     * are all interactive, so this is the platform's default rather than a
     * choice layered over it.
     *
     * It works through a subview that takes the touch, which is what makes it
     * usable for a composer at all: the same pill with a `UITextField` inside
     * responded identically, 39.3 to 41.3, with the field taking focus. A
     * finger on the text still lands on the glass.
     *
     * ON, and the history of this flag is worth keeping because it has been
     * flipped in both directions on evidence that turned out to be
     * window-dependent.
     *
     * `interactive` grows and brightens the glass under a finger — the
     * platform's own press. It was turned OFF after a device report that the
     * field expanded too much, backed by a SIMULATOR measurement of the native
     * pill holding at 359.00→358.67 points through a 1.2s hold — no press.
     * But the simulator does not render the glass press the way a phone does:
     * the same user later held the native field on the device and reported the
     * opposite, precisely — "when I touch it it grows a little and turns a
     * little brighter. In our app it doesn't grow and doesn't get brighter."
     * For a keyboard-window surface the device is the oracle and the
     * simulator is not (see `compare-both-apps-on-one-phone`); the earlier
     * "too much" was most plausibly the CONTAINER MERGE — a growing glass
     * pill within twelve points of the `+` fuses with it — not the press
     * itself.
     *
     * So the platform default stands: glass reacts. If the merge complaint
     * returns, the distance between the pill and the `+` is the knob, not
     * this flag.
     */
    glass.interactive = YES;
    return glass;
  }
#endif
  // Before iOS 26 there is no glass. The thin blur is what the system used for
  // the same job, so a screen written for glass still reads as a material.
  return [UIBlurEffect effectWithStyle:UIBlurEffectStyleSystemThinMaterial];
}

@implementation EXPMaterialSurface {
  UIView *_host;
  UIVisualEffectView *_effectView;
  /** The surface's own colour, drawn above any effect. See `-setFill:`. */
  UIView *_fillView;
  UIColor *_fill;
  /** The tint over the material. Created only when one is asked for. */
  CAGradientLayer *_fadeMask;
  NSString *_appliedKeyword;
  CGFloat _appliedFade;
  /** See `-setStrength:`. Seeded on first use, since 0 is a legitimate value. */
  CGFloat _strength;
  BOOL _hasStrength;
  /**
   * Watches the container's touches without taking them. See `-_touched:`.
   */
  /** Whether the current effect is one that reacts to touch, i.e. glass. */
  BOOL _interactive;
  /** Whether this surface groups OTHER glass surfaces — see `-childContainerView`. */
  BOOL _isContainer;
  /** Whether the element's children belong INSIDE the effect view. Glass only. */
  BOOL _wraps;
}

/*
 * Glass WRAPS. Every other material BACKS.
 *
 * A blur or a thin material is a backdrop: it goes behind the element's own
 * content and the author's background and border paint over it. Glass is not a
 * backdrop, it is a control surface — it reacts to the finger that touches it
 * and it merges with the glass beside it — and both of those are things UIKit
 * only does for what is INSIDE the effect view. A backdrop can therefore draw
 * like glass and can never behave like it, which is what shipped and what the
 * three reports against the composer were: an opaque field, a field that did
 * not respond to touch, and a `+` that would not blob into it.
 */
- (nullable UIView *)childContainerView
{
  return _wraps ? _effectView.contentView : nil;
}

- (nullable UIView *)hostView
{
  return _host;
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

/**
 * The fill, above the effect and below the element's content.
 *
 * Inside the host either way, so the host's fade mask covers the fill and the
 * effect together: one gradient, applied once. A gradient on a sibling box
 * would have to reproduce this one's smoothstep exactly and would be wrong the
 * moment either changed.
 *
 * A WRAPPER paints it on the content view rather than in a subview of its own.
 * It has to: a subview above the effect view would be above the element's
 * children too, and it would be an extra subview in the very view the mounting
 * layer addresses children by index into. A background colour is neither — it
 * is drawn by the content view's own layer, which is below its subviews and
 * above the glass, exactly where a fill belongs.
 */
- (void)_applyFill
{
  if (_host == nil) {
    return;
  }
  if (_wraps) {
    /*
     * A wrapper's fill is the EFFECT's own tint, not a colour painted inside it.
     *
     * `UIGlassEffect.tintColor` is "a tint color applied to the glass", and the
     * word doing the work is *applied*: it is part of what the effect renders,
     * so it grows with the glass when a finger presses it. A background on the
     * content view is not — `UIGlassContainerEffect`'s own documentation says
     * the glass is rendered BEHIND the effect view's `contentView`, and an
     * interactive press expands that rendering rather than the view.
     *
     * Reported from a device with a photograph that admits no other reading: a
     * hard-edged rectangle sitting inside a grown capsule, the fill left at its
     * resting size while the glass around it stretched. It did not show before
     * because the press used to be a reproduction — a recognizer scaling the
     * whole host — and scaling the host took the fill with it. Deleting the
     * reproduction in favour of the platform's own press is what exposed the
     * fill as the only part not participating.
     */
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
          // reads its effect when it is set, and a tint written to the object it
          // is already holding does not reach the render server.
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
  // The effect view may not exist yet; `-applyKeyword:` applies it on creation.
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
  /*
   * A FILL with no effect is still a surface.
   *
   * Measured on the native composer at the same window size: its bar reads 251
   * against a 255 page, and 87% of a near-white is what reproduces that AND the
   * pale blue a balloon becomes behind it. No `UIBlurEffectStyle` is that
   * light — the three closest all read 244 to 247 — so the surface here is a
   * colour, and the host exists to carry its fade.
   */
  if (effect == nil && _fill == nil) {
    /*
     * The children come OUT before the host goes, and only a wrapper has any.
     *
     * A backdrop's host holds nothing of React's, so removing it costs nothing.
     * A wrapper's holds the element's whole content, and taking it away with the
     * children still inside does not merely hide them — the mounting layer
     * addresses children by index into the container view, so the next unmount
     * reaches past the end and aborts. `-currentContainerView` cannot repair it
     * either: it finds the children through a weak reference to the effect
     * view's `contentView`, which this method is about to release.
     */
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
    // Pixels only: the material must not appear in the accessibility tree, and
    // must not take the name of whatever it sits behind.
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

    /*
     * Registered as host CHROME, not merely inserted.
     *
     * At index 0 either way — a material is what is behind the content, so the
     * author's own background and border still paint over it — but an extra
     * subview the mutation stream does not know about shifts every mount index
     * after it. A box with a material and children that come and go then
     * unmounts the wrong view and aborts: choosing a reaction from a pill with
     * six buttons and a material behind them killed the app on
     * `unmountChildComponentView:index:`.
     *
     * `addHostChromeSubview:` is the seam for exactly this. The accessory's bar
     * is not a component view and has no such bookkeeping, so it keeps the
     * plain insert.
     */
    if ([container respondsToSelector:@selector(addHostChromeSubview:)]) {
      [(RCTViewComponentView *)container addHostChromeSubview:_host];
    } else {
      [container insertSubview:_host atIndex:0];
    }
  } else if (keywordChanged) {
    _effectView.effect = effect;
  }

  /*
   * Set on every apply rather than once at creation, because the keyword can
   * change under a host that already exists.
   *
   * A backdrop keeps NO: it lies across the element's content and would swallow
   * every touch that crossed it. A wrapper needs YES twice over — a
   * `userInteractionEnabled` of NO disables hit-testing for the whole subtree,
   * so children parked inside would draw and never respond, and
   * `UIGlassEffect.interactive` reacts to a touch only when the touch is
   * delivered inside the effect view.
   */
  _host.userInteractionEnabled = _wraps;
  _effectView.userInteractionEnabled = _wraps;

  /*
   * And a WRAPPER must not hide its subtree, which is the same distinction one
   * line up and a much louder failure.
   *
   * `accessibilityElementsHidden` takes everything BELOW a view out of the
   * tree. On a backdrop that is nothing — the point is that the material itself
   * is not an element and does not take the name of what it sits behind. On a
   * wrapper it is the element's whole content: every control in the composer
   * vanished from the accessibility tree at once, `idb ui describe-all` came
   * back with nothing but the application node, and all 36 UI tests failed
   * looking up rows by name. Nothing on screen changes, which is what makes it
   * worth a comment rather than a fix and a shrug.
   */
  _host.accessibilityElementsHidden = !_wraps;
  _effectView.accessibilityElementsHidden = !_wraps;

  [self _applyFill];

  [self layOutInContainer:container cornerRadius:_host.layer.cornerRadius cornerCurve:_host.layer.cornerCurve];
}

- (void)layOutInContainer:(UIView *)container cornerRadius:(CGFloat)radius cornerCurve:(CALayerCornerCurve)curve
{
  [self layOutInContainer:container
             cornerRadius:radius
              cornerCurve:curve
              topOverhang:0
           bottomOverhang:0];
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
  // `bounds` and `center` rather than `frame`, because glass scales itself under
  // a finger and `frame` is not meaningful on a transformed view — writing it
  // would silently undo the press mid-touch.
  _host.bounds = CGRectMake(0, 0, CGRectGetWidth(frame), CGRectGetHeight(frame));
  _host.center = CGPointMake(CGRectGetMidX(frame), CGRectGetMidY(frame));
  _effectView.frame = _host.bounds;
  // The owner's corners, or a material would square off a rounded field.
  _host.layer.cornerRadius = radius;
  _host.layer.cornerCurve = curve;
  /*
   * Only clip when there is a shape to clip to — and NEVER clip glass.
   *
   * A backdrop is clipped to its rounded shape because the blur has no shape of
   * its own. Glass has: `cornerConfiguration` below shapes the effect and its
   * rim. Clipping the host as well is what split the composer's field into two
   * layers under a finger. An interactive press grows the glass's rendering
   * beyond the resting bounds; clipped, that growth is cut off at the pill's
   * original footprint — a bright static core — while the grown, merging shape
   * is drawn by the ancestor `UIGlassContainerEffect`'s union outside the clip,
   * dimmer. Photographed on a device: "on press, the text area has a center
   * part that doesn't grow … it's like there are two separate parts/layers."
   * An overhanging surface is likewise deliberately larger than its container
   * and must not be trimmed back to it.
   */
  _host.clipsToBounds = radius > 0 && !_wraps;
  /*
   * And tell the EFFECT its shape, rather than only clipping it to one.
   *
   * A glass effect draws a rim along its own edges. Clipped to a rounded rect it
   * still draws that rim on the rectangle it thinks it is, so the rim runs to
   * each corner and is cut off there — reported as the glass edges being
   * "cut off by the corner radii instead of following the rounded corners".
   * `cornerConfiguration` is what makes UIKit shape the effect itself, so the
   * rim travels around the curve.
   *
   * Only for glass: a blur has no rim, and a squared-off blur behind a rounded
   * clip looks the same either way.
   */
  if (@available(iOS 26.0, *)) {
    if (_interactive && radius > 0) {
      _effectView.cornerConfiguration =
          [UICornerConfiguration configurationWithUniformRadius:[UICornerRadius fixedRadius:radius]];
    }
  }
  [self _updateFadeMask];
}

/**
 * The fade, as a MASK on the host rather than a gradient drawn over it.
 *
 * A gradient painted on top would have to be a colour, and the whole point of a
 * material is that there is no colour to name — what is behind it is the
 * content, and in dark mode it is different content. Masking makes the material
 * itself thin out, so the fade is whatever the blur is currently producing, in
 * both appearances, with nothing to keep in step.
 */
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

/**
 * The chain from the bar to its window, frame by frame.
 *
 * Eight readings of the VIEW have now come back perfect while the composer was
 * plainly not on screen — in its window, alpha 1, not hidden — and the window's
 * own frame turned out to be stationary too. A device trace then put the host at
 * y=4840 inside an 852-point window, which both the material's `onScreen` and
 * the dock's model frame agree on, so the bar really is parked off the bottom
 * and the offset is a clean +4000.
 *
 * A position is the SUM of a chain, and every reading so far has been of one end
 * of it. Nothing in this repository sets 4000, so the view that carries it is
 * UIKit's and can only be found by naming each link. Ancestors are few (the
 * input-view host, its container, the window) so this is a short walk.
 */
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
                                                node.alpha < 0.99
                                                    ? [NSString stringWithFormat:@" a=%.2f", node.alpha]
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
  return [NSString stringWithFormat:
      /*
       * The host window's own FRAME, and where the host lands on screen.
       *
       * `hostWindow=UITextEffectsWindow hostAlpha=1.00 hostHidden=0` says the bar
       * is in its window and drawn — and a device trace showed exactly that at
       * the moment the composer was invisible, with the dock reading 4852 in an
       * 852-point window. Both can be true at once if the WINDOW is what moved,
       * which the class name alone cannot distinguish from the view being torn
       * out. So the window's frame is recorded, and the host's position within
       * the screen, which settles it in one line.
       */
      @"material: fade=%.1f strength=%.2f mask=%@ hostBounds=%.0fx%.0f hostWindow=%@ winFrame=%@ onScreen=%@ "
      @"hostAlpha=%.2f hostHidden=%d "
      @"hostIndex=%ld effect=%@ fill=%@ fillViewBg=%@ containerBg=%@ style=%ld chain=%@",
      _appliedFade,
      // Printed because a prop that never arrives and a prop set to its default
      // are the same number of pixels, and one of them is a bug.
      _hasStrength ? _strength : 1.0,
      maskState,
      host.bounds.size.width,
      host.bounds.size.height,
      host.window == nil ? @"nil" : NSStringFromClass(host.window.class),
      host.window == nil ? @"nil" : NSStringFromCGRect(host.window.frame),
      host.window == nil ? @"nil"
                         : NSStringFromCGRect([host convertRect:host.bounds toView:nil]),
      host.alpha,
      (int)host.hidden,
      (long)[host.superview.subviews indexOfObject:host],
      _effectView == nil ? @"none"
                         : (_effectView.effect == nil ? @"view-no-effect"
                                                      : NSStringFromClass(_effectView.effect.class)),
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
    /*
     * Eased, not linear — and the difference is the whole look of the thing.
     *
     * Two stops give a straight alpha ramp, which has a CORNER at each end: the
     * material starts thinning at a definite line and stops at another, and both
     * read as edges however long the ramp is. Reported as the fade being hard.
     *
     * Sampled from a smoothstep, `t * t * (3 - 2t)`, which leaves and arrives
     * with zero slope, so neither end has a place where the rate changes. Eight
     * steps: the banding a `CAGradientLayer` shows between stops is invisible
     * well before that, and every extra stop is a per-frame interpolation on a
     * layer that resizes with the keyboard.
     *
     * Alpha only: a mask reads opaque as "keep" and transparent as "drop".
     */
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
  /*
   * Inside a `CATransaction` with actions off.
   *
   * `frame` and `locations` are animatable and this runs during layout — so a
   * bar that grew by a line animated its own fade from the old geometry to the
   * new one, a quarter second behind the content it was meant to be fading.
   */
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  /*
   * The fade's LENGTH is the gradient's end point, not its stops.
   *
   * The stops are the shape of the curve and never change; where the ramp
   * finishes is `fade` points down the layer. Setting `endPoint` moves the whole
   * eased curve rather than re-deriving nine numbers on every layout.
   */
  _fadeMask.frame = bounds;
  const CGFloat span = MIN(_appliedFade / CGRectGetHeight(bounds), 1.0);
  _fadeMask.endPoint = CGPointMake(0.5, span);
  _host.layer.mask = _fadeMask;
  [CATransaction commit];
}

@end
