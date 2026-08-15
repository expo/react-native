/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <cstdint>

namespace facebook::yoga {

// https://www.w3.org/TR/css-grid-2/#auto-repeat
//
// `repeat(auto-fill, ...)` and `repeat(auto-fit, ...)` cannot be expanded when
// the style is authored: how many times the pattern repeats depends on the
// size the grid container ends up with. The authored track list therefore
// stores the repeat's pattern ONCE, and this descriptor records where it sits
// so layout can expand it against a real container size.
//
// A track list may contain at most one auto-repeat (css-grid-2 §7.2.3.1),
// which is why a single descriptor per axis is enough.
enum class GridAutoRepeatType : uint8_t {
  None = 0,
  // Repeat as many times as fit without overflowing.
  AutoFill = 1,
  // As auto-fill, but repeated tracks holding no items collapse to zero.
  AutoFit = 2,
};

struct GridAutoRepeat {
  GridAutoRepeatType type{GridAutoRepeatType::None};
  // Index into the authored track list where the repeat pattern begins.
  uint16_t startIndex{0};
  // How many tracks make up the pattern being repeated.
  uint16_t trackCount{0};

  constexpr bool isAuto() const {
    return type != GridAutoRepeatType::None && trackCount > 0;
  }

  bool operator==(const GridAutoRepeat& other) const = default;
};

} // namespace facebook::yoga
