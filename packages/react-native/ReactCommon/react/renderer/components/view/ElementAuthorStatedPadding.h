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
 * Whether the style states padding on the block axis, and separately the
 * inline axis, since the user-agent sheet's `paddingInline: 16` says nothing
 * about the vertical inset. Asked of props, by the control and by layout
 * alike, because a node that folds the platform's padding onto itself would
 * read its own fold back as the author's. Every spelling of each axis, since
 * a tie between style layers resolves by edge.
 */
inline bool elementStatesBlockPadding(const YogaStylableProps &props)
{
  for (const auto edge : {yoga::Edge::All, yoga::Edge::Vertical, yoga::Edge::Top, yoga::Edge::Bottom}) {
    if (!props.yogaStyle.padding(edge).isUndefined()) {
      return true;
    }
  }
  return props.paddingBlock.isDefined() || props.paddingBlockStart.isDefined() || props.paddingBlockEnd.isDefined();
}

inline bool elementStatesInlinePadding(const YogaStylableProps &props)
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
  return props.paddingInline.isDefined() || props.paddingInlineStart.isDefined() || props.paddingInlineEnd.isDefined();
}

} // namespace facebook::react
