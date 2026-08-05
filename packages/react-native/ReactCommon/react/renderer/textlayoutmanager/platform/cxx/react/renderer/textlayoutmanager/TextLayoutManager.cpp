/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "TextLayoutManager.h"

#include <algorithm>
#include <cmath>

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
  auto fontSize = TextAttributes::defaultTextAttributes().fontSize;
  if (!fragments.empty() && !std::isnan(fragments[0].textAttributes.fontSize)) {
    fontSize = fragments[0].textAttributes.fontSize;
  }
  return fontSize + 6;
}

// Per-character advance, layout-observable so inheritance of weight/style/
// letterSpacing can be asserted headlessly. Contract: base 10pt, +2pt when
// bold, +1pt when italic, plus `letterSpacing` verbatim.
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

DeterministicLineBox deterministicLineBox(const AttributedStringBox &attributedStringBox)
{
  const auto textHeight = deterministicLineHeight(attributedStringBox);
  const auto textDescent = textHeight * kDeterministicDescentRatio;

  auto box = DeterministicLineBox{};
  bool hasText = false;

  for (const auto &fragment : attributedStringBox.getValue().getFragments()) {
    if (fragment.isAttachment()) {
      // An atomic inline contributes its own baseline as ascent, and whatever
      // hangs below that baseline as descent. `atomicInlineBaseline` is how far
      // its baseline sits from its top, which the shadow node computed per
      // CSS2 §10.8.1.
      const auto height = fragment.parentShadowView.layoutMetrics.frame.size.height;
      const auto baseline = fragment.atomicInlineBaseline;
      box.ascent = std::max(box.ascent, baseline);
      box.descent = std::max(box.descent, height - baseline);
    } else if (!fragment.string.empty()) {
      hasText = true;
    }
  }

  if (hasText) {
    box.ascent = std::max(box.ascent, textHeight - textDescent);
    box.descent = std::max(box.descent, textDescent);
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
    Float lineHeight) {
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
    const Float startLine = line;
    Float minX = penX;
    penX += fragment.leadingInlineSpace();
    Float maxX = penX;

    for (size_t i = 0; i < characters; i++) {
      if (column >= charactersPerLine) {
        // Wrapping is character-based on the same grid the size pass uses.
        column = 0;
        line += 1;
        penX = 0;
        minX = 0; // the fragment now starts at the line's leading edge
      }
      // Advances are per-character (bold/italic/letterSpacing widen them), so
      // the pen must accumulate them rather than sit on the wrap grid — that
      // is what keeps an element's reported width equal to the width it
      // contributes to its container.
      penX += advance;
      column += 1;
      maxX = std::max(maxX, penX);
    }

    penX += fragment.trailingInlineSpace();
    maxX = std::max(maxX, penX);

    // An element reports its BORDER box, and block-axis padding and borders are
    // part of it. They do not grow the line box — CSS2 §10.6.1 has them
    // overflow it instead, which is why the line's height is untouched here —
    // but they are still inside the box the element reports.
    const auto blockAxis = fragment.blockAxisBoxEdges();

    rects.push_back(Rect{
        .origin = {minX, startLine * lineHeight - blockAxis.top},
        .size = {
            maxX - minX,
            (line - startLine + 1) * lineHeight + blockAxis.top +
                blockAxis.bottom}});
  }

  return rects;
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
    const DeterministicLineBox &lineBox,
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
    const auto lineTop = rect.origin.y;
    const auto baselineY = lineTop + lineBox.ascent;

    attachments[attachmentIndex].frame = Rect{
        .origin = {rect.origin.x, baselineY - fragment.atomicInlineBaseline},
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
      characterCount += 1;
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
    placeAttachments(attributedStringBox, emptyRects, lineBox, attachments);
    return TextMeasurement{
        .size = layoutConstraints.clamp({0, 0}),
        .attachments = std::move(attachments),
        .fragmentRects = std::move(emptyRects)};
  }

  auto maximumWidth = layoutConstraints.maximumSize.width;

  Float width = intrinsicWidth;
  Float lineCount = 1;
  if (std::isfinite(maximumWidth) && intrinsicWidth > maximumWidth) {
    auto charactersPerLine = std::max<Float>(
        1, std::floor(maximumWidth / kDeterministicCharacterWidth));
    lineCount =
        std::ceil(static_cast<Float>(characterCount) / charactersPerLine);
    width = charactersPerLine * kDeterministicCharacterWidth;
  }

  auto rects = measureFragmentRectsDeterministically(
      attributedStringBox, layoutConstraints, lineHeight);
  placeAttachments(attributedStringBox, rects, lineBox, attachments);

  return TextMeasurement{
      .size = layoutConstraints.clamp({width, lineHeight * lineCount}),
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
