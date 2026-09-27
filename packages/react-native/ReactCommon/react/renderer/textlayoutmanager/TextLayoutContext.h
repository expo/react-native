/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/core/ReactPrimitives.h>
#include <react/renderer/graphics/Float.h>

namespace facebook::react {

/*
 * TextLayoutContext: Additional contextual information useful for text
 * measurement.
 */
struct TextLayoutContext {
  /*
   * Reflects the scale factor needed to convert from the logical coordinate
   * space into the device coordinate space of the physical screen.
   * Some layout systems *might* use this to round layout metric values
   * to `pixel value`.
   */
  Float pointScaleFactor{1.0};

  /**
   * The ID of the surface being laid out
   */
  SurfaceId surfaceId{-1};

  /**
   * When the string being measured is the content of an anonymous text-run
   * box (text-children-plan.md §3.B), the box's tag; 0 otherwise. Platforms
   * that build a full text layout to measure can park it under this tag for
   * the mounting layer to reuse, instead of rebuilding the same layout on
   * the UI thread (run-layout-reuse-plan.md).
   */
  Tag runTag{0};

  /**
   * Whether the caller wants a rect per fragment — the geometry an inline
   * element reports from `getBoundingClientRect()` (box-model-scope.md T14).
   * It costs a second text layout, so only the caller that consumes it asks.
   *
   * Said out loud rather than guessed at from the string. Android inferred it
   * from the fragment count, on the reasoning that an inline element implies
   * more than one fragment — but a run whose whole content is one element has
   * exactly one, and every such element silently reported no box at all.
   */
  bool needsFragmentRects{false};

  bool operator==(const TextLayoutContext &rhs) const = default;
};

} // namespace facebook::react
