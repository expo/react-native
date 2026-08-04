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
 * The placement of an inline replaced element (`<img>`) within an anonymous
 * IFC box: the attachment's family (stable across clones, so the owning View
 * can match it back to its own child) and the attachment frame relative to the
 * box's content origin, as resolved by the text layout.
 */
struct InlineAttachmentPlacement {
  const ShadowNodeFamily *family;
  Rect frame;
};

/*
 * Implemented by anonymous inline-formatting-context boxes so their containing
 * View can read the flattened content for painting state without depending on
 * the text module (text-children-plan.md §3.B).
 */
class InlineTextContentAccessor {
 public:
  virtual ~InlineTextContentAccessor() = default;

  virtual AttributedString getContentAttributedString() const = 0;

  virtual std::shared_ptr<const TextLayoutManager> getContentTextLayoutManager() const = 0;

  // Resolved inline frames of this run's replaced elements (`<img>`), so the
  // owning View can position each image at its exact inline offset within the
  // run rather than at the box origin (text-children-plan.md §3.C).
  virtual std::vector<InlineAttachmentPlacement> getInlineAttachmentPlacements(
      const LayoutContext &layoutContext) const = 0;

  // Stamps the run's inline elements (`<b>`, `<span>`, nested `<Text>`) with
  // the box each occupies, so `getBoundingClientRect()` reports a real rect
  // for them (text-children-plan.md §3.G). Purely additive: it does not feed
  // back into measuring or painting. Lives behind this seam so the view module
  // keeps no dependency on the text module.
  virtual void stampInlineElementMetrics(
      const LayoutContext &layoutContext,
      Point contentOrigin,
      const LayoutMetrics &ownerLayoutMetrics) const = 0;
};

} // namespace facebook::react
