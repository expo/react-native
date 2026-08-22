/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "RCTAnonymousTextRunView.h"

#import <React/RCTAssert.h>
#import <React/RCTConversions.h>
#import <react/renderer/textlayoutmanager/RCTAttributedTextUtils.h>
#import <react/renderer/animationbackend/CSSTransitionsTrace.h>
#import <react/renderer/textlayoutmanager/RCTTextLayoutManager.h>
#import <react/utils/ManagedObjectWrapper.h>

#include <limits>

using namespace facebook::react;

@implementation RCTAnonymousTextRunView {
  // Rebuilt when the run changes; walking the layout for every accessibility
  // query would re-lay-out the text on each one.
  NSArray<UIAccessibilityElement *> *_cachedAccessibilityElements;
  // The link rects, and which of them a finger is currently on.
  NSArray<NSValue *> *_cachedLinkRects;
  NSArray<NSValue *> *_pressedLinkRects;
}

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
// coordinate spaces. That drift is exactly what made tapped text jump on
// relayout: paint used `run.frame - contentInset` while hit-testing used
// `run.frame` directly, and the inset only became non-zero once layout metrics
// were applied (i.e. after the first re-render).
- (CGRect)containerFrame
{
  // Pixel-align the run's origin. The engine computes run frames from text
  // layout in points, which lands on fractional pixel offsets; CoreGraphics
  // then rasterizes fresh subpixel glyph variants per draw instead of
  // hitting the glyph cache — measured as a 1.7x mount-time penalty on the
  // simulator's software rasterizer (224 -> 131 ms per 1k rows) and softer
  // glyph edges everywhere. Rounding at this single shared accessor keeps
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
// An inline box's block-axis padding/border/outline overflow the line box
// rather than growing it (CSS2 §10.6.1), so the View's bounds — which are
// exactly the measured text — are by definition too small to draw them into,
// and `-drawRect:` clips them away. A single-line run loses them entirely;
// a wrapped run keeps the ones that happen to fall between its lines, which is
// what made this look like a geometry bug rather than a clipping one.
//
// Only the canvas grows. The compensating `bounds.origin` keeps this view's
// coordinate space identical to the owning View's, so `containerFrame` — the
// one geometry shared by painting and hit-testing — is untouched, as is layout.
- (void)setContainerBounds:(CGRect)containerBounds
{
  auto overflow = _run.attributedString.inlineBoxBlockAxisOverflow();
  // A run can also start *before* the content box in the inline axis: an
  // `outside` list marker (css-lists-3 §3.2) is positioned in the gutter to the
  // inline-start side precisely so the content can hang past it, giving this
  // run a negative origin. Without room on that side `-drawRect:` clips the
  // marker away entirely — the list rendered with no bullets at all on iOS
  // while Android, which does not clip the same way, showed them.
  CGFloat leading = MAX(0, -RCTCGRectFromRect(_run.frame).origin.x);
  /*
   * And past the content box's END: `white-space: pre` keeps lines exactly as
   * authored, and CSS's initial `overflow: visible` means a line longer than
   * the container DRAWS past it (probed in real Safari, which paints the
   * overhang; Android agrees because its container does not clip text
   * drawing). This canvas was sized to the container, so iOS clipped the
   * overhang away — read as "iOS clips, Android doesn't" in the three-way
   * comparison, with the device disagreement being nothing but this view's
   * width. Measured from the same TextKit layout the paint uses, so the canvas
   * and the pixels cannot disagree.
   */
  CGFloat trailing = 0;
  /*
   * Only a run that DOES NOT WRAP can overflow its end edge, so only those pay
   * for the measurement: an ordinary run's lines end at the container by
   * construction and `trailing` stays 0 without any text work.
   */
  const bool wraps = facebook::react::wrapsText(
      _run.attributedString.getBaseTextAttributes().whiteSpace.value_or(facebook::react::WhiteSpace::Normal));
  RCTTextLayoutManager *layoutManager = self.nativeTextLayoutManager;
  if (!wraps && layoutManager != nil) {
    CGRect runFrame = RCTCGRectFromRect(_run.frame);
    auto measurement = [layoutManager
        measureAttributedString:_run.attributedString
            paragraphAttributes:facebook::react::ParagraphAttributes{}
                  layoutContext:facebook::react::TextLayoutContext{}
              layoutConstraints:facebook::react::LayoutConstraints{
                  .maximumSize = {std::numeric_limits<facebook::react::Float>::infinity(),
                                  std::numeric_limits<facebook::react::Float>::infinity()}}];
    trailing = MAX(0, ceil(measurement.size.width) - runFrame.size.width);
  }
  self.frame = CGRectMake(
      containerBounds.origin.x - leading,
      containerBounds.origin.y - overflow.top,
      containerBounds.size.width + leading + trailing,
      containerBounds.size.height + overflow.top + overflow.bottom);
  // The compensating origin keeps this view's coordinate space identical to
  // the owning View's, in both axes, so `containerFrame` — the one geometry
  // shared by painting and hit-testing — is untouched, as is layout.
  CGRect bounds = self.bounds;
  bounds.origin.x = -leading;
  bounds.origin.y = -overflow.top;
  self.bounds = bounds;
}

// The content of -drawRect: resolves DYNAMIC colors (a semantic label color
// cascading into a run resolves against the trait collection current at draw
// time), and UIKit has no way to know that: it re-invalidates layer-backed
// PROPERTIES on appearance changes, never custom-drawn content. Without this
// override the first appearance-flipped render pass — most reliably iOS's
// app-switcher snapshotting, which re-renders the hierarchy under BOTH styles
// — bakes wrong-appearance text into the layer, and it STAYS baked after the
// app foregrounds: black label text on a dark background, exactly the
// "dark mode got lost for some text" report. Later commits invalidated some
// runs back to correct, making a half-flipped, flickering screen out of what
// is really one missing invalidation.
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
    // this frame. If the reported flicker is text blinking out, this line is
    // the whole story.
    facebook::react::CSSTransitionsTrace::shared()->log("paint-nil-mgr");
    return;
  }
  // Paint and hit-testing must share ONE geometry — the run's own Yoga frame.
  // BUG 2 was paint drawing at `frame - contentInset` while hit-testing used
  // `frame`, so tapped text jumped on relayout. Tripwire: fires the moment any
  // inset/offset is reintroduced into this consumer.
  CGRect frame = self.containerFrame;
  RCTAssert(
      RCTRunGeometryMatchesYogaFrame(frame, _run.frame, self.traitCollection.displayScale ?: 3.0),
      @"text-children run paint geometry must be the run's Yoga frame, pixel-aligned");

  /*
   * `white-space: pre` / `nowrap`: lay the PAINT out at unbounded width, the
   * same constraint the measurement used (`constraintsForWhiteSpace`).
   *
   * Yoga clamps the run box to its container, so `frame.size.width` here is
   * the container's — and TextKit, asked to draw into that width, re-broke the
   * lines the measurement deliberately did not break: a long `<pre>` line came
   * out WRAPPED on iOS (then clipped by the canvas), while Android and Safari
   * let it overflow, per CSS's `overflow: visible` initial value. Widening
   * only the draw width keeps geometry, hit-testing and the tripwire above on
   * the Yoga frame; the canvas is grown to fit in `setContainerBounds`.
   */
  if (!facebook::react::wrapsText(_run.attributedString.getBaseTextAttributes().whiteSpace.value_or(
          facebook::react::WhiteSpace::Normal))) {
    frame.size.width = CGFLOAT_MAX;
  }

  // Draw from the TextKit stack measurement already built and laid out for
  // this run (ios-run-draw-reuse-plan.md) instead of converting,
  // rebuilding, and re-shaping it here on the main thread. Content-keyed:
  // a hit is by construction the layout for exactly this content at this
  // width; a miss falls back to the rebuild path below and can never
  // become wrong pixels.
  NSTextStorage *cachedTextStorage = _run.runTag != 0
      ? [nativeTextLayoutManager cachedRunTextStorageForAttributedString:_run.attributedString
                                                                   width:frame.size.width]
      : nil;
  if (cachedTextStorage != nil) {
    [nativeTextLayoutManager drawTextStorage:cachedTextStorage
                            attributedString:_run.attributedString
                                       frame:frame
                           drawHighlightPath:nil];
    [self drawPressedLinkWash];
    return;
  }

  [nativeTextLayoutManager drawAttributedString:_run.attributedString
                            paragraphAttributes:facebook::react::ParagraphAttributes{}
                                          frame:frame
                              drawHighlightPath:nil];
  [self drawPressedLinkWash];
}

/*
 * Painted over the glyphs rather than under them, and rounded, which is what a
 * browser's link highlight looks like on both platforms. `labelColor` at a low
 * alpha rather than a fixed grey so it stays visible in dark mode.
 */
- (void)drawPressedLinkWash
{
  if (_pressedLinkRects.count == 0) {
    return;
  }
  [[[UIColor labelColor] colorWithAlphaComponent:0.18] setFill];
  for (NSValue *value in _pressedLinkRects) {
    // Grown slightly so the wash covers ascenders and descenders rather than
    // clipping the text it is meant to sit behind.
    CGRect rect = CGRectInset(value.CGRectValue, -2, -1);
    [[UIBezierPath bezierPathWithRoundedRect:rect cornerRadius:3] fill];
  }
}

// Resolves a touch (in the owning View's coordinate space) to an inline
// fragment's emitter — e.g. `<b onPress>` — or nullptr when the point misses
// this run or lands on emitter-less bare text, so the tap falls through to the
// View's own emitter. Uses the same `containerFrame` as painting, so a tap
// always hits exactly where the glyphs were drawn.
/*
 * The run's text, so assistive technology can read it.
 *
 * Text children are *painted* by this view rather than mounted as subviews, so
 * nothing in the view tree carries the string: a `<div>Hello</div>` was
 * invisible to VoiceOver entirely, and `<button>Save</button>` announced as a
 * button with no label. `RCTViewComponentView` builds a container's label by
 * walking its subviews and collecting theirs
 * (`RCTRecursiveAccessibilityLabel`), so exposing it here is what puts painted
 * text back into that walk.
 *
 * Deliberately not an accessibility *element*: a text run is not focusable on
 * its own, exactly as a DOM text node is not an event target. It contributes
 * its string to the element that contains it.
 */
- (NSString *)accessibilityLabel
{
  NSString *label = super.accessibilityLabel;
  if (label != nil) {
    return label;
  }
  auto text = _run.attributedString.getString();
  return text.empty() ? nil : RCTNSStringFromString(text);
}

/*
 * The one kind of text run that *is* focusable: a link.
 *
 * The rule above — a run contributes its string to whatever contains it and is
 * not an element itself — is right for text, and wrong for exactly one case. A
 * DOM text node is not an event target, but an `<a href>` is: it is reachable,
 * it is announced as a link, and it is activated on its own. In Safari every
 * link inside a paragraph is a separate accessibility element, and a link that
 * assistive technology cannot land on is not a link.
 *
 * So a run publishes an element per fragment that carries a role, positioned on
 * that fragment's own rects rather than the whole run's. That is what makes a
 * link *inside a sentence* reachable: the anchor has no view — it is a range of
 * glyphs in this run — so there is nothing else that could carry it.
 *
 * `RCTParagraphComponentAccessibilityProvider` does the same for React Native's
 * own `<Text>`; this is the text-children path arriving at the same place.
 *
 * A run with no roles in it returns nothing and stays exactly as it was: not an
 * element, contributing its label upward.
 */
- (void)invalidateAccessibilityElements
{
  _cachedAccessibilityElements = nil;
  _cachedLinkRects = nil;
  _pressedLinkRects = nil;
  // A run only claims touches when it has a link in it; see `-pointInside:`.
  self.userInteractionEnabled = [self linkRects].count > 0;
}

/*
 * The on-screen rects of every link in this run, in the run view's own
 * coordinate space.
 *
 * Shared by accessibility and by press feedback so the two can never disagree
 * about where a link is: what lights up under a finger is exactly what
 * VoiceOver lands on.
 */
- (NSArray<NSValue *> *)linkRects
{
  if (_cachedLinkRects != nil) {
    return _cachedLinkRects;
  }
  RCTTextLayoutManager *nativeTextLayoutManager = self.nativeTextLayoutManager;
  if (nativeTextLayoutManager == nil) {
    return @[];
  }

  NSMutableArray<NSValue *> *rects = [NSMutableArray array];
  const CGRect frame = self.containerFrame;
  const CGPoint offset =
      CGPointMake(frame.origin.x - self.frame.origin.x, frame.origin.y - self.frame.origin.y);

  [nativeTextLayoutManager
      getRectWithAttributedString:_run.attributedString
              paragraphAttributes:facebook::react::ParagraphAttributes{}
               enumerateAttribute:RCTTextAttributesAccessibilityRoleAttributeName
                            frame:CGRectMake(0, 0, frame.size.width, frame.size.height)
                       usingBlock:^(CGRect fragmentRect, NSString *_Nonnull fragmentText, NSString *value) {
                         if (![value isEqualToString:@"link"]) {
                           return;
                         }
                         [rects addObject:[NSValue valueWithCGRect:CGRectOffset(
                                                                       fragmentRect, offset.x, offset.y)]];
                       }];

  _cachedLinkRects = rects;
  return _cachedLinkRects;
}

/*
 * A run claims a touch only where a link actually is.
 *
 * The view covers the whole content box, so claiming everything would make it
 * the hit-test target for taps meant for sibling views. Answering only inside a
 * link's glyphs keeps the run invisible to every other touch, which is what lets
 * press feedback exist at all without disturbing the gesture arbitration around
 * it.
 */
- (BOOL)pointInside:(CGPoint)point withEvent:(UIEvent *)event
{
  for (NSValue *value in [self linkRects]) {
    if (CGRectContainsPoint(value.CGRectValue, point)) {
      return YES;
    }
  }
  return NO;
}

#pragma mark - Press feedback

/*
 * `:active` for a link, drawn where the link is.
 *
 * A browser on either platform paints a translucent wash over a link's own rects
 * while it is held — not over the line, and not over the paragraph. Because the
 * anchor has no view, this is the only place that knows which glyphs to cover.
 *
 * The press releases on cancel as well as on lift, which is what makes a link
 * inside a scroll view behave: the scroll claims the gesture, UIKit cancels the
 * touch, and the highlight goes away without JavaScript being asked.
 */
- (void)setPressedLinkRectsForPoint:(CGPoint)point
{
  NSMutableArray<NSValue *> *pressed = [NSMutableArray array];
  for (NSValue *value in [self linkRects]) {
    if (CGRectContainsPoint(value.CGRectValue, point)) {
      [pressed addObject:value];
    }
  }
  if (pressed.count == 0 && _pressedLinkRects == nil) {
    return;
  }
  _pressedLinkRects = pressed.count > 0 ? pressed : nil;
  [self setNeedsDisplay];
}

- (void)clearPressedLink
{
  if (_pressedLinkRects == nil) {
    return;
  }
  _pressedLinkRects = nil;
  [self setNeedsDisplay];
}

- (void)touchesBegan:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  [self setPressedLinkRectsForPoint:[touches.anyObject locationInView:self]];
  [super touchesBegan:touches withEvent:event];
}

- (void)touchesMoved:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  // Sliding off the link un-highlights it and sliding back on restores it, as a
  // held control does.
  [self setPressedLinkRectsForPoint:[touches.anyObject locationInView:self]];
  [super touchesMoved:touches withEvent:event];
}

- (void)touchesEnded:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  [self clearPressedLink];
  [super touchesEnded:touches withEvent:event];
}

- (void)touchesCancelled:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event
{
  [self clearPressedLink];
  [super touchesCancelled:touches withEvent:event];
}

- (NSArray *)accessibilityElements
{
  if (_cachedAccessibilityElements != nil) {
    return _cachedAccessibilityElements;
  }

  RCTTextLayoutManager *nativeTextLayoutManager = self.nativeTextLayoutManager;
  if (nativeTextLayoutManager == nil) {
    return nil;
  }

  NSMutableArray<UIAccessibilityElement *> *elements = [NSMutableArray array];
  __weak __typeof(self) weakSelf = self;
  const CGRect frame = self.containerFrame;

  [nativeTextLayoutManager
      getRectWithAttributedString:_run.attributedString
              paragraphAttributes:facebook::react::ParagraphAttributes{}
               enumerateAttribute:RCTTextAttributesAccessibilityRoleAttributeName
                            frame:CGRectMake(0, 0, frame.size.width, frame.size.height)
                       usingBlock:^(CGRect fragmentRect, NSString *_Nonnull fragmentText, NSString *value) {
                         UIAccessibilityTraits traits;
                         if ([value isEqualToString:@"link"]) {
                           traits = UIAccessibilityTraitLink;
                         } else if ([value isEqualToString:@"button"]) {
                           traits = UIAccessibilityTraitButton;
                         } else {
                           // Every other role is a description of text, not a
                           // thing to land on.
                           return;
                         }

                         __typeof(self) strongSelf = weakSelf;
                         if (strongSelf == nil) {
                           return;
                         }
                         UIAccessibilityElement *element =
                             [[UIAccessibilityElement alloc] initWithAccessibilityContainer:strongSelf];
                         element.isAccessibilityElement = YES;
                         element.accessibilityTraits = traits;
                         element.accessibilityLabel = fragmentText;
                         // Offset by the run's own frame: the enumeration lays
                         // the string out at the origin, the same convention
                         // `-touchEventEmitterAtContainerPoint:` compensates for
                         // below, and the frame has to be in this view's space.
                         element.accessibilityFrameInContainerSpace = CGRectOffset(
                             fragmentRect, frame.origin.x - self.frame.origin.x, frame.origin.y - self.frame.origin.y);
                         [elements addObject:element];
                       }];

  _cachedAccessibilityElements = elements.count > 0 ? elements : nil;
  return _cachedAccessibilityElements;
}

- (facebook::react::SharedTouchEventEmitter)touchEventEmitterAtContainerPoint:(CGPoint)point
{
  CGRect frame = self.containerFrame;
  // Same one-geometry invariant as -drawRect: hit-testing must use the run's
  // Yoga frame, or a tap lands where no glyph was drawn (BUG 2).
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
  auto eventEmitter = [nativeTextLayoutManager getEventEmitterWithAttributeString:_run.attributedString
                                                             paragraphAttributes:facebook::react::ParagraphAttributes{}
                                                                           frame:frame
                                                                         atPoint:localPoint];
  return std::dynamic_pointer_cast<const facebook::react::TouchEventEmitter>(eventEmitter);
}

@end
