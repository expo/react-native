/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "TextRoleMetrics.h"

#include <react/renderer/attributedstring/conversions.h>

#include <cmath>
#include <limits>

namespace facebook::react {

std::array<std::atomic<Float>, kDynamicTypeRampCount> &
TextRoleMetrics::storage() {
  // Function-local so that the first reader initialises it, whichever thread
  // that is, rather than depending on where this object falls in the static
  // initialisation order of a library the platform publishes into very early.
  // Wrapped in a struct so the NaN fill can happen in a constructor. An atomic
  // is neither copyable nor movable, so the array cannot be built elsewhere and
  // returned, and a default-constructed one holds an indeterminate value rather
  // than a zero — which would read as a legitimate published size of nothing.
  struct Storage {
    std::array<std::atomic<Float>, kDynamicTypeRampCount> sizes;
    Storage() {
      for (auto &slot : sizes) {
        slot.store(
            std::numeric_limits<Float>::quiet_NaN(), std::memory_order_relaxed);
      }
    }
  };
  static Storage storage;
  return storage.sizes;
}

void TextRoleMetrics::publish(DynamicTypeRamp ramp, Float pointSize) {
  // A non-positive or non-finite size is a failed resolution, not a size. Left
  // unpublished rather than stored, so that a caller reading it falls back to
  // the cascade's own font-size instead of computing a margin from zero — a
  // heading whose margins silently collapsed would look like a styling bug
  // several layers away from the platform lookup that actually failed.
  if (!std::isfinite(pointSize) || pointSize <= 0) {
    return;
  }
  storage()[static_cast<size_t>(ramp)].store(
      pointSize, std::memory_order_relaxed);
}

bool TextRoleMetrics::publishByName(
    const std::string &roleName,
    Float pointSize) {
  for (size_t index = 0; index < kDynamicTypeRampCount; index++) {
    const auto ramp = static_cast<DynamicTypeRamp>(index);
    if (toString(ramp) == roleName) {
      publish(ramp, pointSize);
      return true;
    }
  }
  return false;
}

std::optional<Float> TextRoleMetrics::sizeOf(DynamicTypeRamp ramp) {
  const Float size =
      storage()[static_cast<size_t>(ramp)].load(std::memory_order_relaxed);
  if (std::isnan(size)) {
    return std::nullopt;
  }
  return size;
}

void TextRoleMetrics::reset() {
  for (auto &slot : storage()) {
    slot.store(
        std::numeric_limits<Float>::quiet_NaN(), std::memory_order_relaxed);
  }
}

} // namespace facebook::react
