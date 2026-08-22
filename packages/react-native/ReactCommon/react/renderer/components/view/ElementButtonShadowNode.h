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
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>

namespace facebook::react {

extern const char ElementButtonComponentName[];

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
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})),
        disabled(convertRawProp(context, rawProps, "disabled", sourceProps.disabled, false)),
        touchAction(convertRawProp(context, rawProps, "touchAction", sourceProps.touchAction, std::string{})),
        buttonStyle(convertRawProp(context, rawProps, "buttonStyle", sourceProps.buttonStyle, std::string{})),
        hasAuthorChrome(convertRawProp(context, rawProps, "hasAuthorChrome", sourceProps.hasAuthorChrome, false)),
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
  }

  std::string domNodeName() const override
  {
    return nodeName;
  }

  std::string nodeName{};

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
