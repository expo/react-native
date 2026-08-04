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

    const Float startLine = line;
    Float minX = penX;
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

    rects.push_back(Rect{
        .origin = {minX, startLine * lineHeight},
        .size = {maxX - minX, (line - startLine + 1) * lineHeight}});
  }

  return rects;
}

TextMeasurement measureDeterministically(
    const AttributedStringBox& attributedStringBox,
    const LayoutConstraints& layoutConstraints,
    TextMeasurement::Attachments attachments) {
  size_t characterCount = 0;
  Float intrinsicWidth = 0;
  Float maxAttachmentHeight = 0;
  for (const auto& fragment : attributedStringBox.getValue().getFragments()) {
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

  const auto lineHeight =
      std::max(deterministicLineHeight(attributedStringBox), maxAttachmentHeight);

  if (characterCount == 0) {
    return TextMeasurement{
        .size = layoutConstraints.clamp({0, 0}),
        .attachments = std::move(attachments),
        .fragmentRects = measureFragmentRectsDeterministically(
            attributedStringBox, layoutConstraints, lineHeight)};
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

  return TextMeasurement{
      .size = layoutConstraints.clamp({width, lineHeight * lineCount}),
      .attachments = std::move(attachments),
      .fragmentRects = measureFragmentRectsDeterministically(
          attributedStringBox, layoutConstraints, lineHeight)};
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

} // namespace facebook::react
