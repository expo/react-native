/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include <yoga/algorithm/BoundAxis.h>
#include <yoga/algorithm/CalculateLayout.h>
#include <yoga/algorithm/GridAutoRepeat.h>
#include <yoga/algorithm/GridLanesLayout.h>
#include <yoga/algorithm/TrailingPosition.h>
#include <yoga/algorithm/grid/TrackSizing.h>

#include <algorithm>
#include <utility>
#include <limits>

namespace facebook::yoga {

namespace {

// One item's placement in the grid axis: where it starts and how many tracks
// it covers. `startLine` is unset for an auto-placed item, which is what the
// placement algorithm resolves.
struct LaneItem {
  Node* node{nullptr};
  size_t span{1};
  bool hasDefiniteStart{false};
  size_t startLine{0};

  // Filled in by placement.
  size_t placedLine{0};
  float stackingStart{0.0f};
  float outerStackingSize{0.0f};
};

// §2.3: the grid axis is the inline axis (columns) unless ONLY rows were
// given, in which case it is the block axis (a "brick" layout that grows
// sideways).
bool gridAxisIsInline(const Style& style) {
  return !(
      style.gridTemplateColumns().empty() && !style.gridTemplateRows().empty());
}

// §4.1: the grid-axis placement properties are the column ones when columns
// are the grid axis, and the row ones otherwise.
LaneItem resolveLanePlacement(
    Node* child,
    bool inlineIsGridAxis,
    size_t trackCount) {
  const auto& style = child->style();
  const GridLine start =
      inlineIsGridAxis ? style.gridColumnStart() : style.gridRowStart();
  const GridLine end =
      inlineIsGridAxis ? style.gridColumnEnd() : style.gridRowEnd();

  LaneItem item;
  item.node = child;

  // css-grid-1 §8.3: a span of zero or less is invalid and clamps to 1, and
  // line 0 does not exist.
  auto spanOf = [](const GridLine& line) -> size_t {
    return line.isSpan() ? static_cast<size_t>(std::max(1, line.integer)) : 1;
  };

  // A negative line counts back from the end of the explicit grid.
  auto resolveLine = [&](int32_t value) -> size_t {
    if (value > 0) {
      return static_cast<size_t>(value - 1);
    }
    const int64_t fromEnd =
        static_cast<int64_t>(trackCount) + 1 + static_cast<int64_t>(value);
    return static_cast<size_t>(std::max<int64_t>(fromEnd - 1, 0));
  };

  if (start.isInteger() && start.integer != 0) {
    item.hasDefiniteStart = true;
    item.startLine = resolveLine(start.integer);
    if (end.isInteger() && end.integer != 0) {
      const size_t endLine = resolveLine(end.integer);
      item.span = endLine > item.startLine ? endLine - item.startLine : 1;
    } else {
      item.span = spanOf(end);
    }
  } else if (end.isInteger() && end.integer != 0) {
    // Only the end is definite: the start follows from the span.
    const size_t endLine = resolveLine(end.integer);
    const size_t span = spanOf(start);
    item.hasDefiniteStart = true;
    item.startLine = endLine >= span ? endLine - span : 0;
    item.span = span;
  } else {
    item.span = std::max(spanOf(start), spanOf(end));
  }

  // The span is NOT clamped to the explicit grid: css-grid-1 §8.5 grows
  // implicit tracks to hold it, and clamping instead would silently shrink an
  // item that asked to span further than the author's track list reaches.
  item.span = std::max<size_t>(1, item.span);
  return item;
}

} // namespace

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
    uint32_t generationCount) {
  (void)reason;

  const auto& nodeStyle = node->style();
  const Direction direction = node->resolveDirection(ownerDirection);
  const float marginInline =
      nodeStyle.computeMarginForAxis(FlexDirection::Row, ownerWidth);
  const float marginBlock =
      nodeStyle.computeMarginForAxis(FlexDirection::Column, ownerWidth);
  const float paddingAndBorderInline =
      paddingAndBorderForAxis(node, FlexDirection::Row, direction, ownerWidth);
  const float paddingAndBorderBlock = paddingAndBorderForAxis(
      node, FlexDirection::Column, direction, ownerWidth);
  const float availableInnerWidth = calculateAvailableInnerDimension(
      node,
      direction,
      Dimension::Width,
      availableWidth - marginInline,
      paddingAndBorderInline,
      ownerWidth,
      ownerWidth);
  const float availableInnerHeight = calculateAvailableInnerDimension(
      node,
      direction,
      Dimension::Height,
      availableHeight - marginBlock,
      paddingAndBorderBlock,
      ownerHeight,
      ownerWidth);

  const bool inlineIsGridAxis = gridAxisIsInline(nodeStyle);

  const float gridAxisAvailable =
      inlineIsGridAxis ? availableInnerWidth : availableInnerHeight;
  const float stackingAxisAvailable =
      inlineIsGridAxis ? availableInnerHeight : availableInnerWidth;

  const float gridAxisGap = nodeStyle.computeGapForAxis(
      inlineIsGridAxis ? FlexDirection::Row : FlexDirection::Column,
      gridAxisAvailable);
  const float stackingAxisGap = nodeStyle.computeGapForAxis(
      inlineIsGridAxis ? FlexDirection::Column : FlexDirection::Row,
      stackingAxisAvailable);

  // §3.3: repeat(auto-fill|auto-fit) resolves against the grid-axis content
  // box, exactly as in Grid.
  const GridTrackList& authoredTracks = inlineIsGridAxis
      ? nodeStyle.gridTemplateColumns()
      : nodeStyle.gridTemplateRows();
  const GridAutoRepeat& autoRepeat = inlineIsGridAxis
      ? nodeStyle.gridTemplateColumnsAutoRepeat()
      : nodeStyle.gridTemplateRowsAutoRepeat();
  GridTrackList expandedTracks = expandAutoRepeat(
      authoredTracks, autoRepeat, gridAxisAvailable, gridAxisGap);
  if (expandedTracks.empty()) {
    // A lanes container with no track list has a single lane.
    expandedTracks.push_back(GridTrackSize::auto_());
  }
  size_t trackCount = expandedTracks.size();

  // Collect the in-flow items and their grid-axis placements.
  std::vector<LaneItem> items;
  items.reserve(node->getChildCount());
  for (auto child : node->getLayoutChildren()) {
    // Style dimensions are resolved lazily, and until this runs a child's own
    // `height: 50` is not yet visible to hasDefiniteLength — which would make
    // every item measure as though it had no size at all.
    child->processDimensions();
    if (child->style().display() == Display::None ||
        child->style().positionType() == PositionType::Absolute) {
      continue;
    }
    items.push_back(resolveLanePlacement(child, inlineIsGridAxis, trackCount));
  }

  // §8.5: an item that reaches past the explicit grid grows it. The implicit
  // tracks repeat grid-auto-columns/rows, defaulting to auto.
  {
    size_t requiredTracks = trackCount;
    for (const auto& item : items) {
      const size_t reach =
          (item.hasDefiniteStart ? item.startLine : 0) + item.span;
      requiredTracks = std::max(requiredTracks, reach);
    }
    if (requiredTracks > trackCount) {
      const GridTrackList& autoTracks = inlineIsGridAxis
          ? nodeStyle.gridAutoColumns()
          : nodeStyle.gridAutoRows();
      for (size_t i = trackCount; i < requiredTracks; i++) {
        expandedTracks.push_back(
            autoTracks.empty()
                ? GridTrackSize::auto_()
                : autoTracks[(i - trackCount) % autoTracks.size()]);
      }
      trackCount = requiredTracks;
    }
  }

  // ---------------------------------------------------------------------
  // Grid-axis track sizing (§3.4)
  //
  // Grid's own algorithm, with one change to which items contribute: an item
  // with a definite position contributes only to its own tracks, while an
  // auto-placed item contributes to EVERY position it could be placed at.
  // That is what breaks the circularity between placement and sizing — an
  // auto item's track is not known until placement, which needs the sizes.
  // ---------------------------------------------------------------------
  std::vector<GridTrack> gridAxisTracks;
  gridAxisTracks.reserve(trackCount);
  for (const auto& track : expandedTracks) {
    gridAxisTracks.emplace_back(track);
  }
  std::vector<GridTrack> stackingAxisTracks;
  stackingAxisTracks.emplace_back(GridTrackSize::auto_());

  std::vector<GridItem> sizingItems;
  for (const auto& item : items) {
    if (item.hasDefiniteStart) {
      sizingItems.emplace_back(
          item.startLine, item.startLine + item.span, 0, 1, item.node);
    } else {
      // "assumed to be placed at every possible start position"
      for (size_t start = 0; start + item.span <= trackCount; start++) {
        sizingItems.emplace_back(start, start + item.span, 0, 1, item.node);
      }
    }
  }

  BaselineItemGroups baselineGroups;
  {
    auto& columnTracks = inlineIsGridAxis ? gridAxisTracks : stackingAxisTracks;
    auto& rowTracks = inlineIsGridAxis ? stackingAxisTracks : gridAxisTracks;
    // The sizing items above are expressed with the grid axis as columns, so
    // when rows are the grid axis their spans belong on the other axis.
    if (!inlineIsGridAxis) {
      for (auto& sizingItem : sizingItems) {
        std::swap(sizingItem.columnStart, sizingItem.rowStart);
        std::swap(sizingItem.columnEnd, sizingItem.rowEnd);
      }
    }
    auto trackSizing = TrackSizing(
        node,
        columnTracks,
        rowTracks,
        widthSizingMode == SizingMode::StretchFit ? availableInnerWidth
                                                  : YGUndefined,
        heightSizingMode == SizingMode::StretchFit ? availableInnerHeight
                                                   : YGUndefined,
        sizingItems,
        widthSizingMode,
        heightSizingMode,
        direction,
        ownerWidth,
        ownerHeight,
        layoutMarkerData,
        depth,
        generationCount,
        baselineGroups);
    // ONLY the grid axis is sized. The stacking axis has no tracks — it is a
    // running position per lane, computed during placement — so running the
    // full two-axis algorithm would size a fictional track from every item at
    // once. That went badly for aspect-ratio items in particular: with no
    // definite size in either axis they have no well-defined contribution, and
    // the tracks came out four times too wide.
    //
    // The estimator answers "how big is this item in the OTHER axis" during
    // sizing, and for lanes the honest answer is that it is not yet known: the
    // stacking axis is indefinite until placement runs.
    trackSizing.runTrackSizing(
        inlineIsGridAxis ? Dimension::Width : Dimension::Height,
        [](const GridItem&) { return YGUndefined; });
  }

  // Where each track starts along the grid axis, and how wide it is. The two
  // are kept apart because a span's extent is the tracks it covers plus only
  // the gaps BETWEEN them — folding the trailing gap into an offset makes
  // every item one gap too large.
  std::vector<float> trackOffsets(trackCount, 0.0f);
  std::vector<float> trackSizes(trackCount, 0.0f);
  float gridAxisUsed = 0.0f;
  for (size_t i = 0; i < trackCount; i++) {
    trackOffsets[i] = gridAxisUsed;
    trackSizes[i] = gridAxisTracks[i].baseSize;
    gridAxisUsed += trackSizes[i];
    if (i + 1 < trackCount) {
      gridAxisUsed += gridAxisGap;
    }
  }

  // Leftover space in the grid axis is distributed by the content-distribution
  // property for that axis, exactly as in Grid: the tracks are already sized,
  // so this only moves them.
  float gridAxisStartOffset = 0.0f;
  float gridAxisBetweenTracks = 0.0f;
  {
    const float freeSpace = yoga::isDefined(gridAxisAvailable)
        ? gridAxisAvailable - gridAxisUsed
        : 0.0f;
    if (freeSpace > 0.0f && trackCount > 0) {
      const auto justify = nodeStyle.justifyContent();
      const auto align = nodeStyle.alignContent();
      const bool useJustify = inlineIsGridAxis;
      const auto distribution = useJustify
          ? justify
          : (align == Align::SpaceBetween      ? Justify::SpaceBetween
                 : align == Align::SpaceAround ? Justify::SpaceAround
                 : align == Align::SpaceEvenly ? Justify::SpaceEvenly
                 : align == Align::Center      ? Justify::Center
                 : align == Align::End         ? Justify::End
                 : align == Align::FlexEnd     ? Justify::FlexEnd
                                               : Justify::FlexStart);
      switch (distribution) {
        case Justify::Center:
          gridAxisStartOffset = freeSpace / 2.0f;
          break;
        case Justify::End:
        case Justify::FlexEnd:
          gridAxisStartOffset = freeSpace;
          break;
        case Justify::SpaceBetween:
          if (trackCount > 1) {
            gridAxisBetweenTracks = freeSpace / (float)(trackCount - 1);
          }
          break;
        case Justify::SpaceAround:
          gridAxisBetweenTracks = freeSpace / (float)trackCount;
          gridAxisStartOffset = gridAxisBetweenTracks / 2.0f;
          break;
        case Justify::SpaceEvenly:
          gridAxisBetweenTracks = freeSpace / (float)(trackCount + 1);
          gridAxisStartOffset = gridAxisBetweenTracks;
          break;
        default:
          break;
      }
    }
  }
  if (gridAxisStartOffset != 0.0f || gridAxisBetweenTracks != 0.0f) {
    float running = gridAxisStartOffset;
    for (size_t i = 0; i < trackCount; i++) {
      trackOffsets[i] = running;
      running += trackSizes[i] + gridAxisGap + gridAxisBetweenTracks;
    }
  }

  auto extentOf = [&](size_t start, size_t span) {
    const size_t end = std::min(start + span, trackCount);
    float extent = 0.0f;
    for (size_t i = start; i < end; i++) {
      extent += trackSizes[i];
      if (i + 1 < end) {
        extent += gridAxisGap;
      }
    }
    return extent;
  };

  // ---------------------------------------------------------------------
  // Placement (§4.4)
  // ---------------------------------------------------------------------
  const float tieThreshold =
      nodeStyle.flowTolerance().resolve(gridAxisAvailable);
  const bool dense = isDense(nodeStyle.gridAutoFlow());

  // A running position per track, and the cursor that keeps ties moving
  // forward through the document rather than snapping back to the start.
  std::vector<float> runningPosition(trackCount, 0.0f);
  size_t autoPlacementCursor = 0;

  const float gridAxisContentSize = inlineIsGridAxis
      ? (yoga::isDefined(availableInnerWidth) ? availableInnerWidth
                                             : gridAxisUsed)
      : (yoga::isDefined(availableInnerHeight) ? availableInnerHeight
                                               : gridAxisUsed);
  (void)gridAxisContentSize;

  for (auto& item : items) {
    size_t chosenLine = 0;
    float maxPos = 0.0f;

    if (item.hasDefiniteStart) {
      chosenLine = item.startLine;
      for (size_t i = 0; i < item.span && chosenLine + i < trackCount; i++) {
        maxPos = std::max(maxPos, runningPosition[chosenLine + i]);
      }
    } else {
      // For each line the item could start at, the position it would land at
      // is the largest running position of the tracks it would span.
      float smallest = std::numeric_limits<float>::max();
      std::vector<std::pair<size_t, float>> candidates;
      for (size_t start = 0; start + item.span <= trackCount; start++) {
        float candidate = 0.0f;
        for (size_t i = 0; i < item.span; i++) {
          candidate = std::max(candidate, runningPosition[start + i]);
        }
        candidates.emplace_back(start, candidate);
        smallest = std::min(smallest, candidate);
      }
      if (candidates.empty()) {
        candidates.emplace_back(0, runningPosition[0]);
        smallest = runningPosition[0];
      }

      // Every candidate within the tie threshold of the shortest counts as
      // equally good — that is what makes near-equal tracks fill in order
      // rather than by a difference nobody can see.
      size_t firstTied = candidates.size();
      size_t firstTiedAtOrAfterCursor = candidates.size();
      for (size_t i = 0; i < candidates.size(); i++) {
        const bool tied = candidates[i].second - smallest <= tieThreshold;
        if (!tied) {
          continue;
        }
        if (firstTied == candidates.size()) {
          firstTied = i;
        }
        if (candidates[i].first >= autoPlacementCursor &&
            firstTiedAtOrAfterCursor == candidates.size()) {
          firstTiedAtOrAfterCursor = i;
        }
      }
      const size_t pick = firstTiedAtOrAfterCursor != candidates.size()
          ? firstTiedAtOrAfterCursor
          : firstTied;
      chosenLine = candidates[pick].first;
      maxPos = candidates[pick].second;
      autoPlacementCursor = chosenLine + item.span;
    }

    item.placedLine = chosenLine;
    item.stackingStart = maxPos;
  }

  // ---------------------------------------------------------------------
  // Lay the items out, then advance the running positions.
  //
  // The two passes above and below are one pass in the spec: an item's size
  // is needed to advance the tracks it sits in, and the next item's position
  // depends on that. Splitting placement from layout would break that chain,
  // so sizing happens here, in order.
  // ---------------------------------------------------------------------
  std::fill(runningPosition.begin(), runningPosition.end(), 0.0f);
  autoPlacementCursor = 0;

  const float leadingPaddingAndBorderInline =
      node->style().computeInlineStartPaddingAndBorder(
          FlexDirection::Row, direction, ownerWidth);
  const float leadingPaddingAndBorderBlock =
      node->style().computeInlineStartPaddingAndBorder(
          FlexDirection::Column, direction, ownerWidth);

  float stackingExtent = 0.0f;

  for (auto& item : items) {
    // Re-resolve the position against the running positions as they now
    // stand, using the same rule as above.
    size_t chosenLine = item.placedLine;
    if (!item.hasDefiniteStart) {
      float smallest = std::numeric_limits<float>::max();
      std::vector<std::pair<size_t, float>> candidates;
      for (size_t start = 0; start + item.span <= trackCount; start++) {
        float candidate = 0.0f;
        for (size_t i = 0; i < item.span; i++) {
          candidate = std::max(candidate, runningPosition[start + i]);
        }
        candidates.emplace_back(start, candidate);
        smallest = std::min(smallest, candidate);
      }
      size_t firstTied = candidates.size();
      size_t firstTiedAtOrAfterCursor = candidates.size();
      for (size_t i = 0; i < candidates.size(); i++) {
        if (candidates[i].second - smallest > tieThreshold) {
          continue;
        }
        if (firstTied == candidates.size()) {
          firstTied = i;
        }
        if (candidates[i].first >= autoPlacementCursor &&
            firstTiedAtOrAfterCursor == candidates.size()) {
          firstTiedAtOrAfterCursor = i;
        }
      }
      const size_t pick = firstTiedAtOrAfterCursor != candidates.size()
          ? firstTiedAtOrAfterCursor
          : firstTied;
      chosenLine = candidates[pick].first;
      autoPlacementCursor = chosenLine + item.span;
    }

    float maxPos = 0.0f;
    for (size_t i = 0; i < item.span && chosenLine + i < trackCount; i++) {
      maxPos = std::max(maxPos, runningPosition[chosenLine + i]);
    }

    // §4.4.1: the containing block is the grid area in the grid axis and the
    // container's content box in the stacking axis.
    const float gridAxisExtent = extentOf(chosenLine, item.span);
    const float containingBlockWidth =
        inlineIsGridAxis ? gridAxisExtent : stackingAxisAvailable;
    const float containingBlockHeight =
        inlineIsGridAxis ? stackingAxisAvailable : gridAxisExtent;

    const auto& itemStyle = item.node->style();
    const auto marginInlineStart = itemStyle.computeInlineStartMargin(
        FlexDirection::Row, direction, containingBlockWidth);
    const auto marginInlineEnd = itemStyle.computeInlineEndMargin(
        FlexDirection::Row, direction, containingBlockWidth);
    const auto marginBlockStart = itemStyle.computeInlineStartMargin(
        FlexDirection::Column, direction, containingBlockWidth);
    const auto marginBlockEnd = itemStyle.computeInlineEndMargin(
        FlexDirection::Column, direction, containingBlockWidth);

    // Yoga expects the CALLER to resolve a child's own definite size and hand
    // it back as the available size: `calculateLayoutInternal` with an
    // undefined size and MaxContent measures the content, and a childless box
    // with `height: 50` has no content, so it would come out zero. Each axis
    // is therefore resolved here — the grid axis stretches to its area unless
    // the item sizes itself, and the stacking axis follows the item.
    auto axisConstraint = [&](Dimension dimension,
                              float containingBlock,
                              float fallbackAvailable,
                              SizingMode fallbackMode,
                              float margin) {
      std::pair<float, SizingMode> constraint{fallbackAvailable, fallbackMode};
      if (item.node->hasDefiniteLength(dimension, containingBlock)) {
        const float resolved = boundAxis(
            item.node,
            dimension == Dimension::Width ? FlexDirection::Row
                                          : FlexDirection::Column,
            direction,
            item.node
                ->getResolvedDimension(
                    direction, dimension, containingBlock, containingBlockWidth)
                .unwrap(),
            containingBlock,
            containingBlockWidth);
        constraint = {resolved + margin, SizingMode::StretchFit};
      }
      return constraint;
    };

    // Yoga's available size INCLUDES the item's margins — it subtracts them
    // itself — so handing it the area minus the margins takes them off twice.
    const float itemGridAxisAvailable = gridAxisExtent;

    auto widthConstraint = axisConstraint(
        Dimension::Width,
        containingBlockWidth,
        inlineIsGridAxis ? itemGridAxisAvailable : YGUndefined,
        inlineIsGridAxis ? SizingMode::StretchFit : SizingMode::MaxContent,
        marginInlineStart + marginInlineEnd);
    auto heightConstraint = axisConstraint(
        Dimension::Height,
        containingBlockHeight,
        inlineIsGridAxis ? YGUndefined : itemGridAxisAvailable,
        inlineIsGridAxis ? SizingMode::MaxContent : SizingMode::StretchFit,
        marginBlockStart + marginBlockEnd);

    // aspect-ratio is resolved by the caller too, for the same reason definite
    // sizes are: Yoga applies it in the parent's algorithm, not inside the
    // child. The grid axis is known — it is the item's area — so the stacking
    // axis follows from it. Without this an <img>-shaped item measures zero in
    // the stacking axis and every lane collapses.
    const auto aspectRatio = itemStyle.aspectRatio();
    if (aspectRatio.isDefined() && aspectRatio.unwrap() > 0.0f) {
      const float gridAxisContent = gridAxisExtent -
          (inlineIsGridAxis ? marginInlineStart + marginInlineEnd
                            : marginBlockStart + marginBlockEnd);
      if (inlineIsGridAxis) {
        if (!item.node->hasDefiniteLength(
                Dimension::Height, containingBlockHeight)) {
          heightConstraint = {
              gridAxisContent / aspectRatio.unwrap() + marginBlockStart +
                  marginBlockEnd,
              SizingMode::StretchFit};
        }
      } else if (!item.node->hasDefiniteLength(
                     Dimension::Width, containingBlockWidth)) {
        widthConstraint = {
            gridAxisContent * aspectRatio.unwrap() + marginInlineStart +
                marginInlineEnd,
            SizingMode::StretchFit};
      }
    }

    calculateLayoutInternal(
        item.node,
        widthConstraint.first,
        heightConstraint.first,
        direction,
        widthConstraint.second,
        heightConstraint.second,
        containingBlockWidth,
        containingBlockHeight,
        performLayout,
        LayoutPassReason::kGridLayout,
        layoutMarkerData,
        depth,
        generationCount);

    const float measuredStacking = item.node->getLayout().measuredDimension(
        inlineIsGridAxis ? Dimension::Height : Dimension::Width);
    const float marginStacking = inlineIsGridAxis
        ? marginBlockStart + marginBlockEnd
        : marginInlineStart + marginInlineEnd;

    // "the outer sizes of the box are floored at zero" — a large negative
    // margin must not pull a track's running position backwards, or a later
    // item would be told there is room where there is not.
    const float outerStacking = std::max(0.0f, measuredStacking + marginStacking);

    item.placedLine = chosenLine;
    item.stackingStart = maxPos;
    item.outerStackingSize = outerStacking;

    for (size_t i = 0; i < item.span && chosenLine + i < trackCount; i++) {
      runningPosition[chosenLine + i] = maxPos + outerStacking + stackingAxisGap;
    }
    stackingExtent = std::max(stackingExtent, maxPos + outerStacking);

    if (performLayout) {
      // An item narrower than its track is aligned within it by
      // justify-items/justify-self (or align-* when rows are the grid axis).
      // There is no such freedom in the stacking axis: the item defines the
      // extent there, so there is nothing to align against.
      const float itemGridAxisSize = item.node->getLayout().measuredDimension(
          inlineIsGridAxis ? Dimension::Width : Dimension::Height);
      const float gridAxisMargin = inlineIsGridAxis
          ? marginInlineStart + marginInlineEnd
          : marginBlockStart + marginBlockEnd;
      float gridAxisFreeSpace =
          gridAxisExtent - itemGridAxisSize - gridAxisMargin;
      if (gridAxisFreeSpace < 0.0f) {
        gridAxisFreeSpace = 0.0f;
      }
      float alignmentOffset = 0.0f;
      if (inlineIsGridAxis) {
        const auto justify = resolveChildJustification(node, item.node);
        if (justify == Justify::Center) {
          alignmentOffset = gridAxisFreeSpace / 2.0f;
        } else if (justify == Justify::End || justify == Justify::FlexEnd) {
          alignmentOffset = gridAxisFreeSpace;
        }
      } else {
        const auto align = resolveChildAlignment(node, item.node);
        if (align == Align::Center) {
          alignmentOffset = gridAxisFreeSpace / 2.0f;
        } else if (align == Align::End || align == Align::FlexEnd) {
          alignmentOffset = gridAxisFreeSpace;
        }
      }

      const float gridAxisStart = trackOffsets[chosenLine] + alignmentOffset;
      const float inlineStart = inlineIsGridAxis
          ? gridAxisStart + marginInlineStart + leadingPaddingAndBorderInline
          : maxPos + marginInlineStart + leadingPaddingAndBorderInline;
      const float blockStart = inlineIsGridAxis
          ? maxPos + marginBlockStart + leadingPaddingAndBorderBlock
          : gridAxisStart + marginBlockStart + leadingPaddingAndBorderBlock;

      float finalLeft = inlineStart;
      if (direction == Direction::RTL) {
        // §4.4.2: placement follows the writing mode, so an RTL grid axis
        // fills right to left.
        const float containerInline = inlineIsGridAxis
            ? (yoga::isDefined(availableInnerWidth) ? availableInnerWidth
                                                    : gridAxisUsed)
            : availableInnerWidth;
        const float itemWidth =
            item.node->getLayout().measuredDimension(Dimension::Width);
        finalLeft = leadingPaddingAndBorderInline + containerInline -
            (inlineStart - leadingPaddingAndBorderInline) - itemWidth;
      }

      item.node->setLayoutPosition(finalLeft, PhysicalEdge::Left);
      item.node->setLayoutPosition(blockStart, PhysicalEdge::Top);
    }
  }

  // The container's stacking-axis content size is the longest lane. The
  // trailing gap is not part of it: a gap sits between items, and there is
  // nothing after the last one.
  const float stackingContentSize = stackingExtent;

  const float measuredGridAxis = yoga::isDefined(gridAxisAvailable) &&
          (inlineIsGridAxis ? widthSizingMode : heightSizingMode) ==
              SizingMode::StretchFit
      ? gridAxisAvailable
      : gridAxisUsed;

  // The stacking axis is the longest lane, UNLESS the container was given a
  // definite size there — a block-level lanes container still fills its
  // containing block in the inline axis, and an explicit height still wins
  // over the content.
  const float measuredStackingAxis = yoga::isDefined(stackingAxisAvailable) &&
          (inlineIsGridAxis ? heightSizingMode : widthSizingMode) ==
              SizingMode::StretchFit
      ? stackingAxisAvailable
      : stackingContentSize;

  const float measuredWidth =
      inlineIsGridAxis ? measuredGridAxis : measuredStackingAxis;
  const float measuredHeight =
      inlineIsGridAxis ? measuredStackingAxis : measuredGridAxis;

  node->setLayoutMeasuredDimension(
      boundAxis(
          node,
          FlexDirection::Row,
          direction,
          measuredWidth + paddingAndBorderInline,
          ownerWidth,
          ownerWidth),
      Dimension::Width);
  node->setLayoutMeasuredDimension(
      boundAxis(
          node,
          FlexDirection::Column,
          direction,
          measuredHeight + paddingAndBorderBlock,
          ownerHeight,
          ownerWidth),
      Dimension::Height);

  (void)dense;
}

} // namespace facebook::yoga
