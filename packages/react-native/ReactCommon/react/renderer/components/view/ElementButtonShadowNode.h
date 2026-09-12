/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>

#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewShadowNode.h>
#include <react/renderer/components/view/AriaAttributes.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>

namespace facebook::react {

extern const char ElementButtonComponentName[];

/*
 * One command in a button's `<menu>`.
 *
 * HTML says `<menu>` is "a list of commands", and that is exactly what a
 * platform menu is — so a `<button>` whose content includes a `<menu>` is a
 * button that opens one. A chat composer's `+` is this, and so is nearly every
 * overflow button on either platform.
 *
 * The commands arrive as a prop for the same reason `<select>`'s options do: a
 * platform menu is not a container whose children the app lays out. It is
 * handed a list and draws it itself, in a window the app does not own, so child
 * shadow nodes would be laying out views that are never on screen.
 * `<button><menu><button id="x">Reset</button></menu></button>` — the shape
 * HTML actually uses — works, because the tag resolves to a component that
 * reads its children and passes them here.
 *
 * Deliberately NOT a checkable list. `<select>` is a value with a current
 * choice and its menu marks that choice; a `<menu>` is a set of actions, and
 * marking one of them "on" would say something untrue about what the button
 * does.
 */
struct ElementMenuCommand {
  /** What comes back on `onCommand`, and what identifies the child. */
  std::string id{};
  std::string label{};
  bool disabled{false};
  /** A destructive command is drawn in the platform's warning colour. */
  bool destructive{false};
  /**
   * The command's glyph, as an image SOURCE rather than a name — the same
   * `system:<symbol>` scheme `<img>` takes, so a menu and a picture say where a
   * symbol comes from the same way.
   */
  std::string icon{};
  /**
   * Which GROUP the command belongs to, or empty for the menu's top level.
   *
   * A `<menu>` nested inside a `<menu>` is a group — which is what nesting
   * already means — and every command in it carries the same key. Consecutive
   * commands sharing one become an inline `UIMenu`, and a group whose commands
   * ALL carry an icon is presented at `UIMenuElementSizeSmall`: UIKit's compact
   * row of glyphs, where the native chat app puts its reactions.
   *
   * The row is chosen by the group rather than inferred from the absence of
   * labels, which was the first rule here and was wrong twice. `preferredElementSize`
   * is a property of a MENU and says nothing about its children's titles —
   * Apple's own compact rows give each action both a title and an image. And
   * inferring it from icon-only commands would have made an author drop the
   * labels to get the row, which is the accessible name gone: a row of six
   * reactions that VoiceOver cannot read.
   */
  std::string section{};

  bool operator==(const ElementMenuCommand& rhs) const
  {
    return std::tie(id, label, disabled, destructive, icon, section) ==
        std::tie(rhs.id, rhs.label, rhs.disabled, rhs.destructive, rhs.icon, rhs.section);
  }
  bool operator!=(const ElementMenuCommand& rhs) const
  {
    return !(*this == rhs);
  }
};

inline void fromRawValue(const PropsParserContext& context, const RawValue& value, ElementMenuCommand& result)
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
 * The interactive box: what backs `<button>`, and what any element whose
 * behavior is "a box you can press" is swapped onto.
 *
 * It exists as a component separate from `element-box` for one reason: it
 * carries an event emitter that `element-box` does not, and a
 * `ComponentDescriptor` derives its event emitter from a single shadow node.
 * The alternative — putting press events on every box — would put an emitter
 * on every `<div>` in the tree to serve the few that are interactive.
 *
 * Layout-wise it is a box — a `<button>` may contain arbitrary children, which
 * no platform's label-based button control can host — but its *chrome and
 * behaviour under the finger* are the platform's own: on iOS the view hosts a
 * real `UIButton` (configuration-styled) as its background layer, and on
 * Android the box wears the Material button construction (shape, inset,
 * ripple). An author style replaces the chrome; the behaviour stays.
 * See `expo-intrinsics/__docs__/UIKitElements.md`.
 *
 * Press recognition is native and flag-gated: with
 * `enableNativeGestureRecognizers` on, the platform view installs a real
 * recognizer that participates in the platform's own arbitration, so a scroll
 * claiming the gesture cancels the press without a round trip through
 * JavaScript. With the flag off, the element behaves as it does today.
 */
class ElementButtonEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  /*
   * Press-state transitions — and deliberately *only* these.
   *
   * Activation is not emitted here, because it already exists and is already
   * correct: `RCTSurfacePointerHandler` dispatches `click` natively when a
   * pointer ends inside its initial tree, and already suppresses it when an
   * enclosing scroll view scrolled during the gesture. Emitting a click from
   * this recognizer too would fire every handler twice.
   *
   * What has no native answer today is the *press state* — whether the element
   * is currently being pressed — which is what `:active` needs in order to be
   * evaluated without asking JavaScript, and what a press that slides off or is
   * stolen by a scroll has to report its way back out of.
   */
  /** A command in this button's menu was chosen. */
  void onElementCommand(const std::string& id) const {
    dispatchEvent("elementCommand", [id](jsi::Runtime& runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "id", jsi::String::createFromUtf8(runtime, id));
      return payload;
    });
  }

  void onElementPressChange(bool pressed) const {
    dispatchEvent("elementPressChange", [pressed](jsi::Runtime& runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "pressed", pressed);
      return payload;
    });
  }
};

class ElementButtonProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementButtonProps() = default;
  ElementButtonProps(
      const PropsParserContext& context,
      const ElementButtonProps& sourceProps,
      const RawProps& rawProps)
      : ViewProps(context, sourceProps, rawProps),
        // IN DECLARATION ORDER. A member initialiser list out of order is a
        // `-Wreorder-ctor` error under the `-Werror` the Android and Fantom
        // builds use, and merely a warning Xcode does not show — so it compiles
        // on iOS and fails everywhere else, which is a confusing way to find
        // out. `menuCommands` was appended here and declared near the top, and
        // that is exactly what happened.
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})),
        menuCommands(
            convertRawProp(context, rawProps, "menuCommands", sourceProps.menuCommands, std::vector<ElementMenuCommand>{})),
        appleVisualEffect(
            convertRawProp(context, rawProps, "appleVisualEffect", sourceProps.appleVisualEffect, std::string{})),
        appleVisualEffectFade(convertRawProp(
            context, rawProps, "appleVisualEffectFade", sourceProps.appleVisualEffectFade, Float{0})),
        disabled(convertRawProp(context, rawProps, "disabled", sourceProps.disabled, false)),
        touchAction(convertRawProp(context, rawProps, "touchAction", sourceProps.touchAction, std::string{})),
        buttonStyle(convertRawProp(context, rawProps, "buttonStyle", sourceProps.buttonStyle, std::string{})),
        hasAuthorChrome(convertRawProp(context, rawProps, "hasAuthorChrome", sourceProps.hasAuthorChrome, false)),
        authorStatesPressFeedback(convertRawProp(
            context, rawProps, "authorStatesPressFeedback", sourceProps.authorStatesPressFeedback, false)),
        accessibleAuthored(rawProps.at("accessible") != nullptr || sourceProps.accessibleAuthored),
        traitsAuthored(
            rawProps.at("accessibilityRole") != nullptr || rawProps.at("accessibilityTraits") != nullptr ||
            sourceProps.traitsAuthored)
  {
    // User-agent accessibility defaults: the implicit ARIA role of the HTML
    // element. A `<button>` is a single accessibility element that announces as
    // a button. Without this the platform sees only the text inside it —
    // VoiceOver reported the element as `AXStaticText` with the label and no
    // indication it could be activated, which is how this was found.
    //
    // The `*Authored` flags exist because a UA default cannot be expressed by
    // passing a different default to `convertRawProp`: that helper returns the
    // *source* value when a prop is absent (its `defaultValue` applies only to
    // an explicit null), and props absent from an update payload mean
    // "unchanged". Without tracking authorship, an author's `accessible={false}`
    // would be honoured on the commit that set it and silently reverted on the
    // next one.
    if (!accessibleAuthored) {
      accessible = true;
    }
    if (!traitsAuthored) {
      accessibilityTraits = accessibilityTraits | AccessibilityTraits::Button;
    }

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

  /**
   * The commands this button opens as a menu, or empty for an ordinary button.
   *
   * Non-empty turns a press into "open the menu" rather than "activate", which
   * is what `showsMenuAsPrimaryAction` means on iOS and what an overflow button
   * does on Android.
   */
  std::vector<ElementMenuCommand> menuCommands{};

  /**
   * The material behind this button, spelled as `-apple-visual-effect`.
   *
   * The same property the generic box has, on the element that most often
   * wants it: the native composer's `+` is a circle of material with a glyph
   * on it — a blurred, blended background under a plain glyph — and so is
   * every glass control iOS 26
   * puts in a bar. A button that had to be wrapped in a `<div>` to get one
   * would be an element telling authors it is not really a box.
   */
  std::string appleVisualEffect{};
  Float appleVisualEffectFade{0};

  /*
   * A disabled button is not merely unstyled: it must not recognize a press at
   * all, so the recognizer is disabled natively rather than the event being
   * dropped after the fact. That is what keeps a disabled control from eating
   * a gesture an ancestor scroll wanted.
   */
  bool disabled{false};

  /*
   * CSS `touch-action`, which is how the web says who owns a gesture.
   *
   * `none` means this element claims a gesture that starts on it, so an
   * enclosing scroll container must not steal it — the behaviour a slider or
   * any scrubbable control needs, and the reason a `UISlider` inside a table
   * view adjusts rather than scrolls. Empty means `auto`: the scroll wins,
   * which is right for a button.
   *
   * Named after the CSS property rather than something like `ownsDrag` because
   * this *is* that property, and an author who knows the web already knows
   * what it does.
   */
  std::string touchAction{};

  /*
   * The button's prominence, in the platform's vocabulary: "prominent" for the
   * style each platform gives its primary action (UIKit's filled
   * configuration, Material's filled button), anything else for the neutral
   * one (UIKit's gray, Material's tonal).
   *
   * Set from HTML's own semantics rather than by taste: a submit button is the
   * form's primary action, and `<button>`'s default type IS submit. The
   * JavaScript side owns that mapping; this prop only carries the answer.
   */
  std::string buttonStyle{};

  /*
   * Whether the author has claimed the surface (a background or border of
   * their own). Computed in JavaScript next to the style prop it reads —
   * `authorStatesSurface` in Button.js — because both platform views need the
   * same answer and neither should re-derive it from raw styles. The platform
   * chrome is drawn only when this is false.
   */
  bool hasAuthorChrome{false};

  /*
   * Whether the author's own styles answer a press — a `:active` rule, or any
   * declaration that varies with the interaction state.
   *
   * When they do, the platform must not ALSO respond: the two land on
   * different clocks, ours instantly and theirs over its transition, which was
   * reported from a device as a button that "goes dark on press and then
   * changes colour again". When they do not, a button that does nothing at all
   * under a finger is worse — it reads as broken — so the platform answers.
   */
  bool authorStatesPressFeedback{false};

  /*
   * Whether the author ever supplied these, so the user-agent defaults above
   * apply only until they do — and stay out of the way afterwards.
   */
  bool accessibleAuthored{false};
  bool traitsAuthored{false};
};

/*
 * `AbstractViewShadowNode`, not the bare concrete template: that is what carries
 * the text-children layout and paint machinery, and without it a
 * `<button>Save</button>` — the form HTML is actually written in — lays out at
 * the right size and then paints an empty rectangle. Observed exactly that way
 * on device before this was templated to accept an event emitter.
 */
using ElementButtonShadowNode = AbstractViewShadowNode<
    ElementButtonComponentName,
    ElementButtonProps,
    ElementButtonEventEmitter>;

using ElementButtonComponentDescriptor =
    ConcreteComponentDescriptor<ElementButtonShadowNode>;

} // namespace facebook::react
