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
 * Intrinsic inline text tags (<b>, <i>, <span>): thin virtual text elements
 * with baked-in attribute defaults (text-children-plan.md §3.C). All are
 * instances of the inline text element class (TextShadowNode); explicit
 * styles still override the defaults.
 */

extern const char UnknownElementComponentName[];
extern const char BTagComponentName[];
extern const char ITagComponentName[];
extern const char SpanTagComponentName[];
extern const char UTagComponentName[];

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

class BTagProps final : public InlineTagProps {
 public:
  BTagProps()
  {
    textAttributes.fontWeight = FontWeight::Bold;
  }
  BTagProps(const PropsParserContext &context, const BTagProps &sourceProps, const RawProps &rawProps)
      : InlineTagProps(context, sourceProps, rawProps)
  {
    if (!textAttributes.fontWeight.has_value()) {
      textAttributes.fontWeight = FontWeight::Bold;
    }
  }
};

class ITagProps final : public InlineTagProps {
 public:
  ITagProps()
  {
    textAttributes.fontStyle = FontStyle::Italic;
  }
  ITagProps(const PropsParserContext &context, const ITagProps &sourceProps, const RawProps &rawProps)
      : InlineTagProps(context, sourceProps, rawProps)
  {
    if (!textAttributes.fontStyle.has_value()) {
      textAttributes.fontStyle = FontStyle::Italic;
    }
  }
};

/*
 * <u>: underline. A fresh intrinsic used to prove the lazy on-demand registration seam end-to-end —
 * it is registered ONLY via OnDemandComponentDescriptorProviders (never eagerly), so if <u> renders
 * underlined the lazy path works.
 */
class UTagProps final : public InlineTagProps {
 public:
  UTagProps()
  {
    textAttributes.textDecorationLineType = TextDecorationLineType::Underline;
  }
  UTagProps(const PropsParserContext &context, const UTagProps &sourceProps, const RawProps &rawProps)
      : InlineTagProps(context, sourceProps, rawProps)
  {
    if (!textAttributes.textDecorationLineType.has_value()) {
      textAttributes.textDecorationLineType = TextDecorationLineType::Underline;
    }
  }
};

class BTagShadowNode final : public ConcreteShadowNode<BTagComponentName, TextShadowNode, BTagProps, TextEventEmitter> {
 public:
  using ConcreteShadowNode::ConcreteShadowNode;
};

class UTagShadowNode final : public ConcreteShadowNode<UTagComponentName, TextShadowNode, UTagProps, TextEventEmitter> {
 public:
  using ConcreteShadowNode::ConcreteShadowNode;
};

class ITagShadowNode final : public ConcreteShadowNode<ITagComponentName, TextShadowNode, ITagProps, TextEventEmitter> {
 public:
  using ConcreteShadowNode::ConcreteShadowNode;
};

class SpanTagShadowNode final
    : public ConcreteShadowNode<SpanTagComponentName, TextShadowNode, InlineTagProps, TextEventEmitter> {
 public:
  using ConcreteShadowNode::ConcreteShadowNode;
};

/*
 * Props for unknown elements. Carries the authored lowercase tag name so DOM
 * APIs can report it (HTMLUnknownElement keeps its tag). The raw tag is lost at
 * the JS boundary — every unknown tag shares the singleton "unknown" view
 * config — so `createInstance` injects it as the `nodeName` prop, the only
 * per-instance channel (text-children-plan.md §3.C; next-steps T2).
 */
class UnknownElementProps final : public InlineTagProps {
 public:
  using InlineTagProps::InlineTagProps;
};

/*
 * DOM semantics for unknown elements (HTMLUnknownElement): inline, unstyled,
 * content renders — i.e. a span. Unregistered lowercase JSX tags resolve here
 * via the JS view-config fallback.
 */
class UnknownElementShadowNode final
    : public ConcreteShadowNode<UnknownElementComponentName, TextShadowNode, UnknownElementProps, TextEventEmitter> {
 public:
  using ConcreteShadowNode::ConcreteShadowNode;
};

using UnknownElementComponentDescriptor = ConcreteComponentDescriptor<UnknownElementShadowNode>;
using UTagComponentDescriptor = ConcreteComponentDescriptor<UTagShadowNode>;
using BTagComponentDescriptor = ConcreteComponentDescriptor<BTagShadowNode>;
using ITagComponentDescriptor = ConcreteComponentDescriptor<ITagShadowNode>;
using SpanTagComponentDescriptor = ConcreteComponentDescriptor<SpanTagShadowNode>;

} // namespace facebook::react
