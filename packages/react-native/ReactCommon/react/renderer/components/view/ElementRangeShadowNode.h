/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <algorithm>
#include <string>

#include <react/renderer/components/view/AriaAttributes.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>

namespace facebook::react {

extern const char ElementRangeComponentName[];

/*
 * `<input type="range">`: the platform's own slider, a leaf with no children to
 * lay out. Its gesture is a drag it owns, so it declares `touch-action: none`
 * semantics natively rather than being scrolled away by its container.
 */
class ElementRangeEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  /*
   * Continuous, while the thumb moves — the DOM's `input` event.
   */
  void onElementInput(double value) const
  {
    dispatchEvent("elementInput", [value](jsi::Runtime &runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "value", value);
      return payload;
    });
  }

  // The DOM's `change`, on release: `input` is every value while scrubbing,
  // `change` the one the user settled on
  void onElementChange(double value) const
  {
    dispatchEvent("elementChange", [value](jsi::Runtime &runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "value", value);
      return payload;
    });
  }
};

class ElementRangeProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementRangeProps() = default;
  ElementRangeProps(const PropsParserContext &context, const ElementRangeProps &sourceProps, const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})),
        value(convertRawProp(context, rawProps, "value", sourceProps.value, 50.0)),
        minimum(convertRawProp(context, rawProps, "min", sourceProps.minimum, 0.0)),
        maximum(convertRawProp(context, rawProps, "max", sourceProps.maximum, 100.0)),
        step(convertRawProp(context, rawProps, "step", sourceProps.step, 1.0)),
        disabled(convertRawProp(context, rawProps, "disabled", sourceProps.disabled, false))
  {
    // No user-agent accessibility defaults, unlike `<button>`: the backing is a
    // platform control that describes itself, and traits stated here would
    // replace that description rather than add to it

    // Applied last so ARIA wins over the `accessibility*` props, and here
    // rather than in the base so only elements pay for the reads
    applyAriaAttributes(context, rawProps, *this);
  }

  std::string domNodeName() const override
  {
    return nodeName;
  }

  /*
   * The HTML defaults: a range with no attributes runs 0–100 in steps of 1 and
   * starts halfway. Browsers do the same, and code ported from the web relies
   * on it.
   */
  std::string nodeName{};
  double value{50.0};
  double minimum{0.0};
  double maximum{100.0};
  double step{1.0};
  bool disabled{false};

  /*
   * `value` clamped into range, which is what the control is actually set to.
   * HTML clamps rather than rejecting out-of-range values, and an inverted
   * range (min > max) is defined to collapse to min.
   */
  double clampedValue() const
  {
    if (maximum <= minimum) {
      return minimum;
    }
    return std::clamp(value, minimum, maximum);
  }
};

using ElementRangeShadowNode =
    ConcreteViewShadowNode<ElementRangeComponentName, ElementRangeProps, ElementRangeEventEmitter>;

using ElementRangeComponentDescriptor = ConcreteComponentDescriptor<ElementRangeShadowNode>;

} // namespace facebook::react
