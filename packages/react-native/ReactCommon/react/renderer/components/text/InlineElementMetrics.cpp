/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "InlineElementMetrics.h"

#include <react/renderer/components/text/TextShadowNode.h>
#include <react/renderer/components/view/YogaLayoutableShadowNode.h>
#include <unordered_map>

namespace facebook::react {

namespace {

// Union of two rects, treating an unset (zero-area at origin) rect as absent.
Rect unionRect(const Rect& a, const Rect& b) {
  const auto minX = std::min(a.origin.x, b.origin.x);
  const auto minY = std::min(a.origin.y, b.origin.y);
  const auto maxX =
      std::max(a.origin.x + a.size.width, b.origin.x + b.size.width);
  const auto maxY =
      std::max(a.origin.y + a.size.height, b.origin.y + b.size.height);
  return Rect{
      .origin = {minX, minY}, .size = {maxX - minX, maxY - minY}};
}

// Pass 1, post-order: the box each element occupies — its own fragments plus
// those of every inline element inside it, exactly as on the web where a
// <span> wrapping a <b> covers both. Recorded per tag so pass 2 can read any
// node's box without walking its subtree again; doing the union inline during
// the stamping walk instead re-walks each subtree once per ancestor, which is
// quadratic in nesting depth for no reason.
//
// `hasBox` distinguishes "no fragments here" from a legitimately empty rect.
Rect unionSubtree(
    const ShadowNode& node,
    const std::unordered_map<Tag, Rect>& boxesByTag,
    std::unordered_map<Tag, Rect>& unionsByTag,
    bool& hasBox) {
  Rect box{};
  hasBox = false;

  const auto tag = node.getFamily().getTag();
  const auto own = boxesByTag.find(tag);
  if (own != boxesByTag.end()) {
    box = own->second;
    hasBox = true;
  }

  for (const auto& child : node.getChildren()) {
    bool childHasBox = false;
    const auto childBox =
        unionSubtree(*child, boxesByTag, unionsByTag, childHasBox);
    if (childHasBox) {
      box = hasBox ? unionRect(box, childBox) : childBox;
      hasBox = true;
    }
  }

  if (hasBox) {
    unionsByTag[tag] = box;
  }
  return box;
}

// Pass 2, pre-order: stamp each element with the box pass 1 computed for it.
//
// `stampedAncestorOrigin` is the run-space origin of the nearest ancestor that
// was itself stamped, and it is what makes a NESTED element land in the right
// place — which is also why this pass has to run top-down. Every box is
// computed in the run's coordinate space, but layout metrics are read back
// relative to the parent NODE: `getBoundingClientRect` sums frame origins up
// the tree. A top-level inline element gets away with run-space coordinates
// because its parent IS the container; a nested one has its ancestor's offset
// applied a second time. Measured before the subtraction:
// `a<span padding-left:12>c<b>d</b></span>` reported the <b> at x=42 when its
// box is at 32, and the error tracked the leading text exactly (10 / 20 / 30
// for one / two / three characters) while a <b> that was NOT nested was
// correct to the point.
void stampSubtree(
    const ShadowNode& node,
    const std::unordered_map<Tag, Rect>& unionsByTag,
    Point contentOrigin,
    const LayoutMetrics& ownerLayoutMetrics,
    Point stampedAncestorOrigin,
    bool hasStampedAncestor,
    std::vector<PendingInlineElementMetrics>& pending) {
  const auto found = unionsByTag.find(node.getFamily().getTag());
  const bool hasBox = found != unionsByTag.end();
  const auto box = hasBox ? found->second : Rect{};

  // Stampable inline-level content: the text vocabulary (TextShadowNode —
  // <span>/<b>/nested <Text>) and span-like `display:'inline'` Views. The
  // Views use the SAME predicate the run fold uses to decide folding
  // (isInlineFlowContent), so an element folds into the run and reports
  // fragment geometry under one definition — and everything Yoga actually
  // lays out (atomic inlines, blockified Views in flex containers) is
  // excluded by that same predicate and keeps its real metrics.
  const auto* textNode = dynamic_cast<const TextShadowNode*>(&node);
  const bool stampableInlineFlow = textNode == nullptr &&
      YogaLayoutableShadowNode::isInlineFlowContent(node);
  const bool stampable = textNode != nullptr || stampableInlineFlow;

  if (hasBox && stampable) {
    auto metrics = ownerLayoutMetrics;
    // Relative to the nearest stamped ancestor when there is one, because that
    // ancestor's own frame origin is already applied on the way down; relative
    // to the owner's content box otherwise.
    metrics.frame = Rect{
        .origin = hasStampedAncestor
            ? Point{
                  box.origin.x - stampedAncestorOrigin.x,
                  box.origin.y - stampedAncestorOrigin.y}
            : Point{
                  contentOrigin.x + box.origin.x,
                  contentOrigin.y + box.origin.y},
        .size = box.size};

    // Stamping metrics on a node of the committed tree is the same mutation
    // the owning View already performs for inline `<img>` attachments, and it
    // happens during the owner's layout pass.
    //
    // A sealed node cannot be mutated here: layout runs again on subtrees that
    // were not re-cloned — a state update anywhere in the surface re-lays out
    // this run while its children still belong to the previous generation —
    // and `setLayoutMetrics` would trip `ensureUnsealed`, aborting the process
    // in any build with assertions on. It is handed to the owner instead,
    // which can clone the path to it. Dropping it is NOT safe: these metrics
    // come from the run's layout, not its content, so an element that did not
    // change still moves whenever the run rewraps around it.
    if (!node.getSealed()) {
      if (textNode != nullptr) {
        const_cast<TextShadowNode*>(textNode)->setLayoutMetrics(metrics);
      } else {
        const_cast<YogaLayoutableShadowNode*>(
            static_cast<const YogaLayoutableShadowNode*>(&node))
            ->setLayoutMetrics(metrics);
      }
    } else if (
        static_cast<const LayoutableShadowNode&>(node).getLayoutMetrics() !=
        metrics) {
      // Only when they actually differ: cloning is the expensive path, and an
      // unchanged element is the overwhelmingly common case.
      pending.push_back(
          PendingInlineElementMetrics{
              .family = &node.getFamily(), .metrics = metrics});
    }
  }

  const auto childAncestorOrigin =
      (hasBox && stampable) ? box.origin : stampedAncestorOrigin;
  const bool childHasStampedAncestor =
      (hasBox && stampable) || hasStampedAncestor;
  for (const auto& child : node.getChildren()) {
    stampSubtree(
        *child,
        unionsByTag,
        contentOrigin,
        ownerLayoutMetrics,
        childAncestorOrigin,
        childHasStampedAncestor,
        pending);
  }
}

} // namespace

bool hasStampableInlineElements(
    const ShadowNode& owner,
    const AttributedString& attributedString) {
  const auto ownerTag = owner.getFamily().getTag();
  for (const auto& fragment : attributedString.getFragments()) {
    const auto tag = fragment.parentShadowView.tag;
    // Exactly the predicate `stampInlineElementMetrics` applies below when it
    // builds `boxesByTag`; kept in step with it deliberately.
    if (tag != 0 && tag != ownerTag) {
      return true;
    }
  }
  return false;
}

std::vector<PendingInlineElementMetrics> stampInlineElementMetrics(
    const ShadowNode& owner,
    const AttributedString& attributedString,
    const std::vector<Rect>& fragmentRects,
    Point contentOrigin,
    const LayoutMetrics& ownerLayoutMetrics) {
  std::vector<PendingInlineElementMetrics> pending;
  if (fragmentRects.empty()) {
    // The platform text engine does not report fragment rects yet; leave the
    // elements without metrics, exactly as before.
    return pending;
  }

  const auto& fragments = attributedString.getFragments();
  const auto count = std::min(fragments.size(), fragmentRects.size());

  // Union the fragments belonging to each element. A fragment's
  // `parentShadowView` is the element that contributed it (see
  // `BaseTextShadowNode::buildAttributedString`); fragments whose parent is
  // the owner itself describe bare text, which has no element to stamp.
  std::unordered_map<Tag, Rect> boxesByTag;
  for (size_t i = 0; i < count; i++) {
    const auto tag = fragments[i].parentShadowView.tag;
    if (tag == 0 || tag == owner.getFamily().getTag()) {
      continue;
    }
    const auto existing = boxesByTag.find(tag);
    if (existing == boxesByTag.end()) {
      boxesByTag.emplace(tag, fragmentRects[i]);
    } else {
      existing->second = unionRect(existing->second, fragmentRects[i]);
    }
  }

  if (boxesByTag.empty()) {
    return pending;
  }

  std::unordered_map<Tag, Rect> unionsByTag;
  bool hasBox = false;
  unionSubtree(owner, boxesByTag, unionsByTag, hasBox);
  stampSubtree(
      owner,
      unionsByTag,
      contentOrigin,
      ownerLayoutMetrics,
      Point{0, 0},
      /* hasStampedAncestor */ false,
      pending);
  return pending;
}

} // namespace facebook::react
