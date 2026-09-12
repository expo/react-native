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
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/AriaAttributes.h>
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
 * The control's own metrics, per platform — what the measure adds around the
 * widest option's label. Pinned against the REAL controls (the
 * identical-strings rule: update the constant and its test together):
 *  - iOS: EXPElementSelectGeometryTests measures a configured pop-up
 *    UIButton's intrinsic width and title font.
 *  - Android: the Spinner item's `textAppearanceSpinnerItem` text plus the
 *    field-surface's icon allowance; the UA sheet's own padding is OUTSIDE
 *    this measure (Yoga adds style padding around the measured content box).
 *
 * The minimum width is a touch-target floor, the one native-first deviation
 * from the web's pure shrink-to-fit (Safari happily renders a 41px select;
 * a finger should not have to hit that). An author width still wins over
 * the measure entirely, so the floor has an escape hatch.
 */
#if defined(__APPLE__)
constexpr float kElementSelectLabelFontSize = 17.0f;
/*
 * 39.7 is the measured UIButton chrome (EXPElementSelectGeometryTests pins
 * it); +3 is a measurement allowance — the renderer's text layout measures
 * the label a couple of points under UIKit's own title sizing (font
 * tracking and rounding differ), and a select that ellipsizes its widest
 * option by 2pt is wrong in a way 3pt of slack is not.
 */
constexpr float kElementSelectChromeInline = 39.7f + 3.0f;
constexpr float kElementSelectMinTouchWidth = 44.0f;
#else
constexpr float kElementSelectLabelFontSize = 16.0f;
constexpr float kElementSelectChromeInline = 32.0f;
constexpr float kElementSelectMinTouchWidth = 48.0f;
#endif

/*
 * A measured LEAF: `<select>` shrink-to-fits its widest option, which is the
 * web's rule (measured in real Safari: 41/72/239px for one-char/short/long
 * option sets) and also each platform's own idiom — a pop-up UIButton and an
 * M3 exposed dropdown both size to their content. The options live in props
 * (never mounted), so nothing measures itself through children; the widest
 * label is measured through a function the TEXT-side component descriptor
 * injects (DomElementsRegistry), because this header lives in the view layer
 * and the view layer cannot include the text layout manager.
 */
class ElementSelectShadowNode final
    : public ConcreteViewShadowNode<ElementSelectComponentName, ElementSelectProps, ElementSelectEventEmitter> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  /* (label, pointScaleFactor, fontSizeMultiplier) -> the label's width at
   * kElementSelectLabelFontSize. */
  using LabelWidthMeasurer = std::function<Float(const std::string&, Float, Float)>;

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

  Size measureContent(const LayoutContext& layoutContext, const LayoutConstraints& layoutConstraints) const override
  {
    const auto& props = getConcreteProps();
    Float widest = 0;
    if (measurer_ != nullptr) {
      for (const auto& option : props.options) {
        const auto& label = option.label.empty() ? option.value : option.label;
        // Ceil per label: UIKit sizes titles to whole points.
        widest = std::max(
            widest,
            std::ceil(measurer_(
                label, layoutContext.pointScaleFactor, layoutContext.fontSizeMultiplier)));
      }
    }
    // The touch floor applies to the BOX a finger sees, so the sheet's own
    // padding and border count toward it; the measure returns the content
    // box, which Yoga wraps in those. Read the YOGA NODE's style, not
    // props.yogaStyle: `applyAliasedProps` writes the logical aliases
    // (`paddingInline`, the sheet's spelling) straight onto the node, so the
    // props object never sees them.
    const auto horizontalExtras =
        yogaNode_.style().computePaddingAndBorderForDimension(
            yoga::Direction::LTR, yoga::Dimension::Width, 0.0f);
    const auto contentFloor =
        std::max<Float>(kElementSelectMinTouchWidth - horizontalExtras, 0);
    const auto width = std::max<Float>(widest + kElementSelectChromeInline, contentFloor);
    // The block size stays the user-agent sheet's platform height (a style
    // dimension beats the measured one); what is reported here only matters
    // when an author unsets it.
    return layoutConstraints.clamp(Size{width, layoutConstraints.minimumSize.height});
  }

 private:
  LabelWidthMeasurer measurer_{};
};

using ElementSelectComponentDescriptor = ConcreteComponentDescriptor<ElementSelectShadowNode>;

} // namespace facebook::react
