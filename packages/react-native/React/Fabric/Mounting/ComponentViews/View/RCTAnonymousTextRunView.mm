/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "RCTAnonymousTextRunView.h"

#import <React/RCTAssert.h>
#import <React/RCTConversions.h>
#import <react/renderer/animationbackend/CSSTransitionsTrace.h>
#import <react/renderer/textlayoutmanager/RCTTextLayoutManager.h>
#import <react/utils/ManagedObjectWrapper.h>

using namespace facebook::react;

@implementation RCTAnonymousTextRunView

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    self.backgroundColor = UIColor.clearColor;
    self.opaque = NO;
    self.userInteractionEnabled = NO;
    self.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  }
  return self;
}

// The single source of truth for this run's geometry, in the owning View's
// coordinate space: the anonymous run box's Yoga layout frame. Both painting
// (-drawRect:) and touch hit-testing (-touchEventEmitterAtContainerPoint:) go
// through this one accessor, so the two can never drift into different
// coordinate spaces, which would make a tap land where no glyph was drawn.
- (CGRect)containerFrame
{
  // Pixel-align the run's origin. The engine computes run frames from text
  // layout in points, which lands on fractional pixel offsets; CoreGraphics
  // then rasterizes fresh subpixel glyph variants per draw instead of
  // hitting the glyph cache, which costs mount time and softens glyph edges.
  // Rounding at this single shared accessor keeps
  // painting and hit-testing in one coordinate space by construction.
  CGFloat scale = self.traitCollection.displayScale ?: 3.0;
  CGRect frame = RCTCGRectFromRect(_run.frame);
  frame.origin.x = round(frame.origin.x * scale) / scale;
  frame.origin.y = round(frame.origin.y * scale) / scale;
  return frame;
}

// The tripwire behind both consumers of `containerFrame`.
//
// What it is guarding is that neither painting nor hit-testing applies an
// offset of its own: that drift is what made tapped text land where no glyph
// was drawn, and it was a whole content inset — points, not fractions.
//
// It cannot be exact equality, because `containerFrame` deliberately rounds
// the origin to the pixel grid, and a run whose Yoga frame is already
// fractional is completely ordinary — text after inline padding, or inside an
// inline-flex, lands there constantly. Requiring equality turned every one of
// those into a Debug crash. So: the size must match exactly, and the origin
// may differ by less than the one pixel this accessor is allowed to move it.
static BOOL RCTRunGeometryMatchesYogaFrame(CGRect frame, facebook::react::Rect yogaFrame, CGFloat scale)
{
  CGRect raw = RCTCGRectFromRect(yogaFrame);
  CGFloat onePixel = 1.0 / MAX(scale, 1.0);
  return CGSizeEqualToSize(frame.size, raw.size) && fabs(frame.origin.x - raw.origin.x) < onePixel &&
      fabs(frame.origin.y - raw.origin.y) < onePixel;
}

// Sizes this run's canvas to the owning View's content box, plus whatever its
// inline elements' decorations paint *outside* the line box.
//
// An inline box's block-axis padding, border and outline overflow the line box
// rather than growing it (CSS2 §10.6.1), so the View's bounds, which are
// exactly the measured text, are too small to draw them into, and `-drawRect:`
// would clip them away.
//
// Only the canvas grows. The compensating `bounds.origin` keeps this view's
// coordinate space identical to the owning View's, so `containerFrame` — the
// one geometry shared by painting and hit-testing — is untouched, as is layout.
- (void)setContainerBounds:(CGRect)containerBounds
{
  auto overflow = _run.attributedString.inlineBoxBlockAxisOverflow();
  // Make room for a run that starts *before* the content box in the inline
  // axis: an `outside` list marker (css-lists-3 §3.2) sits in the gutter to the
  // inline-start side so the content can hang past it, giving this run a
  // negative origin that `-drawRect:` would otherwise clip away.
  CGFloat leading = MAX(0, -RCTCGRectFromRect(_run.frame).origin.x);
  self.frame = CGRectMake(
      containerBounds.origin.x - leading,
      containerBounds.origin.y - overflow.top,
      containerBounds.size.width + leading,
      containerBounds.size.height + overflow.top + overflow.bottom);
  // The compensating origin keeps this view's coordinate space identical to
  // the owning View's, in both axes, so `containerFrame` — the one geometry
  // shared by painting and hit-testing — is untouched, as is layout.
  CGRect bounds = self.bounds;
  bounds.origin.x = -leading;
  bounds.origin.y = -overflow.top;
  self.bounds = bounds;
}

// The content of -drawRect: resolves DYNAMIC colors against the trait
// collection current at draw time, and UIKit has no way to know that: it
// re-invalidates layer-backed PROPERTIES on appearance changes, never
// custom-drawn content. Without this override the first appearance-flipped
// render pass — most reliably iOS's app-switcher snapshotting, which
// re-renders the hierarchy under BOTH styles — bakes wrong-appearance text
// into the layer, and it STAYS baked after the app foregrounds: dark text
// on a dark background.
- (void)traitCollectionDidChange:(UITraitCollection *)previousTraitCollection
{
  [super traitCollectionDidChange:previousTraitCollection];
  if ([self.traitCollection hasDifferentColorAppearanceComparedToTraitCollection:previousTraitCollection]) {
    [self setNeedsDisplay];
  }
}

- (RCTTextLayoutManager *)nativeTextLayoutManager
{
  auto textLayoutManager = _layoutManager.lock();
  if (!textLayoutManager) {
    return nil;
  }
  return (RCTTextLayoutManager *)facebook::react::unwrapManagedObject(textLayoutManager->getNativeTextLayoutManager());
}

- (void)drawRect:(CGRect)rect
{
  RCTTextLayoutManager *nativeTextLayoutManager = self.nativeTextLayoutManager;
  if (!nativeTextLayoutManager) {
    // A silent blank: the run's layout manager is gone, so NOTHING paints
    // this frame.
    facebook::react::CSSTransitionsTrace::shared()->log("paint-nil-mgr");
    return;
  }
  // Paint and hit-testing must share ONE geometry — the run's own Yoga frame.
  // Tripwire: fires the moment any inset or offset is introduced into this
  // consumer.
  CGRect frame = self.containerFrame;
  RCTAssert(
      RCTRunGeometryMatchesYogaFrame(frame, _run.frame, self.traitCollection.displayScale ?: 3.0),
      @"text-children run paint geometry must be the run's Yoga frame, pixel-aligned");

  // Draw from the TextKit storage already built and laid out when this run was
  // measured, instead of converting, rebuilding and re-shaping it here on the
  // main thread. The cache is keyed by content, so a hit is the layout for
  // exactly this content at this width; a miss falls back to the rebuild path
  // below.
  NSTextStorage *cachedTextStorage = _run.runTag != 0
      ? [nativeTextLayoutManager cachedRunTextStorageForAttributedString:_run.attributedString width:frame.size.width]
      : nil;
  if (cachedTextStorage != nil) {
    [nativeTextLayoutManager drawTextStorage:cachedTextStorage
                            attributedString:_run.attributedString
                                       frame:frame
                           drawHighlightPath:nil];
    return;
  }
  [nativeTextLayoutManager drawAttributedString:_run.attributedString
                            paragraphAttributes:facebook::react::ParagraphAttributes {}
                                          frame:frame
                              drawHighlightPath:nil];
}

// Resolves a touch (in the owning View's coordinate space) to an inline
// fragment's emitter, or nullptr when the point misses this run or lands on a
// fragment without one, as bare text is, so the tap falls through to the
// View's own emitter. Uses the same `containerFrame` as painting, so a tap
// always hits exactly where the glyphs were drawn.
- (facebook::react::SharedTouchEventEmitter)touchEventEmitterAtContainerPoint:(CGPoint)point
{
  CGRect frame = self.containerFrame;
  // Same one-geometry invariant as -drawRect: hit-testing must use the run's
  // Yoga frame, or a tap lands where no glyph was drawn.
  RCTAssert(
      RCTRunGeometryMatchesYogaFrame(frame, _run.frame, self.traitCollection.displayScale ?: 3.0),
      @"text-children run hit-test geometry must be the run's Yoga frame, pixel-aligned");
  if (!CGRectContainsPoint(frame, point)) {
    return nullptr;
  }
  RCTTextLayoutManager *nativeTextLayoutManager = self.nativeTextLayoutManager;
  if (!nativeTextLayoutManager) {
    return nullptr;
  }
  // `getEventEmitterWithAttributeString:` lays the run out in a text container at
  // the origin, so the query point must be local to the run's frame.
  CGPoint localPoint = CGPointMake(point.x - frame.origin.x, point.y - frame.origin.y);
  auto eventEmitter =
      [nativeTextLayoutManager getEventEmitterWithAttributeString:_run.attributedString
                                              paragraphAttributes:facebook::react::ParagraphAttributes {}
                                                            frame:frame
                                                          atPoint:localPoint];
  return std::dynamic_pointer_cast<const facebook::react::TouchEventEmitter>(eventEmitter);
}

@end
