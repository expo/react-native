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

extern const char ExpoNativeButtonComponentName[];

/*
 * Its own props type rather than `ViewProps`, for the same reason the panel has
 * one: `RCTViewComponentView` asserts that a subclass's props are not literally
 * `ViewProps`, and reusing them mounts and then dies on launch.
 */
class ExpoNativeButtonProps final : public ViewProps {
 public:
  ExpoNativeButtonProps() = default;
  ExpoNativeButtonProps(
      const PropsParserContext& context,
      const ExpoNativeButtonProps& sourceProps,
      const RawProps& rawProps)
      : ViewProps(context, sourceProps, rawProps),
        title(convertRawProp(context, rawProps, "title", sourceProps.title, std::string{})),
        systemImage(convertRawProp(context, rawProps, "systemImage", sourceProps.systemImage, std::string{})),
        titleSize(convertRawProp(context, rawProps, "titleSize", sourceProps.titleSize, Float{0})),
        configuration(
            convertRawProp(context, rawProps, "configuration", sourceProps.configuration, std::string{})),
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
   * Which of UIKit's button configurations draws it: `plain` (the default, a
   * bare `UIButton`), `gray`, `tinted`, `filled`, `glass` or `prominentGlass`,
   * by the platform's own names. Only `glass` puts the button inside a glass
   * effect view, which is what merges with a glass field and morphs into a
   * presentation; before iOS 26 `glass` is `tinted` and `prominentGlass` is
   * `filled`, what the system used for the same job.
   */
  std::string configuration{};

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
class ExpoNativeButtonEventEmitter : public ViewEventEmitter {
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

  /**
   * `onPress` — the button was tapped and has no commands to show. The
   * platform's glass button with the app's own thing to open, the way the
   * system chat's `+` opens its card.
   */
  void onPress() const
  {
    dispatchEvent("press");
  }
};

/**
 * `<native:button>` — a button whose action is to open a menu.
 *
 * Built to be the CONTROL GROUP for the composer's `+`, and shippable as
 * itself. Everything about it is the platform's: the glass is an interactive
 * `UIGlassEffect` view around the button (a glass configuration before iOS
 * 26), the press is the button's own tracking, and the menu is a `UIMenu` that
 * UIKit presents, positions and composites — or, with no commands, the tap is
 * `onPress` for the app to answer.
 *
 * The last of those is the reason this element exists. A menu presented by the
 * system is drawn in a window the app does not own, which is the only way
 * anything can lie over the keyboard — measured on the panel this replaces, a
 * view in the accessory's window is clipped dead at the accessory's bottom
 * edge, whatever its frame says. See
 * `DOM-CSS-LIMITATION(overlay-cannot-cover-the-keys)`.
 *
 * The press is the platform's here as it is on a glass `<button>`: there the
 * chrome is a glass configuration, here the button sits inside an interactive
 * `UIGlassEffect` view, and in both the growth and brightening under a finger
 * are UIKit's own.
 */
using ExpoNativeButtonShadowNode =
    ConcreteViewShadowNode<ExpoNativeButtonComponentName, ExpoNativeButtonProps, ExpoNativeButtonEventEmitter>;

using ExpoNativeButtonComponentDescriptor = ConcreteComponentDescriptor<ExpoNativeButtonShadowNode>;

} // namespace facebook::react
