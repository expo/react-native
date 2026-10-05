/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ElementAuthorStatedPadding.h>
#include <react/renderer/components/view/ElementControlMetrics.h>
#include <react/renderer/components/view/ElementTextInputShadowNode.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>

namespace facebook::react {

extern const char ElementTextAreaComponentName[];

/*
 * `<textarea>`, a separate element from `<input>` because iOS draws the two
 * with unrelated classes; the emitter is shared. No `submit`: Return inserts
 * a newline.
 */
class ElementTextAreaProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementTextAreaProps() = default;
  ElementTextAreaProps(
      const PropsParserContext &context,
      const ElementTextAreaProps &sourceProps,
      const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})),
        value(convertRawProp(context, rawProps, "value", sourceProps.value, std::string{})),
        hasValue(rawProps.at("value") != nullptr || sourceProps.hasValue),
        defaultValue(convertRawProp(context, rawProps, "defaultValue", sourceProps.defaultValue, std::string{})),
        placeholder(convertRawProp(context, rawProps, "placeholder", sourceProps.placeholder, std::string{})),
        disabled(convertRawProp(context, rawProps, "disabled", sourceProps.disabled, false)),
        readOnly(convertRawProp(context, rawProps, "readOnly", sourceProps.readOnly, false)),
        maxLength(convertRawProp(context, rawProps, "maxLength", sourceProps.maxLength, -1)),
        autoFocus(convertRawProp(context, rawProps, "autoFocus", sourceProps.autoFocus, false)),
        spellCheck(convertRawProp(context, rawProps, "spellCheck", sourceProps.spellCheck, true)),
        // Separate from `spellCheck` because HTML keeps them separate: checking
        // marks what is wrong, correcting rewrites it (§6.8.5 vs §6.8.8). Both
        // arrive already resolved against the element tree — see TextCorrection.js.
        autoCorrect(convertRawProp(context, rawProps, "autoCorrect", sourceProps.autoCorrect, true)),
        // HTML's default is two rows. It is a *height* in lines, which is why it
        // belongs here rather than in the user-agent style: the style sheet
        // cannot know the line height the element ends up with.
        rows(convertRawProp(context, rawProps, "rows", sourceProps.rows, 2)),
        mostRecentEventCount(
            convertRawProp(context, rawProps, "mostRecentEventCount", sourceProps.mostRecentEventCount, 0))
  {
    // No user-agent accessibility defaults; the control describes itself. See
    // `ElementRangeShadowNode.h` for why that is the rule for control-backed
    // elements.
  }

  std::string domNodeName() const override
  {
    return nodeName;
  }

  std::string nodeName{};
  std::string value{};
  bool hasValue{false};
  std::string defaultValue{};
  std::string placeholder{};
  bool disabled{false};
  bool readOnly{false};
  int maxLength{-1};
  bool autoFocus{false};
  bool spellCheck{true};
  bool autoCorrect{true};
  int rows{2};
  int mostRecentEventCount{0};
};

/*
 * A measured leaf: `rows={n}` is n of the control's own line boxes, which
 * neither platform's control sizes itself from, so layout multiplies what the
 * control reported at startup (`ElementControlMetrics`). TextArea.js folds the
 * children into `defaultValue`, so none reach the shadow tree.
 */
class ElementTextAreaShadowNode final
    : public ConcreteViewShadowNode<ElementTextAreaComponentName, ElementTextAreaProps, ElementTextInputEventEmitter> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  static ShadowNodeTraits BaseTraits()
  {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(ShadowNodeTraits::Trait::MeasurableYogaNode);
    return traits;
  }

  Size measureContent(const LayoutContext & /*layoutContext*/, const LayoutConstraints &layoutConstraints)
      const override
  {
    const auto &props = getConcreteProps();
    // HTML's default, and the same floor the prop's default states.
    const auto rows = props.rows > 0 ? props.rows : 2;
    const auto metrics = elementControlMetrics();
    // The control keeps its inset only when the author states no block
    // padding. The part the platform expresses as padding is on the style
    // already (`applyPlatformPadding`); only the rest is reserved here
    const auto reserved = elementStatesBlockPadding(props)
        ? Float{0}
        : metrics.textAreaInsetBlock - metrics.textAreaPaddingTop - metrics.textAreaPaddingBottom;
    /*
     * The inline size stays whatever the sheet or the author said: a style
     * dimension beats a measured one, and nothing here knows better than they
     * do how wide a field should be.
     */
    return layoutConstraints.clamp(
        Size{layoutConstraints.minimumSize.width, rows * metrics.textAreaLineBox + reserved});
  }

  /*
   * Hands the control its own vertical padding back, where the platform keeps
   * its inset AS padding (Android). Without it, unset block padding reaches the
   * `EditText` as zero and the text sits flush against the top of its field.
   */
  void applyPlatformPadding()
  {
    const auto metrics = elementControlMetrics();
    if (elementStatesBlockPadding(getConcreteProps()) ||
        (metrics.textAreaPaddingTop <= 0 && metrics.textAreaPaddingBottom <= 0)) {
      return;
    }
    ensureUnsealed();
    auto style = yogaNode_.style();
    style.setPadding(yoga::Edge::Top, yoga::StyleLength::points(metrics.textAreaPaddingTop));
    style.setPadding(yoga::Edge::Bottom, yoga::StyleLength::points(metrics.textAreaPaddingBottom));
    yogaNode_.setStyle(style);
  }
};

/*
 * Folds the platform's padding on adopt, which is where a node is finished —
 * after its Yoga style has been built from props, so this is not overwritten.
 */
class ElementTextAreaComponentDescriptor final : public ConcreteComponentDescriptor<ElementTextAreaShadowNode> {
 public:
  using ConcreteComponentDescriptor::ConcreteComponentDescriptor;

 protected:
  void adopt(ShadowNode &shadowNode) const override
  {
    ConcreteComponentDescriptor::adopt(shadowNode);
    static_cast<ElementTextAreaShadowNode &>(shadowNode).applyPlatformPadding();
  }
};

} // namespace facebook::react
