/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <yoga/style/GridAutoFlow.h>
#include <yoga/style/GridAutoRepeat.h>
#include <yoga/style/GridLine.h>
#include <yoga/style/GridTrack.h>

namespace facebook::yoga {

/**
 * Every grid property, held together so that `Style` can point at one
 * allocation instead of carrying all of them inline.
 *
 * The grid properties are large — four track-list vectors alone are 96 bytes
 * — and the overwhelming majority of nodes in an app are not grid containers
 * or grid items. Storing them inline charges every View for a feature it does
 * not use, and pushed ViewProps past its memory budget the moment
 * auto-repeat was added.
 *
 * `Style` therefore holds a shared_ptr that is null until a grid property is
 * actually set, and copies it on write. Reads of an unset grid style return
 * shared defaults, so callers never need to know whether the allocation
 * exists.
 */
struct GridStyle {
  GridTrackList gridTemplateColumns{};
  GridTrackList gridTemplateRows{};
  GridTrackList gridAutoColumns{};
  GridTrackList gridAutoRows{};

  GridAutoFlow gridAutoFlow{GridAutoFlow::Row};

  GridAutoRepeat gridTemplateColumnsAutoRepeat{};
  GridAutoRepeat gridTemplateRowsAutoRepeat{};

  GridLine gridColumnStart{};
  GridLine gridColumnEnd{};
  GridLine gridRowStart{};
  GridLine gridRowEnd{};

  bool operator==(const GridStyle& other) const = default;

  // Whether this differs from a node with no grid properties at all. Used to
  // keep equality consistent between a null pointer and an allocation that
  // happens to hold defaults.
  bool isDefault() const {
    return *this == GridStyle{};
  }
};

// The value a Style with no grid properties reads as.
//
// A namespace-scope inline variable rather than a function-local static: the
// latter is initialised lazily behind a guard the first time it is reached,
// and these accessors run on several threads during a commit. One instance,
// initialised before first use, avoids the question entirely.
inline const GridStyle kDefaultGridStyle{};

} // namespace facebook::yoga
