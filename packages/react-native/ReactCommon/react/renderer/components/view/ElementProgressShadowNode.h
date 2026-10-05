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

extern const char ElementProgressComponentName[];

// One element for `<progress>` and `<meter>`, which differ in meaning and by
// `nodeName`; `min` exists only for `<meter>`. Not interactive, so it never
// claims a drag
class ElementProgressProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementProgressProps() = default;
  ElementProgressProps(
      const PropsParserContext &context,
      const ElementProgressProps &sourceProps,
      const RawProps &rawProps)
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
