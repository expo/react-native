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
#include <react/renderer/components/view/AriaAttributes.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>

namespace facebook::react {

extern const char ElementProgressComponentName[];

/*
 * `<progress>` and `<meter>` — the platform's own progress indicator.
 *
 * One element backs both, because the two differ in meaning rather than in
 * anything either platform draws differently: `<progress>` is how far along a
 * task is, `<meter>` is where a value sits in a range. `nodeName` keeps them
 * distinguishable to the DOM and to assistive technology, and `min` exists only
 * for `<meter>` — `<progress>` is defined from zero.
 *
 * Deliberately not interactive, and that is the whole difference from
 * `<input type="range">`: this reports, it does not accept a gesture. It
 * therefore never claims a drag, so a scroll starting on one just scrolls.
 */
class ElementProgressProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementProgressProps() = default;
  ElementProgressProps(
      const PropsParserContext& context,
      const ElementProgressProps& sourceProps,
      const RawProps& rawProps)
      : ViewProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})),
        value(convertRawProp(context, rawProps, "value", sourceProps.value, 0.0)),
        // An absent `value` on a `<progress>` means indeterminate — a task
        // running with no known end, which both platforms draw as a distinct
        // animation rather than as a bar at zero.
        hasValue(rawProps.at("value") != nullptr || sourceProps.hasValue),
        minimum(convertRawProp(context, rawProps, "min", sourceProps.minimum, 0.0)),
        maximum(convertRawProp(context, rawProps, "max", sourceProps.maximum, 1.0)),
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

  /*
   * The value as a 0–1 fraction, which is what both platforms' progress views
   * take. Guarded against an empty or inverted range, which would otherwise
   * divide by zero.
   */
  double fraction() const
  {
    if (maximum <= minimum) {
      return 0.0;
    }
    return std::clamp((value - minimum) / (maximum - minimum), 0.0, 1.0);
  }

  bool isIndeterminate() const
  {
    return !hasValue;
  }

  std::string nodeName{};
  double value{0.0};
  bool hasValue{false};
  double minimum{0.0};
  double maximum{1.0};
  bool disabled{false};
};

using ElementProgressShadowNode =
    ConcreteViewShadowNode<ElementProgressComponentName, ElementProgressProps, ViewEventEmitter>;

using ElementProgressComponentDescriptor = ConcreteComponentDescriptor<ElementProgressShadowNode>;

} // namespace facebook::react
