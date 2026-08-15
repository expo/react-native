/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include <yoga/algorithm/AbsoluteLayout.h>
#include <yoga/algorithm/BoundAxis.h>
#include <yoga/algorithm/TrailingPosition.h>
#include <yoga/algorithm/GridAutoRepeat.h>
#include <yoga/algorithm/grid/GridLayout.h>
#include <yoga/algorithm/grid/TrackSizing.h>

namespace facebook::yoga {

void calculateGridLayoutInternal(
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
  (void)reason; // Unused parameter

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
  auto widthIsDefinite =
      (widthSizingMode == SizingMode::StretchFit &&
       yoga::isDefined(availableWidth));
  auto heightIsDefinite =
      (heightSizingMode == SizingMode::StretchFit &&
       yoga::isDefined(availableHeight));

  // 11. Grid Layout Algorithm
  // Step 1: Run the Grid Item Placement Algorithm to resolve the placement of
  // all grid items in the grid.
  // Expand repeat(auto-fill|auto-fit, ...) against the container's content
  // box FIRST: line numbering, negative line resolution, placement and track
  // sizing are all defined against the expanded explicit grid
  // (css-grid-2 §7.2.3.1).
  const float columnGap =
      nodeStyle.computeGapForAxis(FlexDirection::Row, availableInnerWidth);
  const float rowGap =
      nodeStyle.computeGapForAxis(FlexDirection::Column, availableInnerHeight);
  const GridTrackList expandedColumns = expandAutoRepeat(
      nodeStyle.gridTemplateColumns(),
      nodeStyle.gridTemplateColumnsAutoRepeat(),
      availableInnerWidth,
      columnGap);
  const GridTrackList expandedRows = expandAutoRepeat(
      nodeStyle.gridTemplateRows(),
      nodeStyle.gridTemplateRowsAutoRepeat(),
      availableInnerHeight,
      rowGap);

  auto autoPlacement = ResolvedAutoPlacement::resolveGridItemPlacements(
      node, expandedColumns.size(), expandedRows.size());

  // §7.2.3.1 auto-fit: after placement, repeated tracks that hold no item
  // collapse. A collapsed track is 0px wide AND the gutters either side of it
  // merge into one, so its total contribution — track plus one gutter — is
  // nothing at all; dropping it from the list produces the same geometry. It
  // is also safe against explicit placement, because a track that any item
  // occupies or spans is by definition not empty, so no line an item refers to
  // can be dropped.
  auto collapseAutoFit = [&](const GridTrackList& expanded,
                             const GridAutoRepeat& autoRepeat,
                             const GridTrackList& authored,
                             float availableSize,
                             float gap,
                             bool isColumnAxis) {
    const auto range =
        autoRepeatRange(authored, autoRepeat, availableSize, gap);
    if (!range.collapsible || expanded.empty()) {
      return expanded;
    }
    // Item track indices are offset by the implicit tracks that were added
    // before the explicit grid.
    const auto offset = static_cast<int64_t>(
        isColumnAxis ? -autoPlacement.minColumnStart
                     : -autoPlacement.minRowStart);
    std::vector<bool> occupied(expanded.size(), false);
    for (const auto& gridItem : autoPlacement.gridItems) {
      const size_t start =
          isColumnAxis ? gridItem.columnStart : gridItem.rowStart;
      const size_t end = isColumnAxis ? gridItem.columnEnd : gridItem.rowEnd;
      for (size_t track = start; track < end; track++) {
        const int64_t index = static_cast<int64_t>(track) - offset;
        if (index >= 0 && index < static_cast<int64_t>(expanded.size())) {
          occupied[static_cast<size_t>(index)] = true;
        }
      }
    }
    GridTrackList collapsed;
    collapsed.reserve(expanded.size());
    for (size_t i = 0; i < expanded.size(); i++) {
      const bool isRepeated = i >= range.begin && i < range.end;
      if (isRepeated && !occupied[i]) {
        continue;
      }
      collapsed.push_back(expanded[i]);
    }
    // An empty grid still has one track to place into.
    if (collapsed.empty()) {
      collapsed.push_back(expanded.front());
    }
    return collapsed;
  };

  const GridTrackList fittedColumns = collapseAutoFit(
      expandedColumns,
      nodeStyle.gridTemplateColumnsAutoRepeat(),
      nodeStyle.gridTemplateColumns(),
      availableInnerWidth,
      columnGap,
      /* isColumnAxis */ true);
  const GridTrackList fittedRows = collapseAutoFit(
      expandedRows,
      nodeStyle.gridTemplateRowsAutoRepeat(),
      nodeStyle.gridTemplateRows(),
      availableInnerHeight,
      rowGap,
      /* isColumnAxis */ false);

  // Collapsing removes tracks, so the items' track indices have to be shifted
  // to match the compacted list. Placement is deliberately NOT redone: a
  // collapsed track keeps its grid line numbers (§7.2.3.1), so re-resolving an
  // explicit `grid-column: 3` against the shorter list would move the item to
  // a different track entirely.
  auto remapPlacement = [&](const GridTrackList& expanded,
                            const GridTrackList& fitted,
                            bool isColumnAxis) {
    if (fitted.size() == expanded.size()) {
      return;
    }
    const auto offset = static_cast<int64_t>(
        isColumnAxis ? -autoPlacement.minColumnStart
                     : -autoPlacement.minRowStart);
    const auto& gridItems = autoPlacement.gridItems;

    // Which expanded explicit tracks survived, in full-track coordinates.
    const size_t fullCount = static_cast<size_t>(
        offset +
        static_cast<int64_t>(
            isColumnAxis ? autoPlacement.maxColumnEnd
                         : autoPlacement.maxRowEnd));
    std::vector<bool> kept(fullCount, true);
    {
      const auto range = isColumnAxis
          ? autoRepeatRange(
                nodeStyle.gridTemplateColumns(),
                nodeStyle.gridTemplateColumnsAutoRepeat(),
                availableInnerWidth,
                columnGap)
          : autoRepeatRange(
                nodeStyle.gridTemplateRows(),
                nodeStyle.gridTemplateRowsAutoRepeat(),
                availableInnerHeight,
                rowGap);
      std::vector<bool> occupied(expanded.size(), false);
      for (const auto& gridItem : gridItems) {
        const size_t start =
            isColumnAxis ? gridItem.columnStart : gridItem.rowStart;
        const size_t end = isColumnAxis ? gridItem.columnEnd : gridItem.rowEnd;
        for (size_t track = start; track < end; track++) {
          const int64_t index = static_cast<int64_t>(track) - offset;
          if (index >= 0 && index < static_cast<int64_t>(expanded.size())) {
            occupied[static_cast<size_t>(index)] = true;
          }
        }
      }
      for (size_t i = 0; i < expanded.size(); i++) {
        const bool isRepeated = i >= range.begin && i < range.end;
        if (isRepeated && !occupied[i]) {
          const auto full = static_cast<int64_t>(i) + offset;
          if (full >= 0 && full < static_cast<int64_t>(kept.size())) {
            kept[static_cast<size_t>(full)] = false;
          }
        }
      }
    }

    // Prefix sums turn old line indices into new ones: newIndex[i] is how
    // many tracks survive before line i.
    std::vector<size_t> newIndex(kept.size() + 1, 0);
    size_t running = 0;
    for (size_t i = 0; i < kept.size(); i++) {
      newIndex[i] = running;
      if (kept[i]) {
        running++;
      }
    }
    newIndex[kept.size()] = running;

    auto mapLine = [&](size_t line) {
      return line < newIndex.size() ? newIndex[line] : running;
    };
    for (auto& gridItem : autoPlacement.gridItems) {
      if (isColumnAxis) {
        const size_t start = mapLine(gridItem.columnStart);
        size_t end = mapLine(gridItem.columnEnd);
        // An item never collapses to nothing: it kept at least its own track.
        gridItem.columnStart = start;
        gridItem.columnEnd = end > start ? end : start + 1;
      } else {
        const size_t start = mapLine(gridItem.rowStart);
        size_t end = mapLine(gridItem.rowEnd);
        gridItem.rowStart = start;
        gridItem.rowEnd = end > start ? end : start + 1;
      }
    }
    if (isColumnAxis) {
      autoPlacement.maxColumnEnd = static_cast<int32_t>(
          static_cast<int64_t>(running) - offset);
    } else {
      autoPlacement.maxRowEnd =
          static_cast<int32_t>(static_cast<int64_t>(running) - offset);
    }
  };

  remapPlacement(expandedColumns, fittedColumns, /* isColumnAxis */ true);
  remapPlacement(expandedRows, fittedRows, /* isColumnAxis */ false);

  // Create the grid tracks (auto and explicit = implicit grid)
  auto gridTracks =
      createGridTracks(node, autoPlacement, fittedColumns, fittedRows);
  // At this point, we have grid items final positions and implicit grid tracks

  // Step 2: Find the size of the grid container, per § 5.2 Sizing Grid
  // Containers. If grid container size is not definite, we have to run the
  // track sizing algorithm to find the size of the grid container. Note: During
  // this phase, cyclic <percentage>s in track sizes are treated as auto.
  float containerInnerWidth =
      widthIsDefinite ? availableInnerWidth : YGUndefined;
  float containerInnerHeight =
      heightIsDefinite ? availableInnerHeight : YGUndefined;
  auto& rowTracks = gridTracks.rowTracks;
  auto& columnTracks = gridTracks.columnTracks;
  auto& gridItems = autoPlacement.gridItems;
  auto& baselineItemGroups = autoPlacement.baselineItemGroups;
  bool needsSecondTrackSizingPass = true;

  if (!widthIsDefinite || !heightIsDefinite) {
    auto trackSizing = TrackSizing(
        node,
        columnTracks,
        rowTracks,
        containerInnerWidth,
        containerInnerHeight,
        gridItems,
        widthSizingMode,
        heightSizingMode,
        direction,
        ownerWidth,
        ownerHeight,
        layoutMarkerData,
        depth,
        generationCount,
        baselineItemGroups);

    trackSizing.runGridSizingAlgorithm();

    bool containerSizeChanged = false;

    // LOCAL FIX (see README-VENDORED.md): the track total is a CONTENT-box
    // size, but `boundAxis` floors its result at the node's padding+border,
    // which is only correct for a border-box size. Flooring a content-box
    // total makes a padded grid container that much too large in an
    // indefinite axis — a 20px-padded container around a 20px row came out
    // 80px tall instead of 60px. Yoga's min/max dimensions are border-box
    // too, so clamp in border-box space and convert back.
    auto boundContentBox = [&](FlexDirection axis,
                               float contentSize,
                               float paddingAndBorder,
                               float axisSize) {
      return boundAxisWithinMinAndMax(
                 node,
                 direction,
                 axis,
                 FloatOptional{contentSize + paddingAndBorder},
                 axisSize,
                 ownerWidth)
                 .unwrap() -
          paddingAndBorder;
    };

    if (!widthIsDefinite) {
      auto totalTrackWidth = trackSizing.getTotalBaseSize(Dimension::Width);
      containerInnerWidth = boundContentBox(
          FlexDirection::Row,
          totalTrackWidth,
          paddingAndBorderInline,
          ownerWidth);
      if (containerInnerWidth != totalTrackWidth) {
        containerSizeChanged = true;
      }
    }

    if (!heightIsDefinite) {
      auto totalTrackHeight = trackSizing.getTotalBaseSize(Dimension::Height);
      containerInnerHeight = boundContentBox(
          FlexDirection::Column,
          totalTrackHeight,
          paddingAndBorderBlock,
          ownerHeight);
      if (containerInnerHeight != totalTrackHeight) {
        containerSizeChanged = true;
      }
    }

    // We need to run track sizing again if:
    // 1. The container size changed due to min/max bounds or
    // 2. There are percentage tracks in indefinite dimensions that need
    // resolution
    bool hasPercentageTracksNeedingResolution =
        (!widthIsDefinite &&
         trackSizing.hasPercentageTracks(Dimension::Width)) ||
        (!heightIsDefinite &&
         trackSizing.hasPercentageTracks(Dimension::Height));
    needsSecondTrackSizingPass =
        containerSizeChanged || hasPercentageTracksNeedingResolution;
  }

  node->setLayoutMeasuredDimension(
      boundAxis(
          node,
          FlexDirection::Row,
          direction,
          containerInnerWidth + paddingAndBorderInline,
          ownerWidth,
          ownerWidth),
      Dimension::Width);

  node->setLayoutMeasuredDimension(
      boundAxis(
          node,
          FlexDirection::Column,
          direction,
          containerInnerHeight + paddingAndBorderBlock,
          ownerHeight,
          ownerWidth),
      Dimension::Height);

  // If we are not performing layout, we can return early after sizing the grid
  // container.
  if (!performLayout) {
    return;
  }

  // Inititialize track sizing with the final container size
  auto trackSizing = TrackSizing(
      node,
      columnTracks,
      rowTracks,
      containerInnerWidth,
      containerInnerHeight,
      gridItems,
      widthSizingMode,
      heightSizingMode,
      direction,
      ownerWidth,
      ownerHeight,
      layoutMarkerData,
      depth,
      generationCount,
      baselineItemGroups);

  // Step 3: Given the resulting grid container size, run the Grid Sizing
  // Algorithm to size the grid. Run track sizing with the new container
  // dimensions Note: During this phase, <percentage>s in track sizes are
  // resolved against the grid container size.

  // We only need to run track sizing again if:
  // 1. Both dimensions were definite or
  // 2. The container size changed due to min/max constraints in Step 2, or
  // 3. There are percentage tracks in indefinite dimensions that need
  // resolution
  if (needsSecondTrackSizingPass) {
    trackSizing.runGridSizingAlgorithm();
  }

  // Step 4: Lay out the grid items into their respective containing blocks.
  // Each grid area’s width and height are considered definite for this purpose.
  auto gridWidth = trackSizing.getTotalBaseSize(Dimension::Width);
  auto gridHeight = trackSizing.getTotalBaseSize(Dimension::Height);

  float leadingPaddingAndBorderInline =
      nodeStyle.computeInlineStartPadding(
          FlexDirection::Row, direction, ownerWidth) +
      nodeStyle.computeInlineStartBorder(FlexDirection::Row, direction);
  float leadingPaddingAndBorderBlock =
      nodeStyle.computeInlineStartPadding(
          FlexDirection::Column, direction, ownerWidth) +
      nodeStyle.computeInlineStartBorder(FlexDirection::Column, direction);

  // Align content/Justify content
  float freeSpaceInlineAxis = containerInnerWidth - gridWidth;
  auto inlineDistribution = trackSizing.calculateContentDistribution(
      Dimension::Width, freeSpaceInlineAxis);
  float freeSpaceBlockAxis = containerInnerHeight - gridHeight;
  auto blockDistribution = trackSizing.calculateContentDistribution(
      Dimension::Height, freeSpaceBlockAxis);

  if (freeSpaceInlineAxis < 0.0f || freeSpaceBlockAxis < 0.0f) {
    node->setLayoutHadOverflow(true);
  }

  auto gridInlineStartOffset = inlineDistribution.startOffset;
  auto gridBlockStartOffset = blockDistribution.startOffset;
  auto finalEffectiveColumnGap = inlineDistribution.effectiveGap;
  auto finalEffectiveRowGap = blockDistribution.effectiveGap;

  std::vector<float> columnGridLineOffsets;
  columnGridLineOffsets.reserve(columnTracks.size() + 1);
  columnGridLineOffsets.push_back(0.0f);
  for (size_t i = 0; i < columnTracks.size(); i++) {
    float offset = columnGridLineOffsets[i] + columnTracks[i].baseSize;
    if (i < columnTracks.size() - 1) {
      offset += finalEffectiveColumnGap;
    }
    columnGridLineOffsets.push_back(offset);
  }

  std::vector<float> rowGridLineOffsets;
  rowGridLineOffsets.reserve(rowTracks.size() + 1);
  rowGridLineOffsets.push_back(0.0f);
  for (size_t i = 0; i < rowTracks.size(); i++) {
    float offset = rowGridLineOffsets[i] + rowTracks[i].baseSize;
    if (i < rowTracks.size() - 1) {
      offset += finalEffectiveRowGap;
    }
    rowGridLineOffsets.push_back(offset);
  }

  for (auto& item : gridItems) {
    // grid line offsets include the gap after each track (except the last).
    // so we subtract the trailing gap for items that do not end at the last
    // track.
    float containingBlockWidth = columnGridLineOffsets[item.columnEnd] -
        columnGridLineOffsets[item.columnStart];
    if (item.columnEnd < columnTracks.size()) {
      containingBlockWidth -= finalEffectiveColumnGap;
    }
    float containingBlockHeight =
        rowGridLineOffsets[item.rowEnd] - rowGridLineOffsets[item.rowStart];
    if (item.rowEnd < rowTracks.size()) {
      containingBlockHeight -= finalEffectiveRowGap;
    }
    float gridItemInlineStart = columnGridLineOffsets[item.columnStart];
    float gridItemBlockStart = rowGridLineOffsets[item.rowStart];
    const auto& itemStyle = item.node->style();

    const auto marginInlineStart = itemStyle.computeInlineStartMargin(
        FlexDirection::Row, direction, containingBlockWidth);
    const auto marginInlineEnd = itemStyle.computeInlineEndMargin(
        FlexDirection::Row, direction, containingBlockWidth);
    const auto marginBlockStart = itemStyle.computeInlineStartMargin(
        FlexDirection::Column, direction, containingBlockWidth);
    const auto marginBlockEnd = itemStyle.computeInlineEndMargin(
        FlexDirection::Column, direction, containingBlockWidth);

    auto itemConstraints = trackSizing.calculateItemConstraints(
        item, containingBlockWidth, containingBlockHeight);

    calculateLayoutInternal(
        item.node,
        itemConstraints.width,
        itemConstraints.height,
        direction,
        itemConstraints.widthSizingMode,
        itemConstraints.heightSizingMode,
        containingBlockWidth,
        containingBlockHeight,
        true,
        LayoutPassReason::kGridLayout,
        layoutMarkerData,
        depth,
        generationCount);

    auto justifySelf = resolveChildJustification(node, item.node);
    auto alignSelf = resolveChildAlignment(node, item.node);

    // since we know the item width and grid width, we can do the alignment
    // here. alignment of grid items happen in the grid area measured dimension
    // includes padding and border
    float actualItemWidth =
        item.node->getLayout().measuredDimension(Dimension::Width);
    auto freeSpaceInlineAxisItem = containingBlockWidth - actualItemWidth -
        marginInlineStart - marginInlineEnd;
    float startAutoMarginOffset = 0.0f;
    // https://www.w3.org/TR/css-grid-1/#auto-margins
    // auto margins in either axis absorb positive free space prior to alignment
    // via the box alignment properties, thereby disabling the effects of any
    // self-alignment properties in that axis.
    if (freeSpaceInlineAxisItem > 0.0f) {
      if (itemStyle.inlineStartMarginIsAuto(FlexDirection::Row, direction) &&
          itemStyle.inlineEndMarginIsAuto(FlexDirection::Row, direction)) {
        startAutoMarginOffset = freeSpaceInlineAxisItem / 2;
        freeSpaceInlineAxisItem = 0.0f;
      } else if (itemStyle.inlineStartMarginIsAuto(
                     FlexDirection::Row, direction)) {
        startAutoMarginOffset = freeSpaceInlineAxisItem;
        freeSpaceInlineAxisItem = 0.0f;
      } else if (itemStyle.inlineEndMarginIsAuto(
                     FlexDirection::Row, direction)) {
        startAutoMarginOffset = 0.0f;
        freeSpaceInlineAxisItem = 0.0f;
      }
    }

    float justifySelfOffset = 0.0f;
    if (justifySelf == Justify::End) {
      justifySelfOffset = freeSpaceInlineAxisItem;
    } else if (justifySelf == Justify::Center) {
      justifySelfOffset = freeSpaceInlineAxisItem / 2;
    }

    float finalLeft = leadingPaddingAndBorderInline + gridItemInlineStart +
        marginInlineStart + startAutoMarginOffset + justifySelfOffset +
        gridInlineStartOffset;

    if (direction == Direction::RTL) {
      finalLeft = getPositionOfOppositeEdge(
          finalLeft, FlexDirection::Row, node, item.node);
    }

    // Add relative position offset for relatively positioned items.
    // For RTL, the relative position is in logical coordinates so we subtract
    // it from the physical left.
    float relativePositionInline = item.node->relativePosition(
        FlexDirection::Row, direction, containingBlockWidth);
    if (direction == Direction::RTL) {
      item.node->setLayoutPosition(
          finalLeft - relativePositionInline, PhysicalEdge::Left);
    } else {
      item.node->setLayoutPosition(
          finalLeft + relativePositionInline, PhysicalEdge::Left);
    }

    float actualItemHeight =
        item.node->getLayout().measuredDimension(Dimension::Height);
    auto freeSpaceBlockAxisItem = containingBlockHeight - actualItemHeight -
        marginBlockStart - marginBlockEnd;
    float topAutoMarginOffset = 0.0f;
    if (freeSpaceBlockAxisItem > 0.0f) {
      if (itemStyle.inlineStartMarginIsAuto(FlexDirection::Column, direction) &&
          itemStyle.inlineEndMarginIsAuto(FlexDirection::Column, direction)) {
        topAutoMarginOffset = freeSpaceBlockAxisItem / 2;
        freeSpaceBlockAxisItem = 0.0f;
      } else if (itemStyle.inlineStartMarginIsAuto(
                     FlexDirection::Column, direction)) {
        topAutoMarginOffset = freeSpaceBlockAxisItem;
        freeSpaceBlockAxisItem = 0.0f;
      } else if (itemStyle.inlineEndMarginIsAuto(
                     FlexDirection::Column, direction)) {
        freeSpaceBlockAxisItem = 0.0f;
      }
    }

    float alignSelfOffset = 0.0f;
    if (alignSelf == Align::End) {
      alignSelfOffset = freeSpaceBlockAxisItem;
    } else if (alignSelf == Align::Center) {
      alignSelfOffset = freeSpaceBlockAxisItem / 2;
    } else if (alignSelf == Align::Baseline) {
      alignSelfOffset = item.baselineShim;
    }

    float finalTop = gridItemBlockStart + marginBlockStart +
        topAutoMarginOffset + alignSelfOffset + gridBlockStartOffset +
        leadingPaddingAndBorderBlock;

    // Add relative position offset for relatively positioned items
    float relativePositionBlock = item.node->relativePosition(
        FlexDirection::Column, direction, containingBlockHeight);
    item.node->setLayoutPosition(
        finalTop + relativePositionBlock, PhysicalEdge::Top);
  }

  // Perform layout of absolute children
  // https://www.w3.org/TR/css-grid-1/#abspos
  // TODO: support grid-[row|column]-[start|end] as containing blocks
  if (nodeStyle.positionType() != PositionType::Static ||
      node->alwaysFormsContainingBlock() || depth == 1) {
    for (auto child : node->getLayoutChildren()) {
      if (child->style().display() == Display::None) {
        zeroOutLayoutRecursively(child);
        child->setHasNewLayout(true);
        child->setDirty(false);
        continue;
      }

      if (child->style().positionType() == PositionType::Absolute) {
        child->processDimensions();
      }
    }

    layoutAbsoluteDescendants(
        node,
        node,
        widthSizingMode,
        direction,
        layoutMarkerData,
        depth,
        generationCount,
        0.0f,
        0.0f,
        availableInnerWidth,
        availableInnerHeight);
  }
}

GridTracks createGridTracks(
    yoga::Node* node,
    const ResolvedAutoPlacement& autoPlacement,
    const GridTrackList& expandedColumns,
    const GridTrackList& expandedRows) {
  // The EXPANDED explicit lists, not style's authored ones: any
  // repeat(auto-fill|auto-fit, ...) was resolved by the caller.
  const auto& gridExplicitColumns = expandedColumns;
  const auto& gridExplicitRows = expandedRows;

  std::vector<GridTrack> columnTracks;
  std::vector<GridTrack> rowTracks;
  columnTracks.reserve(
      static_cast<size_t>(
          autoPlacement.maxColumnEnd - autoPlacement.minColumnStart));
  rowTracks.reserve(
      static_cast<size_t>(autoPlacement.maxRowEnd - autoPlacement.minRowStart));

  // https://www.w3.org/TR/css-grid-1/#auto-tracks
  auto autoRowTracks = node->style().gridAutoRows().empty()
      ? GridTrackList{GridTrackSize{
            .minSizingFunction = StyleSizeLength::ofAuto(),
            .maxSizingFunction = StyleSizeLength::ofAuto()}}
      : node->style().gridAutoRows();
  auto autoColumnTracks = node->style().gridAutoColumns().empty()
      ? GridTrackList{GridTrackSize{
            .minSizingFunction = StyleSizeLength::ofAuto(),
            .maxSizingFunction = StyleSizeLength::ofAuto()}}
      : node->style().gridAutoColumns();

  // The last implicit grid track before the explicit grid receives the last
  // specified size, and so on backwards. i.e. The pattern repeats backwards
  auto negativeImplicitGridColumnTrackCount = -autoPlacement.minColumnStart;
  auto autoColumnTracksSize = autoColumnTracks.size();
  for (auto i = 0; i < negativeImplicitGridColumnTrackCount; i++) {
    auto currentColumnTrackIndex =
        static_cast<size_t>(negativeImplicitGridColumnTrackCount - i - 1) %
        autoColumnTracksSize;
    auto autoColumnTrack =
        autoColumnTracks[autoColumnTracksSize - currentColumnTrackIndex - 1];
    columnTracks.push_back(GridTrack(autoColumnTrack));
  }

  for (size_t i = 0; i < gridExplicitColumns.size(); i++) {
    columnTracks.push_back(GridTrack(gridExplicitColumns[i]));
  }

  // The first track after the last explicitly-sized track receives the first
  // specified size i.e. the pattern repeats forwards
  for (size_t i = 0; i < static_cast<size_t>(autoPlacement.maxColumnEnd) -
           gridExplicitColumns.size();
       i++) {
    auto autoColumnTrack = autoColumnTracks[i % autoColumnTracksSize];
    columnTracks.push_back(GridTrack(autoColumnTrack));
  }

  auto negativeImplicitGridRowTrackCount = -autoPlacement.minRowStart;
  auto autoRowTracksSize = autoRowTracks.size();
  for (auto i = 0; i < negativeImplicitGridRowTrackCount; i++) {
    auto currentRowTrackIndex =
        static_cast<size_t>(negativeImplicitGridRowTrackCount - i - 1) %
        autoRowTracksSize;
    auto autoRowTrack =
        autoRowTracks[autoRowTracksSize - currentRowTrackIndex - 1];
    rowTracks.push_back(GridTrack(autoRowTrack));
  }
  for (const auto& explicitRow : gridExplicitRows) {
    rowTracks.push_back(GridTrack(explicitRow));
  }
  for (size_t i = 0; i <
       static_cast<size_t>(autoPlacement.maxRowEnd) - gridExplicitRows.size();
       i++) {
    auto autoRowTrack = autoRowTracks[i % autoRowTracksSize];
    rowTracks.push_back(GridTrack(autoRowTrack));
  }

  return {std::move(columnTracks), std::move(rowTracks)};
}

} // namespace facebook::yoga
