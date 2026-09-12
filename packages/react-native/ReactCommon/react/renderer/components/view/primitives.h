/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/graphics/Color.h>
#include <react/renderer/graphics/RectangleCorners.h>
#include <react/renderer/graphics/RectangleEdges.h>
#include <react/renderer/graphics/ValueUnit.h>

#include <array>
#include <bitset>
#include <cmath>
#include <limits>
#include <optional>

namespace facebook::react {

enum class PointerEventsMode : uint8_t { Auto, None, BoxNone, BoxOnly };

struct ViewEvents {
  std::bitset<64> bits{};

  enum class Offset : std::size_t {
    // Pointer events
    PointerEnter = 0,
    PointerMove = 1,
    PointerLeave = 2,

    // PanResponder callbacks
    MoveShouldSetResponder = 3,
    MoveShouldSetResponderCapture = 4,
    StartShouldSetResponder = 5,
    StartShouldSetResponderCapture = 6,
    ResponderGrant = 7,
    ResponderReject = 8,
    ResponderStart = 9,
    ResponderEnd = 10,
    ResponderRelease = 11,
    ResponderMove = 12,
    ResponderTerminate = 13,
    ResponderTerminationRequest = 14,
    ShouldBlockNativeResponder = 15,

    // Touch events
    TouchStart = 16,
    TouchMove = 17,
    TouchEnd = 18,
    TouchCancel = 19,

    // W3C Pointer Events
    PointerEnterCapture = 23,
    PointerLeaveCapture = 24,
    PointerMoveCapture = 25,
    PointerOver = 26,
    PointerOut = 27,
    PointerOverCapture = 28,
    PointerOutCapture = 29,
    Click = 30,
    ClickCapture = 31,
    GotPointerCapture = 32,
    LostPointerCapture = 33,
    PointerDown = 34,
    PointerDownCapture = 35,
    PointerUp = 36,
    PointerUpCapture = 37,
  };

  constexpr bool operator[](const Offset offset) const
  {
    return bits[static_cast<std::size_t>(offset)];
  }

  std::bitset<64>::reference operator[](const Offset offset)
  {
    return bits[static_cast<std::size_t>(offset)];
  }
};

inline static bool operator==(const ViewEvents &lhs, const ViewEvents &rhs)
{
  return lhs.bits == rhs.bits;
}

enum class BackfaceVisibility : uint8_t { Auto, Visible, Hidden };

enum class BorderCurve : uint8_t { Circular, Continuous };

/**
 * `corner-shape`, held as the SPEC'S OWN parameter.
 *
 * CSS Borders 4 gives every keyword an equivalent: `round` is
 * `superellipse(1)`, `squircle` is `superellipse(2)`, `bevel` is
 * `superellipse(0)`, `scoop` is `superellipse(-1)`, `notch` is
 * `superellipse(-infinity)` and `square` is `superellipse(infinity)`. So one
 * number says all of them and there is no enumeration to keep in step with the
 * spec.
 *
 * The classic superellipse exponent is `n = 2^k`: `round` is `n = 2`, the
 * circle; `squircle` is `n = 4`; `bevel` is `n = 1`, a straight cut; and the
 * negative side is `n < 1`, which is concave.
 *
 * `border-radius` still says how BIG the corner is. This says what curve it is.
 */
struct CornerShape {
  Float k{1};

  bool isRound() const
  {
    return k == 1;
  }
  bool isSquircle() const
  {
    return k == 2;
  }
  /** The classic exponent, for anything that has to draw the curve itself. */
  Float exponent() const
  {
    if (k == std::numeric_limits<Float>::infinity()) {
      return std::numeric_limits<Float>::infinity();
    }
    if (k == -std::numeric_limits<Float>::infinity()) {
      return 0;
    }
    return std::pow(Float{2}, k);
  }
};

constexpr bool operator==(const CornerShape &lhs, const CornerShape &rhs)
{
  return lhs.k == rhs.k;
}

constexpr bool operator!=(const CornerShape &lhs, const CornerShape &rhs)
{
  return !(lhs == rhs);
}

enum class BorderStyle : uint8_t { Solid, Dotted, Dashed };

enum class OutlineStyle : uint8_t { Solid, Dotted, Dashed };

struct CornerRadii {
  float vertical{0.0f};
  float horizontal{0.0f};

  bool operator==(const CornerRadii &other) const = default;
};

/*
 * `user-select` (css-ui-4 §5.1). On a View this says whether the text the View
 * paints itself — its anonymous runs — can be selected and copied. `<Text>`
 * never sees this value: Text.js maps it onto the `selectable` prop and
 * removes it from the style, which is the behaviour that already shipped.
 *
 * `Auto` is NOT the web's auto. On the web text is selectable everywhere
 * unless something says otherwise; in React Native nothing has ever been
 * selectable unless it asked to be, and flipping that under an existing app
 * is not a change this feature gets to make. So `Auto` means "not
 * selectable", exactly as `<Text>` without `selectable` behaves, and `Text`
 * / `All` / `Contain` opt in. Recorded as a deviation in
 * dom-css-limitations.md.
 */
enum class UserSelect : uint8_t {
  Auto,
  Text,
  None,
  Contain,
  All,
};

/*
 * Whether this value asks for the text to be selectable. See the note above
 * on why `Auto` does not.
 */
inline bool selectsText(UserSelect userSelect)
{
  return userSelect == UserSelect::Text || userSelect == UserSelect::Contain || userSelect == UserSelect::All;
}

enum class Cursor : uint8_t {
  Auto,
  Alias,
  AllScroll,
  Cell,
  ColResize,
  ContextMenu,
  Copy,
  Crosshair,
  Default,
  EResize,
  EWResize,
  Grab,
  Grabbing,
  Help,
  Move,
  NEResize,
  NESWResize,
  NResize,
  NSResize,
  NWResize,
  NWSEResize,
  NoDrop,
  None,
  NotAllowed,
  Pointer,
  Progress,
  RowResize,
  SResize,
  SEResize,
  SWResize,
  Text,
  Url,
  WResize,
  Wait,
  ZoomIn,
  ZoomOut,
};

enum class LayoutConformance : uint8_t { Strict, Compatibility };

template <typename T>
struct CascadedRectangleEdges {
  using Counterpart = RectangleEdges<T>;
  using OptionalT = std::optional<T>;

  OptionalT left{};
  OptionalT top{};
  OptionalT right{};
  OptionalT bottom{};
  OptionalT start{};
  OptionalT end{};
  OptionalT horizontal{};
  OptionalT vertical{};
  OptionalT all{};
  OptionalT block{};
  OptionalT blockStart{};
  OptionalT blockEnd{};

  Counterpart resolve(bool isRTL, T defaults) const
  {
    const auto leadingEdge = isRTL ? end : start;
    const auto trailingEdge = isRTL ? start : end;
    const auto horizontalOrAllOrDefault = horizontal.value_or(all.value_or(defaults));
    const auto verticalOrAllOrDefault = vertical.value_or(all.value_or(defaults));

    return {
        /* .left = */
        left.value_or(leadingEdge.value_or(horizontalOrAllOrDefault)),
        /* .top = */
        blockStart.value_or(block.value_or(top.value_or(verticalOrAllOrDefault))),
        /* .right = */
        right.value_or(trailingEdge.value_or(horizontalOrAllOrDefault)),
        /* .bottom = */
        blockEnd.value_or(block.value_or(bottom.value_or(verticalOrAllOrDefault))),
    };
  }

  bool operator==(const CascadedRectangleEdges<T> &rhs) const = default;
};

template <typename T>
struct CascadedRectangleCorners {
  using Counterpart = RectangleCorners<T>;
  using OptionalT = std::optional<T>;

  OptionalT topLeft{};
  OptionalT topRight{};
  OptionalT bottomLeft{};
  OptionalT bottomRight{};
  OptionalT topStart{};
  OptionalT topEnd{};
  OptionalT bottomStart{};
  OptionalT bottomEnd{};
  OptionalT all{};
  OptionalT endEnd{};
  OptionalT endStart{};
  OptionalT startEnd{};
  OptionalT startStart{};

  Counterpart resolve(bool isRTL, T defaults) const
  {
    const auto logicalTopStart = topStart ? topStart : startStart;
    const auto logicalTopEnd = topEnd ? topEnd : startEnd;
    const auto logicalBottomStart = bottomStart ? bottomStart : endStart;
    const auto logicalBottomEnd = bottomEnd ? bottomEnd : endEnd;

    const auto topLeading = isRTL ? logicalTopEnd : logicalTopStart;
    const auto topTrailing = isRTL ? logicalTopStart : logicalTopEnd;
    const auto bottomLeading = isRTL ? logicalBottomEnd : logicalBottomStart;
    const auto bottomTrailing = isRTL ? logicalBottomStart : logicalBottomEnd;

    return {
        /* .topLeft = */ topLeft.value_or(topLeading.value_or(all.value_or(defaults))),
        /* .topRight = */
        topRight.value_or(topTrailing.value_or(all.value_or(defaults))),
        /* .bottomLeft = */
        bottomLeft.value_or(bottomLeading.value_or(all.value_or(defaults))),
        /* .bottomRight = */
        bottomRight.value_or(bottomTrailing.value_or(all.value_or(defaults))),
    };
  }

  bool operator==(const CascadedRectangleCorners<T> &rhs) const = default;
};

using BorderWidths = RectangleEdges<Float>;
using BorderCurves = RectangleCorners<BorderCurve>;
using CornerShapes = RectangleCorners<CornerShape>;
using BorderStyles = RectangleEdges<BorderStyle>;
using BorderColors = RectangleEdges<SharedColor>;
using BorderRadii = RectangleCorners<CornerRadii>;

using CascadedBorderWidths = CascadedRectangleEdges<Float>;
using CascadedBorderCurves = CascadedRectangleCorners<BorderCurve>;
using CascadedCornerShapes = CascadedRectangleCorners<CornerShape>;
using CascadedBorderStyles = CascadedRectangleEdges<BorderStyle>;
using CascadedBorderColors = CascadedRectangleEdges<SharedColor>;
using CascadedBorderRadii = CascadedRectangleCorners<ValueUnit>;

struct BorderMetrics {
  BorderColors borderColors{};
  BorderWidths borderWidths{};
  BorderRadii borderRadii{};
  BorderCurves borderCurves{};
  /**
   * `corner-shape`, resolved per corner. `round` unless an author said
   * otherwise, which is the CSS initial value.
   */
  CornerShapes cornerShapes{};
  BorderStyles borderStyles{};

  bool operator==(const BorderMetrics &rhs) const = default;
};

inline bool areBorderRadiiCircular(const BorderRadii &borderRadii)
{
  return borderRadii.isUniform() && borderRadii.topLeft.horizontal == borderRadii.topLeft.vertical;
}

} // namespace facebook::react
