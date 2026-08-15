/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <yoga/numeric/Comparison.h>
#include <yoga/style/StyleSizeLength.h>
#include <cstdint>

namespace facebook::yoga {

// https://drafts.csswg.org/css-grid-3/#placement-tolerance
//
//   flow-tolerance: normal | <length-percentage [0,∞]> | infinite
//
// The tie threshold for lane placement. Two candidate positions count as
// equally good when they are within this distance of the shortest one, and
// tied positions fill in document order — which is the whole point: tracks
// differing by a pixel or two do not read as different, so filling them out of
// order looks like a mistake rather than like tidiness.
enum class FlowToleranceKind : uint8_t {
  // Resolves to 1em in grid lanes layout, and to 0 everywhere else.
  Normal = 0,
  Length = 1,
  // Every position is tied, so items distribute strictly in document order.
  Infinite = 2,
};

struct FlowTolerance {
  FlowToleranceKind kind{FlowToleranceKind::Normal};
  // Meaningful only when kind == Length. Percentages resolve against the
  // grid-axis content box size of the container.
  StyleSizeLength length{};

  // What `normal` resolves against. `normal` is 1em, and Yoga has no font
  // model, so the embedder supplies the em size; 16 is the CSS initial
  // font-size and the sensible fallback when nobody says otherwise.
  float emSize{16.0f};

  bool operator==(const FlowTolerance& other) const = default;

  // The threshold in points. `gridAxisSize` is the percentage basis.
  float resolve(float gridAxisSize) const {
    switch (kind) {
      case FlowToleranceKind::Normal:
        return emSize;
      case FlowToleranceKind::Infinite:
        // Large enough that every candidate ties, without being an infinity
        // that would poison the comparisons it takes part in.
        return std::numeric_limits<float>::max();
      case FlowToleranceKind::Length:
        if (length.isPoints()) {
          return length.value().unwrap();
        }
        if (length.isPercent() && yoga::isDefined(gridAxisSize)) {
          return length.value().unwrap() / 100.0f * gridAxisSize;
        }
        return 0.0f;
    }
    return 0.0f;
  }
};

} // namespace facebook::yoga
