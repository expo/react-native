/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <vector>

#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/components/view/InlineAccessibilityContent.h>
#include <react/renderer/core/ReactPrimitives.h>
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
 * inline formatting contexts. Empty for Views
 * with no bare text content.
 */
class ViewState final {
 public:
  struct TextRun {
    AttributedString attributedString;
    InlineAccessibilityContent accessibilityContent;
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
      return attributedString == other.attributedString && accessibilityContent == other.accessibilityContent &&
          frame == other.frame && documentOrder == other.documentOrder && runTag == other.runTag;
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
   *   5 documentOrder (paint order relative to mounted child views),
   *   6 list of accessibility leaves (`InlineAccessibilityContent`), each:
   *     0 kind, 1 tag, 2 label, 3 role, 4 hint, 5 language, 6 disabled,
   *     7 selected, 8 checked, 9 fragment indices, 10 live region, 11 busy,
   *     12 expanded (0 unset, 1 collapsed, 2 expanded), 13..15 value
   *     min/max/now and 16 value text when set, 17 actions (0 name, 1 label),
   *     18 attachment tags the leaf presents,
   *   7 tags of every inline attachment the run lays out.
   *     Both read by ReactViewManager.readInlineAccessibilityItems.
   */
  MapBuffer getMapBuffer() const
  {
    std::vector<MapBuffer> runs;
    runs.reserve(textRuns.size());
    for (const auto &run : textRuns) {
      auto runBuilder = MapBufferBuilder();
      // Serialized with the same run tag the measurement path used, so the
      // mount-side handoff check can compare the two buffers byte-for-byte.
      runBuilder.putMapBuffer(0, toMapBuffer(run.attributedString, run.runTag));
      runBuilder.putDouble(1, run.frame.origin.x);
      runBuilder.putDouble(2, run.frame.origin.y);
      runBuilder.putDouble(3, run.frame.size.width);
      runBuilder.putDouble(4, run.frame.size.height);
      runBuilder.putInt(5, run.documentOrder);
      std::vector<MapBuffer> accessibilityElements;
      accessibilityElements.reserve(run.accessibilityContent.elements.size());
      for (const auto &element : run.accessibilityContent.elements) {
        auto elementBuilder = MapBufferBuilder();
        elementBuilder.putInt(0, static_cast<int>(element.kind));
        elementBuilder.putInt(1, element.tag);
        elementBuilder.putString(2, element.label);
        elementBuilder.putString(3, element.role);
        elementBuilder.putString(4, element.hint);
        elementBuilder.putString(5, element.language);
        elementBuilder.putBool(6, element.disabled);
        // `selected` is tri-state upstream; an unstated selection reads as not selected
        elementBuilder.putBool(7, element.state.selected.value_or(false));
        elementBuilder.putInt(8, static_cast<int>(element.state.checked));
        std::vector<int> fragmentIndices;
        fragmentIndices.reserve(element.fragmentIndices.size());
        for (const auto fragmentIndex : element.fragmentIndices) {
          fragmentIndices.push_back(static_cast<int>(fragmentIndex));
        }
        elementBuilder.putIntBuffer(9, fragmentIndices);
        elementBuilder.putInt(10, static_cast<int>(element.liveRegion));
        elementBuilder.putBool(11, element.state.busy);
        elementBuilder.putInt(12, element.state.expanded.has_value() ? (*element.state.expanded ? 2 : 1) : 0);
        if (element.value.min.has_value()) {
          elementBuilder.putInt(13, *element.value.min);
        }
        if (element.value.max.has_value()) {
          elementBuilder.putInt(14, *element.value.max);
        }
        if (element.value.now.has_value()) {
          elementBuilder.putInt(15, *element.value.now);
        }
        if (element.value.text.has_value()) {
          elementBuilder.putString(16, *element.value.text);
        }
        std::vector<MapBuffer> actions;
        actions.reserve(element.actions.size());
        for (const auto &action : element.actions) {
          auto actionBuilder = MapBufferBuilder();
          actionBuilder.putString(0, action.name);
          actionBuilder.putString(1, action.label.value_or(action.name));
          actions.push_back(actionBuilder.build());
        }
        elementBuilder.putMapBufferList(17, actions);
        elementBuilder.putIntBuffer(18, std::vector<int>(element.attachmentTags.begin(), element.attachmentTags.end()));
        accessibilityElements.push_back(elementBuilder.build());
      }
      runBuilder.putMapBufferList(6, accessibilityElements);
      runBuilder.putIntBuffer(
          7,
          std::vector<int>(
              run.accessibilityContent.attachmentTags.begin(), run.accessibilityContent.attachmentTags.end()));
      runs.push_back(runBuilder.build());
    }
    auto builder = MapBufferBuilder();
    builder.putMapBufferList(0, runs);
    return builder.build();
  }
#endif
};

} // namespace facebook::react
