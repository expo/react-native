/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ElementCheckboxShadowNode.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>

namespace facebook::react {

extern const char ElementRadioComponentName[];

/*
 * Android's `RadioButton`, and on iOS, which has no radio control, the circle
 * Safari draws. Exclusivity across a `name` group is the form's to enforce,
 * as in the DOM; `name` is carried for it. Choosing is atomic, so `change`
 * fires and `input` does not.
 */
class ElementRadioProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementRadioProps() = default;
  ElementRadioProps(const PropsParserContext &context, const ElementRadioProps &sourceProps, const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})),
        checked(convertRawProp(context, rawProps, "checked", sourceProps.checked, false)),
        disabled(convertRawProp(context, rawProps, "disabled", sourceProps.disabled, false)),
        name(convertRawProp(context, rawProps, "name", sourceProps.name, std::string{})),
        value(convertRawProp(context, rawProps, "value", sourceProps.value, std::string{}))
  {
  }

  std::string domNodeName() const override
  {
    return nodeName;
  }

  std::string nodeName{};
  bool checked{false};
  bool disabled{false};
  std::string name{};
  std::string value{};
};

using ElementRadioShadowNode =
    ConcreteViewShadowNode<ElementRadioComponentName, ElementRadioProps, ElementCheckboxEventEmitter>;

using ElementRadioComponentDescriptor = ConcreteComponentDescriptor<ElementRadioShadowNode>;

} // namespace facebook::react
