/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>
#include <vector>

#include <react/renderer/components/view/AriaAttributes.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ElementControlMetrics.h>
#include <react/renderer/components/view/ElementControlSizeState.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>

namespace facebook::react {

extern const char ElementFileInputComponentName[];

// One chosen file: the `File` properties web code reads, plus `uri`, since a
// handle crosses rather than the bytes a browser hands to `FormData`
struct ElementFileDescriptor {
  std::string name{};
  std::string uri{};
  std::string type{};
  double size{0};
};

class ElementFileInputEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  /*
   * The DOM's `change`, and the only event a file input has: there are no
   * intermediate states, because the picker either returns a selection or is
   * cancelled. A cancelled picker reports nothing at all, as in a browser.
   */
  void onElementChange(const std::vector<ElementFileDescriptor> &files) const
  {
    dispatchEvent("elementChange", [files](jsi::Runtime &runtime) {
      auto payload = jsi::Object(runtime);
      auto list = jsi::Array(runtime, files.size());
      for (size_t i = 0; i < files.size(); i++) {
        auto file = jsi::Object(runtime);
        file.setProperty(runtime, "name", jsi::String::createFromUtf8(runtime, files[i].name));
        file.setProperty(runtime, "uri", jsi::String::createFromUtf8(runtime, files[i].uri));
        file.setProperty(runtime, "type", jsi::String::createFromUtf8(runtime, files[i].type));
        file.setProperty(runtime, "size", files[i].size);
        list.setValueAtIndex(runtime, i, file);
      }
      payload.setProperty(runtime, "files", list);
      return payload;
    });
  }
};

/*
 * The platform's document picker. DOM-CSS-LIMITATION: the file picker only;
 * Safari also offers the photo library and the camera, which need
 * `PHPickerViewController` and `UIImagePickerController` from frameworks this
 * target does not link.
 */
class ElementFileInputProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementFileInputProps() = default;
  ElementFileInputProps(
      const PropsParserContext &context,
      const ElementFileInputProps &sourceProps,
      const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})),
        // HTML's `accept`: a comma-separated list of MIME types or extensions.
        // Passed through as written, because the two platforms narrow it in
        // their own vocabularies — uniform type identifiers on one, MIME types
        // on the other.
        accept(convertRawProp(context, rawProps, "accept", sourceProps.accept, std::string{})),
        multiple(convertRawProp(context, rawProps, "multiple", sourceProps.multiple, false)),
        disabled(convertRawProp(context, rawProps, "disabled", sourceProps.disabled, false))
  {
    // ARIA, which is how an author of these elements spells accessibility.
    // Applied last so it wins over the `accessibility*` props, and applied
    // here rather than in the base so only elements pay for the reads.
    applyAriaAttributes(context, rawProps, *this);
  }

  std::string domNodeName() const override
  {
    return nodeName;
  }

  std::string nodeName{};
  std::string accept{};
  bool multiple{false};
  bool disabled{false};
};

/*
 * A measured leaf: the button shrink-to-fits a label that comes from the
 * picker and never reaches props, so the control reports its intrinsic size
 * through state rather than layout measuring it here.
 */
class ElementFileInputShadowNode final : public ConcreteViewShadowNode<
                                             ElementFileInputComponentName,
                                             ElementFileInputProps,
                                             ElementFileInputEventEmitter,
                                             ElementControlSizeState> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  static ShadowNodeTraits BaseTraits()
  {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(ShadowNodeTraits::Trait::MeasurableYogaNode);
    return traits;
  }

  Size measureContent(const LayoutContext & /*layoutContext*/, const LayoutConstraints &layoutConstraints)
      const override
  {
    const auto metrics = elementControlMetrics();
    return elementControlMeasuredSize(
        getStateData(), Size{metrics.fileDefaultWidth, metrics.fileDefaultHeight}, layoutConstraints);
  }
};

using ElementFileInputComponentDescriptor = ConcreteComponentDescriptor<ElementFileInputShadowNode>;

} // namespace facebook::react
