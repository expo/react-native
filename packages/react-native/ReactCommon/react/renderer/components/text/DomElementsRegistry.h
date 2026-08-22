/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <vector>

#include <react/renderer/componentregistry/ComponentDescriptorProvider.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>

#include <react/renderer/components/image/ImageShadowNode.h>
#include <react/renderer/components/text/InlineTextTagShadowNodes.h>
#include <react/renderer/components/view/ElementBoxShadowNode.h>
#include <react/renderer/components/view/ElementButtonShadowNode.h>
#include <react/renderer/components/view/ElementCheckboxShadowNode.h>
#include <react/renderer/components/view/ElementRangeShadowNode.h>
#include <react/renderer/components/view/ElementColorInputShadowNode.h>
#include <react/renderer/components/view/ElementDateInputShadowNode.h>
#include <react/renderer/components/view/ElementFileInputShadowNode.h>
#include <react/renderer/components/view/ElementProgressShadowNode.h>
#include <react/renderer/components/view/ElementRadioShadowNode.h>
#include <react/renderer/components/view/ElementSelectShadowNode.h>
#include <react/renderer/components/view/ElementTextAreaShadowNode.h>
#include <react/renderer/components/view/ElementTextInputShadowNode.h>

#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/attributedstring/AttributedStringBox.h>
#include <react/renderer/attributedstring/ParagraphAttributes.h>
#include <react/renderer/textlayoutmanager/TextLayoutContext.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>

namespace facebook::react::dom {

/*
 * `<select>`'s descriptor with the label measurer injected.
 *
 * The shadow node (view layer) shrink-to-fits its widest option but cannot
 * include the text layout manager — the same layering that keeps
 * InlineTextContentAccessor abstract — so the TEXT side owns the descriptor
 * and hands the node a measuring function on adopt. The label renders in the
 * platform control's own font (kElementSelectLabelFontSize, pinned against
 * the real control by EXPElementSelectGeometryTests), so that is what the
 * measure uses; the option strings never flow through the text cascade.
 */
class ElementSelectMeasuredComponentDescriptor final
    : public ConcreteComponentDescriptor<ElementSelectShadowNode> {
 public:
  explicit ElementSelectMeasuredComponentDescriptor(const ComponentDescriptorParameters& parameters)
      : ConcreteComponentDescriptor(parameters),
        textLayoutManager_(std::make_shared<const TextLayoutManager>(contextContainer_))
  {
  }

 protected:
  void adopt(ShadowNode& shadowNode) const override
  {
    ConcreteComponentDescriptor::adopt(shadowNode);
    auto& node = static_cast<ElementSelectShadowNode&>(shadowNode);
    auto textLayoutManager = textLayoutManager_;
    node.setLabelWidthMeasurer(
        [textLayoutManager](const std::string& label, Float pointScaleFactor, Float fontSizeMultiplier) -> Float {
          auto attributedString = AttributedString{};
          auto fragment = AttributedString::Fragment{};
          fragment.string = label;
          auto textAttributes = TextAttributes::defaultTextAttributes();
          textAttributes.fontSize = kElementSelectLabelFontSize;
          textAttributes.fontSizeMultiplier = fontSizeMultiplier;
          fragment.textAttributes = textAttributes;
          attributedString.appendFragment(std::move(fragment));
          const auto measurement = textLayoutManager->measure(
              AttributedStringBox{attributedString},
              ParagraphAttributes{},
              TextLayoutContext{.pointScaleFactor = pointScaleFactor},
              LayoutConstraints{});
          return measurement.size.width;
        });
  }

 private:
  std::shared_ptr<const TextLayoutManager> textLayoutManager_;
};

/*
 * Registration entry point for the intrinsic DOM elements — the native half of
 * the DOM-elements catalog (text-children-plan.md §3.C). This is the single
 * place that names every element descriptor, so the platform component
 * registries (iOS Paragraph supplemental providers, Android
 * CoreComponentsRegistry, the Fantom stub registry) call these helpers instead
 * of enumerating the descriptor types themselves.
 *
 * Deliberately self-contained so it can one day move to its own
 * `components/dom/` directory / package. The string-children and text-node
 * engine these elements render against stays in react-native and is NOT
 * registered here — text nodes (`#text`) belong to react-native, not to the DOM
 * element catalog.
 *
 * NOTE: header-only on purpose — it introduces no new compilation unit, so no
 * build-system wiring is required at any of the call sites.
 */

/*
 * Inline text elements — resolve inside a paragraph's inline formatting context:
 *   <b>/<i> (styled variants of the inline text element) and the generic
 *   inline text backing itself, which is also where unregistered tags go. Used where only inline-level elements are valid, e.g. the iOS
 *   Paragraph `supplementalComponentDescriptorProviders`.
 */
inline std::vector<ComponentDescriptorProvider> inlineTextElementProviders() {
  return {
      concreteComponentDescriptorProvider<InlineTextComponentDescriptor>(),
  };
}

/*
 * Every intrinsic DOM element: the inline text elements plus <img> (an inline
 * replaced element, Image-backed) and <div> (a block-level container). Used by
 * the app-level component registries that hold the full component set.
 */
inline std::vector<ComponentDescriptorProvider> allElementProviders() {
  auto providers = inlineTextElementProviders();
  providers.push_back(
      concreteComponentDescriptorProvider<ImgTagComponentDescriptor>());
  // The generic box: what backs every block element, and what an inline
  // element is swapped onto when its `display` establishes a formatting
  // context.
  providers.push_back(
      concreteComponentDescriptorProvider<ElementBoxComponentDescriptor>());
  // The interactive box: `<button>`, and anything else whose behavior is a
  // pressable box. Separate from the plain box because it carries a press
  // event emitter.
  providers.push_back(
      concreteComponentDescriptorProvider<ElementButtonComponentDescriptor>());
  // `<input type="range">`: a real platform slider, and the first element whose
  // gesture is a drag it owns rather than a press a scroll may steal.
  providers.push_back(
      concreteComponentDescriptorProvider<ElementRangeComponentDescriptor>());
  // `<input type="checkbox">`.
  providers.push_back(
      concreteComponentDescriptorProvider<ElementCheckboxComponentDescriptor>());
  // `<input>` in its textual forms — text, password, email, number, tel, url,
  // search — which share one control and differ by keyboard and masking.
  providers.push_back(
      concreteComponentDescriptorProvider<ElementTextInputComponentDescriptor>());
  // `<textarea>`, which shares `<input>`'s events but not its control.
  providers.push_back(
      concreteComponentDescriptorProvider<ElementTextAreaComponentDescriptor>());
  // `<progress>` and `<meter>` — readouts rather than controls, so they never
  // claim a gesture.
  providers.push_back(
      concreteComponentDescriptorProvider<ElementProgressComponentDescriptor>());
  // `<select>`, whose `<option>` children are flattened onto it as a prop —
  // the MEASURED descriptor, so the control shrink-to-fits its widest option.
  providers.push_back(
      concreteComponentDescriptorProvider<ElementSelectMeasuredComponentDescriptor>());
  // `<input type="radio">`.
  providers.push_back(
      concreteComponentDescriptorProvider<ElementRadioComponentDescriptor>());
  // `<input type="date">`, `"time"` and `"datetime-local"`.
  providers.push_back(
      concreteComponentDescriptorProvider<ElementDateInputComponentDescriptor>());
  // `<input type="color">`.
  providers.push_back(
      concreteComponentDescriptorProvider<ElementColorInputComponentDescriptor>());
  // `<input type="file">`.
  providers.push_back(
      concreteComponentDescriptorProvider<ElementFileInputComponentDescriptor>());
  return providers;
}

/*
 * Adds every intrinsic DOM element descriptor to a provider registry. Convenience
 * for the `add()`-shaped registries (Fantom stub, Android CoreComponentsRegistry).
 */
inline void addAllElementDescriptors(
    const ComponentDescriptorProviderRegistry& registry) {
  for (const auto& provider : allElementProviders()) {
    registry.add(provider);
  }
}

} // namespace facebook::react::dom
