/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "InlineElementMetrics.h"

#include <react/renderer/components/text/TextShadowNode.h>
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

// Post-order walk: an inline element's box is the union of the fragments it
// contributed *and* those of every inline element inside it — exactly as on
// the web, where a <span> wrapping a <b> covers both. Returns the subtree's
// union so ancestors can accumulate it; `hasBox` distinguishes "no fragments
// here" from a legitimately empty rect.
Rect stampSubtree(
    const ShadowNode& node,
    const std::unordered_map<Tag, Rect>& boxesByTag,
    Point contentOrigin,
    const LayoutMetrics& ownerLayoutMetrics,
    bool& hasBox) {
  Rect box{};
  hasBox = false;

  const auto own = boxesByTag.find(node.getFamily().getTag());
  if (own != boxesByTag.end()) {
    box = own->second;
    hasBox = true;
  }

  for (const auto& child : node.getChildren()) {
    bool childHasBox = false;
    const auto childBox = stampSubtree(
        *child, boxesByTag, contentOrigin, ownerLayoutMetrics, childHasBox);
    if (childHasBox) {
      box = hasBox ? unionRect(box, childBox) : childBox;
      hasBox = true;
    }
  }

  if (hasBox && dynamic_cast<const TextShadowNode*>(&node) != nullptr) {
    auto metrics = ownerLayoutMetrics;
    metrics.frame = Rect{
        .origin =
            {contentOrigin.x + box.origin.x, contentOrigin.y + box.origin.y},
        .size = box.size};
    // Stamping metrics on a node of the committed tree is the same mutation
    // the owning View already performs for inline `<img>` attachments, and it
    // happens during the owner's layout pass.
    //
    // A sealed node is skipped rather than mutated. Layout runs again on
    // subtrees that were not re-cloned — a state update anywhere in the
    // surface re-lays out this paragraph while its children still belong to
    // the previous, sealed generation — and `setLayoutMetrics` would then trip
    // `ensureUnsealed`, aborting the process in any build with assertions on.
    // That is not a lost stamp: a sealed node was stamped when it was last
    // cloned, from the same content, so its metrics already hold.
    if (!node.getSealed()) {
      const_cast<TextShadowNode*>(static_cast<const TextShadowNode*>(&node))
          ->setLayoutMetrics(metrics);
    }
  }

  return box;
}

} // namespace

void stampInlineElementMetrics(
    const ShadowNode& owner,
    const AttributedString& attributedString,
    const std::vector<Rect>& fragmentRects,
    Point contentOrigin,
    const LayoutMetrics& ownerLayoutMetrics) {
  if (fragmentRects.empty()) {
    // The platform text engine does not report fragment rects yet; leave the
    // elements without metrics, exactly as before.
    return;
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
    return;
  }

  bool hasBox = false;
  stampSubtree(owner, boxesByTag, contentOrigin, ownerLayoutMetrics, hasBox);
}

} // namespace facebook::react
