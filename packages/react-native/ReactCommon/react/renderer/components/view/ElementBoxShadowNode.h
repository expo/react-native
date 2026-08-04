/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>

#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/components/view/ViewShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>

namespace facebook::react {

extern const char ElementBoxComponentName[];

/*
 * The box-backed flavor of a DOM element: a `View` that honors whatever
 * `display` the author wrote, and reports the authored tag.
 *
 * Box generation follows computed `display`, not the tag
 * (element-model-design.md). An intrinsic element is backed by the light
 * `TextShadowNode` while it folds into an inline formatting context, and by
 * this when its display establishes one. That is the same choice Blink makes
 * in `LayoutObject::CreateObject`, which constructs a different class per
 * computed display rather than one object that morphs.
 *
 * The two flavors are separate *components*, not one component with two node
 * types, and that is load-bearing: a `ComponentDescriptor` derives its props
 * type from a single shadow node, so one component could not have both
 * `TextProps` (344 B) and `ViewProps` (1512 B). Keeping them separate is what
 * lets a folding `<span>` stay cheap while a box-flavored one gets the full
 * View prop surface.
 *
 * Unlike `DivProps` this forces no display of its own: `<div>` is block
 * because that is its UA default, whereas this backs whatever display made the
 * element a box in the first place.
 *
 * Not addressable from JSX. The renderer swaps an element onto this component
 * at instance creation, which is why it carries `nodeName` — the element must
 * still report its own tag (`RN:span`, not `RN:element-box`).
 */
class ElementBoxProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementBoxProps() = default;
  ElementBoxProps(
      const PropsParserContext &context,
      const ElementBoxProps &sourceProps,
      const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})) {}

  // Empty when rendered without an authored tag, in which case core falls back
  // to the component name.
  std::string domNodeName() const override
  {
    return nodeName;
  }

  std::string nodeName{};
};

using ElementBoxShadowNode = AbstractViewShadowNode<ElementBoxComponentName, ElementBoxProps>;
using ElementBoxComponentDescriptor = ConcreteComponentDescriptor<ElementBoxShadowNode>;

} // namespace facebook::react
