/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>

namespace facebook::react {

extern const char ElementColorInputComponentName[];

/*
 * `<input type="color">` — a swatch that opens a colour picker.
 *
 * The platforms are genuinely unequal here, and this is the one element where
 * that shows in the result rather than only in the code. iOS has
 * `UIColorPickerViewController`, the same picker the system uses everywhere,
 * with a spectrum, sliders, an eyedropper and saved colours. Android has no
 * system colour picker at all — not in the framework and not in Material — so
 * every Android app that offers one has built it. What this element offers
 * there is a grid of swatches, which is what most Android apps that need a
 * colour actually show.
 *
 * DOM-CSS-LIMITATION: an Android user therefore cannot pick an arbitrary colour
 * the way an iOS or desktop-browser user can. This is a platform gap being
 * recorded rather than a port being skipped; closing it properly means building
 * a spectrum picker, which is a piece of UI in its own right.
 *
 * The value is HTML's `#rrggbb`, lowercase, always seven characters — the DOM
 * requires exactly that, and code on the web depends on it.
 */
class ElementColorInputEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  /*
   * `input` fires continuously while the user moves through colours, `change`
   * when they close the picker on one — the same split as a slider, and the
   * split the DOM specifies for this element.
   */
  void onElementInput(const std::string& value) const {
    dispatchEvent("elementInput", [value](jsi::Runtime& runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "value", jsi::String::createFromUtf8(runtime, value));
      return payload;
    });
  }

  void onElementChange(const std::string& value) const {
    dispatchEvent("elementChange", [value](jsi::Runtime& runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "value", jsi::String::createFromUtf8(runtime, value));
      return payload;
    });
  }
};

class ElementColorInputProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementColorInputProps() = default;
  ElementColorInputProps(
      const PropsParserContext& context,
      const ElementColorInputProps& sourceProps,
      const RawProps& rawProps)
      : ViewProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})),
        // HTML's default for a colour input with no value is black, and it is
        // never empty — the element always has a colour.
        value(convertRawProp(context, rawProps, "value", sourceProps.value, std::string{"#000000"})),
        disabled(convertRawProp(context, rawProps, "disabled", sourceProps.disabled, false))
  {
  }

  std::string domNodeName() const override
  {
    return nodeName;
  }

  std::string nodeName{};
  std::string value{"#000000"};
  bool disabled{false};
};

using ElementColorInputShadowNode = ConcreteViewShadowNode<
    ElementColorInputComponentName,
    ElementColorInputProps,
    ElementColorInputEventEmitter>;

using ElementColorInputComponentDescriptor = ConcreteComponentDescriptor<ElementColorInputShadowNode>;

} // namespace facebook::react
