/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>

#include <react/renderer/components/text/TextShadowNode.h>
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
class InlineTagProps : public TextProps, public NodeNameProvider {
 public:
  InlineTagProps() = default;
  InlineTagProps(
      const PropsParserContext &context,
      const InlineTagProps &sourceProps,
      const RawProps &rawProps)
      : TextProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})) {}

  std::string domNodeName() const override
  {
    return nodeName;
  }

  std::string nodeName{};
};

/*
 * <u>: underline. A fresh intrinsic used to prove the lazy on-demand registration seam end-to-end —
 * it is registered ONLY via OnDemandComponentDescriptorProviders (never eagerly), so if <u> renders
 * underlined the lazy path works.
 */
/*
 * Props for the generic inline text element. Carries the authored tag so DOM
 * APIs report it: many elements share this one component, so the tag is lost at
 * the JS boundary unless the reconciler injects it as `nodeName`, which is the
 * only per-instance channel (text-children-plan.md §3.C; next-steps T2).
 */
class InlineTextProps final : public InlineTagProps {
 public:
  using InlineTagProps::InlineTagProps;
};

/*
 * THE GENERIC INLINE TEXT BACKING — one of the two components react-native
 * offers anyone defining elements, the other being the generic box
 * (`element-box`). Inline, unstyled, renders its content, and participates in a
 * text run because TextShadowNode carries the InlineText trait.
 *
 * An element that folds into a line of text points its view config here and
 * needs no native code of its own: what makes it a `<span>`, a `<cite>` or a
 * `<button>` is its tag name and its user-agent style. It is also where the DOM
 * policy sends unregistered tags, which is what it used to be named after — but
 * that is one caller, not the contract.
 */
class InlineTextShadowNode final
    : public ConcreteShadowNode<InlineTextComponentName, TextShadowNode, InlineTextProps, TextEventEmitter> {
 public:
  using ConcreteShadowNode::ConcreteShadowNode;
};

using InlineTextComponentDescriptor = ConcreteComponentDescriptor<InlineTextShadowNode>;

} // namespace facebook::react
