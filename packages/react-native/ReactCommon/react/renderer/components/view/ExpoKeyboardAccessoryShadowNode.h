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

// Its own type even where `ViewProps` would do: `RCTViewComponentView` asserts a
// subclass's props are not literally `ViewProps`
class ExpoKeyboardAccessoryProps final : public ViewProps {
 public:
  ExpoKeyboardAccessoryProps() = default;
  ExpoKeyboardAccessoryProps(
      const PropsParserContext &context,
      const ExpoKeyboardAccessoryProps &sourceProps,
      const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps),
        scope(convertRawProp(context, rawProps, "scope", sourceProps.scope, std::string{})),
        appleVisualEffect(
            convertRawProp(context, rawProps, "appleVisualEffect", sourceProps.appleVisualEffect, std::string{})),
        appleVisualEffectFade(
            convertRawProp(context, rawProps, "appleVisualEffectFade", sourceProps.appleVisualEffectFade, Float{0})),
        appleVisualEffectOpacity(convertRawProp(
            context,
            rawProps,
            "appleVisualEffectOpacity",
            sourceProps.appleVisualEffectOpacity,
            Float{1})),
        automaticInsets(convertRawProp(context, rawProps, "automaticInsets", sourceProps.automaticInsets, true))
  {
  }

  // Who the bar belongs to: `"screen"` (the default) shows it while its view
  // controller's screen is the visible one; `"app"` keeps it up across
  // navigation, for an app whose composer is the app
  std::string scope{};

  // The material the bar's whole surface is made of, spelled as the box's
  // `-apple-visual-effect`, and how far it fades in from its top edge. On the
  // bar rather than a child box because a docked bar is taller than its content,
  // reaching through the home indicator's strip.
  std::string appleVisualEffect{};
  Float appleVisualEffectFade{0};

  // How strongly the material is applied, 0 to 1, as the effect view's own
  // opacity; the platform's darkest bar material is still lighter than the
  // native composer's. It attenuates the blur with the tint, since it blends
  // toward the unblurred content. Named beside `appleVisualEffectFade` rather
  // than as CSS `opacity`, which would fade the children too.
  Float appleVisualEffectOpacity{1};

  // Whether the bar reserves the strip of the home indicator's band the keys do
  // not cover; on by default. Off is for an app that draws into that strip, as
  // the platform's composer does, since a padding smaller than the safe area
  // cannot be expressed while the element also reserves; `onDockChange` then
  // reports the uncovered strip. A boolean, because this element insets one edge.
  bool automaticInsets{true};
};

/*
 * `<native:keyboardaccessory>`, a bar that is part of the keyboard. The name is
 * what makes the platform mount the keyboard-hosted view; full width, out of the
 * flow and against the bottom are ordinary style written by the component. No
 * state: the bar is as wide as the surface rather than the keyboard, which
 * differ only in an iPad split view, see `dom-css-limitations.md`.
 */
using ExpoKeyboardAccessoryShadowNode = ConcreteViewShadowNode<
    ExpoKeyboardAccessoryComponentName,
    ExpoKeyboardAccessoryProps,
    ExpoKeyboardAccessoryEventEmitter>;

using ExpoKeyboardAccessoryComponentDescriptor = ConcreteComponentDescriptor<ExpoKeyboardAccessoryShadowNode>;

} // namespace facebook::react
