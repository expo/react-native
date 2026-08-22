/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "TextLayoutManager.h"

#include <algorithm>
#include <cmath>

#include <react/debug/react_native_assert.h>
#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/renderer/attributedstring/TextAttributes.h>

namespace facebook::react {

namespace {

// Deterministic monospace metrics for headless (e.g. Fantom) testing of
// intrinsic text sizing: every character is 10pt wide, every line is 20pt
// tall, and text wraps naively at the width constraint. Only active behind
// `enableStringChildren` — the historical behavior of this stub is to
// return `minimumSize`, which several test suites rely on.
constexpr Float kDeterministicCharacterWidth = 10;

// How far text descends below its baseline, as a fraction of the line height.
// Deterministic like everything else here, and non-zero so that "aligned to
// the baseline" and "aligned to the bottom edge" are distinguishable — with a
// zero descent every baseline rule looks identical and nothing can be tested.
constexpr Float kDeterministicDescentRatio = 0.2;

// A stand-in x-height, as a fraction of the FONT SIZE — x-height is a font
// metric, and deriving it from the line height instead makes `middle` drift
// whenever `line-height` changes, which is not how CSS behaves. `vertical-align:
// middle` is defined against the parent's x-height (CSS2 §10.8.1), which a
// deterministic measurer has no font to ask — so it is declared, like the
// descent above. It makes `middle` land between `top` and `bottom` and move
// with the font size, which is what a headless test can meaningfully assert;
// the exact offset is a fact about a real font and is checked on a device.
constexpr Float kDeterministicXHeightRatio = 0.5;

Float deterministicLineHeight(const AttributedStringBox& attributedStringBox) {
  // Line height is layout-observable so text-attribute inheritance can be
  // asserted headlessly. Contract: an explicit `lineHeight` wins verbatim;
  // otherwise it tracks font size as `fontSize + 6` (default 14 -> 20, matching
  // the earlier fixed metrics).
  const auto& fragments = attributedStringBox.getValue().getFragments();
  if (!fragments.empty() &&
      !std::isnan(fragments[0].textAttributes.lineHeight)) {
    return fragments[0].textAttributes.lineHeight;
  }
  auto fontSize = TextAttributes::initialFontSize();
  if (!fragments.empty() && !std::isnan(fragments[0].textAttributes.fontSize)) {
    fontSize = fragments[0].textAttributes.fontSize;
  }
  return fontSize + 6;
}

// Per-character advance, layout-observable so inheritance of weight/style/
// letterSpacing can be asserted headlessly. Contract: base 10pt, +2pt when
// bold, +1pt when italic, plus `letterSpacing` verbatim.
/*
 * How many cells of the deterministic grid an atomic inline occupies.
 *
 * This measurer models a monospace grid of `kDeterministicCharacterWidth` cells
 * and wraps by counting cells, which is what makes it reproducible. An
 * attachment used to count as ONE cell no matter how wide it was, so a row of
 * 100pt boxes in a 300pt container never wrapped — the grid said three cells of
 * thirty. Real engines break between adjacent atomic inlines (there is a break
 * opportunity there even with no whitespace, which is why `<span/><span/>` wraps
 * in a browser), so the count has to follow the box's width.
 *
 * Rounded up: a box that does not fill its last cell still occupies it, which
 * keeps the grid the conservative approximation of a width-based break rather
 * than one that occasionally over-fills a line.
 */
Float attachmentColumns(const AttributedString::Fragment& fragment) {
  const auto width = fragment.parentShadowView.layoutMetrics.frame.size.width;
  return std::max<Float>(1, std::ceil(width / kDeterministicCharacterWidth));
}

Float perCharacterAdvance(const AttributedString::Fragment& fragment) {
  const auto& ta = fragment.textAttributes;
  Float perCharacter = kDeterministicCharacterWidth;
  if (ta.fontWeight.has_value() && *ta.fontWeight == FontWeight::Bold) {
    perCharacter += 2;
  }
  if (ta.fontStyle.has_value() && *ta.fontStyle == FontStyle::Italic) {
    perCharacter += 1;
  }
  if (!std::isnan(ta.letterSpacing)) {
    perCharacter += ta.letterSpacing;
  }
  return perCharacter;
}

/**
 * A line box: where its baseline sits, and how far anything on it descends
 * below that baseline.
 *
 * CSS builds a line box from the ascents and descents of what is on it — the
 * baseline sits at the greatest ascent, and the line runs from there down to
 * the greatest descent. That is not the same as "the tallest item's height",
 * which is what this measurer used to return: a 40pt box baseline-aligned on a
 * 20pt text line makes a 44pt line, because the box's bottom sits on the
 * baseline and the text's descender still hangs below it.
 */
struct DeterministicLineBox {
  Float ascent{0};
  Float descent{0};

  Float height() const
  {
    return ascent + descent;
  }
};


/**
 * How one atomic inline grows the line box it is on.
 *
 * Extracted so the whole-run box and the per-line boxes cannot drift: they used
 * to be one computation, and a second copy of these rules is exactly how a
 * `vertical-align` case ends up correct in one and wrong in the other.
 */
void growLineBoxForAttachment(
    DeterministicLineBox& box,
    const AttributedString::Fragment& fragment,
    Float height,
    const DeterministicLineBox& strut) {
  if (fragment.atomicInlineVerticalAlign == 3) {
    // `middle` is positioned relative to the BASELINE (half the parent's
    // x-height above it), so its contribution is exact: half the box above that
    // point and half below.
    const auto xHeight = (strut.ascent + strut.descent) * kDeterministicXHeightRatio;
    box.ascent = std::max(box.ascent, xHeight / 2 + height / 2);
    box.descent = std::max(box.descent, height / 2 - xHeight / 2);
    return;
  }
  if (fragment.atomicInlineVerticalAlign != 0) {
    // `top`/`bottom` align to the line box's own edges, so they cannot
    // contribute an ascent or a descent — where they sit depends on the line's
    // height, which is what is being computed. They still have to FIT, so the
    // line grows downward without moving the baseline.
    if (height > box.height()) {
      box.descent += height - box.height();
    }
    return;
  }
  const auto baseline = fragment.atomicInlineBaseline;
  box.ascent = std::max(box.ascent, baseline);
  box.descent = std::max(box.descent, height - baseline);
}

DeterministicLineBox deterministicLineBox(const AttributedStringBox &attributedStringBox)
{
  const auto textHeight = deterministicLineHeight(attributedStringBox);
  const auto textDescent = textHeight * kDeterministicDescentRatio;

  auto box = DeterministicLineBox{};

  // The strut first: a zero-width inline box with the block container's font
  // and `line-height`, present on every line whether or not text sits on it
  // (CSS2 §10.8). It is baseline-aligned like any other inline box, and being
  // usually the only thing that is on a line of boxes, it is what fixes where
  // the baseline sits — which is what `vertical-align: middle` is measured
  // against.
  box.ascent = textHeight - textDescent;
  box.descent = textDescent;
  const auto strut = box;

  for (const auto &fragment : attributedStringBox.getValue().getFragments()) {
    if (fragment.isAttachment()) {
      growLineBoxForAttachment(
          box,
          fragment,
          fragment.parentShadowView.layoutMetrics.frame.size.height,
          strut);
    }
  }

  if (box.height() == 0) {
    box.ascent = textHeight - textDescent;
    box.descent = textDescent;
  }

  return box;
}

// Lays the fragments out on the same deterministic grid `measureDeterministically`
// uses (naive wrap at `charactersPerLine`) and returns one rect per fragment,
// relative to the text frame. A fragment split across lines reports the union
// of its pieces — the same thing `getBoundingClientRect()` reports for an
// inline element that wraps.
std::vector<Rect> measureFragmentRectsDeterministically(
    const AttributedStringBox& attributedStringBox,
    const LayoutConstraints& layoutConstraints,
    Float lineHeight,
    // Where each line starts and how tall it is, when the run's lines differ.
    // Null on the first pass, which only needs line INDICES — that is what
    // determines the tops in the first place.
    const std::vector<Float>* lineTops = nullptr,
    const std::vector<Float>* lineHeights = nullptr) {
  const auto& fragments = attributedStringBox.getValue().getFragments();
  std::vector<Rect> rects;
  rects.reserve(fragments.size());

  const auto maximumWidth = layoutConstraints.maximumSize.width;
  // Wrapping is character-based on the fixed grid, matching the size pass.
  const auto charactersPerLine = std::isfinite(maximumWidth)
      ? std::max<Float>(
            1, std::floor(maximumWidth / kDeterministicCharacterWidth))
      : std::numeric_limits<Float>::infinity();

  Float column = 0; // characters consumed on the current line
  Float line = 0;
  Float penX = 0; // pen position within the current line, in points

  for (const auto& fragment : fragments) {
    const auto characters = fragment.isAttachment()
        ? static_cast<size_t>(1)
        : fragment.string.size();
    const auto advance = fragment.isAttachment()
        ? fragment.parentShadowView.layoutMetrics.frame.size.width
        : perCharacterAdvance(fragment);

    if (characters == 0) {
      rects.push_back(Rect{
          .origin = {penX, line * lineHeight}, .size = {0, lineHeight}});
      continue;
    }

    // The leading edge is part of the element's box, so the pen advances
    // before the glyphs and the rect starts at the box edge, not the text.
    Float startLine = line;
    Float minX = penX;
    penX += fragment.leadingInlineSpace();
    Float maxX = penX;

    // Span-based walk: the per-character loop this replaces measured hot on
    // large single-block content (an `isAttachment()` virtual-ish call and a
    // branch per character, tens of thousands of times per measure). The
    // arithmetic is identical: characters advance the pen one grid cell at a
    // time; only newlines and the wrap boundary reset it — so whole spans
    // between newlines can be consumed with closed-form wrap math, and
    // newlines are found with memchr instead of a byte-wise branch.
    const bool fragmentIsAttachment = fragment.isAttachment();
    if (fragmentIsAttachment) {
      const auto columns = attachmentColumns(fragment);
      // A box moves to the next line when it does not fit in what remains of
      // this one — not merely when the line is already full. `column > 0`
      // keeps a box wider than the whole container on the line it starts,
      // rather than looping onto an empty line it also cannot fit.
      if (column > 0 && column + columns > charactersPerLine) {
        column = 0;
        line += 1;
        penX = 0;
        minX = 0;
        // The rect's origin is taken from `startLine`, which was captured
        // before this wrap could be known. A text fragment spanning several
        // lines genuinely starts on the earlier one — its rect is the union —
        // but an attachment that wraps starts wholly on the NEW line, and
        // leaving the stale value put the box at the previous line's y while
        // its x had already reset to 0: exactly on top of whatever began that
        // line.
        startLine = line;
      }
      penX += advance;
      column += columns;
      maxX = std::max(maxX, penX);
    } else {
      const auto& string = fragment.string;
      size_t i = 0;
      while (i < characters) {
        if (string[i] == '\n') {
          // A mandatory break — from `<br>`, which survives whitespace
          // collapsing. Every real engine breaks here, so the deterministic
          // measurer must too or `<br>` is invisible to a headless test.
          column = 0;
          line += 1;
          penX = 0;
          minX = 0;
          i += 1;
          continue;
        }
        const auto breakAt = string.find('\n', i);
        auto span =
            (breakAt == std::string::npos ? characters : breakAt) - i;
        i += span;
        while (span > 0) {
          if (column >= charactersPerLine) {
            // Wrapping is character-based on the same grid the size pass
            // uses; the fragment now starts at the line's leading edge.
            column = 0;
            line += 1;
            penX = 0;
            minX = 0;
          }
          // Advances are per-character (bold/italic/letterSpacing widen
          // them), so the pen accumulates them rather than sitting on the
          // wrap grid — that is what keeps an element's reported width equal
          // to the width it contributes to its container.
          const auto take = std::isfinite(charactersPerLine)
              ? std::min(
                    span,
                    static_cast<size_t>(charactersPerLine - column))
              : span;
          penX += static_cast<Float>(take) * advance;
          column += static_cast<Float>(take);
          maxX = std::max(maxX, penX);
          span -= take;
        }
      }
    }

    penX += fragment.trailingInlineSpace();
    maxX = std::max(maxX, penX);

    // An element reports its BORDER box, and block-axis padding and borders are
    // part of it. They do not grow the line box — CSS2 §10.6.1 has them
    // overflow it instead, which is why the line's height is untouched here —
    // but they are still inside the box the element reports.
    const auto blockAxis = fragment.blockAxisBoxEdges();

    // Per-line geometry when the caller supplied it; otherwise the uniform
    // grid, which is all the index pass needs.
    Float rectTop = startLine * lineHeight;
    Float rectHeight = (line - startLine + 1) * lineHeight;
    if (lineTops != nullptr && lineHeights != nullptr && !lineTops->empty()) {
      const auto first =
          std::min(static_cast<size_t>(startLine), lineTops->size() - 1);
      const auto last = std::min(static_cast<size_t>(line), lineTops->size() - 1);
      rectTop = (*lineTops)[first];
      rectHeight = (*lineTops)[last] + (*lineHeights)[last] - rectTop;
    }

    rects.push_back(Rect{
        .origin = {minX, rectTop - blockAxis.top},
        .size = {maxX - minX, rectHeight + blockAxis.top + blockAxis.bottom}});
  }

  return rects;
}


/**
 * Per-line boxes for a run.
 *
 * The measurer used to give every line in a run the SAME height — the tallest
 * thing anywhere in it. That is right for text, where the strut dominates every
 * line equally, and wrong the moment different lines carry different-sized
 * boxes: a 50pt box on line one and a 20pt box on line two produced two 50pt
 * lines and a 100pt block where every browser reports 70.
 *
 * Line ASSIGNMENT depends only on widths, so it can be recovered by running the
 * existing walk with a unit line height — the y it reports is then the line
 * index. That keeps one implementation of wrapping rather than a second copy
 * that can disagree with the first, which is the kind of duplication this file
 * has been bitten by before.
 */
struct DeterministicLines {
  std::vector<DeterministicLineBox> boxes;
  std::vector<Float> tops;
  Float totalHeight{0};
};

DeterministicLines deterministicLines(
    const AttributedStringBox& attributedStringBox,
    const LayoutConstraints& layoutConstraints,
    const DeterministicLineBox& strutOnlyBox) {
  const auto& fragments = attributedStringBox.getValue().getFragments();
  // Unit line height: the reported y IS the line index.
  const auto indexRects =
      measureFragmentRectsDeterministically(attributedStringBox, layoutConstraints, 1);

  size_t lineCount = 1;
  std::vector<size_t> startLines(fragments.size(), 0);
  for (size_t i = 0; i < fragments.size() && i < indexRects.size(); i++) {
    const auto blockAxis = fragments[i].blockAxisBoxEdges();
    const auto start =
        static_cast<size_t>(std::llround(indexRects[i].origin.y + blockAxis.top));
    startLines[i] = start;
    const auto span = static_cast<size_t>(
        std::llround(indexRects[i].size.height - blockAxis.top - blockAxis.bottom));
    lineCount = std::max(lineCount, start + std::max<size_t>(span, 1));
  }

  DeterministicLines lines;
  // Every line starts from the strut and grows for what lands on it.
  lines.boxes.assign(lineCount, strutOnlyBox);
  for (size_t i = 0; i < fragments.size(); i++) {
    const auto& fragment = fragments[i];
    if (!fragment.isAttachment()) {
      continue;
    }
    auto& box = lines.boxes[std::min(startLines[i], lineCount - 1)];
    const auto height = fragment.parentShadowView.layoutMetrics.frame.size.height;
    growLineBoxForAttachment(box, fragment, height, strutOnlyBox);
  }

  lines.tops.reserve(lineCount);
  Float top = 0;
  for (const auto& box : lines.boxes) {
    lines.tops.push_back(top);
    top += box.height();
  }
  lines.totalHeight = top;
  return lines;
}

/**
 * Positions each attachment's frame, baseline-aligned within its line.
 *
 * These frames are what actually place an atomic inline's host view (via
 * `InlineContentShadowNode::getInlineAttachmentPlacements`). They used to be
 * left at zero, which meant every inline box in a headless test sat at the
 * run's origin — so no baseline behaviour was observable from JS at all, and a
 * test written against it would pass no matter what the baseline logic did.
 *
 * The x and the line come from the fragment rects, which already walk the same
 * grid and handle wrapping; only the y is baseline work.
 */
void placeAttachments(
    const AttributedStringBox &attributedStringBox,
    const std::vector<Rect> &fragmentRects,
    const DeterministicLines &lines,
    TextMeasurement::Attachments &attachments)
{
  const auto &fragments = attributedStringBox.getValue().getFragments();
  size_t attachmentIndex = 0;

  for (size_t i = 0; i < fragments.size() && i < fragmentRects.size(); i++) {
    const auto &fragment = fragments[i];
    if (!fragment.isAttachment()) {
      continue;
    }
    if (attachmentIndex >= attachments.size()) {
      break;
    }

    const auto size = fragment.parentShadowView.layoutMetrics.frame.size;
    const auto &rect = fragmentRects[i];
    // The fragment rect spans the whole line box; the baseline sits at the
    // line's ascent below its top, and the box hangs from there by its own
    // baseline (CSS2 §10.8.1).
    // Which line this box is on, and that line's own box — not the run's.
    // Using one box for the whole run put a 20pt box on the second line at the
    // first line's baseline.
    const auto lineTop = rect.origin.y;
    size_t lineIndex = 0;
    for (size_t l = 0; l < lines.tops.size(); l++) {
      if (lines.tops[l] <= lineTop + 0.01) {
        lineIndex = l;
      }
    }
    const auto& lineBox = lines.boxes[lineIndex];
    const auto baselineY = lines.tops[lineIndex] + lineBox.ascent;

    // `vertical-align` (CSS2 §10.8.1). The engine that built the line is the
    // only thing that knows where the line's edges are, so each one applies
    // this itself; the fragment only carries what the box asked for.
    const auto lineBottom = lines.tops[lineIndex] + lineBox.height();
    Float boxTop = baselineY - fragment.atomicInlineBaseline;
    switch (fragment.atomicInlineVerticalAlign) {
      case 1: // top
        boxTop = lines.tops[lineIndex];
        break;
      case 2: // bottom
        boxTop = lineBottom - size.height;
        break;
      case 3: {
        // `middle` is NOT the middle of the line box, which is the intuitive
        // reading and the wrong one. CSS centres the box on the baseline raised
        // by half the parent's x-height (CSS2 §10.8.1) — so it sits slightly
        // above the baseline, near the visual centre of lowercase text, and
        // moves with the font rather than with the line.
        // The SAME x-height `growLineBoxForAttachment` used when it decided how
        // much of the line this box needs. Deriving it from the line box here
        // instead made the two disagree — the box was positioned for one
        // x-height and the line grown for another — and it fell outside the
        // line it had just been given room in. The containment assertion below
        // is what caught it.
        const auto xHeight =
            deterministicLineHeight(attributedStringBox) * kDeterministicXHeightRatio;
        boxTop = baselineY - xHeight / 2 - size.height / 2;
        break;
      }
      default: // baseline — the box's own baseline on the line's
        break;
    }

    // Structural invariant: a line box is the UNION of everything on it
    // (CSS2 §9.4.2), so a box may never be placed outside the line it belongs
    // to. Any alignment that positions against the line — `top`, `bottom`,
    // `middle` — has to be matched by a contribution to the line's height, and
    // forgetting one is invisible in the numbers until something overlaps.
    // This caught exactly that: `middle` was positioned correctly and
    // contributed nothing, putting a 20pt box at y=25 on a 40pt line.
    react_native_assert(
        boxTop >= lines.tops[lineIndex] - 0.01 &&
        boxTop + size.height <= lines.tops[lineIndex] + lineBox.height() + 0.01 &&
        "an atomic inline must be placed inside its own line box");
    react_native_assert(
        fragment.atomicInlineVerticalAlign <= 3 &&
        "unknown vertical-align; the enum and the fragment encoding disagree");

    // The fragment rect starts at the enclosing inline element's BOX edge,
    // which is before its leading margin/border/padding (that is what makes it
    // the right rect to report for the element itself). The attachment's own
    // content starts after that space, so it has to be stepped over here —
    // otherwise `<span style="padding-left:10px"><img></span>` draws the image
    // where the padding should be, while the advance after it is still correct,
    // which reads as the image being 10pt too far left rather than as padding
    // being ignored.
    attachments[attachmentIndex].frame = Rect{
        .origin = {rect.origin.x + fragment.leadingInlineSpace(), boxTop},
        .size = size};
    attachmentIndex++;
  }
}

TextMeasurement measureDeterministically(
    const AttributedStringBox& attributedStringBox,
    const LayoutConstraints& layoutConstraints,
    TextMeasurement::Attachments attachments) {
  size_t characterCount = 0;
  Float intrinsicWidth = 0;
  Float maxAttachmentHeight = 0;
  for (const auto& fragment : attributedStringBox.getValue().getFragments()) {
    // An inline element's box edges (margin + border + padding) occupy advance
    // on the line (box-model-scope.md G3).
    intrinsicWidth +=
        fragment.leadingInlineSpace() + fragment.trailingInlineSpace();
    if (fragment.isAttachment()) {
      // Inline replaced element (the `<img>` tag): reserve its intrinsic box in
      // the run — width adds to the line, height can grow the line box. The size
      // is carried on the attachment fragment's layout metrics (set by
      // `InlineContentShadowNode::sizeImageAttachments`). Contract extension
      // documented in text-children-onboarding.md §4.
      const auto& attachmentSize =
          fragment.parentShadowView.layoutMetrics.frame.size;
      intrinsicWidth += attachmentSize.width;
      maxAttachmentHeight = std::max(maxAttachmentHeight, attachmentSize.height);
      characterCount += static_cast<size_t>(attachmentColumns(fragment));
    } else {
      characterCount += fragment.string.size();
      intrinsicWidth +=
          static_cast<Float>(fragment.string.size()) * perCharacterAdvance(fragment);
    }
  }

  const auto lineBox = deterministicLineBox(attributedStringBox);
  const auto lineHeight = lineBox.height();

  if (characterCount == 0) {
    auto emptyRects = measureFragmentRectsDeterministically(
        attributedStringBox, layoutConstraints, lineHeight);
    // A single line, which is what an empty run is.
    auto emptyLines = DeterministicLines{};
    emptyLines.boxes.push_back(lineBox);
    emptyLines.tops.push_back(0);
    emptyLines.totalHeight = lineBox.height();
    placeAttachments(attributedStringBox, emptyRects, emptyLines, attachments);
    return TextMeasurement{
        .size = layoutConstraints.clamp({0, 0}),
        .attachments = std::move(attachments),
        .fragmentRects = std::move(emptyRects)};
  }

  auto maximumWidth = layoutConstraints.maximumSize.width;

  // Mandatory breaks (`\n`, from `<br>` or from preserved `white-space: pre`
  // text) split the run into segments that each wrap on their own, so counting
  // characters across the whole string would undercount the lines.
  //
  // Their WIDTHS are tracked too, because a run's intrinsic width is its
  // longest line and not the sum of them. That only becomes visible when the
  // width is unbounded — as it is for `pre`, which does not wrap — and it
  // otherwise reads as a correct-looking total.
  std::vector<size_t> segmentLengths;
  std::vector<Float> segmentWidths;
  size_t segmentLength = 0;
  Float segmentWidth = 0;
  for (const auto& fragment : attributedStringBox.getValue().getFragments()) {
    segmentWidth += fragment.leadingInlineSpace() + fragment.trailingInlineSpace();
    if (fragment.isAttachment()) {
      segmentLength += static_cast<size_t>(attachmentColumns(fragment));
      segmentWidth += fragment.parentShadowView.layoutMetrics.frame.size.width;
      continue;
    }
    const auto advance = perCharacterAdvance(fragment);
    for (char character : fragment.string) {
      if (character == '\n') {
        segmentLengths.push_back(segmentLength);
        segmentWidths.push_back(segmentWidth);
        segmentLength = 0;
        segmentWidth = 0;
      } else {
        segmentLength += 1;
        segmentWidth += advance;
      }
    }
  }
  segmentLengths.push_back(segmentLength);
  segmentWidths.push_back(segmentWidth);

  Float longestSegment = 0;
  for (auto candidate : segmentWidths) {
    longestSegment = std::max(longestSegment, candidate);
  }

  Float width = longestSegment;
  const auto charactersPerLine = std::isfinite(maximumWidth)
      ? std::max<Float>(1, std::floor(maximumWidth / kDeterministicCharacterWidth))
      : std::numeric_limits<Float>::infinity();
  // The line COUNT is no longer needed here: the height is the sum of the
  // per-line boxes below, which knows how many there are and how tall each one
  // is. Counting lines and multiplying by one height is what made a run whose
  // lines carry different-sized boxes measure wrong.
  if (std::isfinite(maximumWidth) && intrinsicWidth > maximumWidth) {
    width = charactersPerLine * kDeterministicCharacterWidth;
  }

  // Per-line boxes: a run whose lines carry different-sized boxes has
  // different-sized lines, and the block is their sum rather than the tallest
  // one multiplied by the count.
  auto strutOnly = DeterministicLineBox{};
  {
    const auto textHeight = deterministicLineHeight(attributedStringBox);
    strutOnly.ascent = textHeight - textHeight * kDeterministicDescentRatio;
    strutOnly.descent = textHeight * kDeterministicDescentRatio;
  }
  const auto lines =
      deterministicLines(attributedStringBox, layoutConstraints, strutOnly);

  std::vector<Float> lineHeightsByLine;
  lineHeightsByLine.reserve(lines.boxes.size());
  for (const auto& b : lines.boxes) {
    lineHeightsByLine.push_back(b.height());
  }
  auto rects = measureFragmentRectsDeterministically(
      attributedStringBox,
      layoutConstraints,
      lineHeight,
      &lines.tops,
      &lineHeightsByLine);
  placeAttachments(attributedStringBox, rects, lines, attachments);

  return TextMeasurement{
      .size = layoutConstraints.clamp({width, lines.totalHeight}),
      .attachments = std::move(attachments),
      .fragmentRects = std::move(rects)};
}

} // namespace

TextLayoutManager::TextLayoutManager(
    const std::shared_ptr<const ContextContainer>& /*contextContainer*/)
    : textMeasureCache_(kSimpleThreadSafeCacheSizeCap) {}

TextMeasurement TextLayoutManager::measure(
    const AttributedStringBox& attributedStringBox,
    const ParagraphAttributes& /*paragraphAttributes*/,
    const TextLayoutContext& /*layoutContext*/,
    const LayoutConstraints& layoutConstraints) const {
  TextMeasurement::Attachments attachments;
  for (const auto& fragment : attributedStringBox.getValue().getFragments()) {
    if (fragment.isAttachment()) {
      attachments.push_back(
          TextMeasurement::Attachment{
              .frame =
                  {.origin = {.x = 0, .y = 0},
                   .size = {.width = 0, .height = 0}},
              .isClipped = false});
    }
  }

  if (ReactNativeFeatureFlags::enableStringChildren()) {
    return measureDeterministically(
        attributedStringBox, layoutConstraints, std::move(attachments));
  }

  return TextMeasurement{
      .size =
          {.width = layoutConstraints.minimumSize.width,
           .height = layoutConstraints.minimumSize.height},
      .attachments = attachments};
}


LinesMeasurements TextLayoutManager::measureLines(
    const AttributedStringBox &attributedStringBox,
    const ParagraphAttributes &paragraphAttributes,
    const Size &size) const
{
  if (!ReactNativeFeatureFlags::enableStringChildren()) {
    return {};
  }

  auto measurement = measureDeterministically(
      attributedStringBox,
      LayoutConstraints{.minimumSize = {0, 0}, .maximumSize = size},
      TextMeasurement::Attachments{});

  const auto lineBox = deterministicLineBox(attributedStringBox);
  const auto lineHeight = lineBox.height();
  if (lineHeight <= 0) {
    return {};
  }

  // The grid wraps by character count, so the line count follows from the
  // measured height rather than needing a second walk.
  const auto lineCount =
      std::max<size_t>(1, static_cast<size_t>(std::round(measurement.size.height / lineHeight)));

  auto lines = LinesMeasurements{};
  lines.reserve(lineCount);
  for (size_t i = 0; i < lineCount; i++) {
    lines.emplace_back(
        attributedStringBox.getValue().getString(),
        Rect{
            .origin = {0, static_cast<Float>(i) * lineHeight},
            .size = {measurement.size.width, lineHeight}},
        // `descender` is reported as a negative offset from the baseline, the
        // same sign convention the platform engines use.
        -lineBox.descent,
        lineBox.ascent,
        lineBox.ascent,
        lineBox.ascent);
  }
  return lines;
}

} // namespace facebook::react
