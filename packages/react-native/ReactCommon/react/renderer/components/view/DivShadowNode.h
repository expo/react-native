/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/components/view/ViewState.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

namespace facebook::react {

// NOLINTNEXTLINE(modernize-avoid-c-arrays)
extern const char DivComponentName[];

/*
 * The intrinsic `<div>` tag: a block-level container with block *inner* display
 * (implicit-text-plan.md §3.C) — the intrinsic analog of a `View` but
 * `display:block` instead of `flex`. It is a `View` with `displayBlock` forced
 * on, so it shares the View block path (native `YGDisplayBlock` when
 * `enableYogaDisplayBlock` is on, else the flex emulation) and the shared
 * anonymous-IFC machinery. Block-level (never inline), so a parent's
 * `updateYogaChildren` treats it as a block child.
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

class DivShadowNode final
    : public ConcreteViewShadowNode<DivComponentName, DivProps, ViewEventEmitter, ViewState> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;
};

using DivComponentDescriptor = ConcreteComponentDescriptor<DivShadowNode>;

} // namespace facebook::react
