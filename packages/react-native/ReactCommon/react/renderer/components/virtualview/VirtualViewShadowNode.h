/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/FBReactNativeSpec/EventEmitters.h>
#include <react/renderer/components/FBReactNativeSpec/Props.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>

#include <cmath>
#include <optional>

namespace facebook::react {

constexpr const char VirtualViewComponentName[] = "VirtualView";

class VirtualViewShadowNode final
    : public ConcreteViewShadowNode<VirtualViewComponentName, VirtualViewProps, VirtualViewEventEmitter> {
 public:
  VirtualViewShadowNode(
      const ShadowNodeFragment& fragment,
      const ShadowNodeFamily::Shared& family,
      ShadowNodeTraits traits)
      : ConcreteViewShadowNode(fragment, family, traits) {}

  VirtualViewShadowNode(const ShadowNode& sourceShadowNode, const ShadowNodeFragment& fragment)
      : ConcreteViewShadowNode(sourceShadowNode, fragment)
  {
    holdSpaceWhileHidden(static_cast<const VirtualViewShadowNode&>(sourceShadowNode));
  }

  static ShadowNodeTraits BaseTraits()
  {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    // <VirtualView> has a side effect: it listens to scroll events.
    // It must not be culled, otherwise Fling will not work.
    traits.set(ShadowNodeTraits::Trait::Unstable_uncullableView);
    return traits;
  }

 private:
  /*
   * `VirtualViewRenderState` in VirtualView.js: what the JavaScript side has
   * rendered into this node. `None` is a hidden row — a placeholder with no
   * children, holding the row's place in the scroll.
   */
  static constexpr int kRenderStateNone = 2;

  /**
   * The height this row had when it was last rendered, UNROUNDED, held for as
   * long as it is hidden.
   *
   * A hidden row is a placeholder with the row's height as its style. The only
   * height JavaScript can see is the mounted one, which Yoga has rounded to the
   * pixel grid — and a rounded height is not the row's height. Yoga rounds
   * EDGES, not sizes: a row of 56.5 points sitting at a fractional position
   * mounts as 56.67 or 56.33 depending on where it sits, and a placeholder
   * given that number pushes every row below it by the difference, up to a
   * sixth of a point, which flips the rounding of their edges in turn. Measured:
   * a hundred-row transcript flicked past its end, and every mode change at
   * the prerender edge moved the content size by a third of a point and every
   * visible row by a pixel. On a device that third of a point was the fuel of
   * a loop that re-laid the transcript ninety times in one bounce.
   *
   * The row itself knows the unrounded number: it is the measured dimension
   * Yoga keeps beside the rounded one, and this node is the only place that
   * can read it. Taken from the rendered node at the moment it becomes hidden,
   * carried across every clone while it stays hidden, and dropped when it
   * renders again. A row that was never rendered has nothing to hold and keeps
   * the estimate JavaScript gave it.
   */
  std::optional<float> heldHeight_;

  void holdSpaceWhileHidden(const VirtualViewShadowNode& source)
  {
    if (getConcreteProps().renderState != kRenderStateNone) {
      heldHeight_ = std::nullopt;
      return;
    }
    if (source.getConcreteProps().renderState != kRenderStateNone) {
      // Rendered a moment ago: its layout is the one to keep.
      const float measured = source.yogaNode_.getLayout().measuredDimension(yoga::Dimension::Height);
      heldHeight_ = (!std::isnan(measured) && measured > 0) ? std::optional<float>{measured} : source.heldHeight_;
    } else {
      heldHeight_ = source.heldHeight_;
    }
    if (!heldHeight_.has_value()) {
      return;
    }
    // Both, because the placeholder style from JavaScript is a `minHeight`
    // and would otherwise win over a height below it by the rounding.
    auto style = yogaNode_.style();
    const auto length = yoga::StyleSizeLength::points(*heldHeight_);
    style.setDimension(yoga::Dimension::Height, length);
    style.setMinDimension(yoga::Dimension::Height, length);
    yogaNode_.setStyle(style);
    yogaNode_.setDirty(true);
  }
};

} // namespace facebook::react
