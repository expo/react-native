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
        caretColor(convertRawProp(context, rawProps, "caretColor", sourceProps.caretColor, SharedColor{})),
        // See the member below.
        quiet(convertRawProp(context, rawProps, "quiet", sourceProps.quiet, false))
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

  /**
   * Whether the HOST is in the middle of something, and would rather this
   * element did no expensive work yet.
   *
   * A controlled write that empties the field is made QUIETLY — the input
   * system is not told — because telling it costs a keyboard rebuild:
   * `reloadInputViews` twice to drop the correction queued against the text
   * that has just been sent, and the delegate's own `textWillChange`. Measured
   * on a phone, the whole turn is 113 milliseconds, which is seven dropped
   * frames.
   *
   * The news has to be given before the keyboard acts on that correction, and
   * it used to be given half a second after the write. Half a second is not a
   * quiet moment, it is a GUESS at one: this app's send throw runs for 769
   * milliseconds, so the deadline landed in the middle of it, every time. A
   * deadline cannot know what else is moving; the host can, and this is where
   * it says so. The news is given on the falling edge.
   *
   * A host that never sets it gets the old deadline, so an element used
   * plainly still corrects itself.
   */
  bool quiet{false};
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
