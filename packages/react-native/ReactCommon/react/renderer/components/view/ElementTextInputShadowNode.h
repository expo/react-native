/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>

#include <react/renderer/components/view/AriaAttributes.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ElementControlMetrics.h>
#include <react/renderer/components/view/ElementControlSizeState.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/CancelableEventDecision.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>

namespace facebook::react {

extern const char ElementTextInputComponentName[];

/*
 * `<input>`'s textual types, drawn by the platform's single-line field. The
 * type is carried as the HTML string because the platforms disagree about
 * what it implies: `search` is a return key on iOS and an IME action on
 * Android.
 */
class ElementTextInputEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  // `beforeinput`, offered before the control applies the edit so a controlled
  // input can refuse or transform a keystroke with nothing visible in between.
  // The only synchronous event here: it blocks the JavaScript thread for the
  // handler's duration
  void onElementBeforeInput(const std::string &proposedValue, const std::shared_ptr<CancelableEventDecision> &decision)
      const
  {
    dispatchEvent("elementBeforeInput", [proposedValue, decision](jsi::Runtime &runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "value", jsi::String::createFromUtf8(runtime, proposedValue));
      decorateCancelablePayload(runtime, payload, decision);
      return payload;
    });
  }

  // The DOM's `input`. `eventCount` counts the edits sent; JavaScript echoes
  // the highest one processed as a prop, and the view ignores a value written
  // while the echo is behind, which is what keeps fast typing from rewinding
  // the field
  void onElementInput(const std::string &value, int eventCount) const
  {
    dispatchEvent("elementInput", [value, eventCount](jsi::Runtime &runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "value", jsi::String::createFromUtf8(runtime, value));
      payload.setProperty(runtime, "eventCount", eventCount);
      return payload;
    });
  }

  /*
   * The DOM's `change`, which for a text field is *not* every keystroke: it
   * fires when the edit is committed — on blur, or on submitting — and only if
   * the value actually differs from what it was when editing began. Web code
   * relies on that distinction, and a `change` per keystroke would make
   * `onChange` handlers that save or validate run on every character.
   */
  void onElementChange(const std::string &value) const
  {
    dispatchEvent("elementChange", [value](jsi::Runtime &runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "value", jsi::String::createFromUtf8(runtime, value));
      return payload;
    });
  }

  void onElementFocus() const
  {
    dispatchEvent("elementFocus", [](jsi::Runtime &runtime) { return jsi::Object(runtime); });
  }

  void onElementBlur() const
  {
    dispatchEvent("elementBlur", [](jsi::Runtime &runtime) { return jsi::Object(runtime); });
  }

  /*
   * The return key. Named for the DOM event a form submission raises, because
   * that is what the key means on a single-line field inside a form.
   */
  void onElementSubmit(const std::string &value) const
  {
    dispatchEvent("elementSubmit", [value](jsi::Runtime &runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "value", jsi::String::createFromUtf8(runtime, value));
      return payload;
    });
  }

  /*
   * The selection, as the DOM's `selectionStart`/`selectionEnd`. Reported on
   * its own event rather than folded into `input` because a caret move is not
   * an edit, and conflating them would fire `input` for arrow keys.
   */
  /**
   * How tall the control's text is at its current width: what `field-sizing:
   * content` needs and only the platform's line breaking can know. Reported so
   * an author can act on it; the element does not resize itself, since HTML
   * sizes a `<textarea>` from `rows`.
   */
  void onElementContentSizeChange(Float width, Float height) const
  {
    dispatchEvent("elementContentSizeChange", [width, height](jsi::Runtime &runtime) {
      auto payload = jsi::Object(runtime);
      auto size = jsi::Object(runtime);
      size.setProperty(runtime, "width", width);
      size.setProperty(runtime, "height", height);
      payload.setProperty(runtime, "contentSize", std::move(size));
      return payload;
    });
  }

  void onElementSelectionChange(int start, int end) const
  {
    dispatchEvent("elementSelectionChange", [start, end](jsi::Runtime &runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "selectionStart", start);
      payload.setProperty(runtime, "selectionEnd", end);
      return payload;
    });
  }
};

class ElementTextInputProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementTextInputProps() = default;
  ElementTextInputProps(
      const PropsParserContext &context,
      const ElementTextInputProps &sourceProps,
      const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})),
        type(convertRawProp(context, rawProps, "type", sourceProps.type, std::string{"text"})),
        value(convertRawProp(context, rawProps, "value", sourceProps.value, std::string{})),
        // Distinguished from an empty value: `<input>` with no `value` at all is
        // uncontrolled, and writing "" into it on every commit would erase what
        // the user typed. Only an authored `value` makes the field controlled.
        hasValue(rawProps.at("value") != nullptr || sourceProps.hasValue),
        defaultValue(convertRawProp(context, rawProps, "defaultValue", sourceProps.defaultValue, std::string{})),
        placeholder(convertRawProp(context, rawProps, "placeholder", sourceProps.placeholder, std::string{})),
        disabled(convertRawProp(context, rawProps, "disabled", sourceProps.disabled, false)),
        readOnly(convertRawProp(context, rawProps, "readOnly", sourceProps.readOnly, false)),
        // HTML's absent `maxlength` is "no limit", which is what -1 stands for
        // here; 0 is a real limit meaning nothing may be typed.
        maxLength(convertRawProp(context, rawProps, "maxLength", sourceProps.maxLength, -1)),
        autoFocus(convertRawProp(context, rawProps, "autoFocus", sourceProps.autoFocus, false)),
        spellCheck(convertRawProp(context, rawProps, "spellCheck", sourceProps.spellCheck, true)),
        // Separate from `spellCheck` because HTML keeps them separate: checking
        // marks what is wrong, correcting rewrites it (§6.8.5 vs §6.8.8). Both
        // arrive already resolved against the element tree — see TextCorrection.js.
        autoCorrect(convertRawProp(context, rawProps, "autoCorrect", sourceProps.autoCorrect, true)),
        autoComplete(convertRawProp(context, rawProps, "autoComplete", sourceProps.autoComplete, std::string{})),
        enterKeyHint(convertRawProp(context, rawProps, "enterKeyHint", sourceProps.enterKeyHint, std::string{})),
        inputMode(convertRawProp(context, rawProps, "inputMode", sourceProps.inputMode, std::string{})),
        // The echo described on `onElementInput`. Zero means "JavaScript has
        // processed nothing yet", which is also the state of a field that has
        // never been edited, so the two agree at rest.
        mostRecentEventCount(
            convertRawProp(context, rawProps, "mostRecentEventCount", sourceProps.mostRecentEventCount, 0)),
        // Whether anyone is listening for `beforeinput`.
        //
        // The synchronous path costs a blocked JavaScript thread per keystroke,
        // so it is not taken unless it is going to be used. A field with no
        // `onBeforeInput` types exactly as it did before.
        hasBeforeInput(convertRawProp(context, rawProps, "hasBeforeInput", sourceProps.hasBeforeInput, false))
  {
    // No user-agent accessibility defaults, for the reason set out in
    // `ElementRangeShadowNode.h`: the backing is a platform control, the
    // component view forwards the element's accessibility to it, and a text
    // field already describes itself as one.

    // Applied last so ARIA wins over the `accessibility*` props, and here
    // rather than in the base so only elements pay for the reads
    applyAriaAttributes(context, rawProps, *this);
  }

  std::string domNodeName() const override
  {
    return nodeName;
  }

  /*
   * Whether the field is secure. A property rather than a comparison at each
   * use, so the two platforms cannot drift on which types are masked.
   */
  bool isSecure() const
  {
    return type == "password";
  }

  std::string nodeName{};
  std::string type{"text"};
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
  std::string autoComplete{};
  std::string enterKeyHint{};
  std::string inputMode{};
  int mostRecentEventCount{0};
  bool hasBeforeInput{false};
};

// A measured leaf sized by the field it mounts: the control reports its own
// height, and a width of about twenty characters a column stretches
class ElementTextInputShadowNode final : public ConcreteViewShadowNode<
                                             ElementTextInputComponentName,
                                             ElementTextInputProps,
                                             ElementTextInputEventEmitter,
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

  Size measureContent(const LayoutContext & /*layoutContext*/, const LayoutConstraints &layoutConstraints)
      const override
  {
    const auto metrics = elementControlMetrics();
    // The height is the mounted field's own once it has reported one. The
    // width is the twenty-character default whatever the field holds: an
    // empty field and a full one are the same size, as they are in a browser.
    const auto &reported = getStateData();
    const auto height = reported.height > 0 ? reported.height : metrics.textFieldDefaultHeight;
    return layoutConstraints.clamp(Size{metrics.textFieldDefaultWidth, height});
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
    return elementControlBaseline(size, top, bottom, metrics.textFieldDefaultHeight, metrics.textFieldBaseline);
  }
};

using ElementTextInputComponentDescriptor = ConcreteComponentDescriptor<ElementTextInputShadowNode>;

} // namespace facebook::react
