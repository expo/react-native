/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <algorithm>
#include <limits>
#include <optional>
#include <vector>

#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/attributedstring/AttributedStringBox.h>
#include <react/renderer/attributedstring/ParagraphAttributes.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>

namespace facebook::react {

/*
 * The min-content size of a run of text (css-sizing-3 §4.1): the width of its
 * widest word, and the height of the run wrapped to that width. Yoga asks for
 * it with a width constraint of 0 when it computes a flex item's automatic
 * minimum size, and measuring the run at 0 does not answer: the platform then
 * breaks after every character, which is a stack of letters, not of words.
 *
 * A word is a run of non-whitespace; an attachment is a word of its own width.
 * The widest word is almost always among the longest, so only the three
 * longest are measured alone. Nothing when the run has no text.
 */
inline std::optional<Size> measureTextMinContent(
    const TextLayoutManager& textLayoutManager,
    const AttributedString& attributedString,
    const ParagraphAttributes& paragraphAttributes,
    const TextLayoutContext& textLayoutContext,
    const LayoutConstraints& layoutConstraints) {
  if (attributedString.isEmpty()) {
    return std::nullopt;
  }

  // `overflow-wrap: anywhere` (css-text-3 §5.5) adds a break opportunity
  // between any two characters and counts them in the min-content size, so
  // the widest grapheme is the answer. The platforms break a run that does
  // not fit between characters when asked to lay it out at no width, which is
  // that measurement. (`break-word` breaks the same way but, per the spec,
  // does not change the min-content size, so it takes the longest word below.)
  if (breaksAnywhere(
          attributedString.getBaseTextAttributes().overflowWrap.value_or(
              OverflowWrap::Normal))) {
    return textLayoutManager
        .measure(
            AttributedStringBox{attributedString},
            paragraphAttributes,
            textLayoutContext,
            layoutConstraints)
        .size;
  }

  struct Word {
    AttributedString string;
    size_t characters{0};
    Float attachmentWidth{0};
  };
  std::vector<Word> words;
  Word current;
  auto flush = [&]() {
    if (current.characters > 0) {
      words.push_back(std::move(current));
      current = Word{};
    }
  };
  for (const auto& fragment : attributedString.getFragments()) {
    if (fragment.isAttachment()) {
      flush();
      Word attachment;
      attachment.attachmentWidth =
          fragment.parentShadowView.layoutMetrics.frame.size.width;
      words.push_back(std::move(attachment));
      continue;
    }
    const auto& text = fragment.string;
    size_t start = 0;
    for (size_t i = 0; i <= text.size(); i++) {
      const bool boundary = i == text.size() || text[i] == ' ' ||
          text[i] == '\n' || text[i] == '\t';
      if (!boundary) {
        continue;
      }
      if (i > start) {
        auto piece = fragment;
        piece.string = text.substr(start, i - start);
        current.characters += piece.string.size();
        current.string.appendFragment(std::move(piece));
      }
      if (i < text.size()) {
        flush();
      }
      start = i + 1;
    }
  }
  flush();
  if (words.empty()) {
    return std::nullopt;
  }

  auto unbounded = layoutConstraints;
  unbounded.maximumSize.width = std::numeric_limits<Float>::infinity();
  std::sort(words.begin(), words.end(), [](const Word& a, const Word& b) {
    return a.characters > b.characters;
  });
  Float widest = 0;
  size_t measured = 0;
  for (const auto& word : words) {
    if (word.attachmentWidth > 0) {
      widest = std::max(widest, word.attachmentWidth);
      continue;
    }
    if (measured++ >= 3) {
      break;
    }
    const auto width = textLayoutManager
                           .measure(
                               AttributedStringBox{word.string},
                               paragraphAttributes,
                               textLayoutContext,
                               unbounded)
                           .size.width;
    widest = std::max(widest, width);
  }

  auto wrapped = layoutConstraints;
  wrapped.maximumSize.width = widest;
  const auto size = textLayoutManager
                        .measure(
                            AttributedStringBox{attributedString},
                            paragraphAttributes,
                            textLayoutContext,
                            wrapped)
                        .size;
  return Size{std::max(widest, size.width), size.height};
}

} // namespace facebook::react
