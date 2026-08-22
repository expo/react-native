/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <algorithm>
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

extern const char ElementRangeComponentName[];

/*
 * `<input type="range">` — the platform's own slider.
 *
 * This is the first element whose gesture is a *drag it owns*, which is why it
 * needed the cancellation policy in `RCTElementDragOwnership` first: under a
 * scroll container that answers "yes, cancel" for every view, a slider cannot
 * work at all — dragging it scrolls the page instead of moving the thumb. It
 * therefore declares `touch-action: none` semantics natively rather than
 * relying on the author to remember.
 *
 * A leaf: the control draws itself and has no children to lay out.
 */
class ElementRangeEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  /*
   * Continuous, while the thumb moves — the DOM's `input` event.
   */
  void onElementInput(double value) const {
    dispatchEvent("elementInput", [value](jsi::Runtime& runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "value", value);
      return payload;
    });
  }

  /*
   * On release — the DOM's `change` event.
   *
   * Separate from `input` because the DOM separates them, and because the
   * distinction is load-bearing for a slider: `input` is every intermediate
   * value while scrubbing, `change` is the one the user settled on. Collapsing
   * them would make a committed value indistinguishable from a passing one.
   */
  void onElementChange(double value) const {
    dispatchEvent("elementChange", [value](jsi::Runtime& runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "value", value);
      return payload;
    });
  }
};

class ElementRangeProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementRangeProps() = default;
  ElementRangeProps(
      const PropsParserContext& context,
      const ElementRangeProps& sourceProps,
      const RawProps& rawProps)
      : ViewProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})),
        value(convertRawProp(context, rawProps, "value", sourceProps.value, 50.0)),
        minimum(convertRawProp(context, rawProps, "min", sourceProps.minimum, 0.0)),
        maximum(convertRawProp(context, rawProps, "max", sourceProps.maximum, 100.0)),
        step(convertRawProp(context, rawProps, "step", sourceProps.step, 1.0)),
        disabled(convertRawProp(context, rawProps, "disabled", sourceProps.disabled, false)) {
    // Deliberately no user-agent accessibility defaults here, unlike `<button>`.
    //
    // The backing is a platform control, and the control is what knows how to
    // describe itself: a `UISlider` is an adjustable that reports a value and
    // takes adjust gestures, a `UISwitch` is a toggle that announces on or off.
    // Stating traits here does not add to that, it *replaces* it — the platform
    // view stands in front of its control for accessibility purposes, so
    // whatever this says is what assistive technology hears, and it described a
    // checkbox as a plain button with no value. The component view forwards the
    // element's accessibility to the control instead, which leaves nothing for
    // props to default.
    //
    // `<button>` keeps its defaults, because there the container is the control.
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
