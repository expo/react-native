/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ExpoKeyboardAccessoryEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>

namespace facebook::react {

extern const char ExpoKeyboardAccessoryComponentName[];

/*
 * No props of its own — yet — but its own TYPE.
 *
 * `RCTViewComponentView` asserts that a subclass's props are not literally
 * `ViewProps`, which is how it catches a component view that forgot to set them
 * up at all. Reusing `ViewProps` here compiled, mounted, and then killed the app
 * on launch with a message about a constructor that was in fact correct.
 */
class ExpoKeyboardAccessoryProps final : public ViewProps {
 public:
  ExpoKeyboardAccessoryProps() = default;
  ExpoKeyboardAccessoryProps(
      const PropsParserContext& context,
      const ExpoKeyboardAccessoryProps& sourceProps,
      const RawProps& rawProps)
      : ViewProps(context, sourceProps, rawProps),
        scope(convertRawProp(context, rawProps, "scope", sourceProps.scope, std::string{})),
        appleVisualEffect(
            convertRawProp(context, rawProps, "appleVisualEffect", sourceProps.appleVisualEffect, std::string{})),
        appleVisualEffectFade(convertRawProp(
            context,
            rawProps,
            "appleVisualEffectFade",
            sourceProps.appleVisualEffectFade,
            Float{0})),
        appleVisualEffectOpacity(convertRawProp(
            context,
            rawProps,
            "appleVisualEffectOpacity",
            sourceProps.appleVisualEffectOpacity,
            Float{1})),
        automaticInsets(
            convertRawProp(context, rawProps, "automaticInsets", sourceProps.automaticInsets, true))
  {
  }

  /**
   * Who the bar belongs to: `"screen"` (the default) or `"app"`.
   *
   * A real `inputAccessoryView` lives in the keyboard's own window, above
   * everything, and therefore does not belong to any one screen — push a screen
   * over it and it stays exactly where it was, floating over the transition.
   * That is right for an app whose composer IS the app, and wrong for a
   * navigator, where each screen should bring its own and take it away again.
   *
   * `"screen"` scopes it to the view controller it is mounted in: the bar shows
   * while that screen is the visible one and stands down while it is not.
   * `"app"` is the unscoped behaviour, which is what UIKit gives you if you make
   * a responder first responder and never let go — kept because an author who
   * wants it should not have to leave this element to get it.
   */
  std::string scope{};

  /**
   * The material this bar's whole surface is made of, and how far it fades in
   * from its top edge.
   *
   * On the BAR rather than on a box inside it, because a docked accessory is
   * taller than the content React laid out — it extends through the home
   * indicator's strip to the bottom of the screen, and that strip is part of
   * the bar's surface. A child box can only ever be as tall as its own layout,
   * so the material stopped short and left a seam.
   *
   * Same spelling as the box's `-apple-visual-effect`, deliberately: it is the
   * same property, on the element whose surface it describes.
   */
  std::string appleVisualEffect{};
  Float appleVisualEffectFade{0};

  /**
   * How strongly the material is applied, 0 to 1, and 1 is the platform's own.
   *
   * The effect view's own opacity, which blends the rendered material with the
   * content behind it. It exists because the platform's darkest bar material is
   * still lighter than the one the native composer uses: over a black page in dark mode,
   * measured on the same simulator, `systemChromeMaterial` renders (19,19,19)
   * against the native bar's (0,0,0), and every other stock style is lighter still —
   * thin, thick and ultra-thin all land at (31,31,31).
   *
   * It is a TRADE, and callers should know which way: opacity attenuates the
   * blur and the tint together, because what it blends toward is the unblurred
   * content. So a lower value is a bar that sits closer to the page AND smears
   * less. It buys agreement with the native bar on the empty page at the cost of the
   * thing the material was added for.
   *
   * A number rather than a keyword, and named beside `appleVisualEffectFade`
   * rather than spelled as CSS `opacity`: `opacity` on the element would fade
   * its CHILDREN — the field, the buttons, the text — and this fades only the
   * surface behind them.
   */
  Float appleVisualEffectOpacity{1};

  /**
   * Whether the bar reserves the strip of the home indicator's band that the
   * keys do not already cover. On by default, because a bar that ends under the
   * indicator is a bug and an author should not have to know that to avoid it.
   *
   * Off is for the app that wants to draw INTO that strip. The platform's own
   * chat is one: its composer's concentric padding is 28 and the bottom safe
   * area is 34, so it deliberately overlaps the top of the band. There is
   * no padding that expresses that while the element is also reserving, because
   * the two add; the only way to land on 28 is to own all 34 and pay 28 of it.
   *
   * An author who turns it off owes the padding themselves, and `onDockChange`
   * is what tells them how much of the strip is currently uncovered — the same
   * number the element would have reserved.
   *
   * A boolean rather than a map of edges, which is what `<native:scroll>` takes,
   * because this element insets one edge. `automaticInsets={false}` reads the
   * same on both.
   */
  bool automaticInsets{true};
};

/*
 * `<native:keyboardaccessory>` — a bar that is part of the keyboard.
 *
 * There is nothing here but a name, and the name is the point: it is what makes
 * the platform mount a view that hands its children to the keyboard rather than
 * an ordinary one. Everything else this element needs — full width, out of the
 * flow, against the bottom — is ordinary style, written by the component, so
 * there is no second way of saying it and nothing for an author to find
 * surprising when they read the layout back.
 *
 * In particular there is no state. An earlier draft took its width from the
 * platform, as `<InputAccessoryView>` does, so that the bar could be as wide as
 * the KEYBOARD rather than as wide as the surface. Those differ only when the
 * surface is narrower than the window — an iPad split view — and paying a state
 * round trip on every surface to be right about that one is the wrong trade.
 * Recorded rather than hidden: see `dom-css-limitations.md`.
 */
using ExpoKeyboardAccessoryShadowNode = ConcreteViewShadowNode<
    ExpoKeyboardAccessoryComponentName,
    ExpoKeyboardAccessoryProps,
    ExpoKeyboardAccessoryEventEmitter>;

using ExpoKeyboardAccessoryComponentDescriptor = ConcreteComponentDescriptor<ExpoKeyboardAccessoryShadowNode>;

} // namespace facebook::react
