/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <optional>
#include <react/renderer/core/LayoutPrimitives.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/graphics/Color.h>
#include <react/renderer/attributedstring/InlineBoxDecorations.h>

namespace facebook::react {

/**
 * CSS box decorations on an *inline* element (`<b>`, `<span>`, a nested
 * `<Text>`) — box-model-scope.md G2.
 *
 * Inline elements previously had nowhere to put these: `TextProps` derives
 * from `Props` and `BaseTextProps`, not `ViewProps`, so `padding` and
 * `borderWidth` were unparsable rather than merely unhandled. This is the
 * deliberately focused prop set from that scope's option (a) — it keeps
 * authored `<Text>`'s surface honest rather than implying the whole of
 * `ViewProps` is supported.
 *
 * Background colour is intentionally absent: `TextAttributes::backgroundColor`
 * already paints behind an inline element's glyphs, which is the CSS inline
 * background.
 *
 * Layout semantics (CSS2 §10.6.1 / §8.4), for the consumers of this data:
 *  - **Inline-axis** margin/border/padding add to the advance at the
 *    element's leading and trailing edges.
 *  - **Block-axis** padding/border paint but do NOT change line height, and
 *    block-axis margins have no effect on an inline box at all.
 */
/**
 * The parsed form: the decorations resolved for BOTH inline directions.
 *
 * `start` / `end` / `inline-start` / `inline-end` name the edges of the
 * inline axis, so which physical edge each one is depends on the resolved
 * direction — and props are parsed long before Yoga resolves one. Rather
 * than carry the authored logical values around and re-derive the physical
 * ones at every consumer, both resolutions are computed once here, where all
 * the names are already being read, and `resolve()` picks.
 *
 * Only margin and padding can differ: border in React Native has no logical
 * shorthands (`borderLeftWidth`, never `borderInlineStartWidth`), and the
 * block axis is direction-independent. So the second resolution is four
 * numbers, not a second copy of the struct.
 */
struct InlineBoxProps {
  InlineBoxDecorations ltr{};

  /** `margin` / `padding` inline-axis edges when the direction is RTL. */
  Float rtlMarginLeft{0};
  Float rtlMarginRight{0};
  Float rtlPaddingLeft{0};
  Float rtlPaddingRight{0};

  InlineBoxDecorations resolve(
      std::optional<LayoutDirection> layoutDirection) const {
    if (layoutDirection != LayoutDirection::RightToLeft) {
      return ltr;
    }
    auto resolved = ltr;
    resolved.margin.left = rtlMarginLeft;
    resolved.margin.right = rtlMarginRight;
    resolved.padding.left = rtlPaddingLeft;
    resolved.padding.right = rtlPaddingRight;
    return resolved;
  }

  /*
   * Emptiness is direction-independent: an edge that is zero under one
   * direction is the same edge under the other, just on the opposite side.
   */
  bool isEmpty() const {
    return ltr.isEmpty();
  }

  bool operator==(const InlineBoxProps &rhs) const = default;
};

/*
 * Parses the inline box decorations from raw props. Absent props keep
 * `sourceProps`' values, matching how every other prop group clones.
 */
InlineBoxProps parseInlineBoxProps(
    const PropsParserContext &context,
    const InlineBoxProps &sourceProps,
    const RawProps &rawProps);

} // namespace facebook::react
