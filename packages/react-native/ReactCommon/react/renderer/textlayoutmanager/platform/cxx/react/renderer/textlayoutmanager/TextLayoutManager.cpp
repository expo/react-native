/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "TextLayoutManager.h"

#include <algorithm>
#include <cmath>
#include <string>

#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/renderer/attributedstring/TextAttributes.h>

namespace facebook::react {

namespace {

// Deterministic monospace metrics for headless (e.g. Fantom) testing of
// intrinsic text sizing: every character is 10pt wide (see
// `perCharacterAdvance`), a line is as tall as `deterministicLineBox` says,
// and text wraps naively at the width constraint. Only active behind
// `enableStringChildren`; with the flag off this stub returns `minimumSize`,
// which several test suites rely on.
constexpr Float kDeterministicCharacterWidth = 10;

// How far text descends below its baseline, as a fraction of the line height.
// Deterministic like everything else here, and non-zero so that "aligned to
// the baseline" and "aligned to the bottom edge" are distinguishable — with a
// zero descent every baseline rule looks identical and nothing can be tested.
constexpr Float kDeterministicDescentRatio = 0.2;

Float deterministicLineHeight(const AttributedStringBox& attributedStringBox) {
  // Line height is layout-observable so text attributes can be asserted
  // headlessly. Contract: an explicit `lineHeight` wins verbatim; otherwise it
  // tracks font size as `fontSize + 6` (default 14 -> 20).
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

// Per-character advance, layout-observable so weight, style and
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

/*
 * How many cells of the deterministic grid an atomic inline occupies.
 *
 * This measurer models a monospace grid of `kDeterministicCharacterWidth` cells
 * and wraps by counting cells, which is what makes it reproducible. Real
 * engines break between adjacent atomic inlines (there is a break opportunity
 * there even with no whitespace, which is why `<span/><span/>` wraps in a
 * browser), so the count has to follow the box's width: a row of 100pt boxes
 * in a 300pt container wraps after the third.
 *
 * Rounded up: a box that does not fill its last cell still occupies it, which
 * keeps the grid the conservative approximation of a width-based break rather
 * than one that occasionally over-fills a line.
 */
Float attachmentColumns(const AttributedString::Fragment& fragment) {
  const auto width = fragment.parentShadowView.layoutMetrics.frame.size.width;
  return std::max<Float>(1, std::ceil(width / kDeterministicCharacterWidth));
}

/**
 * A line box: where its baseline sits, and how far anything on it descends
 * below that baseline.
 *
 * CSS builds a line box from the ascents and descents of what is on it — the
 * baseline sits at the greatest ascent, and the line runs from there down to
 * the greatest descent. That is not the same as "the tallest item's height":
 * a 40pt box baseline-aligned on a 20pt text line makes a 44pt line, because
 * the box's bottom sits on the baseline and the text's descender still hangs
 * below it.
 */
struct DeterministicLineBox {
  Float ascent{0};
  Float descent{0};

  Float height() const {
    return ascent + descent;
  }
};

DeterministicLineBox deterministicLineBox(
    const AttributedStringBox& attributedStringBox) {
  const auto textHeight = deterministicLineHeight(attributedStringBox);
  const auto textDescent = textHeight * kDeterministicDescentRatio;

  auto box = DeterministicLineBox{};
  // The strut first: a zero-width inline box with the block container's font
  // and `line-height`, present on every line whether or not text sits on it
  // (CSS2 §10.8). Being usually the only thing on a line of boxes besides the
  // boxes themselves, it is what fixes where the baseline sits.
  box.ascent = textHeight - textDescent;
  box.descent = textDescent;

  for (const auto& fragment : attributedStringBox.getValue().getFragments()) {
    if (fragment.isAttachment()) {
      // An atomic inline contributes its own baseline as ascent, and whatever
      // hangs below that baseline as descent. `atomicInlineBaseline` is how far
      // its baseline sits from its top, which the shadow node computed per
      // CSS2 §10.8.1.
      const auto height =
          fragment.parentShadowView.layoutMetrics.frame.size.height;
      const auto baseline = fragment.atomicInlineBaseline;
      box.ascent = std::max(box.ascent, baseline);
      box.descent = std::max(box.descent, height - baseline);
    }
  }

  return box;
}

// Lays the fragments out on the same deterministic grid
// `measureDeterministically` uses (naive wrap at `charactersPerLine`) and
// returns one rect per fragment, relative to the text frame. A fragment split
// across lines reports the union of its pieces — the same thing
// `getBoundingClientRect()` reports for an inline element that wraps.
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
    const auto text = fragment.isAttachment() ? std::string{} : fragment.string;
    const auto characters =
        fragment.isAttachment() ? static_cast<size_t>(1) : text.size();
    const auto advance = fragment.isAttachment()
        ? fragment.parentShadowView.layoutMetrics.frame.size.width
        : perCharacterAdvance(fragment);

    if (characters == 0) {
      rects.push_back(
          Rect{.origin = {penX, line * lineHeight}, .size = {0, lineHeight}});
      continue;
    }

    Float startLine = line;
    Float minX = penX;
    Float maxX = penX;

    // Walk spans rather than characters: characters advance the pen one grid
    // cell at a time and only newlines and the wrap boundary reset it, so
    // whole spans between newlines are consumed with closed-form wrap math.
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
        // An attachment that wraps starts wholly on the NEW line, unlike a
        // text fragment spanning several lines, whose rect is the union.
        startLine = line;
      }
      penX += advance;
      column += columns;
      maxX = std::max(maxX, penX);
    } else {
      const auto& string = text;
      size_t i = 0;
      while (i < characters) {
        if (string[i] == '\n') {
          // A mandatory break. Every real engine breaks here, so the
          // deterministic measurer must too.
          column = 0;
          line += 1;
          penX = 0;
          minX = 0;
          i += 1;
          continue;
        }
        const auto breakAt = string.find('\n', i);
        auto span = (breakAt == std::string::npos ? characters : breakAt) - i;
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
              ? std::min(span, static_cast<size_t>(charactersPerLine - column))
              : span;
          penX += static_cast<Float>(take) * advance;
          column += static_cast<Float>(take);
          maxX = std::max(maxX, penX);
          span -= take;
        }
      }
    }

    rects.push_back(
        Rect{
            .origin = {minX, startLine * lineHeight},
            .size = {maxX - minX, (line - startLine + 1) * lineHeight}});
  }

  return rects;
}

/**
 * Positions each attachment's frame, baseline-aligned within its line.
 *
 * These frames are what place an atomic inline's host view, so baseline
 * behaviour is observable from JS in a headless test. Left at zero, every
 * inline box would sit at the run's origin and a baseline test would pass no
 * matter what the baseline logic did.
 *
 * The x and the line come from the fragment rects, which already walk the same
 * grid and handle wrapping; only the y is baseline work.
 */
void placeAttachments(
    const AttributedStringBox& attributedStringBox,
    const std::vector<Rect>& fragmentRects,
    const DeterministicLineBox& lineBox,
    TextMeasurement::Attachments& attachments) {
  const auto& fragments = attributedStringBox.getValue().getFragments();
  size_t attachmentIndex = 0;

  for (size_t i = 0; i < fragments.size() && i < fragmentRects.size(); i++) {
    const auto& fragment = fragments[i];
    if (!fragment.isAttachment()) {
      continue;
    }
    if (attachmentIndex >= attachments.size()) {
      break;
    }

    const auto size = fragment.parentShadowView.layoutMetrics.frame.size;
    const auto& rect = fragmentRects[i];
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
    if (fragment.isAttachment()) {
      // An atomic inline: reserve its box in the run — width adds to the line,
      // height can grow the line box. The size is carried on the attachment
      // fragment's layout metrics.
      const auto& attachmentSize =
          fragment.parentShadowView.layoutMetrics.frame.size;
      intrinsicWidth += attachmentSize.width;
      maxAttachmentHeight =
          std::max(maxAttachmentHeight, attachmentSize.height);
      characterCount += 1;
    } else {
      const auto text = fragment.string;
      characterCount += text.size();
      intrinsicWidth +=
          static_cast<Float>(text.size()) * perCharacterAdvance(fragment);
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
        .attachments = std::move(attachments)};
  }

  auto maximumWidth = layoutConstraints.maximumSize.width;

  // Mandatory breaks (`\n`) split the run into segments that each wrap on
  // their own, so counting characters across the whole string would
  // undercount the lines.
  //
  // Their WIDTHS are tracked too, because a run's intrinsic width is its
  // longest line and not the sum of them. That only becomes visible when the
  // width is unbounded, and it otherwise reads as a correct-looking total.
  std::vector<size_t> segmentLengths;
  std::vector<Float> segmentWidths;
  size_t segmentLength = 0;
  Float segmentWidth = 0;
  for (const auto& fragment : attributedStringBox.getValue().getFragments()) {
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
  Float lineCount = 0;
  const auto charactersPerLine = std::isfinite(maximumWidth)
      ? std::max<Float>(
            1, std::floor(maximumWidth / kDeterministicCharacterWidth))
      : std::numeric_limits<Float>::infinity();
  for (auto length : segmentLengths) {
    // An empty segment is still a line: two consecutive breaks leave a blank
    // one, exactly as they do on the web.
    lineCount += std::isfinite(charactersPerLine)
        ? std::max<Float>(
              1, std::ceil(static_cast<Float>(length) / charactersPerLine))
        : 1;
  }
  if (std::isfinite(maximumWidth) && intrinsicWidth > maximumWidth) {
    width = charactersPerLine * kDeterministicCharacterWidth;
  }

  auto rects = measureFragmentRectsDeterministically(
      attributedStringBox, layoutConstraints, lineHeight);
  placeAttachments(attributedStringBox, rects, lineBox, attachments);

  // Take the line count from the placement pass too: it moves an atomic inline
  // that does not fit in what remains of a line wholly onto the next one,
  // which can need more lines than dividing the segment lengths suggests
  for (const auto& rect : rects) {
    lineCount = std::max(
        lineCount, std::round((rect.origin.y + rect.size.height) / lineHeight));
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
    const AttributedStringBox& attributedStringBox,
    const ParagraphAttributes& paragraphAttributes,
    const Size& size) const {
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
  const auto lineCount = std::max<size_t>(
      1, static_cast<size_t>(std::round(measurement.size.height / lineHeight)));

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
