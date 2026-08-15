/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <stddef.h>
#include <yoga/YGEnums.h>
#include <yoga/YGNode.h>
#include <yoga/YGValue.h>

YG_EXTERN_C_BEGIN

YG_EXPORT void YGNodeCopyStyle(YGNodeRef dstNode, YGNodeConstRef srcNode);

YG_EXPORT void YGNodeStyleSetDirection(YGNodeRef node, YGDirection direction);
YG_EXPORT YGDirection YGNodeStyleGetDirection(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetFlexDirection(
    YGNodeRef node,
    YGFlexDirection flexDirection);
YG_EXPORT YGFlexDirection YGNodeStyleGetFlexDirection(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetJustifyContent(
    YGNodeRef node,
    YGJustify justifyContent);
YG_EXPORT YGJustify YGNodeStyleGetJustifyContent(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetJustifyItems(
    YGNodeRef node,
    YGJustify justifyItems);
YG_EXPORT YGJustify YGNodeStyleGetJustifyItems(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetJustifySelf(YGNodeRef node, YGJustify justifySelf);
YG_EXPORT YGJustify YGNodeStyleGetJustifySelf(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetAlignContent(YGNodeRef node, YGAlign alignContent);
YG_EXPORT YGAlign YGNodeStyleGetAlignContent(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetAlignItems(YGNodeRef node, YGAlign alignItems);
YG_EXPORT YGAlign YGNodeStyleGetAlignItems(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetAlignSelf(YGNodeRef node, YGAlign alignSelf);
YG_EXPORT YGAlign YGNodeStyleGetAlignSelf(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetPositionType(
    YGNodeRef node,
    YGPositionType positionType);
YG_EXPORT YGPositionType YGNodeStyleGetPositionType(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetFlexWrap(YGNodeRef node, YGWrap flexWrap);
YG_EXPORT YGWrap YGNodeStyleGetFlexWrap(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetOverflow(YGNodeRef node, YGOverflow overflow);
YG_EXPORT YGOverflow YGNodeStyleGetOverflow(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetDisplay(YGNodeRef node, YGDisplay display);
YG_EXPORT YGDisplay YGNodeStyleGetDisplay(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetFlex(YGNodeRef node, float flex);
YG_EXPORT float YGNodeStyleGetFlex(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetFlexGrow(YGNodeRef node, float flexGrow);
YG_EXPORT float YGNodeStyleGetFlexGrow(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetFlexShrink(YGNodeRef node, float flexShrink);
YG_EXPORT float YGNodeStyleGetFlexShrink(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetFlexBasis(YGNodeRef node, float flexBasis);
YG_EXPORT void YGNodeStyleSetFlexBasisPercent(YGNodeRef node, float flexBasis);
YG_EXPORT void YGNodeStyleSetFlexBasisAuto(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetFlexBasisMaxContent(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetFlexBasisFitContent(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetFlexBasisStretch(YGNodeRef node);
YG_EXPORT YGValue YGNodeStyleGetFlexBasis(YGNodeConstRef node);

YG_EXPORT void
YGNodeStyleSetPosition(YGNodeRef node, YGEdge edge, float position);
YG_EXPORT void
YGNodeStyleSetPositionPercent(YGNodeRef node, YGEdge edge, float position);
YG_EXPORT YGValue YGNodeStyleGetPosition(YGNodeConstRef node, YGEdge edge);
YG_EXPORT void YGNodeStyleSetPositionAuto(YGNodeRef node, YGEdge edge);

YG_EXPORT
void YGNodeStyleSetMargin(YGNodeRef node, YGEdge edge, float margin);
YG_EXPORT void
YGNodeStyleSetMarginPercent(YGNodeRef node, YGEdge edge, float margin);
YG_EXPORT void YGNodeStyleSetMarginAuto(YGNodeRef node, YGEdge edge);
YG_EXPORT YGValue YGNodeStyleGetMargin(YGNodeConstRef node, YGEdge edge);

YG_EXPORT void
YGNodeStyleSetPadding(YGNodeRef node, YGEdge edge, float padding);
YG_EXPORT void
YGNodeStyleSetPaddingPercent(YGNodeRef node, YGEdge edge, float padding);
YG_EXPORT YGValue YGNodeStyleGetPadding(YGNodeConstRef node, YGEdge edge);

YG_EXPORT void YGNodeStyleSetBorder(YGNodeRef node, YGEdge edge, float border);
YG_EXPORT float YGNodeStyleGetBorder(YGNodeConstRef node, YGEdge edge);

YG_EXPORT void
YGNodeStyleSetGap(YGNodeRef node, YGGutter gutter, float gapLength);
YG_EXPORT void
YGNodeStyleSetGapPercent(YGNodeRef node, YGGutter gutter, float gapLength);
YG_EXPORT YGValue YGNodeStyleGetGap(YGNodeConstRef node, YGGutter gutter);

YG_EXPORT void YGNodeStyleSetBoxSizing(YGNodeRef node, YGBoxSizing boxSizing);
YG_EXPORT YGBoxSizing YGNodeStyleGetBoxSizing(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetWidth(YGNodeRef node, float width);
YG_EXPORT void YGNodeStyleSetWidthPercent(YGNodeRef node, float width);
YG_EXPORT void YGNodeStyleSetWidthAuto(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetWidthMaxContent(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetWidthFitContent(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetWidthStretch(YGNodeRef node);
YG_EXPORT YGValue YGNodeStyleGetWidth(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetHeight(YGNodeRef node, float height);
YG_EXPORT void YGNodeStyleSetHeightPercent(YGNodeRef node, float height);
YG_EXPORT void YGNodeStyleSetHeightAuto(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetHeightMaxContent(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetHeightFitContent(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetHeightStretch(YGNodeRef node);
YG_EXPORT YGValue YGNodeStyleGetHeight(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetMinWidth(YGNodeRef node, float minWidth);
YG_EXPORT void YGNodeStyleSetMinWidthPercent(YGNodeRef node, float minWidth);
YG_EXPORT void YGNodeStyleSetMinWidthMaxContent(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetMinWidthFitContent(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetMinWidthStretch(YGNodeRef node);
YG_EXPORT YGValue YGNodeStyleGetMinWidth(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetMinHeight(YGNodeRef node, float minHeight);
YG_EXPORT void YGNodeStyleSetMinHeightPercent(YGNodeRef node, float minHeight);
YG_EXPORT void YGNodeStyleSetMinHeightMaxContent(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetMinHeightFitContent(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetMinHeightStretch(YGNodeRef node);
YG_EXPORT YGValue YGNodeStyleGetMinHeight(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetMaxWidth(YGNodeRef node, float maxWidth);
YG_EXPORT void YGNodeStyleSetMaxWidthPercent(YGNodeRef node, float maxWidth);
YG_EXPORT void YGNodeStyleSetMaxWidthMaxContent(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetMaxWidthFitContent(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetMaxWidthStretch(YGNodeRef node);
YG_EXPORT YGValue YGNodeStyleGetMaxWidth(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetMaxHeight(YGNodeRef node, float maxHeight);
YG_EXPORT void YGNodeStyleSetMaxHeightPercent(YGNodeRef node, float maxHeight);
YG_EXPORT void YGNodeStyleSetMaxHeightMaxContent(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetMaxHeightFitContent(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetMaxHeightStretch(YGNodeRef node);
YG_EXPORT YGValue YGNodeStyleGetMaxHeight(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetAspectRatio(YGNodeRef node, float aspectRatio);
YG_EXPORT float YGNodeStyleGetAspectRatio(YGNodeConstRef node);

// Grid Item Properties
YG_EXPORT void YGNodeStyleSetGridColumnStart(
    YGNodeRef node,
    int gridColumnStart);
YG_EXPORT void YGNodeStyleSetGridColumnStartAuto(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetGridColumnStartSpan(YGNodeRef node, int span);
YG_EXPORT int YGNodeStyleGetGridColumnStart(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetGridColumnEnd(YGNodeRef node, int gridColumnEnd);
YG_EXPORT void YGNodeStyleSetGridColumnEndAuto(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetGridColumnEndSpan(YGNodeRef node, int span);
YG_EXPORT int YGNodeStyleGetGridColumnEnd(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetGridRowStart(YGNodeRef node, int gridRowStart);
YG_EXPORT void YGNodeStyleSetGridRowStartAuto(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetGridRowStartSpan(YGNodeRef node, int span);
YG_EXPORT int YGNodeStyleGetGridRowStart(YGNodeConstRef node);

YG_EXPORT void YGNodeStyleSetGridRowEnd(YGNodeRef node, int gridRowEnd);
YG_EXPORT void YGNodeStyleSetGridRowEndAuto(YGNodeRef node);
YG_EXPORT void YGNodeStyleSetGridRowEndSpan(YGNodeRef node, int span);
YG_EXPORT int YGNodeStyleGetGridRowEnd(YGNodeConstRef node);

// Grid Container Properties

// https://www.w3.org/TR/css-grid-2/#auto-repeat
//
// A track list may contain at most one repeat(auto-fill|auto-fit, ...). Set
// the track list to the pattern expanded ONCE, then mark which slice of it is
// the auto-repeat: layout expands it against the container's real size, since
// the repetition count is not knowable from style alone.
//
//   grid-template-columns: 10px repeat(auto-fill, minmax(120px, 1fr)) 10px
//     -> three tracks set: 10px, minmax(120px, 1fr), 10px
//     -> auto-repeat at startIndex 1, trackCount 1
// https://www.w3.org/TR/css-grid-2/#grid-auto-flow-property
// `column` fills down a column before moving to the next; `dense` lets a later
// item backfill a hole an earlier spanning item left behind.
typedef enum YGGridAutoFlow {
  YGGridAutoFlowRow = 0,
  YGGridAutoFlowRowDense = 1,
  YGGridAutoFlowColumn = 2,
  YGGridAutoFlowColumnDense = 3,
} YGGridAutoFlow;

YG_EXPORT void YGNodeStyleSetGridAutoFlow(YGNodeRef node, YGGridAutoFlow flow);

// https://drafts.csswg.org/css-grid-3/#placement-tolerance
//
// The tie threshold for grid lanes placement: candidate positions within this
// distance of the shortest one count as equally good, and tied positions fill
// in document order. `normal` is 1em.
typedef enum YGFlowToleranceType {
  YGFlowToleranceNormal = 0,
  YGFlowTolerancePoints = 1,
  YGFlowTolerancePercent = 2,
  YGFlowToleranceInfinite = 3,
} YGFlowToleranceType;

YG_EXPORT void YGNodeStyleSetFlowTolerance(
    YGNodeRef node,
    YGFlowToleranceType type,
    float value);

// https://www.w3.org/TR/css-grid-2/#grid-template-areas-property
//
// Set the row strings of the template, then the name an item is placed into:
//
//   grid-template-areas: "header header" "sidebar main"
//     -> YGNodeStyleSetGridTemplateAreas(grid, (const char*[]){"header header",
//                                                              "sidebar main"}, 2)
//     -> YGNodeStyleSetGridArea(item, "header")
//
// A ragged template, or a name that does not form a rectangle, makes the whole
// declaration invalid per §7.3 and is ignored.
YG_EXPORT void YGNodeStyleSetGridTemplateAreas(
    YGNodeRef node,
    const char* const* rows,
    size_t rowCount);
YG_EXPORT void YGNodeStyleSetGridArea(YGNodeRef node, const char* areaName);

typedef enum YGGridAutoRepeatType {
  YGGridAutoRepeatNone = 0,
  YGGridAutoRepeatAutoFill = 1,
  YGGridAutoRepeatAutoFit = 2,
} YGGridAutoRepeatType;

YG_EXPORT void YGNodeStyleSetGridTemplateColumnsAutoRepeat(
    YGNodeRef node,
    YGGridAutoRepeatType type,
    size_t startIndex,
    size_t trackCount);
YG_EXPORT void YGNodeStyleSetGridTemplateRowsAutoRepeat(
    YGNodeRef node,
    YGGridAutoRepeatType type,
    size_t startIndex,
    size_t trackCount);

YG_EXPORT void YGNodeStyleSetGridTemplateColumnsCount(
    YGNodeRef node,
    size_t count);
YG_EXPORT void YGNodeStyleSetGridTemplateColumn(
    YGNodeRef node,
    size_t index,
    YGGridTrackType type,
    float value);
YG_EXPORT void YGNodeStyleSetGridTemplateColumnMinMax(
    YGNodeRef node,
    size_t index,
    YGGridTrackType minType,
    float minValue,
    YGGridTrackType maxType,
    float maxValue);

YG_EXPORT void YGNodeStyleSetGridTemplateRowsCount(
    YGNodeRef node,
    size_t count);
YG_EXPORT void YGNodeStyleSetGridTemplateRow(
    YGNodeRef node,
    size_t index,
    YGGridTrackType type,
    float value);
YG_EXPORT void YGNodeStyleSetGridTemplateRowMinMax(
    YGNodeRef node,
    size_t index,
    YGGridTrackType minType,
    float minValue,
    YGGridTrackType maxType,
    float maxValue);

YG_EXPORT void YGNodeStyleSetGridAutoColumnsCount(YGNodeRef node, size_t count);
YG_EXPORT void YGNodeStyleSetGridAutoColumn(
    YGNodeRef node,
    size_t index,
    YGGridTrackType type,
    float value);
YG_EXPORT void YGNodeStyleSetGridAutoColumnMinMax(
    YGNodeRef node,
    size_t index,
    YGGridTrackType minType,
    float minValue,
    YGGridTrackType maxType,
    float maxValue);

YG_EXPORT void YGNodeStyleSetGridAutoRowsCount(YGNodeRef node, size_t count);
YG_EXPORT void YGNodeStyleSetGridAutoRow(
    YGNodeRef node,
    size_t index,
    YGGridTrackType type,
    float value);
YG_EXPORT void YGNodeStyleSetGridAutoRowMinMax(
    YGNodeRef node,
    size_t index,
    YGGridTrackType minType,
    float minValue,
    YGGridTrackType maxType,
    float maxValue);

YG_EXTERN_C_END
