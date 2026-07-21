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

namespace facebook::react {

/*
 * Intrinsic inline text tags (<b>, <i>, <span>): thin virtual text elements
 * with baked-in attribute defaults (implicit-text-plan.md §3.C). All are
 * instances of the inline text element class (TextShadowNode); explicit
 * styles still override the defaults.
 */

extern const char UnknownElementComponentName[];
extern const char BTagComponentName[];
extern const char ITagComponentName[];
extern const char SpanTagComponentName[];

class BTagProps final : public TextProps {
 public:
  BTagProps()
  {
    textAttributes.fontWeight = FontWeight::Bold;
  }
  BTagProps(const PropsParserContext &context, const BTagProps &sourceProps, const RawProps &rawProps)
      : TextProps(context, sourceProps, rawProps)
  {
    if (!textAttributes.fontWeight.has_value()) {
      textAttributes.fontWeight = FontWeight::Bold;
    }
  }
};

class ITagProps final : public TextProps {
 public:
  ITagProps()
  {
    textAttributes.fontStyle = FontStyle::Italic;
  }
  ITagProps(const PropsParserContext &context, const ITagProps &sourceProps, const RawProps &rawProps)
      : TextProps(context, sourceProps, rawProps)
  {
    if (!textAttributes.fontStyle.has_value()) {
      textAttributes.fontStyle = FontStyle::Italic;
    }
  }
};

class BTagShadowNode final : public ConcreteShadowNode<BTagComponentName, TextShadowNode, BTagProps, TextEventEmitter> {
 public:
  using ConcreteShadowNode::ConcreteShadowNode;
};

class ITagShadowNode final : public ConcreteShadowNode<ITagComponentName, TextShadowNode, ITagProps, TextEventEmitter> {
 public:
  using ConcreteShadowNode::ConcreteShadowNode;
};

class SpanTagShadowNode final
    : public ConcreteShadowNode<SpanTagComponentName, TextShadowNode, TextProps, TextEventEmitter> {
 public:
  using ConcreteShadowNode::ConcreteShadowNode;
};

/*
 * Props for unknown elements. Carries the authored lowercase tag name so DOM
 * APIs can report it (HTMLUnknownElement keeps its tag). The raw tag is lost at
 * the JS boundary — every unknown tag shares the singleton "unknown" view
 * config — so `createInstance` injects it as the `nodeName` prop, the only
 * per-instance channel (implicit-text-plan.md §3.C; next-steps T2).
 */
class UnknownElementProps final : public TextProps {
 public:
  UnknownElementProps() = default;
  UnknownElementProps(
      const PropsParserContext &context,
      const UnknownElementProps &sourceProps,
      const RawProps &rawProps)
      : TextProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})) {}

  std::string nodeName{};
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
using BTagComponentDescriptor = ConcreteComponentDescriptor<BTagShadowNode>;
using ITagComponentDescriptor = ConcreteComponentDescriptor<ITagShadowNode>;
using SpanTagComponentDescriptor = ConcreteComponentDescriptor<SpanTagShadowNode>;

} // namespace facebook::react
