/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>

#include <react/renderer/components/view/ElementAuthorStatedPadding.h>
#include <react/renderer/components/view/ElementControlMetrics.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/components/view/ViewShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/dom/NodeNameProvider.h>

namespace facebook::react {

extern const char ElementButtonComponentName[];

/*
 * The interactive box backing `<button>`: a box that carries a press event
 * emitter, separate from `element-box` because a `ComponentDescriptor` derives
 * its emitter from one shadow node and every `<div>` would otherwise carry
 * one. The platform view draws the chrome (a `UIButton` configuration, the
 * Material construction) and, with `enableNativeGestureRecognizers` on,
 * tracks the press in the platform's own arbitration so a scroll cancels it
 * without a round trip through JavaScript. An author style replaces the
 * chrome; the behaviour stays.
 */
class ElementButtonEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  // Press-state transitions only, for `:active`. `RCTSurfacePointerHandler`
  // dispatches `click` and suppresses it when an enclosing scroll view
  // scrolled, so emitting it here too would fire every handler twice
  void onElementPressChange(bool pressed) const
  {
    dispatchEvent("elementPressChange", [pressed](jsi::Runtime &runtime) {
      auto payload = jsi::Object(runtime);
      payload.setProperty(runtime, "pressed", pressed);
      return payload;
    });
  }
};

class ElementButtonProps final : public ViewProps, public NodeNameProvider {
 public:
  ElementButtonProps() = default;
  ElementButtonProps(const PropsParserContext &context, const ElementButtonProps &sourceProps, const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps),
        nodeName(convertRawProp(context, rawProps, "nodeName", sourceProps.nodeName, std::string{})),
        disabled(convertRawProp(context, rawProps, "disabled", sourceProps.disabled, false)),
        touchAction(convertRawProp(context, rawProps, "touchAction", sourceProps.touchAction, std::string{})),
        buttonStyle(convertRawProp(context, rawProps, "buttonStyle", sourceProps.buttonStyle, std::string{})),
        hasAuthorChrome(convertRawProp(context, rawProps, "hasAuthorChrome", sourceProps.hasAuthorChrome, false)),
        authorStatesPressFeedback(convertRawProp(
            context,
            rawProps,
            "authorStatesPressFeedback",
            sourceProps.authorStatesPressFeedback,
            false)),
        accessibleAuthored(rawProps.at("accessible") != nullptr || sourceProps.accessibleAuthored),
        traitsAuthored(
            rawProps.at("accessibilityRole") != nullptr || rawProps.at("accessibilityTraits") != nullptr ||
            sourceProps.traitsAuthored)
  {
    // The element's implicit role: one accessibility element announcing as a
    // button. The `*Authored` flags exist because `convertRawProp` returns the
    // source value for an absent prop and an absent prop means unchanged, so
    // an author's `accessible={false}` would otherwise revert on the next
    // commit
    if (!accessibleAuthored) {
      accessible = true;
    }
    if (!traitsAuthored) {
      accessibilityTraits = accessibilityTraits | AccessibilityTraits::Button;
    }
  }

  std::string domNodeName() const override
  {
    return nodeName;
  }

  std::string nodeName{};

  /*
   * A disabled button is not merely unstyled: it must not recognize a press at
   * all, so the recognizer is disabled natively rather than the event being
   * dropped after the fact. That is what keeps a disabled control from eating
   * a gesture an ancestor scroll wanted.
   */
  bool disabled{false};

  // CSS `touch-action`: `none` claims a gesture that starts on this element,
  // as a scrubbable control needs; empty is `auto` and the scroll wins
  std::string touchAction{};

  /*
   * The button's prominence, in the platform's vocabulary: "prominent" for the
   * style each platform gives its primary action (UIKit's filled
   * configuration, Material's filled button), anything else for the neutral
   * one (UIKit's gray, Material's tonal).
   *
   * Set from HTML's own semantics rather than by taste: a submit button is the
   * form's primary action, and `<button>`'s default type IS submit. The
   * JavaScript side owns that mapping; this prop only carries the answer.
   */
  std::string buttonStyle{};

  /*
   * Whether the author has claimed the surface (a background or border of
   * their own). Computed in JavaScript next to the style prop it reads —
   * `authorStatesSurface` in Button.js — because both platform views need the
   * same answer and neither should re-derive it from raw styles. The platform
   * chrome is drawn only when this is false.
   */
  bool hasAuthorChrome{false};

  // Whether the author's styles answer a press (`:active` or any
  // state-varying declaration). The platform answers only when they do not;
  // two feedbacks land on different clocks
  bool authorStatesPressFeedback{false};

  /*
   * Whether the author ever supplied these, so the user-agent defaults above
   * apply only until they do — and stay out of the way afterwards.
   */
  bool accessibleAuthored{false};
  bool traitsAuthored{false};
};

// `AbstractViewShadowNode` carries the text-children layout and paint
// machinery; without it `<button>Save</button>` paints an empty rectangle
// The control's content insets, folded onto the node because a node laid out
// around children cannot carry a Yoga measure function. Folded only when the
// author states padding on neither axis
class ElementButtonShadowNode final
    : public AbstractViewShadowNode<ElementButtonComponentName, ElementButtonProps, ElementButtonEventEmitter> {
 public:
  using AbstractViewShadowNode::AbstractViewShadowNode;

  void applyPlatformChrome()
  {
    // As a unit, not per axis, since the insets are one design with the
    // platter (DOM-CSS-DEVIATION(button-chrome-withdraws-as-a-unit))
    const auto &props = getConcreteProps();
    if (elementStatesBlockPadding(props) || elementStatesInlinePadding(props)) {
      return;
    }
    // Skip the insets when the author has claimed the surface, since they are
    // the platter's and the platter is not drawn: a 16-point shadcn checkbox
    // kept them and came out 48 wide
    if (props.hasAuthorChrome) {
      return;
    }
    const auto metrics = elementControlMetrics();
    ensureUnsealed();
    auto style = yogaNode_.style();
    style.setPadding(yoga::Edge::Vertical, yoga::StyleLength::points(metrics.buttonPaddingBlock));
    style.setPadding(yoga::Edge::Horizontal, yoga::StyleLength::points(metrics.buttonPaddingInline));
    yogaNode_.setStyle(style);
  }
};

/*
 * Folded on adopt, which is where a node is finished — after the Yoga style
 * has been built from props, so this is not overwritten by it.
 */
class ElementButtonComponentDescriptor final : public ConcreteComponentDescriptor<ElementButtonShadowNode> {
 public:
  using ConcreteComponentDescriptor::ConcreteComponentDescriptor;

 protected:
  void adopt(ShadowNode &shadowNode) const override
  {
    ConcreteComponentDescriptor::adopt(shadowNode);
    static_cast<ElementButtonShadowNode &>(shadowNode).applyPlatformChrome();
  }
};

} // namespace facebook::react
