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
 * `<textarea>` — multi-line text, on the platform's own multi-line control.
 *
 * A separate element from `<input>` rather than a `multiline` flag on it,
 * because that is what it is in HTML and because the controls genuinely differ:
 * iOS draws single-line fields with `UITextField` and multi-line text with
 * `UITextView`, which are unrelated classes with different scrolling, selection
 * and keyboard behaviour. The events are the same, though, so the emitter is
 * shared with `<input>` — `input`, `change`, `focus`, `blur` and selection mean
 * exactly what they mean there.
 *
 * `submit` is deliberately absent: Return inserts a newline in a textarea, and
 * a control that dismissed the keyboard on Return would be unusable.
 */
class ElementTextAreaProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementTextAreaProps() = default;
  ElementTextAreaProps(
      const PropsParserContext& context,
      const ElementTextAreaProps& sourceProps,
      const RawProps& rawProps)
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
 * A MEASURED leaf: `rows={n}` is n lines of the control's own text.
 *
 * Neither platform's control sizes itself from `rows` — left to them,
 * `rows={2}` and `rows={8}` draw the same box — so someone has to turn lines
 * into points. It used to be the user-agent sheet, from two numbers measured
 * by hand off a simulator; they were wrong by fourteen points at the default
 * two rows for months, because nothing they described could contradict them.
 * Now the platform's own control is asked at startup and layout multiplies
 * what it said. See `ElementControlMetrics`.
 *
 * A leaf, which it already was: `<textarea>` seeds its value from its
 * children, and TextArea.js folds those into `defaultValue` in JavaScript, so
 * no child ever reaches the shadow tree to be laid out.
 */
class ElementTextAreaShadowNode final : public ConcreteViewShadowNode<
    ElementTextAreaComponentName,
    ElementTextAreaProps,
    ElementTextInputEventEmitter> {
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
    const auto& props = getConcreteProps();
    // HTML's default, and the same floor the prop's default states.
    const auto rows = props.rows > 0 ? props.rows : 2;
    const auto metrics = elementControlMetrics();
    /*
     * The control's own inset counts ONLY when the control keeps it — which is
     * when the author states no BLOCK padding. Inline padding says nothing
     * about the vertical inset. Of that inset, the part the platform expresses
     * as padding is on the style already (`applyPlatformPadding`), and Yoga adds
     * it around what this returns; only the rest is reserved here.
     */
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
  void adopt(ShadowNode& shadowNode) const override
  {
    ConcreteComponentDescriptor::adopt(shadowNode);
    static_cast<ElementTextAreaShadowNode&>(shadowNode).applyPlatformPadding();
  }
};

} // namespace facebook::react
