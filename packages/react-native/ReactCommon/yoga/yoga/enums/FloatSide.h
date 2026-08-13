/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <cstdint>
#include <yoga/enums/YogaEnums.h>

namespace facebook::yoga {

/**
 * CSS `float` (CSS2 §9.5) for block formatting contexts — see
 * `calculateBlockLayout` in algorithm/CalculateLayout.cpp.
 *
 * Deliberately yoga-internal (no `YGFloat` in the public C enum surface):
 * floats only have meaning inside `Display::Block`, which is itself
 * flag-gated on the React Native side, so exposing them through the stable C
 * API would commit to them before the block algorithm is finished. Named
 * `FloatSide` rather than `Float` because `Float` is already yoga's scalar
 * type alias.
 */
enum class FloatSide : uint8_t {
  None,
  Left,
  Right,
  // The logical sides survive parsing rather than being flattened to physical
  // ones there, because the resolved direction is a LAYOUT result and it
  // inherits — a float's own props cannot know it. They are resolved where
  // the direction is in hand, in `calculateBlockLayout`.
  InlineStart,
  InlineEnd,
};

template <>
constexpr int32_t ordinalCount<FloatSide>() {
  return 5;
}

inline const char* toString(FloatSide e) {
  switch (e) {
    case FloatSide::None:
      return "none";
    case FloatSide::Left:
      return "left";
    case FloatSide::Right:
      return "right";
    case FloatSide::InlineStart:
      return "inline-start";
    case FloatSide::InlineEnd:
      return "inline-end";
  }
  return "unknown";
}

/**
 * CSS `clear` (CSS2 §9.5.2): which float edges a box must clear before it is
 * placed.
 */
enum class Clear : uint8_t {
  None,
  Left,
  Right,
  Both,
  // Logical, for the same reason as `FloatSide` above.
  InlineStart,
  InlineEnd,
};

template <>
constexpr int32_t ordinalCount<Clear>() {
  return 6;
}

inline const char* toString(Clear e) {
  switch (e) {
    case Clear::None:
      return "none";
    case Clear::Left:
      return "left";
    case Clear::Right:
      return "right";
    case Clear::Both:
      return "both";
    case Clear::InlineStart:
      return "inline-start";
    case Clear::InlineEnd:
      return "inline-end";
  }
  return "unknown";
}

} // namespace facebook::yoga
