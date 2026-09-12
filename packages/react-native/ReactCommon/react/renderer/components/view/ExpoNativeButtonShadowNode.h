/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ElementButtonShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>

#include <string>
#include <vector>

namespace facebook::react {

extern const char ExpoNativeButtonComponentName[];

// Its own props type: `RCTViewComponentView` asserts that a subclass's props
// are not literally `ViewProps`
class ExpoNativeButtonProps final : public ViewProps {
 public:
  ExpoNativeButtonProps() = default;
  ExpoNativeButtonProps(
      const PropsParserContext &context,
      const ExpoNativeButtonProps &sourceProps,
      const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps),
        title(convertRawProp(context, rawProps, "title", sourceProps.title, std::string{})),
        systemImage(convertRawProp(context, rawProps, "systemImage", sourceProps.systemImage, std::string{})),
        titleSize(convertRawProp(context, rawProps, "titleSize", sourceProps.titleSize, Float{0})),
        configuration(convertRawProp(context, rawProps, "configuration", sourceProps.configuration, std::string{})),
        commands(convertRawProp(context, rawProps, "commands", sourceProps.commands, std::vector<ElementMenuCommand>{}))
  {
  }

  // Given to the button's configuration rather than drawn as a child, so a glass
  // button draws its label inside its own chrome
  std::string title{};

  // An SF Symbol name, used instead of `title` when both are given
  std::string systemImage{};

  // The title's point size; 0 means the platform's own. A prop rather than
  // `font-size` because the title is configuration, not content the cascade
  // can reach.
  Float titleSize{0};

  // One of UIKit's configurations by its own name: `plain` (default), `gray`,
  // `tinted`, `filled`, `glass` or `prominentGlass`. Only `glass` puts the
  // button inside a glass effect view; before iOS 26 `glass` is `tinted` and
  // `prominentGlass` is `filled`.
  std::string configuration{};

  // Shared with `<button>`'s `<menu>`: both build the same `UIMenu`
  std::vector<ElementMenuCommand> commands{};
};

// `onCommand` carries the command's `id`, not its index: the list can reorder
// while the menu is open
class ExpoNativeButtonEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  void onCommand(const std::string &id) const
  {
    dispatchEvent("command", [id](jsi::Runtime &runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "id", jsi::String::createFromUtf8(runtime, id));
      return payload;
    });
  }

  // The button was tapped and has no commands to show
  void onPress() const
  {
    dispatchEvent("press");
  }
};

/**
 * `<native:button>`: a platform button whose action opens a `UIMenu`, or
 * reports `onPress` when it has no commands. Everything about it is UIKit's:
 * the interactive glass around it, the press tracking, and the menu, which is
 * presented in a window the app does not own and so can lie over the keyboard
 * (see `DOM-CSS-LIMITATION(overlay-cannot-cover-the-keys)`).
 */
using ExpoNativeButtonShadowNode =
    ConcreteViewShadowNode<ExpoNativeButtonComponentName, ExpoNativeButtonProps, ExpoNativeButtonEventEmitter>;

using ExpoNativeButtonComponentDescriptor = ConcreteComponentDescriptor<ExpoNativeButtonShadowNode>;

} // namespace facebook::react
