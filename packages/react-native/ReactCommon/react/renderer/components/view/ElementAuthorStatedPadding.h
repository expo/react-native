/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/YogaStylableProps.h>

namespace facebook::react {

/*
 * Whether the style states padding on the BLOCK axis, and separately the
 * INLINE axis.
 *
 * Per axis, because a control's own spacing is per axis and so is a style
 * sheet's. On Android the user-agent sheet gives every field
 * `paddingInline: 16` — and a single "any padding?" question read that as the
 * author having taken over the field's spacing, so a textarea reserved no
 * VERTICAL inset and its text sat flush against its top edge. Horizontal
 * padding says nothing about the vertical inset.
 *
 * Asked of PROPS, by everyone. The control (to decide whether to keep its own
 * inset) and layout (to decide whether to reserve room for it) must give the
 * same answer or the box and the text inside it disagree — and the Yoga node's
 * style is not a neutral witness: a node that folds the platform's own padding
 * onto itself would then read its own fold back as the author's. The props
 * hold only what was written, including the logical aliases
 * (`paddingBlock`, `paddingInlineStart`…) that `applyAliasedProps` later folds
 * onto the node.
 *
 * Every spelling of each axis, because a tie between style layers resolves by
 * EDGE: `paddingTop` beats `padding` whatever order they were written in.
 */
inline bool elementStatesBlockPadding(const YogaStylableProps& props)
{
  for (const auto edge : {yoga::Edge::All, yoga::Edge::Vertical, yoga::Edge::Top, yoga::Edge::Bottom}) {
    if (!props.yogaStyle.padding(edge).isUndefined()) {
      return true;
    }
  }
  return props.paddingBlock.isDefined() || props.paddingBlockStart.isDefined() ||
      props.paddingBlockEnd.isDefined();
}

inline bool elementStatesInlinePadding(const YogaStylableProps& props)
{
  for (const auto edge :
       {yoga::Edge::All,
        yoga::Edge::Horizontal,
        yoga::Edge::Left,
        yoga::Edge::Right,
        yoga::Edge::Start,
        yoga::Edge::End}) {
    if (!props.yogaStyle.padding(edge).isUndefined()) {
      return true;
    }
  }
  return props.paddingInline.isDefined() || props.paddingInlineStart.isDefined() ||
      props.paddingInlineEnd.isDefined();
}

} // namespace facebook::react
