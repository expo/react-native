/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/ElementButtonShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>

#include <string>
#include <vector>

namespace facebook::react {

extern const char ExpoMenuButtonComponentName[];

/*
 * Its own props type rather than `ViewProps`, for the same reason the panel has
 * one: `RCTViewComponentView` asserts that a subclass's props are not literally
 * `ViewProps`, and reusing them mounts and then dies on launch.
 */
class ExpoMenuButtonProps final : public ViewProps {
 public:
  ExpoMenuButtonProps() = default;
  ExpoMenuButtonProps(
      const PropsParserContext& context,
      const ExpoMenuButtonProps& sourceProps,
      const RawProps& rawProps)
      : ViewProps(context, sourceProps, rawProps),
        title(convertRawProp(context, rawProps, "title", sourceProps.title, std::string{})),
        systemImage(convertRawProp(context, rawProps, "systemImage", sourceProps.systemImage, std::string{})),
        titleSize(convertRawProp(context, rawProps, "titleSize", sourceProps.titleSize, Float{0})),
        prominent(convertRawProp(context, rawProps, "prominent", sourceProps.prominent, false)),
        commands(convertRawProp(
            context,
            rawProps,
            "commands",
            sourceProps.commands,
            std::vector<ElementMenuCommand>{}))
  {
  }

  /**
   * The button's label. A `+` for a composer; a word for anything else.
   *
   * Given to the button's CONFIGURATION rather than drawn as a child, and that
   * is the point of this component. A glass button draws its label inside its
   * own chrome, below the material and above the refraction; a label supplied
   * as a subview sits on top of the glass instead of in it, and reads as a
   * sticker on a button rather than as the button's own text.
   */
  std::string title{};

  /** An SF Symbol name, used instead of `title` when both are given. */
  std::string systemImage{};

  /**
   * The title's point size; 0 means the platform's own.
   *
   * A prop rather than `font-size`, because the title is CONFIGURATION and not
   * content: it never becomes a text node, so there is nothing for the style
   * cascade to reach. Naming it separately is what keeps that visible, rather
   * than having a `font-size` that works on this one element and nowhere else
   * that takes its label the same way.
   */
  Float titleSize{0};

  /**
   * The platform's two prominences: a filled, tinted glass or a plain one.
   *
   * The same distinction `<button>` draws from HTML's semantics, stated
   * directly here because this element has no semantics to draw it from.
   */
  bool prominent{false};

  /**
   * The menu's commands, in order.
   *
   * `ElementMenuCommand` is shared with `<button>`'s `<menu>` rather than
   * redefined: the two elements build the same `UIMenu` from the same fields,
   * and a second struct that happened to agree would only be a second thing to
   * keep in step.
   */
  std::vector<ElementMenuCommand> commands{};
};

/**
 * `onCommand` — one of the menu's commands was chosen.
 *
 * The command's `id`, not its index: a list that reorders between the render
 * that built the menu and the tap that chose from it would otherwise report the
 * wrong command, and a menu is open for as long as someone is reading it.
 */
class ExpoMenuButtonEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  void onCommand(const std::string& id) const
  {
    dispatchEvent("command", [id](jsi::Runtime& runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "id", jsi::String::createFromUtf8(runtime, id));
      return payload;
    });
  }
};

/**
 * `<native:menubutton>` — a button whose action is to open a menu.
 *
 * Built to be the CONTROL GROUP for the composer's `+`, and shippable as
 * itself. Everything about it is the platform's: the glass is a
 * `UIButtonConfiguration`, the press is the button's own tracking, and the menu
 * is a `UIMenu` that UIKit presents, positions and composites.
 *
 * The last of those is the reason this element exists. A menu presented by the
 * system is drawn in a window the app does not own, which is the only way
 * anything can lie over the keyboard — measured on the panel this replaces, a
 * view in the accessory's window is clipped dead at the accessory's bottom
 * edge, whatever its frame says. See
 * `DOM-CSS-LIMITATION(overlay-cannot-cover-the-keys)`.
 *
 * And because the button owns its touches, it gets the platform's glass press —
 * the growth and brightening that `<button>` has to reproduce from measurements,
 * because there the touch belongs to React's pointer system. See
 * `DOM-CSS-DEVIATION(glass-press-reproduced)`.
 */
using ExpoMenuButtonShadowNode =
    ConcreteViewShadowNode<ExpoMenuButtonComponentName, ExpoMenuButtonProps, ExpoMenuButtonEventEmitter>;

using ExpoMenuButtonComponentDescriptor = ConcreteComponentDescriptor<ExpoMenuButtonShadowNode>;

} // namespace facebook::react
