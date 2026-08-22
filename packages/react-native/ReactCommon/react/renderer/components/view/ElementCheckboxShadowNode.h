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

extern const char ElementCheckboxComponentName[];

/*
 * `<input type="checkbox">` — a boolean, drawn by whichever control the
 * platform actually uses for one.
 *
 * The two platforms disagree, and following each is the point: iOS has no
 * checkbox, and a form boolean there is a `UISwitch`; Android has a real
 * `CheckBox` and uses it. Rendering an iOS-style switch on Android (or a drawn
 * tick on iOS) would look imported on both. The element is the semantic —
 * "a boolean the user can toggle" — and the control is the platform's answer to
 * it, which is the same reasoning that makes `<select>` a menu on one and a
 * dropdown on the other.
 */
class ElementCheckboxEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  /*
   * The DOM fires `change` on a checkbox, not `input`-then-change: toggling is
   * atomic, so there are no intermediate values to report.
   *
   * DOM-CSS-LIMITATION: `preventDefault()` on the click cannot stop the toggle.
   * The control toggles itself and then reports it. Unlike a text field — where
   * `onBeforeInput` is synchronous precisely so a refused character is never
   * drawn — nothing draws in between here: the switch reports a toggle it has
   * already animated, so there is no flicker to prevent, only a state to
   * disagree with. A controlled `checked` prop does that without blocking a
   * thread. See __docs__/SpecDeviations.md.
   */
  void onElementChange(bool checked) const {
    dispatchEvent("elementChange", [checked](jsi::Runtime& runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "checked", checked);
      return payload;
    });
  }
};

class ElementCheckboxProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementCheckboxProps() = default;
  ElementCheckboxProps(
      const PropsParserContext& context,
      const ElementCheckboxProps& sourceProps,
      const RawProps& rawProps)
      : ViewProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})),
        checked(convertRawProp(context, rawProps, "checked", sourceProps.checked, false)),
        disabled(convertRawProp(context, rawProps, "disabled", sourceProps.disabled, false))
  {
    // Deliberately no user-agent accessibility defaults here, unlike `<button>`.
    //
    // The backing is a platform control, and the control is what knows how to
    // describe itself: a `UISlider` is an adjustable that reports a value and
    // takes adjust gestures, a `UISwitch` is a toggle that announces on or off.
    // Stating traits here does not add to that, it *replaces* it — the platform
    // view stands in front of its control for accessibility purposes, so
    // whatever this says is what assistive technology hears, and it described a
    // checkbox as a plain button with no value. The component view forwards the
    // element's accessibility to the control instead, which leaves nothing for
    // props to default.
    //
    // `<button>` keeps its defaults, because there the container is the control.
  }

  std::string domNodeName() const override
  {
    return nodeName;
  }

  std::string nodeName{};
  bool checked{false};
  bool disabled{false};
};

using ElementCheckboxShadowNode =
    ConcreteViewShadowNode<ElementCheckboxComponentName, ElementCheckboxProps, ElementCheckboxEventEmitter>;

using ElementCheckboxComponentDescriptor = ConcreteComponentDescriptor<ElementCheckboxShadowNode>;

} // namespace facebook::react
