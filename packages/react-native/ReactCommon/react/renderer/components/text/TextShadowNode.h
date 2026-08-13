/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <limits>

#include <react/renderer/components/text/BaseTextShadowNode.h>
#include <react/renderer/components/text/TextProps.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/core/ConcreteShadowNode.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/core/LayoutableShadowNode.h>

namespace facebook::react {

extern const char TextComponentName[];

using TextEventEmitter = TouchEventEmitter;

/**
 * Inline text elements — authored `<Text>` and every intrinsic derived from it
 * (`<b>`/`<i>`/`<span>`/`<u>`, the unknown-element fallback).
 *
 * The base is `LayoutableShadowNode` purely so these elements can CARRY layout
 * metrics. They are still never laid out by Yoga — nothing casts them to
 * `YogaLayoutableShadowNode`, so box generation and painting are byte-for-byte
 * unchanged, and authored `<Text>` keeps its exact RN layout behavior. Their
 * metrics are stamped from the text engine's per-fragment rects by the
 * containing Paragraph/View (`stampInlineElementMetrics`), which is what lets
 * `getBoundingClientRect()` report a real box for an inline element: the DOM
 * walk in `LayoutableShadowNode::computeRelativeLayoutMetrics` bails unless
 * every node between the root and the target is layoutable.
 */
class TextShadowNode
    : public ConcreteShadowNode<TextComponentName, LayoutableShadowNode, TextProps, TextEventEmitter>,
      public BaseTextShadowNode {
 public:
  static ShadowNodeTraits BaseTraits()
  {
    auto traits = ConcreteShadowNode::BaseTraits();
    // Text and all inline text elements (the intrinsics <b>/<i>/<span>/<u>/… and the unknown
    // fallback are TextShadowNode subclasses) flow inline in a View's anonymous IFC.
    traits.set(ShadowNodeTraits::Trait::InlineText);
#ifdef ANDROID
    traits.set(ShadowNodeTraits::Trait::FormsView);
#endif
    return traits;
  }

  using ConcreteShadowNode::ConcreteShadowNode;

  // Inert: an inline text element never runs a layout pass of its own. See the
  // class comment — the base exists only to hold stamped metrics.
  void layoutTree(LayoutContext /*layoutContext*/, LayoutConstraints /*layoutConstraints*/) override {}

  void layout(LayoutContext /*layoutContext*/) override {}

  void dirtyLayout() override {}

  bool getIsLayoutClean() const override
  {
    return true;
  }

  /*
   * An inline element mounts a view on Android (see `FormsView` below), but
   * that view is a handle — for refs and for the tag the mounting layer keys
   * on — never a box. CSS gives an inline element one box per line it spans
   * (CSS2 §9.2.2), so the single rectangle a view could take is wrong in both
   * directions: it would paint a plain rectangle over the sliced box the
   * inline formatting context paints, and it would hit-test the whole union
   * including the parts of those lines belonging to other elements.
   *
   * Returning empty metrics here leaves painting to `InlineBoxDecorationSpan`
   * and hit-testing to the text view's span lookup, both of which work per
   * fragment. The hit-testing half is verified: Android resolves a touch
   * inside text through `ReactCompoundView.reactTagForTouch(x, y)`
   * (`TouchTargetHelper`, and `PreparedLayoutTextView` implements it), which
   * maps the point to a span and returns that element's tag. It never consults
   * the child views' bounds, so an inline element's tag is found whether its
   * view is unsized, or flattened away entirely by view collapsing. It also restores upstream's shape, where this class is not
   * layoutable at all and the mounted view is consequently 0x0; the stamped
   * metrics this class holds exist for `getBoundingClientRect()`, which reads
   * the shadow tree and is unaffected.
   */
  LayoutMetrics getMountedLayoutMetrics() const override
  {
    return EmptyLayoutMetrics;
  }

#ifdef ANDROID
  using BaseShadowNode =
      ConcreteShadowNode<TextComponentName, LayoutableShadowNode, TextProps, TextEventEmitter>;

  TextShadowNode(const ShadowNodeFragment &fragment, const ShadowNodeFamily::Shared &family, ShadowNodeTraits traits)
      : BaseShadowNode(fragment, family, traits), BaseTextShadowNode()
  {
    orderIndex_ = std::numeric_limits<decltype(orderIndex_)>::max();
  }
#endif
};

} // namespace facebook::react
