/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "TextLayoutManager.h"

#include <cmath>

#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/renderer/attributedstring/TextAttributes.h>

namespace facebook::react {

namespace {

// Deterministic monospace metrics for headless (e.g. Fantom) testing of
// intrinsic text sizing: every character is 10pt wide, every line is 20pt
// tall, and text wraps naively at the width constraint. Only active behind
// `enableImplicitTextChildren` — the historical behavior of this stub is to
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

TextMeasurement measureDeterministically(
    const AttributedStringBox& attributedStringBox,
    const LayoutConstraints& layoutConstraints,
    TextMeasurement::Attachments attachments) {
  size_t characterCount = 0;
  Float intrinsicWidth = 0;
  for (const auto& fragment : attributedStringBox.getValue().getFragments()) {
    if (!fragment.isAttachment()) {
      characterCount += fragment.string.size();
      // Per-character advance is layout-observable so inheritance of weight/
      // style/letterSpacing can be asserted headlessly. Contract: base 10pt,
      // +2pt when bold, +1pt when italic, plus `letterSpacing` verbatim.
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
      intrinsicWidth += static_cast<Float>(fragment.string.size()) * perCharacter;
    }
  }

  const auto lineHeight = deterministicLineHeight(attributedStringBox);

  if (characterCount == 0) {
    return TextMeasurement{
        .size = layoutConstraints.clamp({0, 0}),
        .attachments = std::move(attachments)};
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
      .attachments = std::move(attachments)};
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

  if (ReactNativeFeatureFlags::enableImplicitTextChildren()) {
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
