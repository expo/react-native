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
 * It forces no display of its own. An element is block because its user-agent
 * style says so, not because of the component backing it — which is what lets a
 * block element be defined without a C++ class, by anyone.
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
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})),
        listStyleTypeValue(
            convertRawProp(context, rawProps, "listStyleType", sourceProps.listStyleTypeValue, std::string{})),
        listStylePositionValue(
            convertRawProp(context, rawProps, "listStylePosition", sourceProps.listStylePositionValue, std::string{})),
        start(convertRawProp(context, rawProps, "start", sourceProps.start, 1)) {}

  // Empty when rendered without an authored tag, in which case core falls back
  // to the component name.
  std::string domNodeName() const override
  {
    return nodeName;
  }

  std::string nodeName{};

  /*
   * List properties. `list-style-type` and `list-style-position` are style
   * properties and `<ol start>` an HTML attribute, but all three live on the
   * props because markers are generated during layout, which reads them from
   * the shadow node rather than from a stylesheet.
   *
   * They sit on the generic box because a list container IS one: whichever
   * element a provider names `ul`, it is a box whose user-agent style says
   * `display: block`. An empty `listStyleTypeValue` means the container takes
   * the user-agent default for its nesting depth; an empty position means
   * `outside`.
   */
  std::string listStyleTypeValue{};
  std::string listStylePositionValue{};
  int start{1};
};

using ElementBoxShadowNode = AbstractViewShadowNode<ElementBoxComponentName, ElementBoxProps>;
using ElementBoxComponentDescriptor = ConcreteComponentDescriptor<ElementBoxShadowNode>;

} // namespace facebook::react
