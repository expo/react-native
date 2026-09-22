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

// Its own props type: `RCTViewComponentView` asserts a subclass's props are not
// literally `ViewProps`
class ExpoKeyboardPanelProps final : public ViewProps {
 public:
  ExpoKeyboardPanelProps() = default;
  ExpoKeyboardPanelProps(
      const PropsParserContext &context,
      const ExpoKeyboardPanelProps &sourceProps,
      const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps),
        visible(convertRawProp(context, rawProps, "visible", sourceProps.visible, false))
  {
  }

  // Whether the panel is taking the keyboard's place: it is the responder's
  // `inputView`, so raising it runs the keyboard's own transition
  bool visible{false};
};

// `<native:keyboardpanel>`: a panel that replaces the keyboard through
// `UIResponder.inputView`, so the system owns the animation, the height, the
// safe area and the dismissal. A sibling of the accessory, which rides above the
// keyboard where this stands in for it.
using ExpoKeyboardPanelShadowNode =
    ConcreteViewShadowNode<ExpoKeyboardPanelComponentName, ExpoKeyboardPanelProps, ViewEventEmitter>;

using ExpoKeyboardPanelComponentDescriptor = ConcreteComponentDescriptor<ExpoKeyboardPanelShadowNode>;

} // namespace facebook::react
