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
#include <react/renderer/graphics/Float.h>

namespace facebook::react {

extern const char ExpoTopLayerComponentName[];

// Its own props type: `RCTViewComponentView` asserts a subclass's props are not
// literally `ViewProps`
class ExpoTopLayerProps final : public ViewProps {
 public:
  ExpoTopLayerProps() = default;
  ExpoTopLayerProps(const PropsParserContext &context, const ExpoTopLayerProps &sourceProps, const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps),
        active(convertRawProp(context, rawProps, "active", sourceProps.active, false))
  {
  }

  // Whether the layer is up: the children are drawn above the screen while it
  // is, and nowhere while it is not (a closed popover keeps its handle)
  bool active{false};
};

// `onOutsidePress`: a press began on the screen outside everything in the
// layer, which is what light-dismisses an `auto` popover (HTML §6.12.3). Where,
// in window coordinates, so a press on the popover's own invoker can be told
// apart: that one toggles the popover through its click instead.
class ExpoTopLayerEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  void onOutsidePress(Float x, Float y) const
  {
    dispatchEvent("outsidePress", [x, y](jsi::Runtime &runtime) -> jsi::Value {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "x", x);
      payload.setProperty(runtime, "y", y);
      return payload;
    });
  }
};

/*
 * `<native:toplayer>`: HTML's top layer for the elements in it. The element
 * stays where React renders it, so its children keep their context and lay out
 * against it, but they are painted above everything on the screen, unclipped by
 * the ancestors they were written in, at the element's place in the window. A
 * popover shown with `showPopover()` and a modal `<dialog>` render in one.
 *
 * Never culled: its children are drawn outside its own box, which is empty.
 */
class ExpoTopLayerShadowNode final
    : public ConcreteViewShadowNode<ExpoTopLayerComponentName, ExpoTopLayerProps, ExpoTopLayerEventEmitter> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  static ShadowNodeTraits BaseTraits()
  {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::Unstable_uncullableView);
    return traits;
  }
};

using ExpoTopLayerComponentDescriptor = ConcreteComponentDescriptor<ExpoTopLayerShadowNode>;

} // namespace facebook::react
