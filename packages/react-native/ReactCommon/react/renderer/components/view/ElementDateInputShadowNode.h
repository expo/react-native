/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>
#include <utility>

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ElementControlMetrics.h>
#include <react/renderer/components/view/ElementControlSizeState.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/AriaAttributes.h>
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
    // ARIA, which is how an author of these elements spells accessibility.
    // Applied last so it wins over the `accessibility*` props, and applied
    // here rather than in the base so only elements pay for the reads.
    applyAriaAttributes(context, rawProps, *this);
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

/*
 * A MEASURED leaf, sized by the picker it mounts.
 *
 * A compact `UIDatePicker` is as wide as the value it is showing in the mode
 * it is in — "8/2/26" and "8/2/26, 14:05" are not the same control. The sheet
 * had one number per family (160 for date and time, 220 for datetime-local),
 * fitted to the longest case and wrong about the rest; at 160 the
 * datetime-local picker truncated its own date to "8/2...", which is a control
 * that cannot show its value. The picker reports what it actually needs.
 */
class ElementDateInputShadowNode final : public ConcreteViewShadowNode<
    ElementDateInputComponentName,
    ElementDateInputProps,
    ElementDateInputEventEmitter,
    ElementControlSizeState> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  static ShadowNodeTraits BaseTraits()
  {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(ShadowNodeTraits::Trait::MeasurableYogaNode);
    return traits;
  }

  Size measureContent(
      const LayoutContext& /*layoutContext*/,
      const LayoutConstraints& layoutConstraints) const override
  {
    const auto metrics = elementControlMetrics();
    const auto& props = getConcreteProps();
    const auto startupDefault = props.showsDate() && props.showsTime()
        ? Size{metrics.dateTimePickerDefaultWidth, metrics.dateTimePickerDefaultHeight}
        : props.showsTime() ? Size{metrics.timePickerDefaultWidth, metrics.timePickerDefaultHeight}
                            : Size{metrics.datePickerDefaultWidth, metrics.datePickerDefaultHeight};
    return elementControlMeasuredSize(getStateData(), startupDefault, layoutConstraints);
  }

  /*
   * The baseline is the control's text, not the bottom of its box, so the
   * control lines up with the sentence it sits in. See
   * `elementControlBaseline`.
   */
  Float baseline(const LayoutContext& /*layoutContext*/, Size size)
      const override {
    const auto metrics = elementControlMetrics();
    const auto& props = getConcreteProps();
    const auto probe = props.showsDate() && props.showsTime()
        ? std::
              pair{metrics.dateTimePickerDefaultHeight, metrics.dateTimePickerBaseline}
        : props.showsTime()
        ? std::pair{metrics.timePickerDefaultHeight, metrics.timePickerBaseline}
        : std::pair{
              metrics.datePickerDefaultHeight, metrics.datePickerBaseline};
    const auto& style = yogaNode_.style();
    const auto top =
        style.computeFlexStartPadding(
            yoga::FlexDirection::Column, yoga::Direction::LTR, size.width) +
        style.computeFlexStartBorder(
            yoga::FlexDirection::Column, yoga::Direction::LTR);
    const auto bottom =
        style.computeFlexEndPadding(
            yoga::FlexDirection::Column, yoga::Direction::LTR, size.width) +
        style.computeFlexEndBorder(
            yoga::FlexDirection::Column, yoga::Direction::LTR);
    return elementControlBaseline(size, top, bottom, probe.first, probe.second);
  }
};

using ElementDateInputComponentDescriptor = ConcreteComponentDescriptor<ElementDateInputShadowNode>;

} // namespace facebook::react
