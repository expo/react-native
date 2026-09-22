/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>

namespace facebook::react {

extern const char ExpoKeyboardPanelComponentName[];

/*
 * Its own props type rather than `ViewProps`, for the same reason the accessory
 * has one: `RCTViewComponentView` asserts that a subclass's props are not
 * literally `ViewProps`, and reusing them mounts and then dies on launch.
 */
class ExpoKeyboardPanelProps final : public ViewProps {
 public:
  ExpoKeyboardPanelProps() = default;
  ExpoKeyboardPanelProps(
      const PropsParserContext& context,
      const ExpoKeyboardPanelProps& sourceProps,
      const RawProps& rawProps)
      : ViewProps(context, sourceProps, rawProps),
        visible(convertRawProp(context, rawProps, "visible", sourceProps.visible, false))
  {
  }

  /**
   * Whether the panel is TAKING THE KEYBOARD'S PLACE.
   *
   * Not "is it on screen": the panel is the responder's `inputView`, so raising
   * it is the same act as raising a keyboard and the system runs the same
   * transition. Which is the whole reason to do it this way — a panel drawn
   * over the keyboard would have to imitate that transition, and imitating it
   * is what makes a panel feel bolted on.
   */
  bool visible{false};

};

/*
 * `<native:keyboardpanel>` — a panel that REPLACES the keyboard.
 *
 * The native chat's `+` opens one: the keys go away, a panel takes their place,
 * and the composer stays where it is. UIKit has a primitive for exactly that —
 * `UIResponder.inputView` — and using it means the system owns the animation,
 * the height, the safe area and the dismissal, none of which have to be
 * reproduced.
 *
 * It is a sibling of the accessory rather than a child of it: the accessory is
 * what rides ABOVE the keyboard and the panel is what stands IN for it. Two
 * different slots on the same responder.
 */
using ExpoKeyboardPanelShadowNode =
    ConcreteViewShadowNode<ExpoKeyboardPanelComponentName, ExpoKeyboardPanelProps, ViewEventEmitter>;

using ExpoKeyboardPanelComponentDescriptor = ConcreteComponentDescriptor<ExpoKeyboardPanelShadowNode>;

} // namespace facebook::react
