/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <limits>
#include <optional>

#include <react/renderer/attributedstring/TextAttributes.h>
#include <react/renderer/attributedstring/primitives.h>
#include <react/renderer/core/LayoutConstraints.h>

namespace facebook::react {

/*
 * The constraints text is laid out under, given its `white-space`.
 *
 * `pre` and `nowrap` do not wrap (css-text-3 §3), so the line breaker must be
 * given unbounded width — otherwise a long line silently folds and the
 * preserved whitespace is the only half of `pre` that works. The resulting box
 * is wider than its container, which is exactly what the web does: a `<pre>`
 * overflows rather than reflows.
 *
 * Shared because every pass that lays the same text out has to agree. It is
 * not enough for the pass that MEASURES a run to widen its constraints: the
 * pass that places the atomic inlines inside it, and the paragraph's own
 * measure, ask the line breaker the same question and must not get a different
 * answer. One container reporting a single line while the elements inside it
 * sat on three is what two copies of this rule produced.
 */
inline LayoutConstraints constraintsForWhiteSpace(
    const std::optional<WhiteSpace>& whiteSpace,
    const LayoutConstraints& layoutConstraints) {
  if (wrapsText(whiteSpace.value_or(WhiteSpace::Normal))) {
    return layoutConstraints;
  }
  auto unwrapped = layoutConstraints;
  unwrapped.maximumSize.width = std::numeric_limits<Float>::infinity();
  return unwrapped;
}

} // namespace facebook::react
