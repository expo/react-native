/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <memory>
#include <vector>

#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/core/LayoutMetrics.h>
#include <react/renderer/graphics/Rect.h>

namespace facebook::react {

class TextLayoutManager;
class ShadowNodeFamily;
struct LayoutContext;

/*
 * The placement of an atomic inline, such as an inline replaced element
 * (`<img>`), within an anonymous IFC box: the attachment's family (stable
 * across clones, so the owning View can match it back to its own child) and
 * the attachment frame relative to the box's content origin, as resolved by
 * the line layout.
 */
struct InlineAttachmentPlacement {
  const ShadowNodeFamily *family;
  Rect frame;
};

/*
 * An inline element whose metrics could not be stamped in place because its
 * node is sealed: it belongs to a committed generation and was not re-cloned
 * this commit. Its owner clones the path to it and applies these, the same way
 * it repositions atomic inline attachments.
 *
 * An inline element's box comes from the run's layout, not from its own
 * content, so it moves when its container's width changes and the run rewraps
 * it onto another line, even though nothing about the element itself changed
 * and it is therefore never re-cloned.
 */
struct PendingInlineElementMetrics {
  const ShadowNodeFamily *family;
  LayoutMetrics metrics;
};

/*
 * Implemented by anonymous inline-formatting-context boxes so their containing
 * View can place and paint their contents without depending on the text
 * module, which implements them.
 */
class InlineTextContentAccessor {
 public:
  virtual ~InlineTextContentAccessor() = default;

  /*
   * `fontSizeMultiplier`: the accessibility font scale the content was
   * measured under (LayoutContext.fontSizeMultiplier). The published string
   * must carry it so it compares equal to — and renders identically to —
   * what measurement laid out.
   */
  virtual AttributedString getContentAttributedString(Float fontSizeMultiplier) const = 0;

  virtual std::shared_ptr<const TextLayoutManager> getContentTextLayoutManager() const = 0;

  // Resolved frames of this run's atomic inlines, so the owning View can
  // position each one at its place in the run's lines rather than at the box
  // origin.
  virtual std::vector<InlineAttachmentPlacement> getInlineAttachmentPlacements(
      const LayoutContext &layoutContext) const = 0;

  // Stamps the run's inline elements (`<b>`, `<span>`, nested `<Text>`) with
  // the box each occupies, so `getBoundingClientRect()` reports a real rect
  // for them. It does not feed back into measuring or painting.
  //
  // Returns the elements it could not stamp because their nodes are sealed,
  // for the owner to apply by cloning, as it does for atomic inline
  // attachments.
  virtual std::vector<PendingInlineElementMetrics> stampInlineElementMetrics(
      const LayoutContext &layoutContext,
      Point contentOrigin,
      const LayoutMetrics &ownerLayoutMetrics) const = 0;
};

} // namespace facebook::react
