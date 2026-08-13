/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <vector>

#include <yoga/enums/FloatSide.h>

namespace facebook::yoga {

/*
 * A float that has been placed, in the coordinates of the block formatting
 * context that owns it.
 *
 * Floats belong to a formatting context, not to the block they are written in
 * (CSS2 §9.5). A block that shares its owner's context — no `overflow`, in
 * flow, not a flex item or the root — does not own the floats inside it: they
 * are what the OWNER's height grows to contain, and they intrude on the
 * owner's later content. So a placed float has to be able to outlive the block
 * it was written in, which is why this type is shared rather than local to the
 * algorithm.
 */
struct PlacedFloat {
  float blockStart{0.0f};
  float blockEnd{0.0f};
  float inlineExtent{0.0f}; // distance intruded from the float's own side
  FloatSide side{FloatSide::None};
};

} // namespace facebook::yoga
