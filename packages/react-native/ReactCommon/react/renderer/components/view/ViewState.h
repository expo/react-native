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

#ifdef RN_SERIALIZABLE_STATE
#include <folly/dynamic.h>
#include <react/renderer/attributedstring/conversions.h>
#include <react/renderer/mapbuffer/MapBuffer.h>
#include <react/renderer/mapbuffer/MapBufferBuilder.h>
#endif

namespace facebook::react {

class TextLayoutManager;

/*
 * State for the <View> component: the laid-out text runs of its anonymous
 * inline formatting contexts (text-children-plan.md §3.B). Empty for Views
 * with no bare text content.
 */
class ViewState final {
 public:
  struct TextRun {
    AttributedString attributedString;
    Rect frame;

    /*
     * Number of block-level (mounted) React children that precede this run in
     * document order. Lets the mounting layer interleave the per-run paint views
     * with mounted child views in authored order (CSS painting order), rather
     * than drawing all text on top (text-children-plan.md §3.B).
     */
    int documentOrder{0};

    bool operator==(const TextRun &other) const
    {
      return attributedString == other.attributedString && frame == other.frame &&
          documentOrder == other.documentOrder;
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

  ViewState() = default;
  ViewState(std::vector<TextRun> textRuns, std::weak_ptr<const TextLayoutManager> layoutManager)
      : textRuns(std::move(textRuns)), layoutManager(std::move(layoutManager))
  {
  }

#ifdef RN_SERIALIZABLE_STATE
  /*
   * Android serializes Fabric state across JNI (RN_SERIALIZABLE_STATE). The text
   * runs are computed natively during layout (ViewShadowNode), never pushed back
   * from the Java layer, so reconstruction from `data` is a no-op that preserves
   * the previously computed runs. The runs reach the mounting layer through the
   * shadow node's state data directly (see the Android View text-run painting),
   * not through this dynamic payload.
   */
  ViewState(const ViewState &previousState, folly::dynamic /*data*/)
      : textRuns(previousState.textRuns), layoutManager(previousState.layoutManager)
  {
  }

  folly::dynamic getDynamic() const
  {
    return folly::dynamic::object();
  }

  /*
   * Serializes the text runs to a MapBuffer for the Android mounting layer
   * (ReactViewManager paints them into the ReactViewGroup). Top level:
   *   VS_KEY_RUNS -> list of run MapBuffers.
   * Each run:
   *   0 attributedString (standard AttributedString MapBuffer, consumed by
   *     TextLayoutManager.getOrCreateSpannableForText),
   *   1..4 frame left/top/width/height in dips,
   *   5 documentOrder (paint order relative to mounted child views).
   */
  MapBuffer getMapBuffer() const
  {
    std::vector<MapBuffer> runs;
    runs.reserve(textRuns.size());
    for (const auto &run : textRuns) {
      auto runBuilder = MapBufferBuilder();
      runBuilder.putMapBuffer(0, toMapBuffer(run.attributedString));
      runBuilder.putDouble(1, run.frame.origin.x);
      runBuilder.putDouble(2, run.frame.origin.y);
      runBuilder.putDouble(3, run.frame.size.width);
      runBuilder.putDouble(4, run.frame.size.height);
      runBuilder.putInt(5, run.documentOrder);
      runs.push_back(runBuilder.build());
    }
    auto builder = MapBufferBuilder();
    builder.putMapBufferList(0, runs);
    return builder.build();
  }
#endif
};

} // namespace facebook::react
