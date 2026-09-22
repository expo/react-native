/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/cxxstableapi/PrivateGuard.h>

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
      const ShadowNodeFragment &fragment,
      const ShadowNodeFamily::Shared &family,
      ShadowNodeTraits traits)
      : ConcreteViewShadowNode(fragment, family, traits)
  {
  }

  VirtualViewShadowNode(const ShadowNode &sourceShadowNode, const ShadowNodeFragment &fragment)
      : ConcreteViewShadowNode(sourceShadowNode, fragment)
  {
    holdSpaceWhileHidden(static_cast<const VirtualViewShadowNode &>(sourceShadowNode));
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
  // `VirtualViewRenderState.None` in VirtualView.js: a hidden row, a
  // placeholder with no children holding the row's place
  static constexpr int kRenderStateNone = 2;

  /*
   * The height this row had when last rendered, unrounded, held while it is
   * hidden. JavaScript can only see the mounted height, which Yoga has rounded
   * to the pixel grid by edges rather than sizes, and a placeholder given that
   * number shifts every row below it by up to a fraction of a point. Yoga keeps
   * the measured dimension beside the rounded one; it is taken when the row
   * becomes hidden, carried across clones, and dropped when it renders again.
   */
  std::optional<float> heldHeight_;

  void holdSpaceWhileHidden(const VirtualViewShadowNode &source)
  {
    if (getConcreteProps().renderState != kRenderStateNone) {
      heldHeight_ = std::nullopt;
      return;
    }
    if (source.getConcreteProps().renderState != kRenderStateNone) {
      // Rendered a moment ago: its layout is the one to keep
      const float measured = source.yogaNode_.getLayout().measuredDimension(yoga::Dimension::Height);
      heldHeight_ = (!std::isnan(measured) && measured > 0) ? std::optional<float>{measured} : source.heldHeight_;
    } else {
      heldHeight_ = source.heldHeight_;
    }
    if (!heldHeight_.has_value()) {
      return;
    }
    // Both, because the placeholder style from JavaScript is a `minHeight` and
    // would otherwise win over a height below it
    auto style = yogaNode_.style();
    const auto length = yoga::StyleSizeLength::points(*heldHeight_);
    style.setDimension(yoga::Dimension::Height, length);
    style.setMinDimension(yoga::Dimension::Height, length);
    yogaNode_.setStyle(style);
    yogaNode_.setDirty(true);
  }
};

} // namespace facebook::react
