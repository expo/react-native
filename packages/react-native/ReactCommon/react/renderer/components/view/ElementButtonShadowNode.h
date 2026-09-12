/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>

#include <react/renderer/components/view/AriaAttributes.h>
#include <react/renderer/components/view/ElementAuthorStatedPadding.h>
#include <react/renderer/components/view/ElementControlMetrics.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/components/view/ViewShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>

namespace facebook::react {

extern const char ElementButtonComponentName[];

/*
 * One command in a button's `<menu>`, HTML's "list of commands", which a
 * `<button>` containing one opens as a platform menu. The commands arrive as a
 * prop, like `<select>`'s options, because a platform menu draws its own list
 * in a window the app does not own. Not a checkable list: a `<menu>` is a set
 * of actions, not a value with a current choice.
 */
struct ElementMenuCommand {
  // Reported on `onCommand`
  std::string id{};
  std::string label{};
  bool disabled{false};
  // Drawn in the platform's warning colour
  bool destructive{false};
  // An image source in the same `system:<symbol>` scheme `<img>` takes
  std::string icon{};
  // The group a nested `<menu>` puts the command in; empty at the top level.
  // Consecutive commands sharing a group become an inline `UIMenu`, and a group
  // whose commands all carry an icon is presented at `UIMenuElementSizeSmall`.
  // The row is chosen by the group, not by the absence of labels, so an author
  // never has to drop the accessible name to get it.
  std::string section{};

  bool operator==(const ElementMenuCommand &rhs) const
  {
    return std::tie(id, label, disabled, destructive, icon, section) ==
        std::tie(rhs.id, rhs.label, rhs.disabled, rhs.destructive, rhs.icon, rhs.section);
  }
  bool operator!=(const ElementMenuCommand &rhs) const
  {
    return !(*this == rhs);
  }
};

inline void fromRawValue(const PropsParserContext &context, const RawValue &value, ElementMenuCommand &result)
{
  auto map = (std::unordered_map<std::string, RawValue>)value;

  auto id = map.find("id");
  if (id != map.end() && id->second.hasType<std::string>()) {
    fromRawValue(context, id->second, result.id);
  }
  auto label = map.find("label");
  if (label != map.end() && label->second.hasType<std::string>()) {
    fromRawValue(context, label->second, result.label);
  }
  auto disabled = map.find("disabled");
  if (disabled != map.end() && disabled->second.hasType<bool>()) {
    fromRawValue(context, disabled->second, result.disabled);
  }
  auto destructive = map.find("destructive");
  if (destructive != map.end() && destructive->second.hasType<bool>()) {
    fromRawValue(context, destructive->second, result.destructive);
  }
  auto icon = map.find("icon");
  if (icon != map.end() && icon->second.hasType<std::string>()) {
    fromRawValue(context, icon->second, result.icon);
  }
  auto section = map.find("section");
  if (section != map.end() && section->second.hasType<std::string>()) {
    fromRawValue(context, section->second, result.section);
  }

  // A command with no `id` is identified by its label, which is the same rule
  // HTML gives an `<option>` with no `value`.
  if (result.id.empty()) {
    result.id = result.label;
  }
}

/*
 * The interactive box behind `<button>` and every element that is "a box you
 * can press". Separate from `element-box` because it carries an event emitter,
 * which a `ComponentDescriptor` derives from a single shadow node; giving every
 * `<div>` an emitter would serve the few interactive ones at everyone's cost.
 *
 * Layout-wise it is a box, since a `<button>` may contain arbitrary children;
 * its chrome and press behaviour are the platform's: a configuration-styled
 * `UIButton` behind the content on iOS, the Material button construction on
 * Android. An author style replaces the chrome and keeps the behaviour. With
 * `enableNativeGestureRecognizers` the platform view installs a real
 * recognizer, so a scroll claiming the gesture cancels the press without a
 * round trip through JavaScript.
 */
class ElementButtonEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  // Press-state transitions only. Activation stays with
  // `RCTSurfacePointerHandler`, which already dispatches `click` and suppresses
  // it when an enclosing scroll view scrolled; emitting it here too would fire
  // every handler twice.
  void onElementCommand(const std::string &id) const
  {
    dispatchEvent("elementCommand", [id](jsi::Runtime &runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "id", jsi::String::createFromUtf8(runtime, id));
      return payload;
    });
  }

  void onElementPressChange(bool pressed) const
  {
    dispatchEvent("elementPressChange", [pressed](jsi::Runtime &runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "pressed", pressed);
      return payload;
    });
  }
};

class ElementButtonProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementButtonProps() = default;
  ElementButtonProps(const PropsParserContext &context, const ElementButtonProps &sourceProps, const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps),
        // In declaration order: `-Wreorder-ctor` is an error under the `-Werror`
        // of the Android and Fantom builds, and only a hidden warning in Xcode
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})),
        menuCommands(convertRawProp(
            context,
            rawProps,
            "menuCommands",
            sourceProps.menuCommands,
            std::vector<ElementMenuCommand>{})),
        appleVisualEffect(
            convertRawProp(context, rawProps, "appleVisualEffect", sourceProps.appleVisualEffect, std::string{})),
        appleVisualEffectFade(
            convertRawProp(context, rawProps, "appleVisualEffectFade", sourceProps.appleVisualEffectFade, Float{0})),
        disabled(convertRawProp(context, rawProps, "disabled", sourceProps.disabled, false)),
        touchAction(convertRawProp(context, rawProps, "touchAction", sourceProps.touchAction, std::string{})),
        buttonStyle(convertRawProp(context, rawProps, "buttonStyle", sourceProps.buttonStyle, std::string{})),
        hasAuthorChrome(convertRawProp(context, rawProps, "hasAuthorChrome", sourceProps.hasAuthorChrome, false)),
        authorStatesPressFeedback(convertRawProp(
            context,
            rawProps,
            "authorStatesPressFeedback",
            sourceProps.authorStatesPressFeedback,
            false)),
        accessibleAuthored(rawProps.at("accessible") != nullptr || sourceProps.accessibleAuthored),
        traitsAuthored(
            rawProps.at("accessibilityRole") != nullptr || rawProps.at("accessibilityTraits") != nullptr ||
            sourceProps.traitsAuthored)
  {
    // The implicit ARIA role: a `<button>` is one accessibility element that
    // announces as a button, where the platform would otherwise see only the
    // text inside it. The `*Authored` flags are needed because `convertRawProp`
    // returns the source value for an absent prop, so a default passed to it
    // would revert an author's `accessible={false}` on the next commit.
    if (!accessibleAuthored) {
      accessible = true;
    }
    if (!traitsAuthored) {
      accessibilityTraits = accessibilityTraits | AccessibilityTraits::Button;
    }

    // Applied last so ARIA wins over the `accessibility*` props, and here
    // rather than in the base so only elements pay for the reads
    applyAriaAttributes(context, rawProps, *this);
  }

  std::string domNodeName() const override
  {
    return nodeName;
  }

  std::string nodeName{};

  // Non-empty turns a press into opening the menu rather than activating
  // (`showsMenuAsPrimaryAction` on iOS)
  std::vector<ElementMenuCommand> menuCommands{};

  // `-apple-visual-effect`, the same property the generic box has
  std::string appleVisualEffect{};
  Float appleVisualEffectFade{0};

  /*
   * A disabled button is not merely unstyled: it must not recognize a press at
   * all, so the recognizer is disabled natively rather than the event being
   * dropped after the fact. That is what keeps a disabled control from eating
   * a gesture an ancestor scroll wanted.
   */
  bool disabled{false};

  // CSS `touch-action`: `none` claims a gesture that starts on the element so
  // an enclosing scroll must not steal it, as a `UISlider` in a table view
  // does; empty means `auto` and the scroll wins
  std::string touchAction{};

  // "prominent" for the platform's primary-action style (UIKit filled, Material
  // filled), anything else for the neutral one. JavaScript derives it from
  // HTML's semantics: a submit button is the form's primary action.
  std::string buttonStyle{};

  // Whether the author claimed the surface with a background or border of
  // their own; computed once in JavaScript (`authorStatesSurface`) for both
  // platforms. The platform chrome is drawn only when false.
  bool hasAuthorChrome{false};

  // Whether the author's styles answer a press (`:active` or any declaration
  // that varies with interaction state). When they do, the platform must not
  // also respond: the two land on different clocks.
  bool authorStatesPressFeedback{false};

  // Whether the author supplied these, so the user-agent defaults apply only
  // until they do
  bool accessibleAuthored{false};
  bool traitsAuthored{false};
};

/*
 * `AbstractViewShadowNode` rather than the bare concrete template, because it
 * carries the text-children layout and paint machinery a `<button>Save</button>`
 * needs to paint its content.
 *
 * A button's padding is the control's, folded onto the node's style: a button
 * lays out around its children, and a node with children cannot carry a Yoga
 * measure function the way `<select>` and the fields do. Folded only when the
 * author states padding on neither axis.
 */
class ElementButtonShadowNode final
    : public AbstractViewShadowNode<ElementButtonComponentName, ElementButtonProps, ElementButtonEventEmitter> {
 public:
  using AbstractViewShadowNode::AbstractViewShadowNode;

  void applyPlatformChrome()
  {
    // As a unit, not per axis, unlike the text area's inset
    // (DOM-CSS-DEVIATION(button-chrome-withdraws-as-a-unit)): an author who
    // states padding on either axis has taken the spacing over
    const auto &props = getConcreteProps();
    if (elementStatesBlockPadding(props) || elementStatesInlinePadding(props)) {
      return;
    }
    // Skip the insets when the author has claimed the surface, since they are
    // the platter's and the platter is not drawn: a 16-point shadcn checkbox
    // kept them and came out 48 wide
    if (props.hasAuthorChrome) {
      return;
    }
    const auto metrics = elementControlMetrics();
    ensureUnsealed();
    auto style = yogaNode_.style();
    style.setPadding(yoga::Edge::Vertical, yoga::StyleLength::points(metrics.buttonPaddingBlock));
    style.setPadding(yoga::Edge::Horizontal, yoga::StyleLength::points(metrics.buttonPaddingInline));
    yogaNode_.setStyle(style);
  }
};

/*
 * Folded on adopt, which is where a node is finished — after the Yoga style
 * has been built from props, so this is not overwritten by it.
 */
class ElementButtonComponentDescriptor final : public ConcreteComponentDescriptor<ElementButtonShadowNode> {
 public:
  using ConcreteComponentDescriptor::ConcreteComponentDescriptor;

 protected:
  void adopt(ShadowNode &shadowNode) const override
  {
    ConcreteComponentDescriptor::adopt(shadowNode);
    static_cast<ElementButtonShadowNode &>(shadowNode).applyPlatformChrome();
  }
};

} // namespace facebook::react
