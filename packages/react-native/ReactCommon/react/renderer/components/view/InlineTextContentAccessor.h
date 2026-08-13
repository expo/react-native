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
/**
 * An element whose metrics could not be stamped in place because its node is
 * SEALED — it belongs to a committed generation and was not re-cloned this
 * commit. Its owner clones the path to it and applies these, the same way it
 * already repositions inline `<img>` attachments.
 *
 * Skipping a sealed node used to be treated as harmless on the grounds that
 * it was stamped from the same content when it was last cloned. Content is
 * not the input, though — LAYOUT is. Nothing about a `<b>` changes when its
 * container narrows and the run rewraps it onto the next line, so it is never
 * re-cloned, and it kept reporting its old line's rect: measured x=110 y=0
 * after a 400 -> 120 resize where a freshly rendered tree put it at x=0 of the
 * second line.
 */
struct PendingInlineElementMetrics {
  const ShadowNodeFamily *family;
  LayoutMetrics metrics;
};

class InlineTextContentAccessor {
 public:
  virtual ~InlineTextContentAccessor() = default;

  /*
   * `fontSizeMultiplier`: the accessibility font scale the content was
   * measured under (LayoutContext.fontSizeMultiplier). The published string
   * must carry it so it compares equal to — and renders identically to —
   * what measurement laid out; the cascade itself stores no multiplier.
   */
  virtual AttributedString getContentAttributedString(Float fontSizeMultiplier) const = 0;

  virtual std::shared_ptr<const TextLayoutManager> getContentTextLayoutManager() const = 0;

  /*
   * An `outside` list marker, already measured (css-lists-3 §3.2).
   *
   * Measuring happens on this side of the interface because the view layer
   * cannot include the text layout manager, and the caller only needs to know
   * how wide the marker is so it can place it in the gutter to the
   * inline-start side of the content box.
   */
  /*
   * BUILD HAZARD: adding a virtual to this interface changes its vtable, and
   * an incremental Android build can leave `ReactAndroid/build/prefab-headers`
   * stale — the app's own C++ then compiles against the old layout while
   * linking the new library, which corrupts memory rather than failing to
   * build. It presented as a SIGSEGV destroying a `TextEffectInfo` on the JS
   * thread, on screens with no lists in them at all. Delete that directory and
   * `rn-tester/android/app/build/intermediates/cxx` after changing this file.
   */
  struct OutsideMarker {
    AttributedString attributedString;
    Size size;
    /*
     * Distance from the marker box's top to its glyphs' baseline. The caller
     * aligns this with the content's first-line baseline — a symbolic marker
     * renders at a reduced font size (kSymbolicMarkerFontScale), so its own
     * line is much shorter than the content's, and top-aligning the two boxes
     * floated the bullet up at cap height. 0 when line measurement is
     * unavailable; the caller then falls back to top alignment.
     */
    Float baseline{0};
    bool present{false};
  };
  virtual OutsideMarker getOutsideMarker() const = 0;

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
  //
  // Returns the elements it could not stamp because their nodes are sealed,
  // for the owner to apply by cloning — the same treatment inline `<img>`
  // attachments already get. An element's box comes from the run's LAYOUT, so
  // it moves when the run rewraps even though the element itself is unchanged
  // and therefore never re-cloned.
  virtual std::vector<PendingInlineElementMetrics> stampInlineElementMetrics(
      const LayoutContext &layoutContext,
      Point contentOrigin,
      const LayoutMetrics &ownerLayoutMetrics) const = 0;
};

} // namespace facebook::react
