/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/graphics/Color.h>
#include <react/renderer/graphics/Float.h>
#include <react/renderer/graphics/RectangleEdges.h>

namespace facebook::react {

/**
 * CSS box decorations carried by an inline element's fragments, so both
 * measurement and painting can see them (box-model-scope.md G2–G5).
 *
 * Lives in `attributedstring` rather than `components/text` because the
 * text engines consume it while painting; the props that produce it stay in
 * the text component (`parseInlineBoxProps`).
 */
struct InlineBoxDecorations {
  RectangleEdges<Float> margin{};
  RectangleEdges<Float> padding{};
  RectangleEdges<Float> borderWidth{};
  RectangleEdges<SharedColor> borderColor{};
  SharedColor outlineColor{};
  Float outlineWidth{0};
  Float outlineOffset{0};
  Float borderRadius{0};

  bool isEmpty() const
  {
    return margin == RectangleEdges<Float>{} && padding == RectangleEdges<Float>{} &&
        borderWidth == RectangleEdges<Float>{} && outlineWidth == 0 && borderRadius == 0;
  }

  /** Advance at the element's leading edge: margin + border + padding. */
  Float leadingInlineSpace() const
  {
    return margin.left + borderWidth.left + padding.left;
  }

  /** Advance at the element's trailing edge. */
  Float trailingInlineSpace() const
  {
    return margin.right + borderWidth.right + padding.right;
  }

  bool operator==(const InlineBoxDecorations &rhs) const = default;
};

} // namespace facebook::react
