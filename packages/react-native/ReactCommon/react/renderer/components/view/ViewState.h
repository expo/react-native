/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <vector>

#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/core/ReactPrimitives.h>
#include <react/renderer/graphics/Rect.h>

#ifdef RN_SERIALIZABLE_STATE
#include <folly/dynamic.h>
#include <react/renderer/mapbuffer/MapBuffer.h>
#endif

namespace facebook::react {

class TextLayoutManager;

/*
 * State for the <View> component: the laid-out text runs of its anonymous
 * inline formatting contexts. Empty for Views
 * with no bare text content.
 */
class ViewState final {
 public:
  struct TextRun {
    AttributedString attributedString;
    Rect frame;

    /*
     * Number of the View's mounted views that paint below this run, which is
     * where the mounting layer places the run's paint view among them (CSS
     * painting order), rather than drawing all text on top.
     */
    int documentOrder{0};

    /*
     * The anonymous box's tag for content runs, which keys the registry that
     * hands a run's measured layout over to the mounting layer; 0 for runs
     * that opt out of the handoff (outside list markers share their box's tag
     * with the content run and would collide, and their layouts are trivial).
     */
    Tag runTag{0};

    bool operator==(const TextRun &other) const
    {
      return attributedString == other.attributedString && frame == other.frame &&
          documentOrder == other.documentOrder && runTag == other.runTag;
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
   * the previously computed runs. The runs reach the Java layer through
   * `getMapBuffer`, not through this dynamic payload.
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
   * Serializes the text runs to a MapBuffer for the Android mounting layer to
   * paint. Top level:
   *   0 -> list of run MapBuffers.
   * Each run:
   *   0 attributedString (standard AttributedString MapBuffer, consumed by
   *     TextLayoutManager.getOrCreateSpannableForText),
   *   1..4 frame left/top/width/height in dips,
   *   5 documentOrder (paint order relative to mounted child views).
   */
  MapBuffer getMapBuffer() const;
#endif
};

} // namespace facebook::react
