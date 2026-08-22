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

extern const char ElementDateInputComponentName[];

/*
 * `<input type="date">`, `"time"` and `"datetime-local"` — the platform's own
 * date and time pickers.
 *
 * The value crosses as an HTML-format string rather than as a number, because
 * that is what the DOM defines and what round-trips to the web unchanged:
 * `YYYY-MM-DD` for a date, `HH:MM` for a time, `YYYY-MM-DDTHH:MM` for both. The
 * platforms parse and format it themselves — a timestamp would have forced a
 * timezone decision here that neither the DOM nor the user asked for, since
 * these three types are all *local* and carry no zone at all.
 */
class ElementDateInputEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  /*
   * Both DOM events, with the same distinction as a text field: `input` for
   * every adjustment the user makes while the picker is open, `change` for the
   * value they settle on.
   */
  void onElementInput(const std::string& value) const {
    dispatchEvent("elementInput", [value](jsi::Runtime& runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "value", jsi::String::createFromUtf8(runtime, value));
      return payload;
    });
  }

  void onElementChange(const std::string& value) const {
    dispatchEvent("elementChange", [value](jsi::Runtime& runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "value", jsi::String::createFromUtf8(runtime, value));
      return payload;
    });
  }
};

class ElementDateInputProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementDateInputProps() = default;
  ElementDateInputProps(
      const PropsParserContext& context,
      const ElementDateInputProps& sourceProps,
      const RawProps& rawProps)
      : ViewProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})),
        type(convertRawProp(context, rawProps, "type", sourceProps.type, std::string{"date"})),
        value(convertRawProp(context, rawProps, "value", sourceProps.value, std::string{})),
        hasValue(rawProps.at("value") != nullptr || sourceProps.hasValue),
        // The picker's bounds, as HTML's `min` and `max` attributes — same
        // string format as the value, and empty for "no bound".
        minimum(convertRawProp(context, rawProps, "min", sourceProps.minimum, std::string{})),
        maximum(convertRawProp(context, rawProps, "max", sourceProps.maximum, std::string{})),
        disabled(convertRawProp(context, rawProps, "disabled", sourceProps.disabled, false))
  {
  }

  std::string domNodeName() const override
  {
    return nodeName;
  }

  bool showsDate() const
  {
    return type == "date" || type == "datetime-local";
  }

  bool showsTime() const
  {
    return type == "time" || type == "datetime-local";
  }

  std::string nodeName{};
  std::string type{"date"};
  std::string value{};
  bool hasValue{false};
  std::string minimum{};
  std::string maximum{};
  bool disabled{false};
};

using ElementDateInputShadowNode = ConcreteViewShadowNode<
    ElementDateInputComponentName,
    ElementDateInputProps,
    ElementDateInputEventEmitter>;

using ElementDateInputComponentDescriptor = ConcreteComponentDescriptor<ElementDateInputShadowNode>;

} // namespace facebook::react
