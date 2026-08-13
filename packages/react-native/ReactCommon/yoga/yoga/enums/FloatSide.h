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
};

template <>
constexpr int32_t ordinalCount<FloatSide>() {
  return 3;
}

inline const char* toString(FloatSide e) {
  switch (e) {
    case FloatSide::None:
      return "none";
    case FloatSide::Left:
      return "left";
    case FloatSide::Right:
      return "right";
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
};

template <>
constexpr int32_t ordinalCount<Clear>() {
  return 4;
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
  }
  return "unknown";
}

} // namespace facebook::yoga
