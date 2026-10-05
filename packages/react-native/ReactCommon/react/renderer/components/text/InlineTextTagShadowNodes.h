/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>

#include <react/renderer/components/text/TextShadowNode.h>
#include <react/renderer/components/view/AccessibilityProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/ConcreteShadowNode.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>

namespace facebook::react {

/*
 * The generic inline text backing, and the props every inline element shares.
 *
 * There are no per-tag classes here. <b>'s boldness and <i>'s italics are
 * declarations in a user-agent stylesheet, applied beneath the author's style,
 * so they need a style entry rather than a component — which is what lets a
 * provider define them without any native code.
 */

extern const char InlineTextComponentName[];

/*
 * Base for the intrinsic inline text elements.
 *
 * Carries the authored tag so DOM APIs report it. This matters because several
 * elements are *aliases*: <strong> and <em> render through <b>'s and <i>'s
 * native components, since their rendering is identical. Without this they
 * would report `tagName` as their target — a <strong> identifying as a <b> —
 * which is wrong, and observable to anything doing DOM introspection.
 *
 * The tag is lost at the JS boundary (a view config is per-component, not
 * per-tag), so the reconciler injects it as the `nodeName` prop for configs
 * marked `recordNodeName`. Empty when the element is not an alias, in which
 * case core falls back to the component name — see DOM.cpp's use of
 * NodeNameProvider.
 */
class InlineTagProps : public TextProps, public AccessibilityProps, public NodeNameProvider {
 public:
  InlineTagProps() = default;
  InlineTagProps(const PropsParserContext &context, const InlineTagProps &sourceProps, const RawProps &rawProps)
      : TextProps(context, sourceProps, rawProps),
        AccessibilityProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{}))
  {
  }

  void
  setProp(const PropsParserContext &context, RawPropsPropNameHash hash, const char *propName, const RawValue &value)
  {
    TextProps::setProp(context, hash, propName, value);
    AccessibilityProps::setProp(context, hash, propName, value);
    if (hash == CONSTEXPR_RAW_PROPS_KEY_HASH("nodeName")) {
      fromRawValue(context, value, nodeName);
    }
  }

  std::string domNodeName() const override
  {
    return nodeName;
  }

  std::string nodeName{};
};

class InlineTextProps final : public InlineTagProps {
 public:
  using InlineTagProps::InlineTagProps;
};

/*
 * The generic inline text element. Unstyled, it participates in a text run
 * through TextShadowNode's InlineText trait; a tag that folds into a line of
 * text points its view config here and gets its look from a user-agent style.
 * Unregistered tags resolve here too.
 */
class InlineTextShadowNode final
    : public ConcreteShadowNode<InlineTextComponentName, TextShadowNode, InlineTextProps, TextEventEmitter> {
 public:
  using ConcreteShadowNode::ConcreteShadowNode;
};

using InlineTextComponentDescriptor = ConcreteComponentDescriptor<InlineTextShadowNode>;

} // namespace facebook::react
