/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <yoga/numeric/Comparison.h>
#include <yoga/style/GridAutoRepeat.h>
#include <yoga/style/GridTrack.h>
#include <yoga/style/StyleSizeLength.h>
#include <algorithm>
#include <cmath>
#include <vector>

namespace facebook::yoga {

// Expanding `repeat(auto-fill, ...)` and `repeat(auto-fit, ...)`.
// https://www.w3.org/TR/css-grid-2/#auto-repeat
//
// This is the one part of a track list that cannot be resolved from style
// alone: how many times the pattern repeats depends on the size the container
// ends up with. Placement, line numbering and track sizing all run against the
// EXPANDED list, so the expansion has to happen before any of them.
//
// This file is ours, deliberately kept outside algorithm/grid/, which is
// vendored verbatim from upstream — see algorithm/grid/README-VENDORED.md.

namespace detail {

// §7.2.3.1: "each track is treated as its max track sizing function if that is
// definite, or as its minimum track sizing function otherwise".
//
// This is what makes the common `minmax(120px, 1fr)` idiom work: 1fr is not
// definite, so the 120px minimum is what the repetition count is computed
// from.
inline float autoRepeatTrackSize(
    const GridTrackSize& track,
    const float availableSize) {
  auto definiteSize = [&](const StyleSizeLength& length) -> float {
    if (length.isPoints()) {
      return length.value().unwrap();
    }
    if (length.isPercent() && yoga::isDefined(availableSize)) {
      return length.value().unwrap() / 100.0f * availableSize;
    }
    return YGUndefined;
  };

  // A maximum below the minimum is floored by it, as track sizing does
  // (`minmax(100px, 50px)` is 100px), and a track is counted as at least 1px
  // so that a tiny or zero size cannot ask for millions of repetitions (the
  // floor the spec suggests)
  const float fromMax = definiteSize(track.maxSizingFunction);
  const float fromMin = definiteSize(track.minSizingFunction);
  float size = YGUndefined;
  if (yoga::isDefined(fromMax)) {
    size = yoga::isDefined(fromMin) ? std::max(fromMax, fromMin) : fromMax;
  } else if (yoga::isDefined(fromMin)) {
    size = fromMin;
  }
  return yoga::isDefined(size) ? std::max(size, 1.0f) : YGUndefined;
}

// How many repetitions a container may ask for at most, whatever its size: a
// bound on the tracks one auto-repeat expands to, against a pathological size
// or count
constexpr size_t kMaxAutoRepetitions = 10000;

} // namespace detail

// How many times the auto-repeat pattern fits into `availableSize`.
//
// §7.2.3.1: the largest positive integer that does not overflow the container's
// content box, and at least 1. A pattern whose tracks have no definite size
// cannot be counted, so it too repeats once. With `coverMinimum`, the size is
// the container's definite minimum instead, and the count is the smallest that
// fills it (§7.2.3.2).
inline size_t resolveAutoRepeatCount(
    const GridTrackList& authoredTracks,
    const GridAutoRepeat& autoRepeat,
    const float availableSize,
    const float gap,
    const bool coverMinimum = false) {
  if (!autoRepeat.isAuto()) {
    return 0;
  }
  if (yoga::isUndefined(availableSize) || availableSize <= 0.0f) {
    // An indefinite axis gives nothing to fit against.
    return 1;
  }

  const size_t start = autoRepeat.startIndex;
  const size_t count = autoRepeat.trackCount;
  if (start + count > authoredTracks.size()) {
    return 1;
  }

  // The size of one repetition of the pattern...
  float patternSize = 0.0f;
  for (size_t i = start; i < start + count; i++) {
    const float size =
        detail::autoRepeatTrackSize(authoredTracks[i], availableSize);
    if (yoga::isUndefined(size)) {
      // An indefinite track in the pattern makes the count unresolvable.
      return 1;
    }
    patternSize += size;
  }

  // ...and of the fixed tracks that surround it, which take up room the
  // repetitions cannot have.
  float fixedSize = 0.0f;
  size_t fixedCount = 0;
  for (size_t i = 0; i < authoredTracks.size(); i++) {
    if (i >= start && i < start + count) {
      continue;
    }
    const float size =
        detail::autoRepeatTrackSize(authoredTracks[i], availableSize);
    fixedSize += yoga::isDefined(size) ? size : 0.0f;
    fixedCount++;
  }

  const float perRepetition = patternSize + static_cast<float>(count) * gap;
  if (perRepetition <= 0.0f) {
    // Zero-sized tracks with no gap would otherwise repeat forever.
    return 1;
  }

  // Laying out N repetitions plus the fixed tracks costs
  //
  //   fixedSize + N * patternSize + gap * (fixedCount + N * count - 1)
  //
  // and must not exceed availableSize. Solving for N:
  const float room =
      availableSize - fixedSize - gap * (static_cast<float>(fixedCount) - 1.0f);
  const float fit = std::min(
      room / perRepetition, static_cast<float>(detail::kMaxAutoRepetitions));
  const auto repetitions =
      static_cast<int32_t>(coverMinimum ? std::ceil(fit) : std::floor(fit));
  return repetitions < 1 ? 1 : static_cast<size_t>(repetitions);
}

// The authored track list with its auto-repeat expanded in place.
//
// Returns the authored list unchanged when there is no auto-repeat, so callers
// can use this unconditionally.
inline GridTrackList expandAutoRepeat(
    const GridTrackList& authoredTracks,
    const GridAutoRepeat& autoRepeat,
    const float availableSize,
    const float gap,
    const bool coverMinimum = false) {
  if (!autoRepeat.isAuto()) {
    return authoredTracks;
  }

  const size_t start = autoRepeat.startIndex;
  const size_t count = autoRepeat.trackCount;
  if (start + count > authoredTracks.size()) {
    return authoredTracks;
  }

  const size_t repetitions = resolveAutoRepeatCount(
      authoredTracks, autoRepeat, availableSize, gap, coverMinimum);

  GridTrackList expanded;
  expanded.reserve(authoredTracks.size() - count + count * repetitions);
  for (size_t i = 0; i < start; i++) {
    expanded.push_back(authoredTracks[i]);
  }
  for (size_t r = 0; r < repetitions; r++) {
    for (size_t i = start; i < start + count; i++) {
      expanded.push_back(authoredTracks[i]);
    }
  }
  for (size_t i = start + count; i < authoredTracks.size(); i++) {
    expanded.push_back(authoredTracks[i]);
  }
  return expanded;
}

// Which expanded track indices came from the auto-repeat, so that `auto-fit`
// can collapse the ones that end up empty. Half-open range [begin, end).
struct AutoRepeatRange {
  size_t begin{0};
  size_t end{0};
  bool collapsible{false};
};

inline AutoRepeatRange autoRepeatRange(
    const GridTrackList& authoredTracks,
    const GridAutoRepeat& autoRepeat,
    const float availableSize,
    const float gap,
    const bool coverMinimum = false) {
  if (!autoRepeat.isAuto()) {
    return {};
  }
  const size_t repetitions = resolveAutoRepeatCount(
      authoredTracks, autoRepeat, availableSize, gap, coverMinimum);
  return {
      autoRepeat.startIndex,
      autoRepeat.startIndex + autoRepeat.trackCount * repetitions,
      autoRepeat.type == GridAutoRepeatType::AutoFit};
}

} // namespace facebook::yoga
