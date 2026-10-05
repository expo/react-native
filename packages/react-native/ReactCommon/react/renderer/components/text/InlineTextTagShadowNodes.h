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

extern const char InlineTextComponentName[];

/*
 * Props shared by every inline element. `nodeName` carries the authored tag,
 * which a view config cannot: one component backs many tags, and an alias
 * such as <strong> must report itself, not <b>. The reconciler injects it for
 * configs marked `recordNodeName`; empty means the component name is the tag.
 */
class InlineTagProps : public TextProps, public NodeNameProvider {
 public:
  InlineTagProps() = default;
  InlineTagProps(const PropsParserContext &context, const InlineTagProps &sourceProps, const RawProps &rawProps)
      : TextProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{}))
  {
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
