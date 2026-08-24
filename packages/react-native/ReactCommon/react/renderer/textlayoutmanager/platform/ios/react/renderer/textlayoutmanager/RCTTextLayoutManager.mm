/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "RCTTextLayoutManager.h"

#import <CoreText/CoreText.h>

#import <array>

#import "RCTAttributedTextUtils.h"

#include <react/renderer/textlayoutmanager/RCTTextPrimitivesConversions.h>

#import <React/NSTextStorage+FontScaling.h>
#import <React/RCTUtils.h>
#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/utils/ManagedObjectWrapper.h>
#import <react/utils/SimpleThreadSafeCache.h>

#include <list>
#include <mutex>
#include <unordered_map>

using namespace facebook::react;

namespace {

/*
 * The run TextKit storage cache (ios-run-draw-reuse-plan.md). Measuring a
 * run builds and fully lays out its NSTextStorage stack on the layout
 * thread; caching it by CONTENT + width lets the run view draw from it
 * instead of converting, rebuilding, and re-shaping the identical stack on
 * the main thread. Content keying — not take-on-remove — is deliberate: it
 * extends the exact caching policy the C++ text measure cache already
 * applies to the same inputs, so a measure-cache-hit re-mount (repeated
 * content, relayout churn) still finds its storage at draw. Entries are
 * only ever inserted whole and never mutated; the mutex is the
 * happens-before edge for the layout-thread -> main-thread handoff, and
 * draws happen serially on the main thread.
 */
struct RunStorageKey {
  AttributedString attributedString;
  CGFloat width;

  /*
   * Equality over exactly what glyph layout depends on: the container width,
   * the base attributes, and each fragment's content.
   *
   * "Content" is `Fragment::isContentEqual` rather than a field list written
   * out here, and that is the point. A fragment's inline box is not
   * decoration the draw adds on top — its inline-axis margin/border/padding
   * becomes kerning and `firstLineHeadIndent` on the NSAttributedString
   * (RCTApplyInlineBoxSpacing), so it moves glyphs and changes where lines
   * break. Listing fields by hand is how a key silently stops covering one:
   * two rows in a fixed-width block with the same text and the same text
   * attributes but different `<span>` padding are a legal cache collision
   * under a text-and-attributes key, and they render identically.
   * `isContentEqual` is the codebase's existing "everything measurement
   * depends on" predicate, so a new layout-affecting field on Fragment is
   * covered the day it lands.
   *
   * Deliberately NOT the fragments' parentShadowView — its layout metrics
   * are zero at measure and stamped with real geometry by publish
   * (inline-element rects), and they have no effect on shaping for
   * non-attachment fragments. Attachment fragments DO layout by those
   * metrics, which is why attachment-bearing runs are never cached (see the
   * park site) and are rejected here too.
   */
  bool operator==(const RunStorageKey &other) const
  {
    if (width != other.width ||
        !(attributedString.getBaseTextAttributes() == other.attributedString.getBaseTextAttributes())) {
      return false;
    }
    const auto &fragments = attributedString.getFragments();
    const auto &otherFragments = other.attributedString.getFragments();
    if (fragments.size() != otherFragments.size()) {
      return false;
    }
    for (size_t i = 0; i < fragments.size(); i++) {
      if (fragments[i].isAttachment() || otherFragments[i].isAttachment() ||
          !fragments[i].isContentEqual(otherFragments[i])) {
        return false;
      }
    }
    return true;
  }
};

struct RunStorageKeyHash {
  size_t operator()(const RunStorageKey &key) const
  {
    // Hash only the components equality always inspects; collisions are
    // resolved by the full comparison above.
    return std::hash<std::string>{}(key.attributedString.getString()) ^ std::hash<CGFloat>{}(key.width);
  }
};

struct RunStorageState {
  // Most-recently-used at the back. The list owns the storages; the map
  // indexes into it.
  std::list<std::pair<RunStorageKey, NSTextStorage *__strong>> order;
  std::unordered_map<RunStorageKey, decltype(order)::iterator, RunStorageKeyHash> entries;
  size_t totalChars = 0;
};

// Bounded by character count: entries hold whole laid-out TextKit stacks.
constexpr size_t kRunStorageMaxChars = 65536;
constexpr size_t kRunStorageMaxEntries = 256;

std::mutex &runStorageMutex()
{
  static std::mutex mutex;
  return mutex;
}
RunStorageState &runStorageState()
{
  static RunStorageState state;
  return state;
}

void cacheRunTextStorage(const AttributedString &attributedString, CGFloat width, NSTextStorage *textStorage)
{
  auto key = RunStorageKey{.attributedString = attributedString, .width = width};
  size_t chars = attributedString.getString().size();
  std::lock_guard<std::mutex> lock(runStorageMutex());
  auto &state = runStorageState();
  auto it = state.entries.find(key);
  if (it != state.entries.end()) {
    state.totalChars -= it->second->first.attributedString.getString().size();
    state.order.erase(it->second);
    state.entries.erase(it);
  }
  state.order.emplace_back(key, textStorage);
  state.entries[key] = std::prev(state.order.end());
  state.totalChars += chars;
  while (!state.order.empty() &&
         (state.totalChars > kRunStorageMaxChars || state.entries.size() > kRunStorageMaxEntries)) {
    auto &oldest = state.order.front();
    state.totalChars -= oldest.first.attributedString.getString().size();
    state.entries.erase(oldest.first);
    state.order.pop_front();
  }
}

NSTextStorage *cachedRunTextStorage(const AttributedString &attributedString, CGFloat width)
{
  auto key = RunStorageKey{.attributedString = attributedString, .width = width};
  std::lock_guard<std::mutex> lock(runStorageMutex());
  auto &state = runStorageState();
  auto it = state.entries.find(key);
  if (it == state.entries.end()) {
    return nil;
  }
  // Touch: move to most-recently-used.
  state.order.splice(state.order.end(), state.order, it->second);
  it->second = std::prev(state.order.end());
  return it->second->second;
}

} // namespace

@implementation RCTGlyphHuggingLayoutManager {
  CGPoint _backgroundDrawOrigin;
}

- (void)drawBackgroundForGlyphRange:(NSRange)glyphsToShow atPoint:(CGPoint)origin
{
  // Remembered so -fillBackgroundRectArray: can translate its rects (which
  // arrive offset by this origin) back into container coordinates, where the
  // line fragment rects live.
  _backgroundDrawOrigin = origin;
  [super drawBackgroundForGlyphRange:glyphsToShow atPoint:origin];
}

- (void)fillBackgroundRectArray:(const CGRect *)rectArray
                          count:(NSUInteger)rectCount
              forCharacterRange:(NSRange)charRange
                          color:(UIColor *)color
{
  /*
   * TextKit extends a wrapped range's background to the line fragment's far
   * edge — the SELECTION convention, where the highlight is a caret range
   * and running to the wrap point is meaningful. A CSS background is not a
   * selection: it hugs the glyphs, and the space collapsed at a soft wrap
   * paints nothing (css-text-3 §4.1.3 removes it for rendering; verified
   * against real Safari, which ends the first-line highlight at the last
   * glyph while TextKit painted on to the container edge).
   *
   * Each rect is clamped to its own line fragment's USED rect, which is the
   * glyph extent without the trailing whitespace. Legitimate in-advance
   * background — inline-box padding riding a character's kern — is inside
   * the used rect and unaffected. Clamping both edges keeps the rule
   * direction-agnostic: whichever side the wrap leaves hanging is the side
   * the used rect excludes.
   */
  NSTextContainer *textContainer = self.textContainers.firstObject;
  std::vector<CGRect> clamped(rectCount);
  for (NSUInteger i = 0; i < rectCount; i++) {
    CGRect rect = CGRectOffset(rectArray[i], -_backgroundDrawOrigin.x, -_backgroundDrawOrigin.y);
    NSUInteger glyphIndex =
        [self glyphIndexForPoint:CGPointMake(CGRectGetMinX(rect) + 0.5, CGRectGetMidY(rect))
                 inTextContainer:textContainer];
    CGRect usedRect = [self lineFragmentUsedRectForGlyphAtIndex:glyphIndex effectiveRange:nil];
    CGFloat left = MAX(CGRectGetMinX(rect), CGRectGetMinX(usedRect));
    CGFloat right = MIN(CGRectGetMaxX(rect), CGRectGetMaxX(usedRect));
    rect.origin.x = left;
    rect.size.width = MAX(right - left, 0);
    clamped[i] = CGRectOffset(rect, _backgroundDrawOrigin.x, _backgroundDrawOrigin.y);
  }
  [super fillBackgroundRectArray:clamped.data() count:rectCount forCharacterRange:charRange color:color];
}

@end

@implementation RCTTextLayoutManager {
  SimpleThreadSafeCache<AttributedString, std::shared_ptr<void>, 256> _cache;
}

static NSLineBreakMode RCTNSLineBreakModeFromEllipsizeMode(EllipsizeMode ellipsizeMode)
{
  switch (ellipsizeMode) {
    case EllipsizeMode::Clip:
      return NSLineBreakByClipping;
    case EllipsizeMode::Head:
      return NSLineBreakByTruncatingHead;
    case EllipsizeMode::Tail:
      return NSLineBreakByTruncatingTail;
    case EllipsizeMode::Middle:
      return NSLineBreakByTruncatingMiddle;
  }
}

- (TextMeasurement)measureNSAttributedString:(NSAttributedString *)attributedString
                         paragraphAttributes:(ParagraphAttributes)paragraphAttributes
                               layoutContext:(TextLayoutContext)layoutContext
                           layoutConstraints:(LayoutConstraints)layoutConstraints
{
  if (attributedString.length == 0) {
    // This is not really an optimization because that should be checked much earlier on the call stack.
    // Sometimes, very irregularly, measuring an empty string crashes/freezes iOS internal text infrastructure.
    // This is our last line of defense.
    return {};
  }

  CGSize maximumSize = CGSize{layoutConstraints.maximumSize.width, CGFLOAT_MAX};
  NSTextStorage *textStorage = [self _textStorageAndLayoutManagerWithAttributesString:attributedString
                                                                  paragraphAttributes:paragraphAttributes
                                                                                 size:maximumSize];

  return [self _measureTextStorage:textStorage paragraphAttributes:paragraphAttributes layoutContext:layoutContext];
}

- (TextMeasurement)measureAttributedString:(AttributedString)attributedString
                       paragraphAttributes:(ParagraphAttributes)paragraphAttributes
                             layoutContext:(TextLayoutContext)layoutContext
                         layoutConstraints:(LayoutConstraints)layoutConstraints
{
  NSAttributedString *nsAttributedString = [self _nsAttributedStringFromAttributedString:attributedString];

  // A run-tagged measure caches the TextKit stack it builds — fully laid
  // out on this (layout) thread — for the run view to draw from instead of
  // rebuilding and re-shaping it on the main thread
  // (ios-run-draw-reuse-plan.md).
  if (layoutContext.runTag != 0 && nsAttributedString.length != 0) {
    CGSize maximumSize = CGSize{layoutConstraints.maximumSize.width, CGFLOAT_MAX};
    NSTextStorage *textStorage = [self _textStorageAndLayoutManagerWithAttributesString:nsAttributedString
                                                                    paragraphAttributes:paragraphAttributes
                                                                                   size:maximumSize];
    auto measurement = [self _measureTextStorage:textStorage
                             paragraphAttributes:paragraphAttributes
                                   layoutContext:layoutContext];
    // Attachment-bearing runs are never cached: an attachment's placeholder
    // lays out by its parentShadowView's metrics, which change between
    // measure and mount — the cache key deliberately ignores those metrics
    // for the fragments it does compare.
    bool hasAttachments = false;
    for (const auto &fragment : attributedString.getFragments()) {
      if (fragment.isAttachment()) {
        hasAttachments = true;
        break;
      }
    }
    if (!hasAttachments) {
      cacheRunTextStorage(attributedString, maximumSize.width, textStorage);
    }
    return measurement;
  }

  return [self measureNSAttributedString:nsAttributedString
                     paragraphAttributes:paragraphAttributes
                           layoutContext:layoutContext
                       layoutConstraints:layoutConstraints];
}

- (nullable NSTextStorage *)cachedRunTextStorageForAttributedString:(const AttributedString &)attributedString
                                                              width:(CGFloat)width
{
  // Content-keyed: the storage returned is by construction the layout for
  // exactly what is being drawn (the key IS the content plus the container
  // width wrapping depends on; the container height deliberately differs —
  // CGFLOAT_MAX at measure — and cannot affect glyph layout because runs
  // never truncate). A miss falls back to the rebuild path; it can never
  // become wrong pixels.
  return cachedRunTextStorage(attributedString, width);
}

- (std::vector<facebook::react::Rect>)
    getFragmentRectsWithAttributedString:(AttributedString)attributedString
                     paragraphAttributes:(ParagraphAttributes)paragraphAttributes
                                    size:(CGSize)size
{
  std::vector<facebook::react::Rect> rects;
  const auto &fragments = attributedString.getFragments();
  if (fragments.empty()) {
    return rects;
  }

  NSAttributedString *nsAttributedString = [self _nsAttributedStringFromAttributedString:attributedString];
  NSTextStorage *textStorage = [self _textStorageAndLayoutManagerWithAttributesString:nsAttributedString
                                                                 paragraphAttributes:paragraphAttributes
                                                                                size:size];
  NSLayoutManager *layoutManager = textStorage.layoutManagers.firstObject;
  NSTextContainer *textContainer = layoutManager.textContainers.firstObject;
  [layoutManager ensureLayoutForTextContainer:textContainer];

  rects.reserve(fragments.size());

  // Fragments are appended to the attributed string in order, so their
  // character ranges tile it. Lengths are counted in UTF-16 units (what
  // NSAttributedString indexes by), and an attachment occupies exactly the
  // one attachment character.
  NSUInteger location = 0;
  for (const auto &fragment : fragments) {
    NSUInteger length;
    if (fragment.isAttachment()) {
      length = 1;
    } else {
      NSString *fragmentText = [NSString stringWithUTF8String:fragment.string.c_str()];
      length = fragmentText != nil ? fragmentText.length : 0;
    }
    if (length == 0 && fragment.isEmptyElement && textStorage.length > 0) {
      // An inline element with no text of its own. The web gives it a
      // zero-width box on the line it sits on (CSSOM-View §4), and a
      // zero-length glyph range returns nothing at all — so the box is built
      // from the line fragment it lands in and the caret position within it.
      NSUInteger charIndex = MIN(location, textStorage.length - 1);
      NSUInteger glyphIndex = [layoutManager glyphIndexForCharacterAtIndex:charIndex];
      CGRect lineRect = [layoutManager lineFragmentRectForGlyphAtIndex:glyphIndex effectiveRange:NULL];
      CGFloat x;
      if (location >= textStorage.length) {
        // Nothing follows: the caret sits after the last glyph, not before it.
        CGRect last = [layoutManager boundingRectForGlyphRange:NSMakeRange(glyphIndex, 1)
                                              inTextContainer:textContainer];
        x = CGRectGetMaxX(last);
      } else {
        x = lineRect.origin.x + [layoutManager locationForGlyphAtIndex:glyphIndex].x;
      }
      rects.push_back(facebook::react::Rect{
          .origin = {.x = (Float)x, .y = (Float)lineRect.origin.y},
          .size = {.width = 0, .height = (Float)lineRect.size.height}});
      continue;
    }
    if (length == 0 || location + length > textStorage.length) {
      rects.push_back(facebook::react::Rect{});
      location += length;
      continue;
    }

    NSRange characterRange = NSMakeRange(location, length);
    NSRange glyphRange = [layoutManager glyphRangeForCharacterRange:characterRange actualCharacterRange:nullptr];
    // `boundingRectForGlyphRange:` already unions the pieces of a range that
    // wraps across lines, which is exactly the box the web reports.
    CGRect boundingRect = [layoutManager boundingRectForGlyphRange:glyphRange inTextContainer:textContainer];

    // An element's box is its *border* box, so it includes the inline-axis
    // space G3 reserved. The trailing space is kerning on the element's own
    // last character and is already inside `boundingRect`; the leading space
    // is kerning on the *preceding* character (no spacer character is ever
    // injected — see RCTApplyInlineBoxSpacing), so it sits just outside and
    // has to be added back here.
    CGFloat leading = fragment.leadingInlineSpace();
    boundingRect.origin.x -= leading;
    boundingRect.size.width += leading;

    // Block-axis padding and borders are part of the border box too. They
    // deliberately do NOT grow the line box (CSS2 §10.6.1 — they overflow it),
    // so the glyph bounds TextKit returns never include them, but the element
    // still reports them as its own box.
    const auto blockAxis = fragment.blockAxisBoxEdges();
    boundingRect.origin.y -= blockAxis.top;
    boundingRect.size.height += blockAxis.top + blockAxis.bottom;

    rects.push_back(facebook::react::Rect{
        .origin = {.x = (Float)boundingRect.origin.x, .y = (Float)boundingRect.origin.y},
        .size = {.width = (Float)boundingRect.size.width, .height = (Float)boundingRect.size.height}});

    location += length;
  }

  return rects;
}

- (CGRect)drawingFrameForAttributedString:(AttributedString)attributedString
                      paragraphAttributes:(ParagraphAttributes)paragraphAttributes
                                    frame:(CGRect)frame
                           containerFrame:(CGRect *)containerFrame
{
  if (containerFrame != nullptr) {
    *containerFrame = frame;
  }

  if (!ReactNativeFeatureFlags::enableIOSCompressedTextFrameAdjustment()) {
    return frame;
  }

  NSTextStorage *textStorage = [self
      _textStorageAndLayoutManagerWithAttributesString:[self _nsAttributedStringFromAttributedString:attributedString]
                                   paragraphAttributes:paragraphAttributes
                                                  size:frame.size];
  NSLayoutManager *layoutManager = textStorage.layoutManagers.firstObject;
  NSTextContainer *textContainer = layoutManager.textContainers.firstObject;
  [layoutManager ensureLayoutForTextContainer:textContainer];

  NSRange glyphRange = [layoutManager glyphRangeForTextContainer:textContainer];
  [self processTruncatedAttributedText:textStorage textContainer:textContainer layoutManager:layoutManager];

  __block CGFloat maximumLineHeight = 0;
  [textStorage enumerateAttribute:NSParagraphStyleAttributeName
                          inRange:NSMakeRange(0, textStorage.length)
                          options:NSAttributedStringEnumerationLongestEffectiveRangeNotRequired
                       usingBlock:^(NSParagraphStyle *paragraphStyle, __unused NSRange range, __unused BOOL *stop) {
                         if (paragraphStyle != nil) {
                           maximumLineHeight = MAX(paragraphStyle.maximumLineHeight, maximumLineHeight);
                         }
                       }];
  if (maximumLineHeight == 0 || glyphRange.length == 0) {
    return frame;
  }

  CGRect glyphBounds = [layoutManager boundingRectForGlyphRange:glyphRange inTextContainer:textContainer];
  CGFloat glyphHeight = CGRectGetMaxY(glyphBounds) - MIN(glyphBounds.origin.y, 0);
  CGFloat drawingHeight = MAX(frame.size.height, glyphHeight);
  CGFloat extraHeight = drawingHeight - frame.size.height;

  CGRect localContainerFrame = frame;
  localContainerFrame.origin.y -= extraHeight / 2.0;
  localContainerFrame.size.height = drawingHeight;
  if (containerFrame != nullptr) {
    *containerFrame = localContainerFrame;
  }

  CGRect drawingFrame = frame;
  drawingFrame.size.height = drawingHeight;
  drawingFrame.origin.y = localContainerFrame.origin.y;
  if (glyphBounds.origin.y < 0) {
    drawingFrame.origin.y += (drawingHeight - glyphBounds.size.height) / 2.0 - glyphBounds.origin.y;
  }
  return drawingFrame;
}


namespace {

// SharedColor -> UIColor. Kept local: this module does not depend on
// React/Fabric (where RCTUIColorFromSharedColor lives), and the conversion is
// a single unwrap.
UIColor *_Nullable inlineBoxColor(const facebook::react::SharedColor &sharedColor)
{
  return RCTUIColorFromSharedColor(sharedColor);
}

// Paints the CSS box decorations of inline elements: one box per line
// fragment, with the leading edge's border drawn only on the first fragment
// and the trailing edge's only on the last (CSS2 §8.6 `box-decoration-break:
// slice`, the default). box-model-scope.md G4/G5.
//
// Vertical padding/border deliberately overflow the line box rather than
// growing it, which is what the web does for inline boxes.
//
// Two phases, because the element's own background must sit UNDER any
// background a nested child paints through TextKit's attribute pass, while
// the borders must sit OVER it: Background runs before
// `drawBackgroundForGlyphRange:`, Borders after.
//
// The background is painted here, not by `NSBackgroundColorAttributeName`,
// for any fragment carrying box decorations: the attribute covers glyph
// advances only, and G3 hangs the LEADING space off the preceding character
// — so a padded span's background started after its own left padding (and,
// on the trailing side, the attribute spilled over the margin). CSS paints
// the background over the border box; the box computed for the borders is
// exactly that. The attribute is stripped from such fragments where the
// string is built (RCTNSAttributedStringFragmentWithAttributesFromFragment).
enum class InlineBoxPaintPhase { Background, Borders };

void drawInlineBoxDecorations(
    const AttributedString &attributedString,
    NSTextStorage *textStorage,
    NSLayoutManager *layoutManager,
    NSTextContainer *textContainer,
    CGPoint origin,
    InlineBoxPaintPhase phase)
{
  const auto &fragments = attributedString.getFragments();
  CGContextRef context = UIGraphicsGetCurrentContext();
  if (context == nullptr) {
    return;
  }

  // G3 expresses inline-axis spacing as kerning, never as extra characters, so
  // fragments still tile the built string one-for-one.
  auto builtLengthOfFragment = [](const AttributedString::Fragment &fragment) -> NSUInteger {
    NSString *text = [NSString stringWithUTF8String:fragment.string.c_str()];
    return fragment.isAttachment() ? 1 : (text != nil ? text.length : 0);
  };

  NSUInteger location = 0;
  size_t index = 0;
  while (index < fragments.size()) {
    const auto &fragment = fragments[index];

    if (fragment.inlineBox.isEmpty()) {
      location += builtLengthOfFragment(fragment);
      index++;
      continue;
    }

    // Consume the whole element: consecutive fragments sharing these
    // decorations, ending at the fragment flagged as the box's end.
    const auto decorations = fragment.inlineBox;
    // The element's own background. Nested children carry it too (the text
    // cascade inherits backgroundColor down), so the first fragment's value
    // is the element's unless a child overrode it at the very start.
    const auto elementBackground = fragment.textAttributes.backgroundColor;
    NSUInteger elementStart = location;
    NSUInteger elementLength = 0;
    bool sawEnd = false;
    while (index < fragments.size()) {
      const auto &current = fragments[index];
      NSUInteger currentLength = builtLengthOfFragment(current);
      elementLength += currentLength;
      location += currentLength;
      index++;
      if (current.isInlineBoxEnd) {
        sawEnd = true;
        break;
      }
    }
    if (!sawEnd || elementLength == 0 || elementStart + elementLength > textStorage.length) {
      continue;
    }

    const CGFloat borderTop = decorations.borderWidth.top;
    const CGFloat borderBottom = decorations.borderWidth.bottom;
    const CGFloat borderLeft = decorations.borderWidth.left;
    const CGFloat borderRight = decorations.borderWidth.right;
    const CGFloat padTop = decorations.padding.top;
    const CGFloat padBottom = decorations.padding.bottom;

    NSRange characterRange = NSMakeRange(elementStart, elementLength);
    NSRange glyphRange = [layoutManager glyphRangeForCharacterRange:characterRange
                                               actualCharacterRange:nullptr];

    // One rect per line the element occupies, tight to *this element's* glyphs.
    //
    // Both of the obvious APIs are wrong here, and both fail in ways that look
    // plausible on screen:
    //  - `boundingRectForGlyphRange:` widens to the whole line fragment, and to
    //    the container's full width once the range spans a line break.
    //  - `enumerateEnclosingRectsForGlyphRange:` is built for selection
    //    highlighting, so it *merges* contiguous full-width lines into a single
    //    tall rect. Border edges then get painted across the middle of the run
    //    instead of on each line.
    // So the extents are derived from glyph positions directly, which is the
    // only formulation that stays tight at both ends of every line.
    NSMutableArray<NSValue *> *lineRects = [NSMutableArray array];
    [layoutManager
        enumerateLineFragmentsForGlyphRange:glyphRange
                                 usingBlock:^(
                                     CGRect lineRect,
                                     CGRect usedRect,
                                     NSTextContainer *__unused container,
                                     NSRange lineGlyphRange,
                                     BOOL *__unused stop) {
                                   NSRange intersection =
                                       NSIntersectionRange(lineGlyphRange, glyphRange);
                                   if (intersection.length == 0) {
                                     return;
                                   }
                                   // `locationForGlyphAtIndex:` is relative to
                                   // the line fragment's origin.
                                   CGFloat startX = lineRect.origin.x +
                                       [layoutManager locationForGlyphAtIndex:intersection.location].x;
                                   NSUInteger endGlyph = NSMaxRange(intersection);
                                   CGFloat endX;
                                   if (endGlyph < NSMaxRange(lineGlyphRange)) {
                                     endX = lineRect.origin.x +
                                         [layoutManager locationForGlyphAtIndex:endGlyph].x;
                                   } else {
                                     // The element runs to the end of this
                                     // line; `usedRect` is where the line's
                                     // content actually stops.
                                     endX = CGRectGetMaxX(usedRect);
                                   }
                                   if (endX <= startX) {
                                     return;
                                   }
                                   [lineRects
                                       addObject:[NSValue
                                                     valueWithCGRect:CGRectMake(
                                                                         startX,
                                                                         usedRect.origin.y,
                                                                         endX - startX,
                                                                         usedRect.size.height)]];
                                 }];

    for (NSUInteger i = 0; i < lineRects.count; i++) {
      // CSS2 §8.6 `box-decoration-break: slice`: only the first fragment gets
      // the leading edge and only the last gets the trailing one.
      // DOM-CSS-LIMITATION(no-box-decoration-break-clone): only `slice` (the
      // default) is implemented; `clone` would repeat both edges per fragment.
      const bool isFirst = (i == 0);
      const bool isLast = (i + 1 == lineRects.count);
      const CGFloat leadBorder = isFirst ? borderLeft : 0;
      const CGFloat trailBorder = isLast ? borderRight : 0;

      // `run` is the element's own glyphs. G3's leading space is kerning on the
      // *preceding* character, so it falls outside this rect and the padding
      // and border have to be added back here; the trailing space is kerning
      // on the element's last character, so it is inside `run` and comes off.
      // The margin is not painted at all.
      //
      // Vertically nothing is reserved, and nothing should be — an inline
      // box's block-axis padding and border overflow the line box instead of
      // growing it (CSS2 §10.6.1) — so those grow the box outwards here.
      CGRect run = [lineRects[i] CGRectValue];
      CGFloat left = origin.x + run.origin.x - (isFirst ? decorations.padding.left + borderLeft : 0);
      CGFloat right = origin.x + CGRectGetMaxX(run) -
          (isLast ? decorations.trailingInlineSpace() - decorations.padding.right - borderRight : 0);
      CGRect borderBox = CGRectMake(
          left,
          origin.y + run.origin.y - padTop - borderTop,
          std::max((CGFloat)0, right - left),
          run.size.height + padTop + padBottom + borderTop + borderBottom);

      if (phase == InlineBoxPaintPhase::Background) {
        // The border box, exactly — CSS's default background-clip. The
        // borders paint over it in the later phase.
        UIColor *backgroundColor = inlineBoxColor(elementBackground);
        if (backgroundColor != nil) {
          CGContextSetFillColorWithColor(context, backgroundColor.CGColor);
          if (decorations.borderRadius > 0) {
            UIBezierPath *path = [UIBezierPath bezierPathWithRoundedRect:borderBox
                                                            cornerRadius:decorations.borderRadius];
            CGContextAddPath(context, path.CGPath);
            CGContextFillPath(context);
          } else {
            CGContextFillRect(context, borderBox);
          }
        }
        continue;
      }

      // Edges are filled as solid rects rather than stroked: a stroke centres
      // on the path, so a degenerate (zero-height) rect straddles the edge and
      // lands half a point off, and CoreGraphics' handling of zero-size rects
      // is not worth relying on.
      UIColor *topColor = inlineBoxColor(decorations.borderColor.top);
      UIColor *bottomColor = inlineBoxColor(decorations.borderColor.bottom);
      UIColor *leftColor = inlineBoxColor(decorations.borderColor.left);
      UIColor *rightColor = inlineBoxColor(decorations.borderColor.right);

      if (borderTop > 0 && topColor != nil) {
        CGContextSetFillColorWithColor(context, topColor.CGColor);
        CGContextFillRect(
            context,
            CGRectMake(borderBox.origin.x, borderBox.origin.y, borderBox.size.width, borderTop));
      }
      if (borderBottom > 0 && bottomColor != nil) {
        CGContextSetFillColorWithColor(context, bottomColor.CGColor);
        CGContextFillRect(
            context,
            CGRectMake(
                borderBox.origin.x,
                CGRectGetMaxY(borderBox) - borderBottom,
                borderBox.size.width,
                borderBottom));
      }
      if (leadBorder > 0 && leftColor != nil) {
        CGContextSetFillColorWithColor(context, leftColor.CGColor);
        CGContextFillRect(
            context,
            CGRectMake(borderBox.origin.x, borderBox.origin.y, leadBorder, borderBox.size.height));
      }
      if (trailBorder > 0 && rightColor != nil) {
        CGContextSetFillColorWithColor(context, rightColor.CGColor);
        CGContextFillRect(
            context,
            CGRectMake(
                CGRectGetMaxX(borderBox) - trailBorder,
                borderBox.origin.y,
                trailBorder,
                borderBox.size.height));
      }

      // G5: the outline is the border box pushed out by `outline-offset`.
      // It is stroked (not sliced per edge) and never affects layout.
      if (decorations.outlineWidth > 0) {
        UIColor *outlineColor = inlineBoxColor(decorations.outlineColor);
        if (outlineColor != nil) {
          // Stroke centres on the path, so offset by half the width to keep
          // the inner edge exactly `outlineOffset` away from the border box.
          CGFloat inset = -(decorations.outlineOffset + decorations.outlineWidth / 2);
          CGRect outlineRect = CGRectInset(borderBox, inset, inset);
          CGContextSetStrokeColorWithColor(context, outlineColor.CGColor);
          CGContextSetLineWidth(context, decorations.outlineWidth);
          if (decorations.borderRadius > 0) {
            UIBezierPath *path = [UIBezierPath bezierPathWithRoundedRect:outlineRect
                                                           cornerRadius:decorations.borderRadius];
            CGContextAddPath(context, path.CGPath);
            CGContextStrokePath(context);
          } else {
            CGContextStrokeRect(context, outlineRect);
          }
        }
      }
    }
  }
}

} // namespace

- (void)drawAttributedString:(AttributedString)attributedString
         paragraphAttributes:(ParagraphAttributes)paragraphAttributes
                       frame:(CGRect)frame
           drawHighlightPath:(void (^_Nullable)(UIBezierPath *highlightPath))block
{
  NSTextStorage *textStorage = [self
      _textStorageAndLayoutManagerWithAttributesString:[self _nsAttributedStringFromAttributedString:attributedString]
                                   paragraphAttributes:paragraphAttributes
                                                  size:frame.size];
  [self drawTextStorage:textStorage attributedString:attributedString frame:frame drawHighlightPath:block];
}

- (void)drawTextStorage:(NSTextStorage *)textStorage
       attributedString:(const AttributedString &)attributedString
                  frame:(CGRect)frame
      drawHighlightPath:(void (^_Nullable)(UIBezierPath *highlightPath))block
{
  NSLayoutManager *layoutManager = textStorage.layoutManagers.firstObject;
  NSTextContainer *textContainer = layoutManager.textContainers.firstObject;

#if TARGET_OS_MACCATALYST
  CGContextRef context = UIGraphicsGetCurrentContext();
  CGContextSaveGState(context);
  CGContextSetShouldSmoothFonts(context, NO);
#endif

  NSRange glyphRange = [layoutManager glyphRangeForTextContainer:textContainer];

  [self processTruncatedAttributedText:textStorage textContainer:textContainer layoutManager:layoutManager];

  // An inline element's own background paints first, so a nested child's
  // attribute-painted background can still sit on top of it; the borders and
  // outline paint after the attribute pass, so they sit on top of everything
  // but the glyphs.
  drawInlineBoxDecorations(
      attributedString,
      textStorage,
      layoutManager,
      textContainer,
      frame.origin,
      InlineBoxPaintPhase::Background);
  [layoutManager drawBackgroundForGlyphRange:glyphRange atPoint:frame.origin];
  drawInlineBoxDecorations(
      attributedString,
      textStorage,
      layoutManager,
      textContainer,
      frame.origin,
      InlineBoxPaintPhase::Borders);
  [layoutManager drawGlyphsForGlyphRange:glyphRange atPoint:frame.origin];

#if TARGET_OS_MACCATALYST
  CGContextRestoreGState(context);
#endif

  // Custom decoration pass: enumerate `RCTCustomDecorationAttributeName`
  // ranges and paint each one ourselves. Covers wavy (no UIKit equivalent),
  // dotted, and dashed (UIKit's pattern bits don't match browser geometry).
  {
    CGContextRef ctx = UIGraphicsGetCurrentContext();
    if (ctx != nullptr) {
      NSRange charRange = [layoutManager characterRangeForGlyphRange:glyphRange actualGlyphRange:nullptr];
      [textStorage
          enumerateAttribute:RCTCustomDecorationAttributeName
                     inRange:charRange
                     options:0
                  usingBlock:^(NSDictionary *_Nullable attrs, NSRange attrRange, __unused BOOL *stop) {
                    if (attrs == nil) {
                      return;
                    }
                    NSArray<NSString *> *lines = attrs[@"lines"];
                    UIColor *strokeColor = attrs[@"color"];
                    NSString *style = attrs[@"style"];
                    UIFont *font = [textStorage attribute:NSFontAttributeName
                                                  atIndex:attrRange.location
                                           effectiveRange:nullptr];
                    if (font == nil || strokeColor == nil || style == nil) {
                      return;
                    }

                    CGFloat fontSize = font.pointSize;
                    // Thickness scales with the type size so the decoration
                    // remains visible at small sizes and proportionate at
                    // large ones. ~`fontSize / 12` plus a 1.5pt floor.
                    CGFloat thickness = MAX(fontSize / 12.0f, 1.5f);
                    CGFloat wavyWavelength = 1.0f + 2.0f * round(2.0f * thickness + 0.5f);
                    CGFloat wavyCpDistance = 0.5f + round(3.0f * thickness + 0.5f);

                    NSRange targetGlyphRange = [layoutManager glyphRangeForCharacterRange:attrRange
                                                                     actualCharacterRange:nullptr];

                    CGContextSaveGState(ctx);
                    CGContextSetStrokeColorWithColor(ctx, strokeColor.CGColor);
                    CGContextSetLineWidth(ctx, thickness);
                    CGContextSetShouldAntialias(ctx, YES);

                    if ([style isEqualToString:@"dotted"]) {
                      const std::array<CGFloat, 2> dotIntervals = {0.0f, thickness * 2.0f};
                      CGContextSetLineDash(ctx, 0, dotIntervals.data(), dotIntervals.size());
                      CGContextSetLineCap(ctx, kCGLineCapRound);
                    } else if ([style isEqualToString:@"dashed"]) {
                      const std::array<CGFloat, 2> dashIntervals = {thickness * 2.0f, thickness};
                      CGContextSetLineDash(ctx, 0, dashIntervals.data(), dashIntervals.size());
                      CGContextSetLineCap(ctx, kCGLineCapButt);
                    } else {
                      CGContextSetLineCap(ctx, kCGLineCapRound);
                    }

                    [layoutManager
                        enumerateLineFragmentsForGlyphRange:targetGlyphRange
                                                 usingBlock:^(
                                                     CGRect lineRect,
                                                     __unused CGRect usedRect,
                                                     NSTextContainer *_Nonnull container,
                                                     NSRange lineGlyphRange,
                                                     __unused BOOL *_Nonnull innerStop) {
                                                   NSRange intersection =
                                                       NSIntersectionRange(targetGlyphRange, lineGlyphRange);
                                                   if (intersection.length == 0) {
                                                     return;
                                                   }
                                                   CGRect firstGlyphRect = [layoutManager
                                                       boundingRectForGlyphRange:NSMakeRange(intersection.location, 1)
                                                                 inTextContainer:container];
                                                   CGRect lastGlyphRect = [layoutManager
                                                       boundingRectForGlyphRange:NSMakeRange(
                                                                                     NSMaxRange(intersection) - 1, 1)
                                                                 inTextContainer:container];
                                                   CGFloat x1 = firstGlyphRect.origin.x + frame.origin.x;
                                                   CGFloat x2 = CGRectGetMaxX(lastGlyphRect) + frame.origin.x;
                                                   CGFloat baseline =
                                                       lineRect.origin.y + font.ascender + frame.origin.y;

                                                   // NOLINTNEXTLINE(cppcoreguidelines-init-variables)
                                                   for (NSString *line in lines) {
                                                     CGFloat y = 0.0f;
                                                     if ([line isEqualToString:@"underline"]) {
                                                       if ([style isEqualToString:@"wavy"]) {
                                                         y = baseline + 1.0f;
                                                       } else {
                                                         // The font's own underline position, not an
                                                         // invented constant: CoreText publishes where
                                                         // this face puts its rule (negative = below the
                                                         // baseline), and the platform's underlines sit
                                                         // there. A dotted rule is round-capped, so half
                                                         // its thickness rides above the stroke's centre
                                                         // — the dots hugged the descenders when the
                                                         // centre sat at the type's position; centring
                                                         // the stroke a half-thickness lower keeps the
                                                         // dot TOPS at the face's rule position.
                                                         CGFloat rulePosition = -CTFontGetUnderlinePosition(
                                                             (__bridge CTFontRef)font);
                                                         y = baseline + MAX(rulePosition, thickness) +
                                                             thickness / 2.0f + 0.5f;
                                                       }
                                                     } else {
                                                       y = baseline - (font.ascender + font.descender) / 2.0f + 1.0f;
                                                     }
                                                     if ([style isEqualToString:@"wavy"]) {
                                                       CGContextSaveGState(ctx);
                                                       CGContextClipToRect(
                                                           ctx,
                                                           CGRectMake(
                                                               x1,
                                                               y - wavyCpDistance - thickness,
                                                               x2 - x1,
                                                               2 * wavyCpDistance + 2 * thickness));
                                                       CGContextBeginPath(ctx);
                                                       CGContextMoveToPoint(ctx, x1, y);
                                                       CGFloat step = wavyWavelength / 2.0f;
                                                       CGFloat wx = x1;
                                                       while (wx < x2) {
                                                         CGFloat midX = wx + step;
                                                         CGContextAddCurveToPoint(
                                                             ctx,
                                                             midX,
                                                             y + wavyCpDistance,
                                                             midX,
                                                             y - wavyCpDistance,
                                                             wx + wavyWavelength,
                                                             y);
                                                         wx += wavyWavelength;
                                                       }
                                                       CGContextStrokePath(ctx);
                                                       CGContextRestoreGState(ctx);
                                                     } else {
                                                       CGContextBeginPath(ctx);
                                                       CGContextMoveToPoint(ctx, x1, y);
                                                       CGContextAddLineToPoint(ctx, x2, y);
                                                       CGContextStrokePath(ctx);
                                                     }
                                                   }
                                                 }];

                    CGContextRestoreGState(ctx);
                  }];
    }
  }

  if (block != nil) {
    __block UIBezierPath *highlightPath = nil;
    NSRange characterRange = [layoutManager characterRangeForGlyphRange:glyphRange actualGlyphRange:NULL];

    [textStorage
        enumerateAttribute:RCTAttributedStringIsHighlightedAttributeName
                   inRange:characterRange
                   options:0
                usingBlock:^(NSNumber *value, NSRange range, __unused BOOL *stop) {
                  if (!value.boolValue) {
                    return;
                  }

                  [layoutManager
                      enumerateEnclosingRectsForGlyphRange:range
                                  withinSelectedGlyphRange:range
                                           inTextContainer:textContainer
                                                usingBlock:^(CGRect enclosingRect, __unused BOOL *anotherStop) {
                                                  UIBezierPath *path = [UIBezierPath
                                                      bezierPathWithRoundedRect:CGRectInset(enclosingRect, -2, -2)
                                                                   cornerRadius:2];
                                                  if (highlightPath != nullptr) {
                                                    [highlightPath appendPath:path];
                                                  } else {
                                                    highlightPath = path;
                                                  }
                                                }];
                }];

    block(highlightPath);
  }
}

- (void)processTruncatedAttributedText:(NSTextStorage *)textStorage
                         textContainer:(NSTextContainer *)textContainer
                         layoutManager:(NSLayoutManager *)layoutManager
{
  if (textContainer.maximumNumberOfLines > 0) {
    [layoutManager ensureLayoutForTextContainer:textContainer];
    NSRange glyphRange = [layoutManager glyphRangeForTextContainer:textContainer];
    __block int line = 0;
    [layoutManager
        enumerateLineFragmentsForGlyphRange:glyphRange
                                 usingBlock:^(
                                     CGRect rect,
                                     CGRect usedRect,
                                     NSTextContainer *_Nonnull _,
                                     NSRange lineGlyphRange,
                                     BOOL *_Nonnull stop) {
                                   if (line == textContainer.maximumNumberOfLines - 1) {
                                     NSRange truncatedRange = [layoutManager
                                         truncatedGlyphRangeInLineFragmentForGlyphAtIndex:lineGlyphRange.location];
                                     if (truncatedRange.location != NSNotFound) {
                                       NSRange characterRange =
                                           [layoutManager characterRangeForGlyphRange:truncatedRange
                                                                     actualGlyphRange:nil];
                                       if (characterRange.location > 0 && characterRange.length > 0) {
                                         // Remove color attributes for truncated range
                                         for (NSAttributedStringKey key in
                                              @[ NSForegroundColorAttributeName, NSBackgroundColorAttributeName ]) {
                                           [textStorage removeAttribute:key range:characterRange];
                                           id attribute = [textStorage attribute:key
                                                                         atIndex:characterRange.location - 1
                                                                  effectiveRange:nil];
                                           if (attribute != nullptr) {
                                             [textStorage addAttribute:key value:attribute range:characterRange];
                                           }
                                         }
                                       }
                                     }
                                   }
                                   line++;
                                 }];
  }
}

- (LinesMeasurements)getLinesForAttributedString:(facebook::react::AttributedString)attributedString
                             paragraphAttributes:(facebook::react::ParagraphAttributes)paragraphAttributes
                                            size:(CGSize)size
{
  NSTextStorage *textStorage = [self
      _textStorageAndLayoutManagerWithAttributesString:[self _nsAttributedStringFromAttributedString:attributedString]
                                   paragraphAttributes:paragraphAttributes
                                                  size:size];
  NSLayoutManager *layoutManager = textStorage.layoutManagers.firstObject;
  NSTextContainer *textContainer = layoutManager.textContainers.firstObject;

  NSRange glyphRange = [layoutManager glyphRangeForTextContainer:textContainer];

  std::vector<LineMeasurement> paragraphLines{};
  auto blockParagraphLines = &paragraphLines;

  [layoutManager
      enumerateLineFragmentsForGlyphRange:glyphRange
                               usingBlock:^(
                                   CGRect overallRect,
                                   CGRect usedRect,
                                   NSTextContainer *_Nonnull usedTextContainer,
                                   NSRange lineGlyphRange,
                                   BOOL *_Nonnull stop) {
                                 NSRange range = [layoutManager characterRangeForGlyphRange:lineGlyphRange
                                                                           actualGlyphRange:nil];
                                 NSString *renderedString = [textStorage.string substringWithRange:range];
                                 UIFont *font =
                                     [[textStorage attributedSubstringFromRange:range] attribute:NSFontAttributeName
                                                                                         atIndex:0
                                                                                  effectiveRange:nil];
                                 auto rect = facebook::react::Rect{
                                     .origin = facebook::react::Point{.x = usedRect.origin.x, .y = usedRect.origin.y},
                                     .size = facebook::react::Size{
                                         .width = usedRect.size.width, .height = usedRect.size.height}};

                                 CGFloat baseline = [layoutManager locationForGlyphAtIndex:range.location].y;
                                 const char *renderedUTF8 = [renderedString UTF8String];
                                 auto line = LineMeasurement{
                                     std::string(renderedUTF8 != nullptr ? renderedUTF8 : ""),
                                     rect,
                                     overallRect.size.height - baseline,
                                     font.capHeight,
                                     baseline,
                                     font.xHeight};
                                 blockParagraphLines->push_back(line);
                               }];
  return paragraphLines;
}

- (NSTextStorage *)_textStorageAndLayoutManagerWithAttributesString:(NSAttributedString *)attributedString
                                                paragraphAttributes:(ParagraphAttributes)paragraphAttributes
                                                               size:(CGSize)size
{
  NSTextContainer *textContainer = [[NSTextContainer alloc] initWithSize:size];

  textContainer.lineFragmentPadding = 0.0; // Note, the default value is 5.
  textContainer.lineBreakMode = paragraphAttributes.maximumNumberOfLines > 0
      ? RCTNSLineBreakModeFromEllipsizeMode(paragraphAttributes.ellipsizeMode)
      : NSLineBreakByClipping;
  textContainer.maximumNumberOfLines = paragraphAttributes.maximumNumberOfLines;

  // The subclass gives CSS background semantics to wrapped ranges — see its
  // -fillBackgroundRectArray: for the whole story.
  NSLayoutManager *layoutManager = [RCTGlyphHuggingLayoutManager new];
  layoutManager.usesFontLeading = NO;
  [layoutManager addTextContainer:textContainer];

  NSTextStorage *textStorage = [[NSTextStorage alloc] initWithAttributedString:attributedString];

  RCTApplyBaselineOffset(textStorage);

  [textStorage addLayoutManager:layoutManager];

  if (paragraphAttributes.adjustsFontSizeToFit) {
    CGFloat minimumFontSize = !isnan(paragraphAttributes.minimumFontSize) ? paragraphAttributes.minimumFontSize : 4.0;
    CGFloat maximumFontSize = !isnan(paragraphAttributes.maximumFontSize) ? paragraphAttributes.maximumFontSize : 96.0;
    [textStorage scaleFontSizeToFitSize:size minimumFontSize:minimumFontSize maximumFontSize:maximumFontSize];
  }

  return textStorage;
}

- (std::shared_ptr<const EventEmitter>)getEventEmitterWithAttributeString:(AttributedString)attributedString
                                                      paragraphAttributes:(ParagraphAttributes)paragraphAttributes
                                                                    frame:(CGRect)frame
                                                                  atPoint:(CGPoint)point
{
  NSTextStorage *textStorage = [self
      _textStorageAndLayoutManagerWithAttributesString:[self _nsAttributedStringFromAttributedString:attributedString]
                                   paragraphAttributes:paragraphAttributes
                                                  size:frame.size];
  NSLayoutManager *layoutManager = textStorage.layoutManagers.firstObject;
  NSTextContainer *textContainer = layoutManager.textContainers.firstObject;

  CGFloat fraction;
  NSUInteger characterIndex = [layoutManager characterIndexForPoint:point
                                                    inTextContainer:textContainer
                           fractionOfDistanceBetweenInsertionPoints:&fraction];

  // If the point is not before (fraction == 0.0) the first character and not
  // after (fraction == 1.0) the last character, then the attribute is valid.
  if (textStorage.length > 0 && (fraction > 0 || characterIndex > 0) &&
      (fraction < 1 || characterIndex < textStorage.length - 1)) {
    NSData *eventEmitterWrapper = (NSData *)[textStorage attribute:RCTAttributedStringEventEmitterKey
                                                           atIndex:characterIndex
                                                    effectiveRange:NULL];
    return RCTUnwrapEventEmitter(eventEmitterWrapper);
  }

  return nil;
}

- (void)getRectWithAttributedString:(AttributedString)attributedString
                paragraphAttributes:(ParagraphAttributes)paragraphAttributes
                 enumerateAttribute:(NSString *)enumerateAttribute
                              frame:(CGRect)frame
                         usingBlock:(RCTTextLayoutFragmentEnumerationBlock)block
{
  NSTextStorage *textStorage = [self
      _textStorageAndLayoutManagerWithAttributesString:[self _nsAttributedStringFromAttributedString:attributedString]
                                   paragraphAttributes:paragraphAttributes
                                                  size:frame.size];

  NSLayoutManager *layoutManager = textStorage.layoutManagers.firstObject;
  NSTextContainer *textContainer = layoutManager.textContainers.firstObject;
  [layoutManager ensureLayoutForTextContainer:textContainer];

  NSRange glyphRange = [layoutManager glyphRangeForTextContainer:textContainer];
  NSRange characterRange = [layoutManager characterRangeForGlyphRange:glyphRange actualGlyphRange:NULL];

  [textStorage enumerateAttribute:enumerateAttribute
                          inRange:characterRange
                          options:0
                       usingBlock:^(NSString *value, NSRange range, BOOL *pause) {
                         if (value == nullptr) {
                           return;
                         }

                         [layoutManager
                             enumerateEnclosingRectsForGlyphRange:range
                                         withinSelectedGlyphRange:range
                                                  inTextContainer:textContainer
                                                       usingBlock:^(CGRect enclosingRect, BOOL *_Nonnull stop) {
                                                         block(
                                                             enclosingRect,
                                                             [textStorage attributedSubstringFromRange:range].string,
                                                             value);
                                                         *stop = YES;
                                                       }];
                       }];
}

#pragma mark - Private

- (NSAttributedString *)_nsAttributedStringFromAttributedString:(AttributedString)attributedString
{
  auto sharedNSAttributedString = _cache.get(attributedString, [&]() {
    return wrapManagedObject(RCTNSAttributedStringFromAttributedString(attributedString));
  });

  return unwrapManagedObject(sharedNSAttributedString);
}

- (TextMeasurement)_measureTextStorage:(NSTextStorage *)textStorage
                   paragraphAttributes:(ParagraphAttributes)paragraphAttributes
                         layoutContext:(TextLayoutContext)layoutContext
{
  NSLayoutManager *layoutManager = textStorage.layoutManagers.firstObject;
  NSTextContainer *textContainer = layoutManager.textContainers.firstObject;
  [layoutManager ensureLayoutForTextContainer:textContainer];

  NSRange glyphRange = [layoutManager glyphRangeForTextContainer:textContainer];
  __block BOOL textDidWrap = NO;
  __block NSUInteger linesEnumerated = 0;
  __block CGFloat enumeratedLinesHeight = 0;
  [layoutManager
      enumerateLineFragmentsForGlyphRange:glyphRange
                               usingBlock:^(
                                   CGRect overallRect,
                                   CGRect usedRect,
                                   NSTextContainer *_Nonnull usedTextContainer,
                                   NSRange lineGlyphRange,
                                   BOOL *_Nonnull stop) {
                                 NSRange range = [layoutManager characterRangeForGlyphRange:lineGlyphRange
                                                                           actualGlyphRange:nil];
                                 NSUInteger lastCharacterIndex = range.location + range.length - 1;
                                 BOOL endsWithNewLine =
                                     [textStorage.string characterAtIndex:lastCharacterIndex] == '\n';
                                 if (!endsWithNewLine && textStorage.string.length > lastCharacterIndex + 1) {
                                   textDidWrap = YES;
                                 }
                                 if (linesEnumerated++ < paragraphAttributes.maximumNumberOfLines) {
                                   enumeratedLinesHeight = usedRect.origin.y + usedRect.size.height;
                                 }
                                 if (textDidWrap &&
                                     (paragraphAttributes.maximumNumberOfLines == 0 ||
                                      linesEnumerated >= paragraphAttributes.maximumNumberOfLines)) {
                                   *stop = YES;
                                 }
                               }];

  CGRect usedBounds = [layoutManager usedRectForTextContainer:textContainer];
  CGSize size = usedBounds.size;

  if (textDidWrap) {
    size.width = textContainer.size.width;
  }

  if (paragraphAttributes.maximumNumberOfLines != 0) {
    // If maximumNumberOfLines is set, we cannot rely on setting it on the NSTextContainer
    // due to an edge case where it returns wrong height:
    // When maximumNumberOfLines is set to N and the N+1 line is empty, the measured height
    // is N+1 lines (incorrect). Adding any characted to the N+1 line, making it non-empty
    // casuses the measured height to be N lines (correct).
    if (linesEnumerated < paragraphAttributes.maximumNumberOfLines) {
      enumeratedLinesHeight += layoutManager.extraLineFragmentUsedRect.size.height;
    }
    size.height = enumeratedLinesHeight;
  }

  size = (CGSize){ceil(size.width * layoutContext.pointScaleFactor) / layoutContext.pointScaleFactor,
                  ceil(size.height * layoutContext.pointScaleFactor) / layoutContext.pointScaleFactor};

  NSRange visibleGlyphRange = [layoutManager glyphRangeForTextContainer:textContainer];

  __block auto attachments = TextMeasurement::Attachments{};

  [textStorage
      enumerateAttribute:NSAttachmentAttributeName
                 inRange:NSMakeRange(0, textStorage.length)
                 options:0
              usingBlock:^(NSTextAttachment *attachment, NSRange range, BOOL *stop) {
                if (attachment == nullptr) {
                  return;
                }

                NSRange attachmentGlyphRange = [layoutManager glyphRangeForCharacterRange:range
                                                                     actualCharacterRange:NULL];
                NSRange truncatedRange =
                    [layoutManager truncatedGlyphRangeInLineFragmentForGlyphAtIndex:attachmentGlyphRange.location];

                // Attachment on a line that did not fit (e.g. on the 4th line when the container is limited to 3 lines)
                BOOL isOutsideVisibleRange = !NSLocationInRange(attachmentGlyphRange.location, visibleGlyphRange);
                // Attachment in the ellipsis range of the last visible line (line truncated with "..." and the
                // attachment falls in that portion)
                BOOL isInTruncatedRange =
                    truncatedRange.location != NSNotFound && attachmentGlyphRange.location >= truncatedRange.location;

                if (isOutsideVisibleRange || isInTruncatedRange) {
                  attachments.push_back(TextMeasurement::Attachment{.isClipped = true});
                } else {
                  // The bounds carry the enclosing inline box's leading and
                  // trailing space so that it occupies advance (see
                  // RCTNSAttributedStringFragmentFromFragment). The BOX is only
                  // the part between them, so both are backed out here — the
                  // reservation is a layout concern, not part of the picture.
                  NSNumber *leadingSpace = [textStorage attribute:RCTAtomicInlineLeadingSpaceAttributeName
                                                          atIndex:range.location
                                                   effectiveRange:NULL];
                  NSNumber *trailingSpace = [textStorage attribute:RCTAtomicInlineTrailingSpaceAttributeName
                                                           atIndex:range.location
                                                    effectiveRange:NULL];
                  CGFloat leading = leadingSpace.doubleValue;
                  // The bounds also carry any extra descent added so the line
                  // keeps the strut's — the BOX is the height without it.
                  NSNumber *extraDescent = [textStorage attribute:RCTAtomicInlineExtraDescentAttributeName
                                                          atIndex:range.location
                                                   effectiveRange:NULL];
                  CGSize attachmentSize = CGSizeMake(
                      attachment.bounds.size.width - leading - trailingSpace.doubleValue,
                      attachment.bounds.size.height - extraDescent.doubleValue);
                  CGRect glyphRect = [layoutManager boundingRectForGlyphRange:range inTextContainer:textContainer];

                  CGRect frame;
                  // The line's baseline, asked of TextKit rather than derived.
                  //
                  // Deriving it as `lineBottom + font.descender` used the
                  // TEXT's descender, but the line's descent is whatever the
                  // tallest thing on it needs — an attachment hanging below the
                  // baseline makes it larger. On the probe line the box hung
                  // 3.72pt below while the font's descender is 2.76, so the
                  // baseline came out 0.96pt low and every attachment on that
                  // line was placed a point off. `locationForGlyphAtIndex:`
                  // returns the glyph's position within its line fragment, and
                  // its y IS the baseline.
                  CGRect lineFragment = [layoutManager lineFragmentRectForGlyphAtIndex:range.location
                                                                        effectiveRange:NULL];
                  // `locationForGlyphAtIndex:` already has the attachment's own
                  // `bounds.origin.y` baked in — that offset is how the glyph
                  // was positioned in the first place — so it has to be backed
                  // out to recover the line's baseline. Leaving it in
                  // double-counted the offset and pushed the box down by
                  // exactly that much again.
                  //
                  // Verified against an independent ground truth (the baseline
                  // read off a TEXT glyph on the same line, where
                  // `locationForGlyphAtIndex:` IS the baseline) across four
                  // probes covering both terms: offsets of 0, -3.7, -8.5 and
                  // -27.7pt, and boxes both taller and shorter than the line.
                  // Exact to six decimals in every case — the demo's probes on
                  // the Lists screen are those cases.
                  CGPoint glyphLocation = [layoutManager locationForGlyphAtIndex:range.location];
                  CGFloat lineBaseline =
                      lineFragment.origin.y + glyphLocation.y + attachment.bounds.origin.y;
                  // The box's OWN baseline goes on the line's (CSS2 §10.8.1).
                  // `bounds.origin.y` is how far the box hangs below the
                  // baseline (negative), so the box's baseline sits
                  // `height + origin.y` down from its top.
                  //
                  // This is the SECOND placement path an attachment goes
                  // through: the bounds offset positions the glyph TextKit
                  // lays out, while this positions the child view that
                  // actually draws the box. Setting the bounds alone moved the
                  // placeholder and left the view behind, which is why an
                  // inline-block's text still sat above the line around it.
                  // Computed from the INFLATED bounds, where the two adjustments cancel:
                  // the height gained exactly what the origin lost, so this is
                  // the same distance from the box's top to its baseline.
                  CGFloat baselineFromTop =
                      attachment.bounds.size.height + attachment.bounds.origin.y;
                  CGFloat boxTop = lineBaseline - baselineFromTop;

                  // `vertical-align` (CSS2 §10.8.1). Applied here rather than
                  // through the attachment's bounds because this is the pass
                  // that positions the child VIEW, and because `top`/`bottom`
                  // are relative to the line box — which only exists once
                  // TextKit has laid the line out, and is exactly what
                  // `lineFragment` is.
                  NSNumber *verticalAlign = [textStorage attribute:RCTAtomicInlineVerticalAlignAttributeName
                                                           atIndex:range.location
                                                    effectiveRange:NULL];
                  switch (verticalAlign.integerValue) {
                    case 1: // top
                      boxTop = lineFragment.origin.y;
                      break;
                    case 2: // bottom
                      boxTop = lineFragment.origin.y + lineFragment.size.height - attachmentSize.height;
                      break;
                    case 3: { // middle
                      // Centred on the baseline raised by half the parent's
                      // x-height — NOT on the middle of the line box, which is
                      // the intuitive reading and the wrong one.
                      UIFont *font = [textStorage attribute:NSFontAttributeName
                                                    atIndex:range.location
                                             effectiveRange:NULL];
                      CGFloat xHeight = font != nil ? font.xHeight : 0;
                      boxTop = lineBaseline - xHeight / 2 - attachmentSize.height / 2;
                      break;
                    }
                    default: // baseline — the box's own baseline on the line's
                      break;
                  }

                  frame = {.origin = {glyphRect.origin.x + leading, boxTop}, .size = attachmentSize};

                  auto rect = facebook::react::Rect{
                      .origin = facebook::react::Point{.x = frame.origin.x, .y = frame.origin.y},
                      .size = facebook::react::Size{.width = frame.size.width, .height = frame.size.height}};

                  attachments.push_back(TextMeasurement::Attachment{.frame = rect, .isClipped = false});
                }
              }];

  return TextMeasurement{.size = {.width = size.width, .height = size.height}, .attachments = attachments};
}

@end
