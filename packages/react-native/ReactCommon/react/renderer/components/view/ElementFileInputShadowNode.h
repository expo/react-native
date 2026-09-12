/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>
#include <vector>

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/AriaAttributes.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>

namespace facebook::react {

extern const char ElementFileInputComponentName[];

/*
 * One chosen file, as `change` reports it.
 *
 * `name`, `size` and `type` are the `File` properties web code reads. `uri` is
 * the addition the DOM has no equivalent for and that native code cannot do
 * without: a browser hands the file's *bytes* to `FormData`, while here the
 * file stays where it is and the app is given a handle to it. Copying every
 * picked file into memory to imitate the web would make choosing a video an
 * out-of-memory crash.
 */
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
  void onElementChange(const std::vector<ElementFileDescriptor>& files) const {
    dispatchEvent("elementChange", [files](jsi::Runtime& runtime) {
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
 * `<input type="file">` — the platform's own document picker.
 *
 * DOM-CSS-LIMITATION: this offers the *file* picker only. Safari's file input
 * also offers the photo library and the camera, from an action sheet; matching
 * that needs `PHPickerViewController` and `UIImagePickerController`, which live
 * in frameworks this target does not link today. Choosing a photo that has been
 * saved to Files works; choosing one straight from the library does not.
 */
class ElementFileInputProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementFileInputProps() = default;
  ElementFileInputProps(
      const PropsParserContext& context,
      const ElementFileInputProps& sourceProps,
      const RawProps& rawProps)
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

using ElementFileInputShadowNode = ConcreteViewShadowNode<
    ElementFileInputComponentName,
    ElementFileInputProps,
    ElementFileInputEventEmitter>;

using ElementFileInputComponentDescriptor = ConcreteComponentDescriptor<ElementFileInputShadowNode>;

} // namespace facebook::react
