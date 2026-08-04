/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

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
using InlineBoxProps = InlineBoxDecorations;

/*
 * Parses the inline box decorations from raw props. Absent props keep
 * `sourceProps`' values, matching how every other prop group clones.
 */
InlineBoxProps parseInlineBoxProps(
    const PropsParserContext &context,
    const InlineBoxProps &sourceProps,
    const RawProps &rawProps);

} // namespace facebook::react
