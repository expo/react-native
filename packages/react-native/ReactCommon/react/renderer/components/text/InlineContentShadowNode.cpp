/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "InlineContentShadowNode.h"

#include <string_view>

#include <react/renderer/dom/NodeNameProvider.h>

#include <react/renderer/mounting/ShadowView.h>

#include <react/renderer/components/text/InlineElementMetrics.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <string>

#include <react/renderer/attributedstring/AttributedStringBox.h>
#include <react/renderer/textlayoutmanager/TextLayoutManagerExtended.h>
#include <react/renderer/attributedstring/ParagraphAttributes.h>
#include <react/renderer/components/text/BaseTextShadowNode.h>
#include <react/renderer/components/view/YogaStylableProps.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/core/LayoutableShadowNode.h>
#include <react/renderer/textlayoutmanager/TextLayoutContext.h>

namespace facebook::react {

// NOLINTNEXTLINE(facebook-hte-CArray, modernize-avoid-c-arrays)
const char InlineContentComponentName[] = "InlineContent";

namespace {

// SWAR (SIMD-within-a-register) helpers for the white-space fast path.
// Plain portable C — no intrinsics — so the identical code runs on physical
// iOS/Android arm64 devices, simulators, and x86 hosts; loads go through
// memcpy (unaligned-safe everywhere). Byte order does not matter for the
// masks below: adjacency and membership are position-symmetric, and the
// first/last byte checks read the string directly.
//
// swarEq marks each byte equal to `c` with 0x80 in that byte's lane
// (classic zero-byte detection over x ^ broadcast(c)).
static inline uint64_t swarEq(uint64_t x, char c) {
  const uint64_t ones = 0x0101010101010101ULL;
  const uint64_t highs = 0x8080808080808080ULL;
  const uint64_t t = x ^ (ones * static_cast<uint8_t>(c));
  return (t - ones) & ~t & highs;
}

// ASCII whitespace subject to CSS `white-space: normal` collapsing
// (css-text-3 §3). Matches the whitespace-only-run predicate in
// AnonymousTextContent.cpp.
//
// ENCODING CONTRACT: every byte-level scan in this pass — this predicate,
// the segment-break check, and the memchr-grade identity probes below — is
// only correct because `Fragment::string` is UTF-8 (Hermes converts JS
// strings via convertUTF16ToUTF8 before they reach the renderer). UTF-8 is
// self-synchronizing: bytes of multi-byte sequences are all >= 0x80, so an
// ASCII byte like 0x20 or 0x0A can never be a fragment of a larger
// character and byte scans cannot produce false positives. This would NOT
// hold for UCS-2/UTF-16 byte strings (U+2020 DAGGER encodes as 20 20 —
// two "spaces" to a byte scan) — never store UTF-16 bytes in a fragment.
// WPTDerived-itest pins multi-byte content through collapse and measure.
bool isCollapsibleWhitespace(char character) {
  return character == ' ' || character == '\t' || character == '\n' ||
      character == '\r' || character == '\f';
}

// A segment break (css-text-3 §4.1): whitespace that ends a line where
// `white-space` preserves newlines, as opposed to a space or tab, which the
// same value may still collapse.
bool isSegmentBreak(char character) {
  return character == '\n' || character == '\r';
}

// Applies CSS `white-space: normal` processing to an anonymous IFC's attributed
// string (css-text-3 §3): collapse each run of collapsible whitespace to a
// single space and trim whitespace at the IFC's leading and trailing edges.
// Collapsing spans fragment boundaries — a space split across two text nodes,
// or around an inline element, collapses to one — mirroring how the web
// collapses across inline boxes. Attachment fragments (e.g. the replaced
// `<img>`) are opaque, non-whitespace anchors. This runs only on anonymous
// IFCs (this class is created solely for text-children runs); explicit `<Text>`
// keeps RN's verbatim whitespace. See text-children-plan.md §3.A/§4.4 and the
// §7 decision (CSS-normal collapsing).
void collapseWhitespace(AttributedString& attributedString) {
  auto& fragments = attributedString.getFragments();

  // Collapse pass. `pendingCollapse` starts true so leading whitespace at the
  // IFC edge is dropped; it stays true while the last emitted character was a
  // (collapsed) space, so consecutive whitespace — even across fragments —
  // yields a single space.
  bool pendingCollapse = true;
  for (auto& fragment : fragments) {
    if (fragment.isAttachment()) {
      // A replaced element is an opaque, non-whitespace box.
      pendingCollapse = false;
      continue;
    }
    auto whiteSpace =
        fragment.textAttributes.whiteSpace.value_or(WhiteSpace::Normal);
    if (preservesSpaces(whiteSpace) && preservesNewlines(whiteSpace)) {
      // `pre`, `pre-wrap`, `break-spaces` (css-text-3 §3): runs of spaces and
      // newlines are preserved verbatim, in what is rendered AND in what a copy
      // puts on the clipboard. Nothing here touches them, and `pendingCollapse`
      // is cleared so a following normal-whitespace run does not treat the
      // preserved text as if it had ended in a collapsed space.
      pendingCollapse = false;
      continue;
    }
    if (fragment.forcedBreak) {
      // A forced break from `<br>`. Its newline is content, not collapsible
      // whitespace, so it survives untouched — but whitespace FOLLOWING it
      // sits at the start of a new line and is dropped, which is what leaving
      // `pendingCollapse` set does.
      pendingCollapse = true;
      continue;
    }
    const bool keepNewlines = preservesNewlines(whiteSpace);
    const auto& source = fragment.string;
    const size_t size = source.size();

    // Copy-on-write state machine, hand-inlined: `matched` counts characters
    // emitted while byte-identical to the source prefix; a fresh string is
    // materialized only at the first divergence, and pure prefix truncations
    // (dropped trailing white space) resize in place. Tidy content — the
    // overwhelmingly common case — runs the loop allocation-free.
    //
    // Deliberately a plain per-byte loop: an earlier version pre-scanned
    // with std::string::find probes to skip the loop entirely, but probes
    // anchored on frequent bytes (a space occurs every ~6 characters in
    // prose) degrade into thousands of short memchr calls and measured 3×
    // slower than this loop on article-sized content.
    std::string collapsed;
    size_t matched = 0;
    bool materialized = false;
    size_t index = 0;
    while (index < size) {
      // SWAR fast path (lazy mode): classify 8 bytes at once. A block is
      // benign — provably emitted verbatim — when it contains no
      // always-transformed bytes (tab/CR/FF; and under newline-collapsing
      // modes, any newline), and no two ADJACENT white-space bytes (an
      // isolated space, or an isolated newline under `pre-line`, passes
      // through unchanged). Cross-block adjacency and leading-edge trims are
      // covered by the `pendingCollapse` guard: a block whose first byte is
      // white space while a collapse is pending needs the slow path.
      // ~10x fewer iterations than the per-byte machine on tidy prose, which
      // is exactly the shape (a space every ~6 bytes) where byte-anchored
      // find() probes measured slower than the machine itself.
      // The block advance asserts the pure-prefix state: `matched == index`
      // means everything so far was emitted verbatim, so claiming the next 8
      // bytes wholesale is sound. After a lazily-dropped byte (a collapsed
      // space) matched trails index until the next emit materializes — the
      // fast path must stand down there or it splices the wrong prefix (a
      // corruption the multi-byte encoding test caught immediately).
      if (!materialized && matched == index && size - index >= 8) {
        uint64_t word;
        std::memcpy(&word, source.data() + index, 8);
        const uint64_t spaces = swarEq(word, ' ');
        const uint64_t newlines = swarEq(word, '\n');
        const uint64_t always = swarEq(word, '\t') | swarEq(word, '\r') |
            swarEq(word, '\f');
        const uint64_t whitespace =
            keepNewlines ? (spaces | newlines) : spaces;
        const uint64_t adjacent = whitespace & (whitespace >> 8);
        const bool benign = always == 0 &&
            (keepNewlines || newlines == 0) && adjacent == 0 &&
            !(pendingCollapse && isCollapsibleWhitespace(source[index]));
        if (benign) {
          matched += 8;
          index += 8;
          const char last = source[index - 1];
          pendingCollapse =
              last == ' ' || (keepNewlines && last == '\n');
          continue;
        }
      }
      const char character = source[index];
      index++;
      // `pre-line` is the one value that splits the two axes: a segment break
      // is content that ends the line, while spaces and tabs around it still
      // collapse. The space before the break is dropped (it would sit at the
      // end of a line) and `pendingCollapse` stays set afterwards so the ones
      // after it are dropped too (they would lead the next line).
      if (keepNewlines && isSegmentBreak(character)) {
        const bool emittedEmpty = materialized ? collapsed.empty() : matched == 0;
        if (!emittedEmpty) {
          const char emittedBack =
              materialized ? collapsed.back() : source[matched - 1];
          if (emittedBack == ' ') {
            if (materialized) {
              collapsed.pop_back();
            } else {
              matched--;
            }
          }
        }
        // emit('\n')
        if (!materialized) {
          if (matched < size && source[matched] == '\n') {
            matched++;
          } else {
            collapsed.reserve(size);
            collapsed.assign(source, 0, matched);
            collapsed.push_back('\n');
            materialized = true;
          }
        } else {
          collapsed.push_back('\n');
        }
        pendingCollapse = true;
        continue;
      }
      if (isCollapsibleWhitespace(character)) {
        if (!pendingCollapse) {
          // emit(' ')
          if (!materialized) {
            if (matched < size && source[matched] == ' ') {
              matched++;
            } else {
              collapsed.reserve(size);
              collapsed.assign(source, 0, matched);
              collapsed.push_back(' ');
              materialized = true;
            }
          } else {
            collapsed.push_back(' ');
          }
          pendingCollapse = true;
        }
      } else {
        // emit(character)
        if (!materialized) {
          if (matched < size && source[matched] == character) {
            matched++;
          } else {
            collapsed.reserve(size);
            collapsed.assign(source, 0, matched);
            collapsed.push_back(character);
            materialized = true;
          }
        } else {
          collapsed.push_back(character);
        }
        pendingCollapse = false;
      }
    }
    if (materialized) {
      fragment.string = std::move(collapsed);
    } else if (matched != size) {
      // Everything emitted matched the source prefix; only trailing
      // characters were dropped. Truncate in place — no allocation.
      fragment.string.resize(matched);
    }
  }

  // Trailing edge: at most one collapsed space can remain at the end; strip it
  // from the last text-bearing fragment (a trailing replaced element is not
  // whitespace, so stop there). Only COLLAPSIBLE white space is subject to
  // the trim (css-text-3 §4.1.3): under `pre`/`pre-wrap`/`break-spaces` a
  // trailing space is preserved content — WPT break-spaces-001 pins that it
  // still takes up space at the end of the line.
  for (auto it = fragments.rbegin(); it != fragments.rend(); ++it) {
    if (it->isAttachment()) {
      break;
    }
    if (it->string.empty()) {
      continue;
    }
    const auto lastWhiteSpace =
        it->textAttributes.whiteSpace.value_or(WhiteSpace::Normal);
    if (!preservesSpaces(lastWhiteSpace) && it->string.back() == ' ') {
      it->string.pop_back();
    }
    break;
  }

  // Drop fragments emptied by collapsing so the run stays canonical and
  // `isEmpty()` reports true for a run that reduced to nothing. An element
  // that was empty to begin with is not one of those: its fragment carries no
  // text on purpose, and it is the only record that the element has a box.
  std::erase_if(fragments, [](const AttributedString::Fragment& fragment) {
    return !fragment.isAttachment() && !fragment.isEmptyElement &&
        fragment.string.empty();
  });
}

// Reserves each inline replaced element's (`<img>`) intrinsic box in the run by
// measuring the attachment shadow node and stamping its size onto the attachment
// fragment, so the run measures with the image's box included
// (text-children-plan.md §3.C). Mirrors
// `ParagraphShadowNode::getContentWithMeasuredAttachments`. Runs before
// whitespace collapsing so the attachment fragment indices are still valid.
void measureImageAttachments(
    AttributedString& attributedString,
    const BaseTextShadowNode::Attachments& attachments,
    const LayoutContext& layoutContext,
    const LayoutConstraints& layoutConstraints) {
  auto& fragments = attributedString.getFragments();
  auto constraints = layoutConstraints;
  constraints.minimumSize = Size{0, 0};
  for (const auto& attachment : attachments) {
    const auto* layoutable =
        dynamic_cast<const LayoutableShadowNode*>(attachment.shadowNode);
    if (layoutable == nullptr || attachment.fragmentIndex >= fragments.size()) {
      continue;
    }
    auto size = layoutable->measure(layoutContext, constraints);
    // Where this box's baseline sits, so the text engine can put that baseline
    // on the line's rather than dropping the box's bottom onto it.
    fragments[attachment.fragmentIndex].atomicInlineBaseline =
        layoutable->baseline(layoutContext, size);

    // Where the box asked to sit on the line. Read here, with the box's props
    // in hand, and carried on the fragment because the engine that places it
    // sees only fragments.
    if (const auto* yogaStylable = dynamic_cast<const YogaStylableProps*>(
            attachment.shadowNode->getProps().get())) {
      fragments[attachment.fragmentIndex].atomicInlineVerticalAlign =
          static_cast<uint8_t>(yogaStylable->verticalAlign);
    }

    // An atomic inline box's inline-axis margins add to the advance it
    // occupies on the line (CSS2 §10.8): the reserved box is the MARGIN box,
    // not the border box `measure()` returns. Block-axis margins deliberately
    // do not grow the line box — on the web they have no effect on line
    // height for an inline-level box.
    const auto& attachmentProps =
        *attachment.shadowNode->getProps();
    if (const auto* yogaProps =
            dynamic_cast<const YogaStylableProps*>(&attachmentProps)) {
      const auto& style = yogaProps->yogaStyle;
      const auto inlineMargins =
          style.computeMarginForAxis(yoga::FlexDirection::Row, 0.0f);
      if (!std::isnan(inlineMargins)) {
        size.width += inlineMargins;
      }
    }

    fragments[attachment.fragmentIndex].parentShadowView.layoutMetrics.frame.size =
        size;
  }
}

} // namespace

void InlineContentShadowNode::appendListMarkerIfNeeded(
    AttributedString& attributedString,
    const TextAttributes& textAttributes) const {
  // The marker leads the content, so it is MEASURED with it and the first line
  // starts after it. Every builder in this file has to run it — measurement
  // builds its own attributed string separately from painting, and a marker in
  // only one of them would overlap the text instead of displacing it.
  //
  // We have neither `::marker` nor generated content, so it is an ordinary
  // fragment of this box's inline flow and inherits the element's font and
  // colour the way a real marker does.
  //
  if (listMarker_.text.empty() || listMarker_.outside) {
    return;
  }
  auto marker = AttributedString::Fragment{};
  // The gap after the marker is a no-break space, so it survives the
  // white-space collapsing a plain space would not.
  marker.string = listMarker_.text + reinterpret_cast<const char*>(u8"\u00A0");
  marker.textAttributes = textAttributes;
  // No `parentShadowView`: the marker is not any element's content, so it is
  // treated as bare text and never stamped with an element box.
  attributedString.appendFragment(std::move(marker));
}

void InlineContentShadowNode::setListMarker(ListMarker listMarker) {
  // The marker is folded into the built content; invalidate the memo.
  cachedContent_ = nullptr;
  ensureUnsealed();
  listMarker_ = std::move(listMarker);
}

void InlineContentShadowNode::setTextLayoutManager(
    std::shared_ptr<const TextLayoutManager> textLayoutManager) {
  ensureUnsealed();
  textLayoutManager_ = std::move(textLayoutManager);
}

InlineContentShadowNode::OutsideMarker
InlineContentShadowNode::getOutsideMarker() const {
  // Only `outside` markers are painted separately; an `inside` one is already
  // part of the measured content.
  if (listMarker_.text.empty() || !listMarker_.outside ||
      textLayoutManager_ == nullptr) {
    return {};
  }

  auto markerString = AttributedString{};
  auto fragment = AttributedString::Fragment{};
  // The trailing no-break space is the gap between the marker and the content.
  // Measuring it as part of the marker is what sets the marker's start
  // position once the caller right-aligns the whole thing to the content edge.
  fragment.string =
      listMarker_.text + reinterpret_cast<const char*>(u8"\u00A0");
  fragment.textAttributes = cascadeWithResolvedDirection();
  // A fragment reaching the paint path needs a real `parentShadowView`: the
  // text-effect machinery walks it, and a default-constructed one segfaults.
  fragment.parentShadowView = ShadowView{*this};
  markerString.appendFragment(std::move(fragment));

  const auto measurement = textLayoutManager_->measure(
      AttributedStringBox{markerString},
      ParagraphAttributes{},
      TextLayoutContext{
          .pointScaleFactor = getLayoutMetrics().pointScaleFactor,
          .surfaceId = getSurfaceId()},
      LayoutConstraints{});

  return OutsideMarker{
      .attributedString = markerString,
      .size = measurement.size,
      .present = true};
}

Float InlineContentShadowNode::baseline(
    const LayoutContext& /*layoutContext*/,
    Size size) const {
  if (textLayoutManager_ == nullptr) {
    return 0;
  }
  auto attributedString = AttributedString{};
  auto attachments = BaseTextShadowNode::Attachments{};
  const auto cascade = cascadeWithResolvedDirection();
  appendListMarkerIfNeeded(attributedString, cascade);
  BaseTextShadowNode::buildAttributedString(
      cascade, *this, attributedString, attachments);
  if (attributedString.isEmpty()) {
    return 0;
  }

  if constexpr (TextLayoutManagerExtended::supportsLineMeasurement()) {
    auto lines = TextLayoutManagerExtended(*textLayoutManager_)
                     .measureLines(
                         AttributedStringBox{attributedString},
                         ParagraphAttributes{},
                         size);
    if (lines.empty()) {
      return 0;
    }
    // Derived from the line's BOTTOM rather than its ascender: the ascender is
    // a font metric and overshoots the real distance from the content's top to
    // the baseline whenever the line box is not exactly ascent+descent tall,
    // which put an inline-block's text a couple of points above the text
    // around it on iOS. The bottom minus the descender is where the glyphs
    // actually sit.
    const auto& line = lines[0];
    return line.frame.origin.y + line.frame.size.height -
        std::abs(line.descender);
  }
  return 0;
}


AttributedString InlineContentShadowNode::getContentAttributedString(
    Float fontSizeMultiplier) const {
  auto textAttributes = cascadeWithResolvedDirection();
  // Mirror `measureContent`: the published string must be the SAME value
  // measurement produced — multiplier included — or the platform layout
  // caches keyed by content can never hit, and a fallback rebuild under
  // accessibility font scaling would drop the multiplier the measurement
  // applied.
  textAttributes.fontSizeMultiplier = fontSizeMultiplier;
  if (cachedContent_ != nullptr && !cachedContent_->hasAttachments &&
      cachedContentMatches(textAttributes)) {
    return cachedContent_->attributedString;
  }
  auto attributedString = AttributedString{};
  auto attachments = BaseTextShadowNode::Attachments{};

  appendListMarkerIfNeeded(attributedString, textAttributes);
  BaseTextShadowNode::buildAttributedString(
      textAttributes, *this, attributedString, attachments);
  // Reserve each inline `<img>` box so the painted run offsets the surrounding
  // glyphs past the image, matching the measured layout. The image nodes are
  // never Yoga-laid-out in place (their owning View lays out clones), so their
  // own layout metrics are zero here — we re-measure instead, exactly as
  // `measureContent` does, using the box's own pixel scale.
  auto layoutContext = LayoutContext{};
  layoutContext.pointScaleFactor = getLayoutMetrics().pointScaleFactor;
  measureImageAttachments(
      attributedString,
      attachments,
      layoutContext,
      LayoutConstraints{
          .minimumSize = {0, 0},
          .maximumSize = {
              std::numeric_limits<Float>::infinity(),
              std::numeric_limits<Float>::infinity()}});
  collapseWhitespace(attributedString);
  attributedString.setBaseTextAttributes(textAttributes);
  if (!getSealed()) {
    cachedContent_ = std::make_shared<const CachedContent>(CachedContent{
        .fontSizeMultiplier = textAttributes.fontSizeMultiplier,
        .layoutDirection = textAttributes.layoutDirection,
        .hasAttachments = !attachments.empty(),
        .attributedString =
            attachments.empty() ? attributedString : AttributedString{}});
  }
  return attributedString;
}

std::vector<InlineAttachmentPlacement>
InlineContentShadowNode::getInlineAttachmentPlacements(
    const LayoutContext& layoutContext) const {
  std::vector<InlineAttachmentPlacement> placements;
  if (textLayoutManager_ == nullptr) {
    return placements;
  }

  // Attachment presence is structural (it does not depend on the multiplier
  // or constraints): a prior build having found none means there is nothing
  // to place, and the whole content build below is skipped.
  if (cachedContent_ != nullptr && !cachedContent_->hasAttachments) {
    return placements;
  }

  auto textAttributes = cascadeWithResolvedDirection();
  textAttributes.fontSizeMultiplier = layoutContext.fontSizeMultiplier;

  auto attributedString = AttributedString{};
  auto attachments = BaseTextShadowNode::Attachments{};
  appendListMarkerIfNeeded(attributedString, textAttributes);
  BaseTextShadowNode::buildAttributedString(
      textAttributes, *this, attributedString, attachments);
  if (attachments.empty()) {
    return placements;
  }

  // Reserve each image's box so the run lays out with the attachments included,
  // exactly as `measureContent` does. The images are not laid out yet at this
  // point (the owning View positions them right after), so we measure them here
  // rather than reading their (still-zero) layout metrics.
  measureImageAttachments(
      attributedString,
      attachments,
      layoutContext,
      LayoutConstraints{
          .minimumSize = {0, 0},
          .maximumSize = {
              std::numeric_limits<Float>::infinity(),
              std::numeric_limits<Float>::infinity()}});
  collapseWhitespace(attributedString);
  attributedString.setBaseTextAttributes(textAttributes);
  if (attributedString.isEmpty()) {
    return placements;
  }

  // Lay the run out at the box's final size so the attachment frames reflect
  // wrapping and alignment as actually mounted.
  auto boxSize = getLayoutMetrics().frame.size;
  TextLayoutContext textLayoutContext{
      .pointScaleFactor = layoutContext.pointScaleFactor,
      .surfaceId = getSurfaceId(),
  };
  auto measurement = textLayoutManager_->measure(
      AttributedStringBox{attributedString},
      ParagraphAttributes{},
      textLayoutContext,
      LayoutConstraints{.minimumSize = boxSize, .maximumSize = boxSize});

  // `measurement.attachments` is parallel to the attachment fragments in the
  // measured string, which preserves the order of `attachments`.
  auto count = std::min(attachments.size(), measurement.attachments.size());
  placements.reserve(count);
  for (size_t i = 0; i < count; ++i) {
    placements.push_back(
        {&attachments[i].shadowNode->getFamily(),
         measurement.attachments[i].frame});
  }
  return placements;
}

std::vector<PendingInlineElementMetrics>
InlineContentShadowNode::stampInlineElementMetrics(
    const LayoutContext& layoutContext,
    Point contentOrigin,
    const LayoutMetrics& ownerLayoutMetrics) const {
  if (textLayoutManager_ == nullptr) {
    return {};
  }

  auto textAttributes = cascadeWithResolvedDirection();
  textAttributes.fontSizeMultiplier = layoutContext.fontSizeMultiplier;

  auto attributedString = AttributedString{};
  auto attachments = BaseTextShadowNode::Attachments{};
  appendListMarkerIfNeeded(attributedString, textAttributes);
  BaseTextShadowNode::buildAttributedString(
      textAttributes, *this, attributedString, attachments);
  if (attributedString.isEmpty()) {
    return {};
  }

  // The rects have to come from the SAME string the run measured and painted,
  // or the elements are located in a layout nobody sees. Two steps make the
  // difference, and both were missing here:
  //
  //  - `measureImageAttachments` is what gives an atomic inline (an `<img>`,
  //    an `inline-block`, an `inline-flex`) its size. Without it the
  //    attachment character is still in the string but occupies no advance, so
  //    every element AFTER one reported a box shifted left by that box's
  //    width — and by the sum of them where there were several. The boxes
  //    themselves were right, which is what made it look like a text bug.
  //  - `collapseWhitespace` changes the string, and therefore every character
  //    offset the rects are queried at.
  const auto boxSize = getLayoutMetrics().frame.size;
  auto attachmentLayoutContext = layoutContext;
  measureImageAttachments(
      attributedString,
      attachments,
      attachmentLayoutContext,
      LayoutConstraints{.minimumSize = {0, 0}, .maximumSize = boxSize});
  collapseWhitespace(attributedString);
  attributedString.setBaseTextAttributes(textAttributes);

  // Nothing to stamp means nothing to measure FOR. The rects below cost a
  // full text layout of the run, and their only consumer is the per-element
  // box built from them — so when the run carries no inline element, that
  // layout is computed and discarded in its entirety. Deciding this from the
  // string, before measuring, is the difference between paying per RUN and
  // paying per run that actually has an element in it.
  if (!facebook::react::hasStampableInlineElements(*this, attributedString)) {
    return {};
  }

  // Lay the run out at the size it was actually given, so the rects reflect
  // the wrapping the user sees. (`boxSize` is read above, for the attachments.)
  TextLayoutContext textLayoutContext{
      .pointScaleFactor = layoutContext.pointScaleFactor,
      .surfaceId = getSurfaceId(),
      .needsFragmentRects = true,
  };
  const auto measurement = textLayoutManager_->measure(
      AttributedStringBox{attributedString},
      ParagraphAttributes{},
      textLayoutContext,
      LayoutConstraints{.minimumSize = boxSize, .maximumSize = boxSize});

  return facebook::react::stampInlineElementMetrics(
      *this,
      attributedString,
      measurement.fragmentRects,
      contentOrigin,
      ownerLayoutMetrics);
}

/*
 * The constraints text is laid out under, given its `white-space`.
 *
 * `pre` and `nowrap` do not wrap (css-text-3 §3), so the line breaker must be
 * given unbounded width — otherwise a long line silently folds and the
 * preserved whitespace is the only half of `pre` that works. The resulting box
 * is wider than its container, which is exactly what the web does: a `<pre>`
 * overflows rather than reflows.
 */
static LayoutConstraints constraintsForWhiteSpace(
    const TextAttributes& textAttributes,
    const LayoutConstraints& layoutConstraints) {
  if (wrapsText(textAttributes.whiteSpace.value_or(WhiteSpace::Normal))) {
    return layoutConstraints;
  }
  auto unwrapped = layoutConstraints;
  unwrapped.maximumSize.width = std::numeric_limits<Float>::infinity();
  return unwrapped;
}

Size InlineContentShadowNode::measureContent(
    const LayoutContext& layoutContext,
    const LayoutConstraints& layoutConstraints) const {
  auto textAttributes = cascadeWithResolvedDirection();
  textAttributes.fontSizeMultiplier = layoutContext.fontSizeMultiplier;

  auto attributedString = AttributedString{};
  if (cachedContent_ != nullptr && !cachedContent_->hasAttachments &&
      cachedContentMatches(textAttributes)) {
    attributedString = cachedContent_->attributedString;
  } else {
    auto attachments = BaseTextShadowNode::Attachments{};
    appendListMarkerIfNeeded(attributedString, textAttributes);
    BaseTextShadowNode::buildAttributedString(
        textAttributes, *this, attributedString, attachments);
    measureImageAttachments(
        attributedString, attachments, layoutContext, layoutConstraints);
    collapseWhitespace(attributedString);
    attributedString.setBaseTextAttributes(textAttributes);
    if (!getSealed()) {
      cachedContent_ = std::make_shared<const CachedContent>(CachedContent{
          .fontSizeMultiplier = textAttributes.fontSizeMultiplier,
          .layoutDirection = textAttributes.layoutDirection,
          .hasAttachments = !attachments.empty(),
          .attributedString =
              attachments.empty() ? attributedString : AttributedString{}});
    }
  }

  if (attributedString.isEmpty()) {
    return layoutConstraints.clamp({0, 0});
  }

  TextLayoutContext textLayoutContext{
      .pointScaleFactor = layoutContext.pointScaleFactor,
      .surfaceId = getSurfaceId(),
      // Lets the platform park the layout it builds to measure this run for
      // reuse at mount (run-layout-reuse-plan.md). Only this site tags: the
      // stamp/attachment measures above lay out variant strings that the
      // mount-side content check would reject anyway.
      .runTag = getTag(),
  };

  return textLayoutManager_
      ->measure(
          AttributedStringBox{attributedString},
          ParagraphAttributes{},
          textLayoutContext,
          constraintsForWhiteSpace(textAttributes, layoutConstraints))
      .size;
}

} // namespace facebook::react
