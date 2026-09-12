/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPContextMenuGlass.h"

#import <React/RCTUtils.h>

/*
 * Dims layers and puts them back when released.
 *
 * The restore cannot hang on a completion block, because UIKit runs none for a
 * menu it abandons. These layers are reused between presentations, so one left
 * dimmed costs every later menu its glass — hence ownership: releasing this
 * object restores them whether or not anything asked.
 */
@interface EXPDimmedGlass : NSObject
/** Dims `materials`, remembering what each one was. Call as more appear. */
- (void)dim:(NSArray<CALayer *> *)materials;
/** Gives them all back. Idempotent, and called again by `dealloc`. */
- (void)restore;
@end

@implementation EXPDimmedGlass {
  NSMutableArray<CALayer *> *_materials;
  NSMutableArray<NSNumber *> *_before;
}

- (instancetype)init
{
  if (self = [super init]) {
    _materials = [NSMutableArray new];
    _before = [NSMutableArray new];
  }
  return self;
}

- (void)dim:(NSArray<CALayer *> *)materials
{
  for (CALayer *material in materials) {
    [_materials addObject:material];
    [_before addObject:@(material.opacity)];
    [UIView performWithoutAnimation:^{
      material.opacity = 0;
    }];
  }
}

- (void)restore
{
  NSArray<CALayer *> *materials = [_materials copy];
  NSArray<NSNumber *> *before = [_before copy];
  // Cleared first, so `dealloc` after an explicit restore has nothing to do.
  _materials = nil;
  _before = nil;
  if (materials.count == 0) {
    return;
  }
  // `dealloc` can run on any thread; layers may only be touched on the main one.
  RCTExecuteOnMainQueue(^{
    [materials enumerateObjectsUsingBlock:^(CALayer *material, NSUInteger index, BOOL *stop) {
      [UIView performWithoutAnimation:^{
        material.opacity = before[index].floatValue;
      }];
    }];
  });
}

- (void)dealloc
{
  [self restore];
}

@end

/*
 * The two direct children of the window a presented context menu lives in: the
 * menu and its card in one, the animation UIKit runs over them in the other.
 * They are SIBLINGS, and the panel's own material is in the first — scoping to
 * the second alone reaches the copies and never the menu.
 *
 * Suffix matches, because the morph container is a Swift class and reports
 * itself with its module as `UIKit._UIMorphAnimationContainerView`.
 */
static NSString *const EXPMenuContainerSuffixes[] = {
    @"_UIContextMenuContainerView",
    @"_UIMorphAnimationContainerView",
};

/** The layers that carry a material, by the name UIKit gives them. */
static NSString *const EXPMaterialLayerName = @"MaterialProvider";

static void EXPCollectMaterialLayers(CALayer *layer, NSMutableArray<CALayer *> *into)
{
  if ([layer.name isEqualToString:EXPMaterialLayerName]) {
    [into addObject:layer];
    return;
  }
  for (CALayer *sub in layer.sublayers) {
    EXPCollectMaterialLayers(sub, into);
  }
}

/*
 * The material is on none of the menu's views: they report `effect` nil and
 * plain layers. It is a window-sized `CABackdropLayer` running
 * `glassBackground`, its visible shape a signed distance field, under a layer
 * named `MaterialProvider`:
 *
 *     CALayer name=MaterialProvider        (window-sized)
 *       CABackdropLayer  glassBackground
 *         CASDFLayer → CASDFElementLayer   <- the shape
 *       CASDFLayer name=SDF  vibrantColorMatrix
 *
 * Two private names and public `opacity`. If a name stops matching, nothing is
 * found and the dismissal is whatever UIKit does.
 */
/** Every material in the presentation being dismissed. */
static NSArray<CALayer *> *EXPMenuGlassIn(UIWindow *window)
{
  NSMutableArray<CALayer *> *materials = [NSMutableArray new];
  for (CALayer *sublayer in window.layer.sublayers) {
    NSString *owner = NSStringFromClass([sublayer.delegate class]);
    for (size_t i = 0; i < sizeof(EXPMenuContainerSuffixes) / sizeof(NSString *); i++) {
      if ([owner hasSuffix:EXPMenuContainerSuffixes[i]]) {
        EXPCollectMaterialLayers(sublayer, materials);
        break;
      }
    }
  }

  NSMutableArray<CALayer *> *glass = [NSMutableArray new];
  for (CALayer *material in materials) {
    /*
     * ALL of them. A presentation carries several materials — the menu's, the
     * window-covering providers of its glass group, and the platters behind the
     * lift's chip and the preview's card — and neither size nor position tells
     * them apart: the menu's material sits at the link like the chip's platter
     * does, and the glass covers the window.
     *
     * Dimming the platters too is what stops a lift MORPHING HOME, which this
     * dismissal does not do: it is given nothing to draw, and the card fades out
     * over words that never moved. There is nothing left for a platter to carry.
     *
     * Already dimmed means another press owns it. Taking it again would record
     * zero as its resting value and restore it dimmed.
     */
    if (material.opacity == 0) {
      continue;
    }
    [glass addObject:material];
  }
  return glass;
}

/** Holds a block for `CADisplayLink`, which wants a target and a selector. */
@interface EXPGlassSweep : NSObject
@property (nonatomic, copy) void (^tick)(void);
@end

@implementation EXPGlassSweep
- (void)fire
{
  _tick();
}
@end

void EXPHoldContextMenuGlassDown(UIWindow *window, id<UIContextMenuInteractionAnimating> animator)
{
  if (window == nil || animator == nil) {
    return;
  }

  EXPDimmedGlass *dimmed = [EXPDimmedGlass new];
  [dimmed dim:EXPMenuGlassIn(window)];

  /*
   * EVERY FRAME UNTIL THE DISMISSAL ENDS, because the materials do not all
   * exist when it begins.
   *
   * On a device the window-covering providers are built after `willEnd` — at
   * `willEnd` the presentation carries only the platters, and the glass appears
   * a few frames into the collapse. A single pass finds nothing to dim and the
   * artefact is untouched.
   *
   * The end is the animator's, not a frame count: a count is a duration, and a
   * duration is wrong on half the hardware — 24 frames is a third of a second at
   * 60Hz and a sixth at 120Hz. The count that remains is only a backstop against
   * a completion that never arrives.
   */
  __block BOOL over = NO;
  [animator addCompletion:^{
    over = YES;
    [dimmed restore];
  }];

  /*
   * The sweep holds the dimmed set WEAKLY, so the completion block above stays
   * its only owner. Releasing that block — which UIKit does whether or not it
   * runs it — still restores the layers, and the sweep simply finds nothing to
   * hold and stops.
   */
  __weak UIWindow *weakWindow = window;
  __weak EXPDimmedGlass *weakDimmed = dimmed;
  __block CFTimeInterval firstTick = 0;
  __block CADisplayLink *displayLink = nil;
  EXPGlassSweep *sweep = [EXPGlassSweep new];
  sweep.tick = ^{
    UIWindow *stillThere = weakWindow;
    EXPDimmedGlass *stillDimming = weakDimmed;
    /*
     * The backstop is four SECONDS, read off the link's own clock, and not a
     * count of frames. The comment above already says why — a count is a
     * duration, and a duration is wrong on half the hardware — but the backstop
     * itself was still written as 240 frames, which is four seconds at 60Hz and
     * two at 120Hz. Now it is four on both.
     */
    if (firstTick == 0) {
      firstTick = displayLink.timestamp;
    }
    const BOOL waitedTooLong = displayLink.timestamp - firstTick > 4.0;
    if (over || stillThere == nil || stillDimming == nil || waitedTooLong) {
      [displayLink invalidate];
      displayLink = nil;
      [stillDimming restore];
      return;
    }
    [stillDimming dim:EXPMenuGlassIn(stillThere)];
  };
  displayLink = [CADisplayLink displayLinkWithTarget:sweep selector:@selector(fire)];
  /*
   * Ask for the display's rate. A bare link runs at 60 on a ProMotion screen,
   * so the dim would step every OTHER frame of a collapse that UIKit is
   * animating at 120 — the same two-clocks fault as the scroll rise and the CSS
   * transition engine. This sweep FOLLOWS an animator, so being half its rate is
   * visible directly as the artefact lagging the menu it belongs to.
   */
  const float rate = (float)UIScreen.mainScreen.maximumFramesPerSecond;
  if (rate > 0) {
    displayLink.preferredFrameRateRange = CAFrameRateRangeMake(rate / 2, rate, rate);
  }
  [displayLink addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
}
