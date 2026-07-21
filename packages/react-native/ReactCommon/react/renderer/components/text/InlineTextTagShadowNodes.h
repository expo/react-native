/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/text/TextShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/ConcreteShadowNode.h>

namespace facebook::react {

/*
 * Intrinsic inline text tags (<b>, <i>, <span>): thin virtual text elements
 * with baked-in attribute defaults (implicit-text-plan.md §3.C). All are
 * instances of the inline text element class (TextShadowNode); explicit
 * styles still override the defaults.
 */

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

using BTagComponentDescriptor = ConcreteComponentDescriptor<BTagShadowNode>;
using ITagComponentDescriptor = ConcreteComponentDescriptor<ITagShadowNode>;
using SpanTagComponentDescriptor = ConcreteComponentDescriptor<SpanTagShadowNode>;

} // namespace facebook::react
