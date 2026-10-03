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

} // namespace facebook::react
#endif
