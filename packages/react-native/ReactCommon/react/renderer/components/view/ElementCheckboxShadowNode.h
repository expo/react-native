/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>

namespace facebook::react {

extern const char ElementCheckboxComponentName[];

// A boolean drawn by the platform's own control for one: a `UISwitch` on
// iOS, a `CheckBox` on Android
class ElementCheckboxEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  // `change` only: toggling is atomic. DOM-CSS-LIMITATION: `preventDefault()`
  // on the click cannot stop the toggle, which the control has already
  // animated when it reports it; a controlled `checked` prop disagrees with it
  // without blocking a thread
  void onElementChange(bool checked) const
  {
    dispatchEvent("elementChange", [checked](jsi::Runtime &runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "checked", checked);
      return payload;
    });
  }
};

class ElementCheckboxProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementCheckboxProps() = default;
  ElementCheckboxProps(
      const PropsParserContext &context,
      const ElementCheckboxProps &sourceProps,
      const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})),
        checked(convertRawProp(context, rawProps, "checked", sourceProps.checked, false)),
        disabled(convertRawProp(context, rawProps, "disabled", sourceProps.disabled, false))
  {
    // No accessibility defaults, unlike `<button>`: the platform control
    // describes itself, and traits stated here would replace its description
  }

  std::string domNodeName() const override
  {
    return nodeName;
  }

  std::string nodeName{};
  bool checked{false};
  bool disabled{false};
};

using ElementCheckboxShadowNode =
    ConcreteViewShadowNode<ElementCheckboxComponentName, ElementCheckboxProps, ElementCheckboxEventEmitter>;

using ElementCheckboxComponentDescriptor = ConcreteComponentDescriptor<ElementCheckboxShadowNode>;

} // namespace facebook::react
