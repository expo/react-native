/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <yoga/Yoga.h>
#include <yoga/event/event.h>
#include <yoga/node/Node.h>

namespace facebook::yoga {

// https://drafts.csswg.org/css-grid-3/ — grid lanes layout.
//
// Grid lanes is CSS Grid with one axis flowed rather than gridded. Tracks are
// defined in the GRID AXIS exactly as in Grid, and sized by the same
// algorithm; in the STACKING AXIS each track keeps a running position and
// items pack into whichever track is currently least filled.
//
// This file is ours. It sits outside algorithm/grid/, which is vendored
// verbatim from upstream — see algorithm/grid/README-VENDORED.md — but it
// reuses that directory's track sizing, because §3.4 defines grid-axis sizing
// as Grid's own with one change to which items contribute.
void calculateGridLanesLayoutInternal(
    Node* node,
    float availableWidth,
    float availableHeight,
    Direction ownerDirection,
    SizingMode widthSizingMode,
    SizingMode heightSizingMode,
    float ownerWidth,
    float ownerHeight,
    bool performLayout,
    LayoutPassReason reason,
    LayoutData& layoutMarkerData,
    uint32_t depth,
    uint32_t generationCount);

} // namespace facebook::yoga
