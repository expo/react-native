/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>
#include <unordered_map>
#include <vector>

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>

namespace facebook::react {

extern const char ElementSelectComponentName[];

/*
 * One `<option>`, flattened onto its `<select>`.
 *
 * The options arrive as a prop rather than as child elements. A native
 * `<select>` is not a container that lays out its children — it is a control
 * that is *handed* a list and presents it in a menu the app does not draw — so
 * there is nothing for child shadow nodes to lay out, and mounting them would
 * create views that are never on screen.
 *
 * `<select><option>…</option></select>` — the shape HTML actually uses — works:
 * the tag resolves to a JavaScript component (`Select.js`) that reads the
 * children and passes them here as this list, and the component renders
 * `element-select`, which is the box this shadow node backs.
 *
 * That resolution happens in the reconciler, through the same registry seam
 * that resolves view configs, rather than in a JSX transform — so an element
 * built by `React.createElement` or `cloneElement` behaves exactly like one
 * written as JSX.
 */
struct ElementSelectOption {
  std::string value{};
  std::string label{};
  bool disabled{false};

  bool operator==(const ElementSelectOption& rhs) const
  {
    return std::tie(value, label, disabled) == std::tie(rhs.value, rhs.label, rhs.disabled);
  }
  bool operator!=(const ElementSelectOption& rhs) const
  {
    return !(*this == rhs);
  }
};

inline void fromRawValue(const PropsParserContext& context, const RawValue& value, ElementSelectOption& result)
{
  auto map = (std::unordered_map<std::string, RawValue>)value;

  auto optionValue = map.find("value");
  if (optionValue != map.end() && optionValue->second.hasType<std::string>()) {
    fromRawValue(context, optionValue->second, result.value);
  }

  auto label = map.find("label");
  if (label != map.end() && label->second.hasType<std::string>()) {
    fromRawValue(context, label->second, result.label);
  }

  auto disabled = map.find("disabled");
  if (disabled != map.end() && disabled->second.hasType<bool>()) {
    fromRawValue(context, disabled->second, result.disabled);
  }

  // HTML's rule: an `<option>` with no `value` attribute takes its text as its
  // value. Applied here so neither platform has to know about it.
  if (result.value.empty() && !result.label.empty()) {
    result.value = result.label;
  }
}

/*
 * `<select>` — a choice from a list, presented the way each platform presents
 * one.
 *
 * The platforms differ and both are followed: iOS puts the options in a pull-
 * down `UIMenu` attached to the control, which is what a UIKit app uses for a
 * short list and what the system draws for a pop-up button; Android uses a
 * `Spinner`, which opens the platform's own dropdown. Neither is a wheel — the
 * wheel is what Safari shows for `<select>`, and it is a *web* affordance on
 * iOS rather than a native one.
 */
class ElementSelectEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  /*
   * The DOM's `change`. A `<select>` has no `input` event distinct from it:
   * there are no intermediate values, because choosing is atomic.
   */
  void onElementChange(const std::string& value, int index) const {
    dispatchEvent("elementChange", [value, index](jsi::Runtime& runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "value", jsi::String::createFromUtf8(runtime, value));
      payload.setProperty(runtime, "selectedIndex", index);
      return payload;
    });
  }
};

class ElementSelectProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementSelectProps() = default;
  ElementSelectProps(
      const PropsParserContext& context,
      const ElementSelectProps& sourceProps,
      const RawProps& rawProps)
      : ViewProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})),
        options(convertRawProp(context, rawProps, "options", sourceProps.options, std::vector<ElementSelectOption>{})),
        value(convertRawProp(context, rawProps, "value", sourceProps.value, std::string{})),
        hasValue(rawProps.at("value") != nullptr || sourceProps.hasValue),
        disabled(convertRawProp(context, rawProps, "disabled", sourceProps.disabled, false))
  {
  }

  std::string domNodeName() const override
  {
    return nodeName;
  }

  /*
   * The index of the selected option, or the HTML default.
   *
   * A `<select>` with no matching value selects its first option — that is what
   * a browser does with an untouched `<select>`, and why one always shows
   * something rather than being blank.
   */
  int selectedIndex() const
  {
    for (size_t i = 0; i < options.size(); i++) {
      if (options[i].value == value) {
        return static_cast<int>(i);
      }
    }
    return options.empty() ? -1 : 0;
  }

  std::string nodeName{};
  std::vector<ElementSelectOption> options{};
  std::string value{};
  bool hasValue{false};
  bool disabled{false};
};

using ElementSelectShadowNode =
    ConcreteViewShadowNode<ElementSelectComponentName, ElementSelectProps, ElementSelectEventEmitter>;

using ElementSelectComponentDescriptor = ConcreteComponentDescriptor<ElementSelectShadowNode>;

} // namespace facebook::react
