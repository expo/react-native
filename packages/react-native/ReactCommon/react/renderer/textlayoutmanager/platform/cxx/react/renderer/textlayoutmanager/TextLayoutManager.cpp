/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "TextLayoutManager.h"

#include <cmath>

#include <react/featureflags/ReactNativeFeatureFlags.h>

namespace facebook::react {

namespace {

// Deterministic monospace metrics for headless (e.g. Fantom) testing of
// intrinsic text sizing: every character is 10pt wide, every line is 20pt
// tall, and text wraps naively at the width constraint. Only active behind
// `enableImplicitTextChildren` — the historical behavior of this stub is to
// return `minimumSize`, which several test suites rely on.
constexpr Float kDeterministicCharacterWidth = 10;
constexpr Float kDeterministicLineHeight = 20;

TextMeasurement measureDeterministically(
    const AttributedStringBox& attributedStringBox,
    const LayoutConstraints& layoutConstraints,
    TextMeasurement::Attachments attachments) {
  size_t characterCount = 0;
  for (const auto& fragment : attributedStringBox.getValue().getFragments()) {
    if (!fragment.isAttachment()) {
      characterCount += fragment.string.size();
    }
  }

  if (characterCount == 0) {
    return TextMeasurement{
        .size = layoutConstraints.clamp({0, 0}),
        .attachments = std::move(attachments)};
  }

  auto intrinsicWidth =
      kDeterministicCharacterWidth * static_cast<Float>(characterCount);
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
      .size = layoutConstraints.clamp(
          {width, kDeterministicLineHeight * lineCount}),
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
