/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/core/CancelableEventDecision.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>

namespace facebook::react {

extern const char ElementTextInputComponentName[];

/*
 * `<input>` in its textual forms — `text`, `password`, `email`, `number`,
 * `tel`, `url`, `search` — drawn by the platform's own single-line text field.
 *
 * The type is carried through as the HTML string rather than being resolved to
 * a keyboard type here, because the platforms disagree about what a type
 * implies and each should answer for itself: `email` is a keyboard layout on
 * both, but `search` is a return key on iOS and an IME action on Android, and
 * `number` on iOS is a keypad with no minus sign unless you ask for one. The
 * element states the semantic; the component views state the platform's answer.
 */
class ElementTextInputEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  /*
   * `beforeinput`: the edit the user is about to make, offered to JavaScript
   * *before* the control applies it.
   *
   * This exists so a controlled input can transform or refuse a keystroke with
   * nothing visible in between. The alternative — let the character land, tell
   * JavaScript, and correct the field when the answer comes back — shows the
   * rejected character for a frame or more, which is the flicker that makes a
   * field feel unlike every other field on the device.
   *
   * It is deliberately the only synchronous event here. It blocks the
   * JavaScript thread for the duration of the handler, which is the cost of
   * getting an answer before the platform commits; the browser makes the same
   * trade for the same reason. Everything else stays on the batched path.
   */
  void onElementBeforeInput(
      const std::string& proposedValue,
      const std::shared_ptr<CancelableEventDecision>& decision) const {
    dispatchEvent("elementBeforeInput", [proposedValue, decision](jsi::Runtime& runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "value", jsi::String::createFromUtf8(runtime, proposedValue));
      decorateCancelablePayload(runtime, payload, decision);
      return payload;
    });
  }

  /*
   * The DOM's `input` — every accepted edit, as it happens.
   *
   * `eventCount` travels with it and is the whole controlled-input story. It
   * is a count of the edits this element has *sent*; JavaScript echoes back the
   * highest one it has processed, and the view ignores any value written while
   * that echo is behind. Without it a controlled input drops and reorders
   * characters under fast typing: the value prop for keystroke N arrives after
   * keystroke N+1 has already been typed, and writing it back rewinds the
   * field. Since the write is what has to be suppressed, the count has to reach
   * the view as a prop, which is why it is part of this payload rather than
   * something the view could track alone.
   */
  void onElementInput(const std::string& value, int eventCount) const {
    dispatchEvent("elementInput", [value, eventCount](jsi::Runtime& runtime) {
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
  void onElementChange(const std::string& value) const {
    dispatchEvent("elementChange", [value](jsi::Runtime& runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "value", jsi::String::createFromUtf8(runtime, value));
      return payload;
    });
  }

  void onElementFocus() const {
    dispatchEvent("elementFocus", [](jsi::Runtime& runtime) { return jsi::Object(runtime); });
  }

  void onElementBlur() const {
    dispatchEvent("elementBlur", [](jsi::Runtime& runtime) { return jsi::Object(runtime); });
  }

  /*
   * The return key. Named for the DOM event a form submission raises, because
   * that is what the key means on a single-line field inside a form.
   */
  void onElementSubmit(const std::string& value) const {
    dispatchEvent("elementSubmit", [value](jsi::Runtime& runtime) {
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
  void onElementSelectionChange(int start, int end) const {
    dispatchEvent("elementSelectionChange", [start, end](jsi::Runtime& runtime) {
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
      const PropsParserContext& context,
      const ElementTextInputProps& sourceProps,
      const RawProps& rawProps)
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
        hasBeforeInput(
            convertRawProp(context, rawProps, "hasBeforeInput", sourceProps.hasBeforeInput, false))
  {
    // No user-agent accessibility defaults, for the reason set out in
    // `ElementRangeShadowNode.h`: the backing is a platform control, the
    // component view forwards the element's accessibility to it, and a text
    // field already describes itself as one.
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
  std::string autoComplete{};
  std::string enterKeyHint{};
  std::string inputMode{};
  int mostRecentEventCount{0};
  bool hasBeforeInput{false};
};

using ElementTextInputShadowNode = ConcreteViewShadowNode<
    ElementTextInputComponentName,
    ElementTextInputProps,
    ElementTextInputEventEmitter>;

using ElementTextInputComponentDescriptor = ConcreteComponentDescriptor<ElementTextInputShadowNode>;

} // namespace facebook::react
