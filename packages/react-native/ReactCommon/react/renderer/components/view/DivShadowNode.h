/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/components/view/ViewShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

namespace facebook::react {

// NOLINTNEXTLINE(modernize-avoid-c-arrays)
extern const char DivComponentName[];

/*
 * The intrinsic `<div>` tag: a block-level container with block *inner* display
 * (implicit-text-plan.md §3.C) — the intrinsic analog of a `View` but
 * `display:block` instead of `flex`. `DivProps` is a `ViewProps` with
 * `displayBlock` forced on, so `<div>` shares the View block path (native
 * `YGDisplayBlock` when `enableYogaDisplayBlock` is on, else the flex emulation)
 * and, via `AbstractViewShadowNode`, the exact same anonymous-IFC layout and
 * text-run painting machinery as `<View>`. Block-level (never inline), so a
 * parent's `updateYogaChildren` treats it as a block child.
 */
class DivProps final : public ViewProps {
 public:
  DivProps() : ViewProps() {
    displayBlock = true;
  }
  DivProps(
      const PropsParserContext &context,
      const DivProps &sourceProps,
      const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps) {
    // `<div>` defaults to a block container; an explicit `display` style is a
    // v1 deviation (divs stay block).
    displayBlock = true;
  }
};

/*
 * `ShadowNode` for the intrinsic `<div>` component: `AbstractViewShadowNode`
 * specialized with the `div` name and block-forcing props.
 */
using DivShadowNode = AbstractViewShadowNode<DivComponentName, DivProps>;

using DivComponentDescriptor = ConcreteComponentDescriptor<DivShadowNode>;

} // namespace facebook::react
