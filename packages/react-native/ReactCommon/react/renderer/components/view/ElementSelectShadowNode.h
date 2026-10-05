/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <algorithm>
#include <cmath>
#include <functional>
#include <string>
#include <unordered_map>
#include <vector>

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ElementControlMetrics.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>

namespace facebook::react {

extern const char ElementSelectComponentName[];

// One `<option>`, flattened onto its `<select>` by Select.js: a native select
// is handed a list rather than laying out children
struct ElementSelectOption {
  std::string value{};
  std::string label{};
  bool disabled{false};

  bool operator==(const ElementSelectOption &rhs) const
  {
    return std::tie(value, label, disabled) == std::tie(rhs.value, rhs.label, rhs.disabled);
  }
  bool operator!=(const ElementSelectOption &rhs) const
  {
    return !(*this == rhs);
  }
};

inline void fromRawValue(const PropsParserContext &context, const RawValue &value, ElementSelectOption &result)
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

// A pull-down `UIMenu` on iOS and a `Spinner` on Android; the wheel Safari
// shows is a web affordance
class ElementSelectEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  /*
   * The DOM's `change`. A `<select>` has no `input` event distinct from it:
   * there are no intermediate values, because choosing is atomic.
   */
  void onElementChange(const std::string &value, int index) const
  {
    dispatchEvent("elementChange", [value, index](jsi::Runtime &runtime) {
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
  ElementSelectProps(const PropsParserContext &context, const ElementSelectProps &sourceProps, const RawProps &rawProps)
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

/*
 * What the measure adds around the widest option's label, pinned against the
 * real controls: `EXPElementSelectGeometryTests` on iOS; the Spinner item's
 * `textAppearanceSpinnerItem` text plus the field surface's icon allowance on
 * Android, with the sheet's padding outside the measure. The minimum width is
 * the published touch target (44pt, 48dp), which no control reports; an
 * author width wins over the measure entirely.
 */
#if defined(__APPLE__)
constexpr float kElementSelectMinTouchWidth = 44.0f;
#else
constexpr float kElementSelectMinTouchWidth = 48.0f;
#endif

/*
 * A measured leaf: `<select>` shrink-to-fits its widest option, as Safari and
 * both platforms' controls do. The widest label is measured through a
 * function the text-side component descriptor injects (DomElementsRegistry),
 * since the view layer cannot include the text layout manager.
 */
class ElementSelectShadowNode final
    : public ConcreteViewShadowNode<ElementSelectComponentName, ElementSelectProps, ElementSelectEventEmitter> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  /* (label, pointScaleFactor, fontSizeMultiplier) -> the label's width in the
   * font the real control draws its title in (ElementControlMetrics). */
  using LabelWidthMeasurer = std::function<Float(const std::string &, Float, Float)>;

  static ShadowNodeTraits BaseTraits()
  {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(ShadowNodeTraits::Trait::MeasurableYogaNode);
    return traits;
  }

  void setLabelWidthMeasurer(LabelWidthMeasurer measurer)
  {
    ensureUnsealed();
    measurer_ = std::move(measurer);
  }

  Size measureContent(const LayoutContext &layoutContext, const LayoutConstraints &layoutConstraints) const override
  {
    const auto &props = getConcreteProps();
    const auto metrics = elementControlMetrics();
    Float widest = 0;
    if (measurer_ != nullptr) {
      for (const auto &option : props.options) {
        const auto &label = option.label.empty() ? option.value : option.label;
        // Ceil per label: UIKit sizes titles to whole points.
        widest = std::max(
            widest, std::ceil(measurer_(label, layoutContext.pointScaleFactor, layoutContext.fontSizeMultiplier)));
      }
    }
    // The whole control less its label, as a subtraction against the probe
    // string the platform measured so the text engines' disagreement cancels;
    // an unprobed platform keeps `selectChromeInline`
    const auto chromeInline = (metrics.selectProbeIntrinsicWidth > 0 && measurer_ != nullptr)
        ? metrics.selectProbeIntrinsicWidth -
            measurer_(elementSelectProbeTitle(), layoutContext.pointScaleFactor, layoutContext.fontSizeMultiplier)
        : metrics.selectChromeInline;
    // The touch floor applies to the BOX a finger sees, so the sheet's own
    // padding and border count toward it; the measure returns the content
    // box, which Yoga wraps in those. Read the YOGA NODE's style, not
    // props.yogaStyle: `applyAliasedProps` writes the logical aliases
    // (`paddingInline`, the sheet's spelling) straight onto the node, so the
    // props object never sees them.
    const auto horizontalExtras =
        yogaNode_.style().computePaddingAndBorderForDimension(yoga::Direction::LTR, yoga::Dimension::Width, 0.0f);
    const auto contentFloor = std::max<Float>(kElementSelectMinTouchWidth - horizontalExtras, 0);
    const auto width = std::max<Float>(widest + chromeInline, contentFloor);
    // The block size is the real control's too. A style dimension still beats
    // it, so an author who states a height gets theirs.
    return layoutConstraints.clamp(Size{width, metrics.selectBlockSize});
  }

  /*
   * The baseline is the control's text, not the bottom of its box, so the
   * control lines up with the sentence it sits in. See
   * `elementControlBaseline`.
   */
  Float baseline(const LayoutContext & /*layoutContext*/, Size size) const override
  {
    const auto metrics = elementControlMetrics();
    const auto &style = yogaNode_.style();
    const auto top = style.computeFlexStartPadding(yoga::FlexDirection::Column, yoga::Direction::LTR, size.width) +
        style.computeFlexStartBorder(yoga::FlexDirection::Column, yoga::Direction::LTR);
    const auto bottom = style.computeFlexEndPadding(yoga::FlexDirection::Column, yoga::Direction::LTR, size.width) +
        style.computeFlexEndBorder(yoga::FlexDirection::Column, yoga::Direction::LTR);
    return elementControlBaseline(size, top, bottom, metrics.selectBlockSize, metrics.selectBaseline);
  }

 private:
  LabelWidthMeasurer measurer_{};
};

using ElementSelectComponentDescriptor = ConcreteComponentDescriptor<ElementSelectShadowNode>;

} // namespace facebook::react
