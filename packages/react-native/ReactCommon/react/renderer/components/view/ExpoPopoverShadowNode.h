/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>

namespace facebook::react {

extern const char ExpoPopoverComponentName[];

// Its own props type: `RCTViewComponentView` asserts a subclass's props are not
// literally `ViewProps`
class ExpoPopoverProps final : public ViewProps {
 public:
  ExpoPopoverProps() = default;
  ExpoPopoverProps(const PropsParserContext &context, const ExpoPopoverProps &sourceProps, const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps),
        visible(convertRawProp(context, rawProps, "visible", sourceProps.visible, false)),
        anchorX(convertRawProp(context, rawProps, "anchorX", sourceProps.anchorX, Float{0})),
        anchorY(convertRawProp(context, rawProps, "anchorY", sourceProps.anchorY, Float{0})),
        anchorWidth(convertRawProp(context, rawProps, "anchorWidth", sourceProps.anchorWidth, Float{0})),
        anchorHeight(convertRawProp(context, rawProps, "anchorHeight", sourceProps.anchorHeight, Float{0}))
  {
  }

  // Whether the card is up; `onClose` says when the platform took it down
  bool visible{false};
  // The rectangle of the element the card grows out of, in window coordinates,
  // supplied by the app. Only its x locates the element: with a keyboard up the
  // measured y is where the bar sits in the layout, not where it is drawn.
  Float anchorX{0};
  Float anchorY{0};
  Float anchorWidth{0};
  Float anchorHeight{0};
};

// `onClose`: the card dismissed itself, on a tap outside, a pull or a rotation;
// `visible` is the app's state and must hear about it
class ExpoPopoverEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  void onClose() const
  {
    dispatchEvent("close");
  }
};

// `<native:popover>`: a card the platform presents as a popover, zoomed out of
// the glass of the element under `anchor`, over a keyboard stood down behind a
// picture of its keys
using ExpoPopoverShadowNode =
    ConcreteViewShadowNode<ExpoPopoverComponentName, ExpoPopoverProps, ExpoPopoverEventEmitter>;

using ExpoPopoverComponentDescriptor = ConcreteComponentDescriptor<ExpoPopoverShadowNode>;

} // namespace facebook::react
