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
 * `<input type="radio">` — one of a set of mutually exclusive choices.
 *
 * Android has a real `RadioButton` and uses it. iOS has no radio control at
 * all: UIKit's answer to "one of several" is a `UISegmentedControl` or a table
 * with a checkmark on the chosen row, and neither can be built from a single
 * element, because HTML's radios are separate elements tied together only by a
 * shared `name`. What Safari draws on iOS — a small circle that fills when
 * chosen — is therefore what this draws too. It is the affordance an iOS user
 * already recognises as a radio, arrived at because the platform declines to
 * supply one.
 *
 * The exclusivity is not enforced here. In the DOM it is the *form* that
 * enforces it across a `name` group, and a control that unilaterally cleared
 * its siblings would be reaching outside itself. `name` is carried so a form —
 * or the author's own state — can do it.
 *
 * The events are the checkbox's: choosing is atomic, so `change` fires and
 * `input` does not.
 */
class ElementRadioProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementRadioProps() = default;
  ElementRadioProps(
      const PropsParserContext& context,
      const ElementRadioProps& sourceProps,
      const RawProps& rawProps)
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
