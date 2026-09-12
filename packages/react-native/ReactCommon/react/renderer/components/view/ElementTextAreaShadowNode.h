/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ElementTextInputShadowNode.h>
#include <react/renderer/components/view/AriaAttributes.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/graphics/Color.h>
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
            convertRawProp(context, rawProps, "mostRecentEventCount", sourceProps.mostRecentEventCount, 0)),
        // CSS's `caret-color`, which is a real property and was not expressible
        // at all: iOS draws the insertion point in the control's `tintColor`,
        // which it inherits, so a composer got whatever the window's tint
        // happened to be. Measured against the native composer, whose caret is
        // its own #0088FF: ours came out (66,107,242), a different hue entirely.
        caretColor(convertRawProp(context, rawProps, "caretColor", sourceProps.caretColor, SharedColor{}))
  {
    // No user-agent accessibility defaults; the control describes itself. See
    // `ElementRangeShadowNode.h` for why that is the rule for control-backed
    // elements.

    // ARIA, which is how an author of these elements spells accessibility.
    // Applied last so it wins over the `accessibility*` props, and applied
    // here rather than in the base so only elements pay for the reads.
    applyAriaAttributes(context, rawProps, *this);
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
  /*
   * CSS `caret-color`: the insertion point's colour. Unset leaves the
   * platform's.
   *
   * LAST, matching the initialiser list, and that is not tidiness: C++
   * initialises members in DECLARATION order whatever the list says, so a list
   * in a different order is a lie about when each value exists. Declared at the
   * top when it was added, which made this the one member initialised first —
   * `-Wreorder-ctor` is an error under Fantom's build and invisible under
   * Xcode's, so it compiled for iOS and broke the tester.
   */
  SharedColor caretColor{};
};

using ElementTextAreaShadowNode = ConcreteViewShadowNode<
    ElementTextAreaComponentName,
    ElementTextAreaProps,
    ElementTextInputEventEmitter>;

using ElementTextAreaComponentDescriptor = ConcreteComponentDescriptor<ElementTextAreaShadowNode>;

} // namespace facebook::react
