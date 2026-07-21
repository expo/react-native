/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <vector>

#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/graphics/Rect.h>

namespace facebook::react {

class TextLayoutManager;

/*
 * State for the <View> component: the laid-out text runs of its anonymous
 * inline formatting contexts (implicit-text-plan.md §3.B). Empty for Views
 * with no bare text content.
 */
class ViewState final {
 public:
  struct TextRun {
    AttributedString attributedString;
    Rect frame;

    bool operator==(const TextRun &other) const
    {
      return attributedString == other.attributedString && frame == other.frame;
    }
    bool operator!=(const TextRun &other) const
    {
      return !(*this == other);
    }
  };

  std::vector<TextRun> textRuns;

  /*
   * Connection to the platform text rendering infrastructure used to paint
   * the runs (mirrors ParagraphState::layoutManager).
   */
  std::weak_ptr<const TextLayoutManager> layoutManager;
};

} // namespace facebook::react
