/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <memory>
#include <vector>

#include <react/renderer/core/LayoutMetrics.h>
#include <react/renderer/graphics/Rect.h>

namespace facebook::react {

class ShadowNodeFamily;
struct LayoutContext;

/*
 * The placement of an atomic inline within an anonymous IFC box: the
 * attachment's family (stable across clones, so the owning View can match it
 * back to its own child) and the attachment frame relative to the box's
 * content origin, as resolved by the line layout.
 */
struct InlineAttachmentPlacement {
  const ShadowNodeFamily *family;
  Rect frame;
};

/*
 * Implemented by anonymous inline-formatting-context boxes so their containing
 * View can place their contents without depending on the text module, which
 * implements them.
 */
class InlineTextContentAccessor {
 public:
  virtual ~InlineTextContentAccessor() = default;

  // Resolved frames of this run's atomic inlines, so the owning View can
  // position each one at its place in the run's lines rather than at the box
  // origin.
  virtual std::vector<InlineAttachmentPlacement> getInlineAttachmentPlacements(
      const LayoutContext &layoutContext) const = 0;
};

} // namespace facebook::react
