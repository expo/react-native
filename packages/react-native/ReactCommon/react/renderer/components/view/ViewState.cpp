/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "ViewState.h"

#ifdef RN_SERIALIZABLE_STATE
#include <react/renderer/attributedstring/conversions.h>
#include <react/renderer/mapbuffer/MapBufferBuilder.h>

namespace facebook::react {

MapBuffer ViewState::getMapBuffer() const {
  std::vector<MapBuffer> runs;
  runs.reserve(textRuns.size());
  for (const auto& run : textRuns) {
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
    for (const auto& element : run.accessibilityContent.elements) {
      auto elementBuilder = MapBufferBuilder();
      elementBuilder.putInt(0, static_cast<int>(element.kind));
      elementBuilder.putInt(1, element.tag);
      elementBuilder.putString(2, element.label);
      elementBuilder.putString(3, element.role);
      elementBuilder.putString(4, element.hint);
      elementBuilder.putString(5, element.language);
      elementBuilder.putBool(6, element.disabled);
      // `selected` is tri-state upstream; an unstated selection reads as not
      // selected
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
      elementBuilder.putInt(
          12,
          element.state.expanded.has_value() ? (*element.state.expanded ? 2 : 1)
                                             : 0);
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
      for (const auto& action : element.actions) {
        auto actionBuilder = MapBufferBuilder();
        actionBuilder.putString(0, action.name);
        actionBuilder.putString(1, action.label.value_or(action.name));
        actions.push_back(actionBuilder.build());
      }
      elementBuilder.putMapBufferList(17, actions);
      elementBuilder.putIntBuffer(
          18,
          std::vector<int>(
              element.attachmentTags.begin(), element.attachmentTags.end()));
      accessibilityElements.push_back(elementBuilder.build());
    }
    runBuilder.putMapBufferList(6, accessibilityElements);
    runBuilder.putIntBuffer(
        7,
        std::vector<int>(
            run.accessibilityContent.attachmentTags.begin(),
            run.accessibilityContent.attachmentTags.end()));
    runs.push_back(runBuilder.build());
  }
  auto builder = MapBufferBuilder();
  builder.putMapBufferList(0, runs);
  if (dynamicRangeLimit.has_value()) {
    builder.putInt(
        VS_KEY_DYNAMIC_RANGE_LIMIT, static_cast<int32_t>(*dynamicRangeLimit));
  }
  return builder.build();
}

} // namespace facebook::react
#endif
