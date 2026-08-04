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
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>
#include <string>

namespace facebook::react {

// NOLINTNEXTLINE(modernize-avoid-c-arrays)
extern const char DivComponentName[];

/*
 * The intrinsic `<div>` tag: a block-level container with block *inner* display
 * (text-children-plan.md §3.C) — the intrinsic analog of a `View` but
 * `display:block` instead of `flex`. `DivProps` is a `ViewProps` with
 * `displayBlock` forced on, so `<div>` shares the View block path (native
 * `YGDisplayBlock` when `enableYogaDisplayBlock` is on, else the flex emulation)
 * and, via `AbstractViewShadowNode`, the exact same anonymous-IFC layout and
 * text-run painting machinery as `<View>`. Block-level (never inline), so a
 * parent's `updateYogaChildren` treats it as a block child.
 */
class DivProps final : public ViewProps, public NodeNameProvider {
 public:
  DivProps() : ViewProps() {
    displayBlock = true;
  }
  DivProps(
      const PropsParserContext &context,
      const DivProps &sourceProps,
      const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})) {
    // `<div>`'s *default* display is block, exactly as the UA stylesheet says
    // — but a default is not a forced value. An authored `display` wins, so
    // `<div style={{display:'flex'}}>` is a flex container like on the web.
    if (!displayAuthored) {
      displayBlock = true;
    }
  }

  /*
   * Every block-level intrinsic — `<p>`, `<h1>`, `<ul>`, `<li>` — aliases this
   * component, so without this they would all report `div` to anything reading
   * the tag in C++. Empty when rendered without an authored tag, in which case
   * core falls back to the component name.
   */
  std::string domNodeName() const override
  {
    return nodeName;
  }

  std::string nodeName{};
};

/*
 * `ShadowNode` for the intrinsic `<div>` component: `AbstractViewShadowNode`
 * specialized with the `div` name and block-forcing props.
 */
using DivShadowNode = AbstractViewShadowNode<DivComponentName, DivProps>;

using DivComponentDescriptor = ConcreteComponentDescriptor<DivShadowNode>;

} // namespace facebook::react
