/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include <algorithm>
#include <array>
#include <atomic>
#include <cfloat>
#include <cmath>
#include <cstddef>
#include <cstring>
#include <limits>
#include <vector>

#include <yoga/Yoga.h>

#include <yoga/algorithm/AbsoluteLayout.h>
#include <yoga/algorithm/PlacedFloat.h>
#include <yoga/algorithm/Align.h>
#include <yoga/algorithm/Baseline.h>
#include <yoga/algorithm/BoundAxis.h>
#include <yoga/algorithm/Cache.h>
#include <yoga/algorithm/CalculateLayout.h>
#include <yoga/algorithm/FlexDirection.h>
#include <yoga/algorithm/FlexLine.h>
#include <yoga/algorithm/PixelGrid.h>
#include <yoga/algorithm/SizingMode.h>
#include <yoga/algorithm/TrailingPosition.h>
#include <yoga/algorithm/GridLanesLayout.h>
#include <yoga/algorithm/grid/GridLayout.h>
#include <yoga/debug/AssertFatal.h>
#include <yoga/debug/Log.h>
#include <yoga/event/event.h>
#include <yoga/node/Node.h>
#include <yoga/numeric/Comparison.h>
#include <yoga/numeric/FloatOptional.h>

namespace facebook::yoga {

std::atomic<uint32_t> gCurrentGenerationCount(0);

static bool hasAutoHorizontalMargin(const Style& style) {
  for (const auto direction : {Direction::LTR, Direction::RTL}) {
    if (style.flexStartMarginIsAuto(FlexDirection::Row, direction) ||
        style.flexEndMarginIsAuto(FlexDirection::Row, direction)) {
      return true;
    }
  }
  return false;
}

static bool isColumnStretchEdge(
    const yoga::Node* const owner,
    const yoga::Node* const child) {
  if (owner == nullptr || child == nullptr) {
    return false;
  }
  const auto& ownerStyle = owner->style();
  const auto& childStyle = child->style();
  const auto childWidth = child->getProcessedDimension(Dimension::Width);
  return ownerStyle.display() == Display::Flex &&
      isColumn(ownerStyle.flexDirection()) &&
      ownerStyle.flexWrap() == Wrap::NoWrap &&
      childStyle.positionType() != PositionType::Absolute &&
      !childStyle.aspectRatio().isDefined() &&
      (childWidth.isAuto() || childWidth.isUndefined()) &&
      !hasAutoHorizontalMargin(childStyle) &&
      resolveChildAlignment(owner, child) == Align::Stretch;
}

static bool isInColumnStretchScrollSubtree(const yoga::Node* const node) {
  auto current = node;
  while (current != nullptr) {
    auto owner = current->getOwner();
    while (owner != nullptr && owner->style().display() == Display::Contents) {
      owner = owner->getOwner();
    }
    if (owner == nullptr || !isColumnStretchEdge(owner, current)) {
      return false;
    }
    if (owner->style().overflow() == Overflow::Scroll) {
      return true;
    }
    current = owner;
  }
  return false;
}

static bool isNonZeroLength(const Style::Length& length) {
  return length.isAuto() ||
      (length.value().isDefined() && length.value().unwrap() != 0.0f);
}

static bool hasNonZeroVerticalSpacing(const Style& style) {
  constexpr std::array<Edge, 4> verticalEdges = {
      Edge::Top, Edge::Bottom, Edge::Vertical, Edge::All};
  for (const auto edge : verticalEdges) {
    if (isNonZeroLength(style.margin(edge)) ||
        isNonZeroLength(style.padding(edge)) ||
        isNonZeroLength(style.border(edge))) {
      return true;
    }
  }
  return false;
}

static bool hasPercentageLength(const Style& style) {
  constexpr std::array<Edge, 9> edges = {
      Edge::Left,
      Edge::Top,
      Edge::Right,
      Edge::Bottom,
      Edge::Start,
      Edge::End,
      Edge::Horizontal,
      Edge::Vertical,
      Edge::All};
  for (const auto edge : edges) {
    if (style.margin(edge).isPercent() || style.position(edge).isPercent() ||
        style.padding(edge).isPercent() || style.border(edge).isPercent()) {
      return true;
    }
  }

  constexpr std::array<Dimension, 2> dimensions = {
      Dimension::Width, Dimension::Height};
  for (const auto dimension : dimensions) {
    if (style.dimension(dimension).isPercent() ||
        style.minDimension(dimension).isPercent() ||
        style.maxDimension(dimension).isPercent()) {
      return true;
    }
  }

  return style.flexBasis().isPercent() ||
      style.gap(Gutter::Column).isPercent() ||
      style.gap(Gutter::Row).isPercent() || style.gap(Gutter::All).isPercent();
}

static bool hasNonZeroFlex(const yoga::Node& node) {
  const auto& style = node.style();
  const auto flex = style.flex();
  const auto flexGrow = style.flexGrow();
  const auto flexShrink = style.flexShrink();
  const auto config = node.getConfig();
  const bool canGrow = flexGrow.isDefined()
      ? flexGrow.unwrap() != 0.0f
      : flex.isDefined() && flex.unwrap() > 0.0f;
  const bool canShrink = flexShrink.isDefined()
      ? flexShrink.unwrap() != 0.0f
      : (config != nullptr && config->useWebDefaults()) ||
          (flex.isDefined() && flex.unwrap() < 0.0f);
  return canGrow || canShrink;
}

static bool isHeightFitContentIndependent(const yoga::Node& node) {
  const auto& style = node.style();
  const auto height = style.dimension(Dimension::Height);
  const auto flexBasis = style.flexBasis();
  const bool hasRelativePercentPosition =
      style.position(Edge::Top).isPercent() ||
      style.position(Edge::Bottom).isPercent() ||
      style.position(Edge::Vertical).isPercent() ||
      style.position(Edge::All).isPercent();
  return !node.hasMeasureFunc() && !node.hasMinContentMeasureFunc() &&
      !node.hasBaselineFunc() && !node.isReferenceBaseline() &&
      (height.isAuto() || height.isUndefined()) &&
      style.minDimension(Dimension::Height).isUndefined() &&
      style.maxDimension(Dimension::Height).isUndefined() &&
      (flexBasis.isAuto() || flexBasis.isUndefined()) &&
      !hasNonZeroFlex(node) && style.boxSizing() == BoxSizing::BorderBox &&
      !style.aspectRatio().isDefined() &&
      style.positionType() != PositionType::Absolute &&
      style.overflow() != Overflow::Scroll &&
      style.display() == Display::Flex && isColumn(style.flexDirection()) &&
      style.alignItems() == Align::Stretch &&
      (style.alignSelf() == Align::Auto ||
       style.alignSelf() == Align::Stretch) &&
      style.justifyContent() == Justify::FlexStart &&
      style.flexWrap() == Wrap::NoWrap && !style.gap(Gutter::All).isDefined() &&
      !style.gap(Gutter::Row).isDefined() && !hasRelativePercentPosition &&
      !hasNonZeroVerticalSpacing(style) && !hasPercentageLength(style);
}

static bool canSkipHeightFitContent(const yoga::Node* const root) {
  if (root == nullptr) {
    return false;
  }

  constexpr std::size_t maxPendingNodes = 64;
  std::array<const yoga::Node*, maxPendingNodes> stack{root};
  std::size_t stackSize = 1;
  while (stackSize > 0) {
    const auto node = stack[--stackSize];
    if (node == nullptr || !isHeightFitContentIndependent(*node)) {
      return false;
    }
    for (const auto child : node->getLayoutChildren()) {
      if (stackSize == stack.size()) {
        return false;
      }
      stack[stackSize++] = child;
    }
  }
  return true;
}

void constrainMaxSizeForMode(
    const yoga::Node* node,
    Direction direction,
    FlexDirection axis,
    float ownerAxisSize,
    float ownerWidth,
    /*in_out*/ SizingMode* mode,
    /*in_out*/ float* size) {
  const FloatOptional maxSize =
      node->style().resolvedMaxDimension(
          direction, dimension(axis), ownerAxisSize, ownerWidth) +
      FloatOptional(node->style().computeMarginForAxis(axis, ownerWidth));
  switch (*mode) {
    case SizingMode::StretchFit:
    case SizingMode::FitContent:
      *size = (maxSize.isUndefined() || *size < maxSize.unwrap())
          ? *size
          : maxSize.unwrap();
      break;
    case SizingMode::MaxContent:
      if (maxSize.isDefined()) {
        *mode = SizingMode::FitContent;
        *size = maxSize.unwrap();
      }
      break;
  }
}

static void computeFlexBasisForChild(
    const yoga::Node* const node,
    yoga::Node* const child,
    const float width,
    const SizingMode widthMode,
    const float height,
    const float ownerWidth,
    const float ownerHeight,
    const SizingMode heightMode,
    const Direction direction,
    LayoutData& layoutMarkerData,
    const uint32_t depth,
    const uint32_t generationCount) {
  const FlexDirection mainAxis =
      resolveDirection(node->style().flexDirection(), direction);
  const bool isMainAxisRow = isRow(mainAxis);
  const float mainAxisSize = isMainAxisRow ? width : height;
  const float mainAxisOwnerSize = isMainAxisRow ? ownerWidth : ownerHeight;

  float childWidth = YGUndefined;
  float childHeight = YGUndefined;
  SizingMode childWidthSizingMode;
  SizingMode childHeightSizingMode;

  const FloatOptional resolvedFlexBasis = child->resolveFlexBasis(
      direction, mainAxis, mainAxisOwnerSize, ownerWidth);
  const bool isRowStyleDimDefined =
      child->hasDefiniteLength(Dimension::Width, ownerWidth);
  const bool isColumnStyleDimDefined =
      child->hasDefiniteLength(Dimension::Height, ownerHeight);

  const bool fixFlexBasisFitContent =
      node->getConfig()->isExperimentalFeatureEnabled(
          ExperimentalFeature::FixFlexBasisFitContent);

  const bool useResolvedFlexBasis =
      resolvedFlexBasis.isDefined() && yoga::isDefined(mainAxisSize);

  if (useResolvedFlexBasis) {
    if (child->getLayout().computedFlexBasis.isUndefined() ||
        (child->getConfig()->isExperimentalFeatureEnabled(
             ExperimentalFeature::WebFlexBasis) &&
         child->getLayout().computedFlexBasisGeneration != generationCount)) {
      const FloatOptional paddingAndBorder = FloatOptional(
          paddingAndBorderForAxis(child, mainAxis, direction, ownerWidth));
      child->setLayoutComputedFlexBasis(
          yoga::maxOrDefined(resolvedFlexBasis, paddingAndBorder));
    }
  } else if (isMainAxisRow && isRowStyleDimDefined) {
    // The width is definite, so use that as the flex basis.
    const FloatOptional paddingAndBorder =
        FloatOptional(paddingAndBorderForAxis(
            child, FlexDirection::Row, direction, ownerWidth));

    child->setLayoutComputedFlexBasis(
        yoga::maxOrDefined(
            child->getResolvedDimension(
                direction, Dimension::Width, ownerWidth, ownerWidth),
            paddingAndBorder));
  } else if (!isMainAxisRow && isColumnStyleDimDefined) {
    // The height is definite, so use that as the flex basis.
    const FloatOptional paddingAndBorder =
        FloatOptional(paddingAndBorderForAxis(
            child, FlexDirection::Column, direction, ownerWidth));
    child->setLayoutComputedFlexBasis(
        yoga::maxOrDefined(
            child->getResolvedDimension(
                direction, Dimension::Height, ownerHeight, ownerWidth),
            paddingAndBorder));
  } else {
    // Compute the flex basis and hypothetical main size (i.e. the clamped flex
    // basis).
    childWidthSizingMode = SizingMode::MaxContent;
    childHeightSizingMode = SizingMode::MaxContent;

    auto marginRow =
        child->style().computeMarginForAxis(FlexDirection::Row, ownerWidth);
    auto marginColumn =
        child->style().computeMarginForAxis(FlexDirection::Column, ownerWidth);

    if (isRowStyleDimDefined) {
      childWidth = child
                       ->getResolvedDimension(
                           direction, Dimension::Width, ownerWidth, ownerWidth)
                       .unwrap() +
          marginRow;
      childWidthSizingMode = SizingMode::StretchFit;
    }
    if (isColumnStyleDimDefined) {
      childHeight =
          child
              ->getResolvedDimension(
                  direction, Dimension::Height, ownerHeight, ownerWidth)
              .unwrap() +
          marginColumn;
      childHeightSizingMode = SizingMode::StretchFit;
    }

    // The W3C spec doesn't say anything about the 'overflow' property, but all
    // major browsers appear to implement the following logic.
    if ((!isMainAxisRow && node->style().overflow() == Overflow::Scroll) ||
        node->style().overflow() != Overflow::Scroll) {
      if (yoga::isUndefined(childWidth) && yoga::isDefined(width)) {
        childWidth = width;
        childWidthSizingMode = SizingMode::FitContent;
      }
    }

    // A zero-intrinsic-height column subtree has the same layout with an
    // unbounded height, allowing its measurement cache to survive unrelated
    // size changes elsewhere in a vertical scroll subtree.
    const bool parentDoesNotScroll =
        node != nullptr && node->style().overflow() != Overflow::Scroll;
    bool applyHeightFitContent = isMainAxisRow || parentDoesNotScroll;
    if (fixFlexBasisFitContent) {
      const bool childHadOverflow = child != nullptr && child->isDirty() &&
          child->getLayout().hadOverflow();
      const bool hasHeightIndependentSubtree = node != nullptr &&
          child != nullptr && !isMainAxisRow && parentDoesNotScroll &&
          yoga::isUndefined(childHeight) && yoga::isDefined(height) &&
          isColumnStretchEdge(node, child) &&
          isInColumnStretchScrollSubtree(node) &&
          canSkipHeightFitContent(child);
      if (hasHeightIndependentSubtree && childHadOverflow) {
        child->setLayoutHadOverflow(false);
      }
      if (hasHeightIndependentSubtree) {
        applyHeightFitContent = false;
      }
    }
    if (applyHeightFitContent && yoga::isUndefined(childHeight) &&
        yoga::isDefined(height)) {
      childHeight = height;
      childHeightSizingMode = SizingMode::FitContent;
    }

    const auto& childStyle = child->style();
    if (childStyle.aspectRatio().isDefined()) {
      if (!isMainAxisRow && childWidthSizingMode == SizingMode::StretchFit) {
        childHeight = marginColumn +
            (childWidth - marginRow) / childStyle.aspectRatio().unwrap();
        childHeightSizingMode = SizingMode::StretchFit;
      } else if (
          isMainAxisRow && childHeightSizingMode == SizingMode::StretchFit) {
        childWidth = marginRow +
            (childHeight - marginColumn) * childStyle.aspectRatio().unwrap();
        childWidthSizingMode = SizingMode::StretchFit;
      }
    }

    // If child has no defined size in the cross axis and is set to stretch, set
    // the cross axis to be measured exactly with the available inner width

    const bool hasExactWidth =
        yoga::isDefined(width) && widthMode == SizingMode::StretchFit;
    const bool childWidthStretch =
        resolveChildAlignment(node, child) == Align::Stretch &&
        childWidthSizingMode != SizingMode::StretchFit;
    if (!isMainAxisRow && !isRowStyleDimDefined && hasExactWidth &&
        childWidthStretch) {
      childWidth = width;
      childWidthSizingMode = SizingMode::StretchFit;
      if (childStyle.aspectRatio().isDefined()) {
        childHeight =
            (childWidth - marginRow) / childStyle.aspectRatio().unwrap();
        childHeightSizingMode = SizingMode::StretchFit;
      }
    }

    const bool hasExactHeight =
        yoga::isDefined(height) && heightMode == SizingMode::StretchFit;
    const bool childHeightStretch =
        resolveChildAlignment(node, child) == Align::Stretch &&
        childHeightSizingMode != SizingMode::StretchFit;
    if (isMainAxisRow && !isColumnStyleDimDefined && hasExactHeight &&
        childHeightStretch) {
      childHeight = height;
      childHeightSizingMode = SizingMode::StretchFit;

      if (childStyle.aspectRatio().isDefined()) {
        childWidth =
            (childHeight - marginColumn) * childStyle.aspectRatio().unwrap();
        childWidthSizingMode = SizingMode::StretchFit;
      }
    }

    constrainMaxSizeForMode(
        child,
        direction,
        FlexDirection::Row,
        ownerWidth,
        ownerWidth,
        &childWidthSizingMode,
        &childWidth);
    constrainMaxSizeForMode(
        child,
        direction,
        FlexDirection::Column,
        ownerHeight,
        ownerWidth,
        &childHeightSizingMode,
        &childHeight);

    // Measure the child
    calculateLayoutInternal(
        child,
        childWidth,
        childHeight,
        direction,
        childWidthSizingMode,
        childHeightSizingMode,
        ownerWidth,
        ownerHeight,
        false,
        LayoutPassReason::kMeasureChild,
        layoutMarkerData,
        depth,
        generationCount);

    child->setLayoutComputedFlexBasis(FloatOptional(
        yoga::maxOrDefined(
            child->getLayout().measuredDimension(dimension(mainAxis)),
            paddingAndBorderForAxis(child, mainAxis, direction, ownerWidth))));
  }
  child->setLayoutComputedFlexBasisGeneration(generationCount);
}

static void measureNodeWithMeasureFunc(
    yoga::Node* const node,
    const Direction direction,
    float availableWidth,
    float availableHeight,
    const SizingMode widthSizingMode,
    const SizingMode heightSizingMode,
    const float ownerWidth,
    const float ownerHeight,
    LayoutData& layoutMarkerData,
    const LayoutPassReason reason) {
  yoga::assertFatalWithNode(
      node,
      node->hasMeasureFunc(),
      "Expected node to have custom measure function");

  if (widthSizingMode == SizingMode::MaxContent) {
    availableWidth = YGUndefined;
  }
  if (heightSizingMode == SizingMode::MaxContent) {
    availableHeight = YGUndefined;
  }

  const auto& layout = node->getLayout();
  const float paddingAndBorderAxisRow = layout.padding(PhysicalEdge::Left) +
      layout.padding(PhysicalEdge::Right) + layout.border(PhysicalEdge::Left) +
      layout.border(PhysicalEdge::Right);
  const float paddingAndBorderAxisColumn = layout.padding(PhysicalEdge::Top) +
      layout.padding(PhysicalEdge::Bottom) + layout.border(PhysicalEdge::Top) +
      layout.border(PhysicalEdge::Bottom);

  // We want to make sure we don't call measure with negative size
  const float innerWidth = yoga::isUndefined(availableWidth)
      ? availableWidth
      : yoga::maxOrDefined(0.0f, availableWidth - paddingAndBorderAxisRow);
  const float innerHeight = yoga::isUndefined(availableHeight)
      ? availableHeight
      : yoga::maxOrDefined(0.0f, availableHeight - paddingAndBorderAxisColumn);

  if (widthSizingMode == SizingMode::StretchFit &&
      heightSizingMode == SizingMode::StretchFit) {
    // Don't bother sizing the text if both dimensions are already defined.
    node->setLayoutMeasuredDimension(
        boundAxis(
            node,
            FlexDirection::Row,
            direction,
            availableWidth,
            ownerWidth,
            ownerWidth),
        Dimension::Width);
    node->setLayoutMeasuredDimension(
        boundAxis(
            node,
            FlexDirection::Column,
            direction,
            availableHeight,
            ownerHeight,
            ownerWidth),
        Dimension::Height);
  } else {
    Event::publish<Event::MeasureCallbackStart>(node);

    // Measure the text under the current constraints.
    const YGSize measuredSize = node->measure(
        innerWidth,
        measureMode(widthSizingMode),
        innerHeight,
        measureMode(heightSizingMode));

    layoutMarkerData.measureCallbacks += 1;
    layoutMarkerData.measureCallbackReasonsCount[static_cast<size_t>(reason)] +=
        1;

    Event::publish<Event::MeasureCallbackEnd>(
        node,
        {.width = innerWidth,
         .widthMeasureMode = unscopedEnum(measureMode(widthSizingMode)),
         .height = innerHeight,
         .heightMeasureMode = unscopedEnum(measureMode(heightSizingMode)),
         .measuredWidth = measuredSize.width,
         .measuredHeight = measuredSize.height,
         .reason = reason});

    node->setLayoutMeasuredDimension(
        boundAxis(
            node,
            FlexDirection::Row,
            direction,
            (widthSizingMode == SizingMode::MaxContent ||
             widthSizingMode == SizingMode::FitContent)
                ? measuredSize.width + paddingAndBorderAxisRow
                : availableWidth,
            ownerWidth,
            ownerWidth),
        Dimension::Width);

    node->setLayoutMeasuredDimension(
        boundAxis(
            node,
            FlexDirection::Column,
            direction,
            (heightSizingMode == SizingMode::MaxContent ||
             heightSizingMode == SizingMode::FitContent)
                ? measuredSize.height + paddingAndBorderAxisColumn
                : availableHeight,
            ownerHeight,
            ownerWidth),
        Dimension::Height);
  }
}

// For nodes with no children, use the available values if they were provided,
// or the minimum size as indicated by the padding and border sizes.
static void measureNodeWithoutChildren(
    yoga::Node* const node,
    const Direction direction,
    const float availableWidth,
    const float availableHeight,
    const SizingMode widthSizingMode,
    const SizingMode heightSizingMode,
    const float ownerWidth,
    const float ownerHeight) {
  const auto& layout = node->getLayout();

  float width = availableWidth;
  if (widthSizingMode == SizingMode::MaxContent ||
      widthSizingMode == SizingMode::FitContent) {
    width = layout.padding(PhysicalEdge::Left) +
        layout.padding(PhysicalEdge::Right) +
        layout.border(PhysicalEdge::Left) + layout.border(PhysicalEdge::Right);
  }
  node->setLayoutMeasuredDimension(
      boundAxis(
          node, FlexDirection::Row, direction, width, ownerWidth, ownerWidth),
      Dimension::Width);

  float height = availableHeight;
  if (heightSizingMode == SizingMode::MaxContent ||
      heightSizingMode == SizingMode::FitContent) {
    height = layout.padding(PhysicalEdge::Top) +
        layout.padding(PhysicalEdge::Bottom) +
        layout.border(PhysicalEdge::Top) + layout.border(PhysicalEdge::Bottom);
  }
  node->setLayoutMeasuredDimension(
      boundAxis(
          node,
          FlexDirection::Column,
          direction,
          height,
          ownerHeight,
          ownerWidth),
      Dimension::Height);
}

inline bool isFixedSize(float dim, SizingMode sizingMode) {
  return sizingMode == SizingMode::StretchFit ||
      (yoga::isDefined(dim) && sizingMode == SizingMode::FitContent &&
       dim <= 0.0);
}

static bool measureNodeWithFixedSize(
    yoga::Node* const node,
    const Direction direction,
    const float availableWidth,
    const float availableHeight,
    const SizingMode widthSizingMode,
    const SizingMode heightSizingMode,
    const float ownerWidth,
    const float ownerHeight) {
  if (isFixedSize(availableWidth, widthSizingMode) &&
      isFixedSize(availableHeight, heightSizingMode)) {
    node->setLayoutMeasuredDimension(
        boundAxis(
            node,
            FlexDirection::Row,
            direction,
            yoga::isUndefined(availableWidth) ||
                    (widthSizingMode == SizingMode::FitContent &&
                     availableWidth < 0.0f)
                ? 0.0f
                : availableWidth,
            ownerWidth,
            ownerWidth),
        Dimension::Width);

    node->setLayoutMeasuredDimension(
        boundAxis(
            node,
            FlexDirection::Column,
            direction,
            yoga::isUndefined(availableHeight) ||
                    (heightSizingMode == SizingMode::FitContent &&
                     availableHeight < 0.0f)
                ? 0.0f
                : availableHeight,
            ownerHeight,
            ownerWidth),
        Dimension::Height);
    return true;
  }

  return false;
}

void zeroOutLayoutRecursively(yoga::Node* const node) {
  node->getLayout() = {};
  node->setLayoutDimension(0, Dimension::Width);
  node->setLayoutDimension(0, Dimension::Height);
  node->setHasNewLayout(true);

  node->cloneChildrenIfNeeded();
  for (const auto child : node->getChildren()) {
    zeroOutLayoutRecursively(child);
  }
}

void cleanupContentsNodesRecursively(
    yoga::Node* const node,
    bool didPerformLayout) {
  if (node->hasContentsChildren()) [[unlikely]] {
    node->cloneContentsChildrenIfNeeded();
    for (auto child : node->getChildren()) {
      if (child->style().display() == Display::Contents) {
        child->getLayout() = {};
        child->setLayoutDimension(0, Dimension::Width);
        child->setLayoutDimension(0, Dimension::Height);
        if (didPerformLayout) {
          child->setHasNewLayout(true);
        }
        child->setDirty(false);
        child->cloneChildrenIfNeeded();

        cleanupContentsNodesRecursively(child, didPerformLayout);
      }
    }
  }
}

float calculateAvailableInnerDimension(
    const yoga::Node* const node,
    const Direction direction,
    const Dimension dimension,
    const float availableDim,
    const float paddingAndBorder,
    const float ownerDim,
    const float ownerWidth) {
  float availableInnerDim = availableDim - paddingAndBorder;
  // Max dimension overrides predefined dimension value; Min dimension in turn
  // overrides both of the above
  if (yoga::isDefined(availableInnerDim)) {
    // We want to make sure our available height does not violate min and max
    // constraints
    const FloatOptional minDimensionOptional =
        node->style().resolvedMinDimension(
            direction, dimension, ownerDim, ownerWidth);
    const float minInnerDim = minDimensionOptional.isUndefined()
        ? 0.0f
        : minDimensionOptional.unwrap() - paddingAndBorder;

    const FloatOptional maxDimensionOptional =
        node->style().resolvedMaxDimension(
            direction, dimension, ownerDim, ownerWidth);

    const float maxInnerDim = maxDimensionOptional.isUndefined()
        ? FLT_MAX
        : maxDimensionOptional.unwrap() - paddingAndBorder;
    availableInnerDim = yoga::maxOrDefined(
        yoga::minOrDefined(availableInnerDim, maxInnerDim), minInnerDim);
  }

  return availableInnerDim;
}

static float computeFlexBasisForChildren(
    yoga::Node* const node,
    const float availableInnerWidth,
    const float availableInnerHeight,
    const float ownerWidth,
    const float ownerHeight,
    SizingMode widthSizingMode,
    SizingMode heightSizingMode,
    Direction direction,
    FlexDirection mainAxis,
    bool performLayout,
    LayoutData& layoutMarkerData,
    const uint32_t depth,
    const uint32_t generationCount) {
  float totalOuterFlexBasis = 0.0f;
  YGNodeRef singleFlexChild = nullptr;
  auto children = node->getLayoutChildren();
  SizingMode sizingModeMainDim =
      isRow(mainAxis) ? widthSizingMode : heightSizingMode;
  // If there is only one child with flexGrow + flexShrink it means we can set
  // the computedFlexBasis to 0 instead of measuring and shrinking / flexing the
  // child to exactly match the remaining space
  if (sizingModeMainDim == SizingMode::StretchFit) {
    for (auto child : children) {
      if (child->isNodeFlexible()) {
        if (singleFlexChild != nullptr ||
            yoga::inexactEquals(child->resolveFlexGrow(), 0.0f) ||
            yoga::inexactEquals(child->resolveFlexShrink(), 0.0f)) {
          // There is already a flexible child, or this flexible child doesn't
          // have flexGrow and flexShrink, abort
          singleFlexChild = nullptr;
          break;
        } else {
          singleFlexChild = child;
        }
      }
    }
  }

  for (auto child : children) {
    child->processDimensions();
    if (child->style().display() == Display::None) {
      // Only mutate display: none children during layout passes. Zeroing them
      // out during measure-only passes contributes nothing to the measurement,
      // but sets `hasNewLayout` on nodes the parent's layout pass may never
      // visit (e.g. when its layout is restored from cache, skipping
      // `cloneChildrenIfNeeded()`). Such a leaked flag survives the commit and
      // is copied into lazily-shared clones, later tripping the ownership
      // assertion in `YogaLayoutableShadowNode::layout`.
      if (performLayout) {
        zeroOutLayoutRecursively(child);
        child->setHasNewLayout(true);
        child->setDirty(false);
      }
      continue;
    }
    if (performLayout) {
      // Set the initial position (relative to the owner).
      const Direction childDirection = child->resolveDirection(direction);
      child->setPosition(
          childDirection, availableInnerWidth, availableInnerHeight);
    }

    if (child->style().positionType() == PositionType::Absolute) {
      continue;
    }
    if (child == singleFlexChild) {
      child->setLayoutComputedFlexBasisGeneration(generationCount);
      child->setLayoutComputedFlexBasis(FloatOptional(0));
    } else {
      computeFlexBasisForChild(
          node,
          child,
          availableInnerWidth,
          widthSizingMode,
          availableInnerHeight,
          ownerWidth,
          ownerHeight,
          heightSizingMode,
          direction,
          layoutMarkerData,
          depth,
          generationCount);
    }

    totalOuterFlexBasis +=
        (child->getLayout().computedFlexBasis.unwrap() +
         child->style().computeMarginForAxis(mainAxis, availableInnerWidth));
  }

  return totalOuterFlexBasis;
}

// Returns the min-content size of `node` along `requestedAxis`, used by CSS
// Flexbox §4.5 automatic minimum sizing.
//
// Mirrors RenderCore FlexLayout's `AlgorithmBase::computeMinContentSize` /
// `measureMinContentMainSize` pair (see `xplat/flexlayout/flexlayout/
// FlexboxAlgorithm.h`). Unlike FlexLayout, which crosses a JNI/bridge
// boundary for nested flex containers via thread-local min-content markers,
// Yoga's flex containers are native nodes — so this function recurses
// directly into containers rather than going through a measure callback.
//
// Algorithm:
//   * Leaf with measure function: invoke it with `AtMost 0` on the
//     requested axis and `Undefined` on the other. Text measure-funcs
//     respond with longest-word width; image/collection-like measures
//     respond with 0 along their scroll axis.
//   * Empty leaf: return 0.
//   * Container: iterate in-flow children. For each, take its
//     min-content along the container's own main axis (sum into
//     `mainTotal`) and along its cross axis (max into `crossMax`),
//     plus the child's margins. Add the container's own padding and
//     border on both ends of each axis. Project onto `requestedAxis`.
//
// Container-level recursion does no layout writes (no positions, no
// alignment, no flex distribution); only the descendant leaf measure
// callbacks observe state changes (the same ones a normal layout pass
// would invoke). Roughly equivalent to FlexLayout's dedicated
// `computeMinContentSize` cost: one measure call per leaf + linear walk
// per container.
static float computeMinContentMainSize(
    yoga::Node* const node,
    const FlexDirection requestedAxis,
    const Direction ownerDirection,
    const float ownerWidth,
    const float ownerHeight) {
  const bool wantRow = isRow(requestedAxis);

  // 1. Static value wins for any node (leaf or container). Short-circuits
  // both the measure callback path AND any container recursion. The most
  // common use is `YGNodeSetMinContentWidth(node, 0)` declaring no
  // contribution per CSS-Images (Image) or CSS-Overflow (scroll
  // containers along their scroll axis).
  const FloatOptional staticMin =
      wantRow ? node->getMinContentWidth() : node->getMinContentHeight();
  if (staticMin.isDefined()) {
    return staticMin.unwrap();
  }

  if (node->hasMeasureFunc()) {
    // 2. Dynamic min-content callback if set (for Primitives whose
    // min-content depends on state). Otherwise fall back to the regular
    // measure function with `AtMost 0`, which text measurers naturally
    // answer with longest-word width.
    const YGSize size = node->hasMinContentMeasureFunc()
        ? node->measureMinContent(
              wantRow ? 0.0f : YGUndefined,
              wantRow ? MeasureMode::AtMost : MeasureMode::Undefined,
              wantRow ? YGUndefined : 0.0f,
              wantRow ? MeasureMode::Undefined : MeasureMode::AtMost)
        : node->measure(
              wantRow ? 0.0f : YGUndefined,
              wantRow ? MeasureMode::AtMost : MeasureMode::Undefined,
              wantRow ? YGUndefined : 0.0f,
              wantRow ? MeasureMode::Undefined : MeasureMode::AtMost);
    // Add the leaf's own padding and border, like the container branch below.
    const Direction leafDirection = node->resolveDirection(ownerDirection);
    const float paddingAndBorder =
        node->style().computeFlexStartPaddingAndBorder(
            requestedAxis, leafDirection, ownerWidth) +
        node->style().computeFlexEndPaddingAndBorder(
            requestedAxis, leafDirection, ownerWidth);
    return (wantRow ? size.width : size.height) + paddingAndBorder;
  }

  if (node->getChildCount() == 0) {
    return 0.0f;
  }

  const Direction direction = node->resolveDirection(ownerDirection);
  const FlexDirection nodeMainAxis =
      resolveDirection(node->style().flexDirection(), direction);
  const FlexDirection nodeCrossAxis =
      resolveCrossDirection(nodeMainAxis, direction);

  float mainTotal = 0.0f;
  float crossMax = 0.0f;

  for (size_t i = 0; i < node->getChildCount(); i++) {
    auto* const child = node->getChild(i);
    if (child->style().display() == Display::None ||
        child->style().positionType() == PositionType::Absolute) {
      continue;
    }

    float childMain = computeMinContentMainSize(
        child, nodeMainAxis, direction, ownerWidth, ownerHeight);
    childMain += child->style().computeMarginForAxis(nodeMainAxis, ownerWidth);

    float childCross = computeMinContentMainSize(
        child, nodeCrossAxis, direction, ownerWidth, ownerHeight);
    childCross +=
        child->style().computeMarginForAxis(nodeCrossAxis, ownerWidth);

    mainTotal += childMain;
    crossMax = std::max(crossMax, childCross);
  }

  mainTotal += node->style().computeFlexStartPaddingAndBorder(
                   nodeMainAxis, direction, ownerWidth) +
      node->style().computeFlexEndPaddingAndBorder(
          nodeMainAxis, direction, ownerWidth);
  crossMax += node->style().computeFlexStartPaddingAndBorder(
                  nodeCrossAxis, direction, ownerWidth) +
      node->style().computeFlexEndPaddingAndBorder(
          nodeCrossAxis, direction, ownerWidth);

  const bool nodeMainIsRow = isRow(nodeMainAxis);
  const float widthMin = nodeMainIsRow ? mainTotal : crossMax;
  const float heightMin = nodeMainIsRow ? crossMax : mainTotal;
  return wantRow ? widthMin : heightMin;
}

// Computes the CSS Flexbox §4.5 automatic minimum main-axis size for
// `child`. Returns Undefined when no auto-min applies (feature off, explicit
// `min-{w,h}` already set, or `display:none`); 0 when the item's own
// `overflow != visible` (the spec's per-item escape hatch); or a concrete
// floor otherwise.
//
// Floor = min(content-size, specified-size) capped by max-size, with the
// transferred (aspect-ratio × cross-size) suggestion replacing the
// specified-size leg when the item has an aspect ratio but no specified
// main size. See https://www.w3.org/TR/css-flexbox-1/#min-size-auto.
static FloatOptional computeAutoMinMainSize(
    yoga::Node* const child,
    const FlexDirection mainAxis,
    const Direction direction,
    const float ownerMainAxisSize,
    const float ownerWidth,
    const float ownerHeight) {
  if (child->hasErrata(Errata::MinSizeUndefinedInsteadOfAuto)) {
    return FloatOptional{};
  }
  if (child->style().display() == Display::None) {
    return FloatOptional{};
  }
  // Explicit `min-{w,h}` (including `0`) wins over auto. This is the
  // CSS-spec opt-out (§4.5).
  if (child->style().minDimension(dimension(mainAxis)).isDefined()) {
    return FloatOptional{};
  }
  // Per CSS §4.5: a flex item whose own `overflow` is not `visible` gets
  // auto-min = 0 (let scroll/clip handle overflow rather than enforce a
  // content-based minimum).
  if (child->style().overflow() != Overflow::Visible) {
    return FloatOptional{0.0f};
  }

  const Dimension mainDim = dimension(mainAxis);
  const Dimension crossDim =
      isRow(mainAxis) ? Dimension::Height : Dimension::Width;
  const bool isMainAxisRow = isRow(mainAxis);

  // Specified size suggestion: the resolved main-axis style dimension.
  const FloatOptional specifiedMain = child->getResolvedDimension(
      direction, mainDim, ownerMainAxisSize, ownerWidth);

  // Transferred size suggestion: cross × aspect-ratio, if both are definite.
  FloatOptional transferredMain;
  const FloatOptional aspectRatio = child->style().aspectRatio();
  if (aspectRatio.isDefined()) {
    const float crossOwner = isMainAxisRow ? ownerHeight : ownerWidth;
    const FloatOptional crossResolved = child->getResolvedDimension(
        direction, crossDim, crossOwner, ownerWidth);
    if (crossResolved.isDefined()) {
      const float ratio = aspectRatio.unwrap();
      const float crossValue = crossResolved.unwrap();
      transferredMain = FloatOptional{
          isMainAxisRow ? crossValue * ratio : crossValue / ratio};
    }
  }

  // Content size suggestion: probe via min-content recursion.
  const FloatOptional contentMain = FloatOptional{computeMinContentMainSize(
      child, mainAxis, direction, ownerWidth, ownerHeight)};

  // Combine per §4.5: floor = min(content, specified) when specified is
  // definite; otherwise floor = min(content, transferred) when transferred
  // applies (item has aspect-ratio + definite cross + no specified main);
  // else floor = content.
  FloatOptional floor = contentMain;
  if (specifiedMain.isDefined()) {
    if (floor.isUndefined() || specifiedMain < floor) {
      floor = specifiedMain;
    }
  } else if (transferredMain.isDefined()) {
    if (floor.isUndefined() || transferredMain < floor) {
      floor = transferredMain;
    }
  }

  // §4.5: cap by the max main size.
  const FloatOptional maxMain = child->style().resolvedMaxDimension(
      direction, mainDim, ownerMainAxisSize, ownerWidth);
  if (maxMain.isDefined() && floor > maxMain) {
    floor = maxMain;
  }

  if (floor.isUndefined() || floor.unwrap() < 0.0f) {
    floor = FloatOptional{0.0f};
  }
  return floor;
}

// boundAxis with an additional lower bound from `child`'s cached
// `computedAutoMinMainSize`, applied on the main axis only. Used inside
// the flex-shrink distribution to honor CSS §4.5 auto-min while preserving
// the existing min/max/padding-and-border clamping.
static float boundAxisWithAutoMin(
    const yoga::Node* const child,
    const FlexDirection axis,
    const Direction direction,
    const float value,
    const float axisSize,
    const float widthSize) {
  float bounded = boundAxis(child, axis, direction, value, axisSize, widthSize);
  const FloatOptional autoMin = child->getLayout().computedAutoMinMainSize;
  if (autoMin.isDefined() && bounded < autoMin.unwrap()) {
    bounded = autoMin.unwrap();
  }
  return bounded;
}

// It distributes the free space to the flexible items and ensures that the size
// of the flex items abide the min and max constraints. At the end of this
// function the child nodes would have proper size. Prior using this function
// please ensure that distributeFreeSpaceFirstPass is called.
static float distributeFreeSpaceSecondPass(
    FlexLine& flexLine,
    yoga::Node* const node,
    const FlexDirection mainAxis,
    const FlexDirection crossAxis,
    const Direction direction,
    const float ownerWidth,
    const float mainAxisOwnerSize,
    const float availableInnerMainDim,
    const float availableInnerCrossDim,
    const float availableInnerWidth,
    const float availableInnerHeight,
    const bool mainAxisOverflows,
    const SizingMode sizingModeCrossDim,
    const bool performLayout,
    LayoutData& layoutMarkerData,
    const uint32_t depth,
    const uint32_t generationCount) {
  float childFlexBasis = 0;
  float flexShrinkScaledFactor = 0;
  float flexGrowFactor = 0;
  float deltaFreeSpace = 0;
  const bool isMainAxisRow = isRow(mainAxis);
  const bool isNodeFlexWrap = node->style().flexWrap() != Wrap::NoWrap;

  for (auto currentLineChild : flexLine.itemsInFlow) {
    childFlexBasis = boundAxisWithinMinAndMax(
                         currentLineChild,
                         direction,
                         mainAxis,
                         currentLineChild->getLayout().computedFlexBasis,
                         mainAxisOwnerSize,
                         ownerWidth)
                         .unwrap();
    float updatedMainSize = childFlexBasis;

    if (yoga::isDefined(flexLine.layout.remainingFreeSpace) &&
        flexLine.layout.remainingFreeSpace < 0) {
      flexShrinkScaledFactor =
          -currentLineChild->resolveFlexShrink() * childFlexBasis;
      // Is this child able to shrink?
      if (flexShrinkScaledFactor != 0) {
        float childSize = YGUndefined;

        if (yoga::isDefined(flexLine.layout.totalFlexShrinkScaledFactors) &&
            flexLine.layout.totalFlexShrinkScaledFactors == 0) {
          childSize = childFlexBasis + flexShrinkScaledFactor;
        } else {
          childSize = childFlexBasis +
              (flexLine.layout.remainingFreeSpace /
               flexLine.layout.totalFlexShrinkScaledFactors) *
                  flexShrinkScaledFactor;
        }

        updatedMainSize = boundAxisWithAutoMin(
            currentLineChild,
            mainAxis,
            direction,
            childSize,
            availableInnerMainDim,
            availableInnerWidth);
      }
    } else if (
        yoga::isDefined(flexLine.layout.remainingFreeSpace) &&
        flexLine.layout.remainingFreeSpace > 0) {
      flexGrowFactor = currentLineChild->resolveFlexGrow();

      // Is this child able to grow?
      if (!std::isnan(flexGrowFactor) && flexGrowFactor != 0) {
        updatedMainSize = boundAxisWithAutoMin(
            currentLineChild,
            mainAxis,
            direction,
            childFlexBasis +
                flexLine.layout.remainingFreeSpace /
                    flexLine.layout.totalFlexGrowFactors * flexGrowFactor,
            availableInnerMainDim,
            availableInnerWidth);
      }
    }

    deltaFreeSpace += updatedMainSize - childFlexBasis;

    const float marginMain = currentLineChild->style().computeMarginForAxis(
        mainAxis, availableInnerWidth);
    const float marginCross = currentLineChild->style().computeMarginForAxis(
        crossAxis, availableInnerWidth);

    float childCrossSize = YGUndefined;
    float childMainSize = updatedMainSize + marginMain;
    SizingMode childCrossSizingMode;
    SizingMode childMainSizingMode = SizingMode::StretchFit;

    const auto& childStyle = currentLineChild->style();
    if (childStyle.aspectRatio().isDefined()) {
      childCrossSize = isMainAxisRow
          ? (childMainSize - marginMain) / childStyle.aspectRatio().unwrap()
          : (childMainSize - marginMain) * childStyle.aspectRatio().unwrap();
      childCrossSizingMode = SizingMode::StretchFit;

      childCrossSize += marginCross;
    } else if (
        !std::isnan(availableInnerCrossDim) &&
        !currentLineChild->hasDefiniteLength(
            dimension(crossAxis), availableInnerCrossDim) &&
        sizingModeCrossDim == SizingMode::StretchFit &&
        !(isNodeFlexWrap && mainAxisOverflows) &&
        resolveChildAlignment(node, currentLineChild) == Align::Stretch &&
        !currentLineChild->style().flexStartMarginIsAuto(
            crossAxis, direction) &&
        !currentLineChild->style().flexEndMarginIsAuto(crossAxis, direction)) {
      childCrossSize = availableInnerCrossDim;
      childCrossSizingMode = SizingMode::StretchFit;
    } else if (!currentLineChild->hasDefiniteLength(
                   dimension(crossAxis), availableInnerCrossDim)) {
      childCrossSize = availableInnerCrossDim;
      childCrossSizingMode = yoga::isUndefined(childCrossSize)
          ? SizingMode::MaxContent
          : SizingMode::FitContent;
    } else {
      childCrossSize = currentLineChild
                           ->getResolvedDimension(
                               direction,
                               dimension(crossAxis),
                               availableInnerCrossDim,
                               availableInnerWidth)
                           .unwrap() +
          marginCross;
      const bool isLoosePercentageMeasurement =
          currentLineChild->getProcessedDimension(dimension(crossAxis))
              .isPercent() &&
          sizingModeCrossDim != SizingMode::StretchFit;
      childCrossSizingMode =
          yoga::isUndefined(childCrossSize) || isLoosePercentageMeasurement
          ? SizingMode::MaxContent
          : SizingMode::StretchFit;
    }

    constrainMaxSizeForMode(
        currentLineChild,
        direction,
        mainAxis,
        availableInnerMainDim,
        availableInnerWidth,
        &childMainSizingMode,
        &childMainSize);
    constrainMaxSizeForMode(
        currentLineChild,
        direction,
        crossAxis,
        availableInnerCrossDim,
        availableInnerWidth,
        &childCrossSizingMode,
        &childCrossSize);

    const bool requiresStretchLayout =
        !currentLineChild->hasDefiniteLength(
            dimension(crossAxis), availableInnerCrossDim) &&
        resolveChildAlignment(node, currentLineChild) == Align::Stretch &&
        !currentLineChild->style().flexStartMarginIsAuto(
            crossAxis, direction) &&
        !currentLineChild->style().flexEndMarginIsAuto(crossAxis, direction);

    const float childWidth = isMainAxisRow ? childMainSize : childCrossSize;
    const float childHeight = !isMainAxisRow ? childMainSize : childCrossSize;

    const SizingMode childWidthSizingMode =
        isMainAxisRow ? childMainSizingMode : childCrossSizingMode;
    const SizingMode childHeightSizingMode =
        !isMainAxisRow ? childMainSizingMode : childCrossSizingMode;

    const bool isLayoutPass = performLayout && !requiresStretchLayout;
    // Recursively call the layout algorithm for this child with the updated
    // main size.
    calculateLayoutInternal(
        currentLineChild,
        childWidth,
        childHeight,
        node->getLayout().direction(),
        childWidthSizingMode,
        childHeightSizingMode,
        availableInnerWidth,
        availableInnerHeight,
        isLayoutPass,
        isLayoutPass ? LayoutPassReason::kFlexLayout
                     : LayoutPassReason::kFlexMeasure,
        layoutMarkerData,
        depth,
        generationCount);
    node->setLayoutHadOverflow(
        node->getLayout().hadOverflow() ||
        currentLineChild->getLayout().hadOverflow());
  }
  return deltaFreeSpace;
}

// It distributes the free space to the flexible items.For those flexible items
// whose min and max constraints are triggered, those flex item's clamped size
// is removed from the remaingfreespace.
static void distributeFreeSpaceFirstPass(
    FlexLine& flexLine,
    const Direction direction,
    const FlexDirection mainAxis,
    const float ownerWidth,
    const float mainAxisOwnerSize,
    const float availableInnerMainDim,
    const float availableInnerWidth) {
  float flexShrinkScaledFactor = 0;
  float flexGrowFactor = 0;
  float baseMainSize = 0;
  float boundMainSize = 0;
  float deltaFreeSpace = 0;

  for (auto currentLineChild : flexLine.itemsInFlow) {
    float childFlexBasis = boundAxisWithinMinAndMax(
                               currentLineChild,
                               direction,
                               mainAxis,
                               currentLineChild->getLayout().computedFlexBasis,
                               mainAxisOwnerSize,
                               ownerWidth)
                               .unwrap();

    if (flexLine.layout.remainingFreeSpace < 0) {
      flexShrinkScaledFactor =
          -currentLineChild->resolveFlexShrink() * childFlexBasis;

      // Is this child able to shrink?
      if (yoga::isDefined(flexShrinkScaledFactor) &&
          flexShrinkScaledFactor != 0) {
        baseMainSize = childFlexBasis +
            flexLine.layout.remainingFreeSpace /
                flexLine.layout.totalFlexShrinkScaledFactors *
                flexShrinkScaledFactor;
        boundMainSize = boundAxisWithAutoMin(
            currentLineChild,
            mainAxis,
            direction,
            baseMainSize,
            availableInnerMainDim,
            availableInnerWidth);
        if (yoga::isDefined(baseMainSize) && yoga::isDefined(boundMainSize) &&
            baseMainSize != boundMainSize) {
          // By excluding this item's size and flex factor from remaining, this
          // item's min/max constraints should also trigger in the second pass
          // resulting in the item's size calculation being identical in the
          // first and second passes.
          deltaFreeSpace += boundMainSize - childFlexBasis;
          flexLine.layout.totalFlexShrinkScaledFactors -=
              (-currentLineChild->resolveFlexShrink() *
               currentLineChild->getLayout().computedFlexBasis.unwrap());
        }
      }
    } else if (
        yoga::isDefined(flexLine.layout.remainingFreeSpace) &&
        flexLine.layout.remainingFreeSpace > 0) {
      flexGrowFactor = currentLineChild->resolveFlexGrow();

      // Is this child able to grow?
      if (yoga::isDefined(flexGrowFactor) && flexGrowFactor != 0) {
        baseMainSize = childFlexBasis +
            flexLine.layout.remainingFreeSpace /
                flexLine.layout.totalFlexGrowFactors * flexGrowFactor;
        boundMainSize = boundAxis(
            currentLineChild,
            mainAxis,
            direction,
            baseMainSize,
            availableInnerMainDim,
            availableInnerWidth);

        if (yoga::isDefined(baseMainSize) && yoga::isDefined(boundMainSize) &&
            baseMainSize != boundMainSize) {
          // By excluding this item's size and flex factor from remaining, this
          // item's min/max constraints should also trigger in the second pass
          // resulting in the item's size calculation being identical in the
          // first and second passes.
          deltaFreeSpace += boundMainSize - childFlexBasis;
          flexLine.layout.totalFlexGrowFactors -= flexGrowFactor;
        }
      }
    }
  }
  flexLine.layout.remainingFreeSpace -= deltaFreeSpace;
}

// Do two passes over the flex items to figure out how to distribute the
// remaining space.
//
// The first pass finds the items whose min/max constraints trigger, freezes
// them at those sizes, and excludes those sizes from the remaining space.
//
// The second pass sets the size of each flexible item. It distributes the
// remaining space amongst the items whose min/max constraints didn't trigger in
// the first pass. For the other items, it sets their sizes by forcing their
// min/max constraints to trigger again.
//
// This two pass approach for resolving min/max constraints deviates from the
// spec. The spec
// (https://www.w3.org/TR/CSS-flexbox-1/#resolve-flexible-lengths) describes a
// process that needs to be repeated a variable number of times. The algorithm
// implemented here won't handle all cases but it was simpler to implement and
// it mitigates performance concerns because we know exactly how many passes
// it'll do.
//
// At the end of this function the child nodes would have the proper size
// assigned to them.
//
static void resolveFlexibleLength(
    yoga::Node* const node,
    FlexLine& flexLine,
    const FlexDirection mainAxis,
    const FlexDirection crossAxis,
    const Direction direction,
    const float ownerWidth,
    const float mainAxisOwnerSize,
    const float availableInnerMainDim,
    const float availableInnerCrossDim,
    const float availableInnerWidth,
    const float availableInnerHeight,
    const bool mainAxisOverflows,
    const SizingMode sizingModeCrossDim,
    const bool performLayout,
    LayoutData& layoutMarkerData,
    const uint32_t depth,
    const uint32_t generationCount) {
  const float originalFreeSpace = flexLine.layout.remainingFreeSpace;

  // CSS Flexbox §4.5: compute each item's automatic minimum main-axis size
  // up front so the bounding helpers below can floor shrunk values.
  // computeAutoMinMainSize returns Undefined when the feature is off or an
  // explicit `min-{w,h}` already pins the floor, in which case the cached
  // value is also Undefined and `boundAxisWithAutoMin` reduces to `boundAxis`.
  if (!node->hasErrata(Errata::MinSizeUndefinedInsteadOfAuto)) {
    for (auto currentLineChild : flexLine.itemsInFlow) {
      currentLineChild->getLayout().computedAutoMinMainSize =
          computeAutoMinMainSize(
              currentLineChild,
              mainAxis,
              direction,
              mainAxisOwnerSize,
              availableInnerWidth,
              availableInnerHeight);
    }
  } else {
    for (auto currentLineChild : flexLine.itemsInFlow) {
      currentLineChild->getLayout().computedAutoMinMainSize = FloatOptional{};
    }
  }

  // First pass: detect the flex items whose min/max constraints trigger
  distributeFreeSpaceFirstPass(
      flexLine,
      direction,
      mainAxis,
      ownerWidth,
      mainAxisOwnerSize,
      availableInnerMainDim,
      availableInnerWidth);

  // Second pass: resolve the sizes of the flexible items
  const float distributedFreeSpace = distributeFreeSpaceSecondPass(
      flexLine,
      node,
      mainAxis,
      crossAxis,
      direction,
      ownerWidth,
      mainAxisOwnerSize,
      availableInnerMainDim,
      availableInnerCrossDim,
      availableInnerWidth,
      availableInnerHeight,
      mainAxisOverflows,
      sizingModeCrossDim,
      performLayout,
      layoutMarkerData,
      depth,
      generationCount);

  flexLine.layout.remainingFreeSpace = originalFreeSpace - distributedFreeSpace;
}

static void justifyMainAxis(
    yoga::Node* const node,
    FlexLine& flexLine,
    const FlexDirection mainAxis,
    const FlexDirection crossAxis,
    const Direction direction,
    const SizingMode sizingModeMainDim,
    const SizingMode sizingModeCrossDim,
    const float mainAxisOwnerSize,
    const float ownerWidth,
    const float availableInnerMainDim,
    const float availableInnerCrossDim,
    const float availableInnerWidth,
    const bool performLayout) {
  const auto& style = node->style();

  const float leadingPaddingAndBorderMain =
      node->style().computeFlexStartPaddingAndBorder(
          mainAxis, direction, ownerWidth);
  const float trailingPaddingAndBorderMain =
      node->style().computeFlexEndPaddingAndBorder(
          mainAxis, direction, ownerWidth);

  const float gap =
      node->style().computeGapForAxis(mainAxis, availableInnerMainDim);
  // If we are using "at most" rules in the main axis, make sure that
  // remainingFreeSpace is 0 when min main dimension is not given
  if (sizingModeMainDim == SizingMode::FitContent &&
      flexLine.layout.remainingFreeSpace > 0) {
    if (style.minDimension(dimension(mainAxis)).isDefined() &&
        style
            .resolvedMinDimension(
                direction, dimension(mainAxis), mainAxisOwnerSize, ownerWidth)
            .isDefined()) {
      // This condition makes sure that if the size of main dimension(after
      // considering child nodes main dim, leading and trailing padding etc)
      // falls below min dimension, then the remainingFreeSpace is reassigned
      // considering the min dimension

      // `minAvailableMainDim` denotes minimum available space in which child
      // can be laid out, it will exclude space consumed by padding and border.
      const float minAvailableMainDim =
          style
              .resolvedMinDimension(
                  direction, dimension(mainAxis), mainAxisOwnerSize, ownerWidth)
              .unwrap() -
          leadingPaddingAndBorderMain - trailingPaddingAndBorderMain;
      const float occupiedSpaceByChildNodes =
          availableInnerMainDim - flexLine.layout.remainingFreeSpace;
      flexLine.layout.remainingFreeSpace = yoga::maxOrDefined(
          0.0f, minAvailableMainDim - occupiedSpaceByChildNodes);
    } else {
      flexLine.layout.remainingFreeSpace = 0;
    }
  }

  // In order to position the elements in the main axis, we have two controls.
  // The space between the beginning and the first element and the space between
  // each two elements.
  float leadingMainDim = 0;
  float betweenMainDim = gap;
  const Justify justifyContent = flexLine.layout.remainingFreeSpace >= 0
      ? node->style().justifyContent()
      : fallbackAlignment(node->style().justifyContent());

  if (flexLine.numberOfAutoMargins == 0) {
    switch (justifyContent) {
      case Justify::Start:
      case Justify::End:
      case Justify::Auto:
        // No-Op
        break;
      case Justify::Stretch:
        // No-Op
        break;
      case Justify::Center:
        leadingMainDim = flexLine.layout.remainingFreeSpace / 2;
        break;
      case Justify::FlexEnd:
        leadingMainDim = flexLine.layout.remainingFreeSpace;
        break;
      case Justify::SpaceBetween:
        if (flexLine.itemsInFlow.size() > 1) {
          betweenMainDim += flexLine.layout.remainingFreeSpace /
              static_cast<float>(flexLine.itemsInFlow.size() - 1);
        }
        break;
      case Justify::SpaceEvenly:
        // Space is distributed evenly across all elements
        leadingMainDim = flexLine.layout.remainingFreeSpace /
            static_cast<float>(flexLine.itemsInFlow.size() + 1);
        betweenMainDim += leadingMainDim;
        break;
      case Justify::SpaceAround:
        // Space on the edges is half of the space between elements
        leadingMainDim = 0.5f * flexLine.layout.remainingFreeSpace /
            static_cast<float>(flexLine.itemsInFlow.size());
        betweenMainDim += leadingMainDim * 2;
        break;
      case Justify::FlexStart:
        break;
    }
  }

  flexLine.layout.mainDim = leadingPaddingAndBorderMain + leadingMainDim;
  flexLine.layout.crossDim = 0;

  float maxAscentForCurrentLine = 0;
  float maxDescentForCurrentLine = 0;
  bool isNodeBaselineLayout = isBaselineLayout(node);
  for (auto child : flexLine.itemsInFlow) {
    const LayoutResults& childLayout = child->getLayout();
    if (child->style().flexStartMarginIsAuto(mainAxis, direction) &&
        flexLine.layout.remainingFreeSpace > 0.0f) {
      flexLine.layout.mainDim += flexLine.layout.remainingFreeSpace /
          static_cast<float>(flexLine.numberOfAutoMargins);
    }

    if (performLayout) {
      child->setLayoutPosition(
          childLayout.position(flexStartEdge(mainAxis)) +
              flexLine.layout.mainDim,
          flexStartEdge(mainAxis));
    }

    if (child != flexLine.itemsInFlow.back()) {
      flexLine.layout.mainDim += betweenMainDim;
    }

    if (child->style().flexEndMarginIsAuto(mainAxis, direction) &&
        flexLine.layout.remainingFreeSpace > 0.0f) {
      flexLine.layout.mainDim += flexLine.layout.remainingFreeSpace /
          static_cast<float>(flexLine.numberOfAutoMargins);
    }
    bool canSkipFlex =
        !performLayout && sizingModeCrossDim == SizingMode::StretchFit;
    if (canSkipFlex) {
      // If we skipped the flex step, then we can't rely on the measuredDims
      // because they weren't computed. This means we can't call
      // dimensionWithMargin.
      flexLine.layout.mainDim +=
          child->style().computeMarginForAxis(mainAxis, availableInnerWidth) +
          boundAxisWithinMinAndMax(
              child,
              direction,
              mainAxis,
              childLayout.computedFlexBasis,
              mainAxisOwnerSize,
              ownerWidth)
              .unwrap();
      flexLine.layout.crossDim = availableInnerCrossDim;
    } else {
      // The main dimension is the sum of all the elements dimension plus
      // the spacing.
      flexLine.layout.mainDim +=
          child->dimensionWithMargin(mainAxis, availableInnerWidth);

      if (isNodeBaselineLayout) {
        // If the child is baseline aligned then the cross dimension is
        // calculated by adding maxAscent and maxDescent from the baseline.
        const float ascent = calculateBaseline(child) +
            child->style().computeFlexStartMargin(
                FlexDirection::Column, direction, availableInnerWidth);
        const float descent =
            child->getLayout().measuredDimension(Dimension::Height) +
            child->style().computeMarginForAxis(
                FlexDirection::Column, availableInnerWidth) -
            ascent;

        maxAscentForCurrentLine =
            yoga::maxOrDefined(maxAscentForCurrentLine, ascent);
        maxDescentForCurrentLine =
            yoga::maxOrDefined(maxDescentForCurrentLine, descent);
      } else {
        // The cross dimension is the max of the elements dimension since
        // there can only be one element in that cross dimension in the case
        // when the items are not baseline aligned
        flexLine.layout.crossDim = yoga::maxOrDefined(
            flexLine.layout.crossDim,
            child->dimensionWithMargin(crossAxis, availableInnerWidth));
      }
    }
  }
  flexLine.layout.mainDim += trailingPaddingAndBorderMain;

  if (isNodeBaselineLayout) {
    flexLine.layout.crossDim =
        maxAscentForCurrentLine + maxDescentForCurrentLine;
  }
}

//
// This is the main routine that implements a subset of the flexbox layout
// algorithm described in the W3C CSS documentation:
// https://www.w3.org/TR/CSS3-flexbox/.
//
// Limitations of this algorithm, compared to the full standard:
//  * Display property is always assumed to be 'flex' except for Text nodes,
//    which are assumed to be 'inline-flex'.
//  * The 'zIndex' property (or any form of z ordering) is not supported. Nodes
//    are stacked in document order.
//  * The 'order' property is not supported. The order of flex items is always
//    defined by document order.
//  * The 'visibility' property is always assumed to be 'visible'. Values of
//    'collapse' and 'hidden' are not supported.
//  * There is no support for forced breaks.
//  * It does not support vertical inline directions (top-to-bottom or
//    bottom-to-top text).
//
// Deviations from standard:
//  * Section 4.5 of the spec indicates that all flex items have a default
//    minimum main size. For text blocks, for example, this is the width of the
//    widest word. Calculating the minimum width is expensive, so we forego it
//    and assume a default minimum main size of 0.
//  * Min/Max sizes in the main axis are not honored when resolving flexible
//    lengths.
//  * The spec indicates that the default value for 'flexDirection' is 'row',
//    but the algorithm below assumes a default of 'column'.
//
// Input parameters:
//    - node: current node to be sized and laid out
//    - availableWidth & availableHeight: available size to be used for sizing
//      the node or YGUndefined if the size is not available; interpretation
//      depends on layout flags
//    - ownerDirection: the inline (text) direction within the owner
//      (left-to-right or right-to-left)
//    - widthSizingMode: indicates the sizing rules for the width (see below
//      for explanation)
//    - heightSizingMode: indicates the sizing rules for the height (see below
//      for explanation)
//    - performLayout: specifies whether the caller is interested in just the
//      dimensions of the node or it requires the entire node and its subtree to
//      be laid out (with final positions)
//
// Details:
//    This routine is called recursively to lay out subtrees of flexbox
//    elements. It uses the information in node.style, which is treated as a
//    read-only input. It is responsible for setting the layout.direction and
//    layout.measuredDimensions fields for the input node as well as the
//    layout.position and layout.lineIndex fields for its child nodes. The
//    layout.measuredDimensions field includes any border or padding for the
//    node but does not include margins.
//
//    When calling calculateLayoutImpl and calculateLayoutInternal, if the
//    caller passes an available size of undefined then it must also pass a
//    measure mode of SizingMode::MaxContent in that dimension.
//

// Accumulator for a set of adjoining vertical margins (CSS2 §8.3.1): the
// realized margin is max(positives) + min(negatives).
struct CollapsedMargin {
  float positive{0.0f};
  float negative{0.0f};
  void fold(float margin) {
    if (margin >= 0.0f) {
      positive = yoga::maxOrDefined(positive, margin);
    } else {
      negative = yoga::minOrDefined(negative, margin);
    }
  }
  float realized() const {
    return positive + negative;
  }
};

static bool blockChildIsInFlow(const yoga::Node* child) {
  return child->style().display() != Display::None &&
      child->style().positionType() != PositionType::Absolute;
}

// Whether descendant margins collapse through `box`'s top (leading) or bottom
// (trailing) edge into the surrounding block formatting context (CSS2 §8.3.1
// "adjoining margins"): the box must be a block container participating in
// the same BFC (Display::Block; an IFC leaf with a measure function never
// collapses through) with no separating padding or border on that edge; for
// the bottom edge its height must additionally be auto.
static bool marginsCollapseThroughEdge(yoga::Node* box, bool leadingEdge) {
  if (box->style().display() != Display::Block || box->hasMeasureFunc()) {
    return false;
  }
  // A box establishing its own formatting context — which `overflow` other
  // than visible does — keeps its children's margins inside it.
  if (box->style().overflow() != Overflow::Visible) {
    return false;
  }
  // Owner width only resolves percentage padding/border; the box's measured
  // width is its containing block's stretch in the common case.
  const float ownerWidthApprox =
      box->getLayout().measuredDimension(Dimension::Width);
  const float edgePaddingAndBorder = leadingEdge
      ? box->style().computeFlexStartPaddingAndBorder(
            FlexDirection::Column, Direction::LTR, ownerWidthApprox)
      : box->style().computeFlexEndPaddingAndBorder(
            FlexDirection::Column, Direction::LTR, ownerWidthApprox);
  if (edgePaddingAndBorder != 0.0f) {
    return false;
  }
  if (!leadingEdge && !box->style().dimension(Dimension::Height).isAuto()) {
    return false;
  }
  return true;
}

// Folds into `accumulator` the descendant margins escaping (collapsing)
// through `box`'s leading or trailing edge, walking the laid-out subtree
// (heights are needed to detect self-collapsing boxes, so this runs after
// `box` is laid out). Self-collapsing (zero-height) boxes chain the collapse
// at their level; the walk then descends into the first (last) realized box.
// `DOM-CSS-LIMITATION(escaped-margin-walk-approximations)`: two approximations
// in this walk. Descendants of self-collapsing boxes are not walked, so a
// margin escaping from inside one does not reach the owner's flow; and a
// percentage margin resolves against the measured width of the box being
// walked rather than the margin's own containing block, which differ once the
// walk has descended. Both need nesting deep enough that neither has been seen
// in the corpus.
static void foldEscapedMargins(
    yoga::Node* box,
    bool leadingEdge,
    CollapsedMargin& accumulator) {
  auto* cur = box;
  while (marginsCollapseThroughEdge(cur, leadingEdge)) {
    const float marginOwnerWidth =
        cur->getLayout().measuredDimension(Dimension::Width);
    std::vector<yoga::Node*> inFlowChildren;
    for (auto* candidate : cur->getLayoutChildren()) {
      if (blockChildIsInFlow(candidate)) {
        inFlowChildren.push_back(candidate);
      }
    }
    if (!leadingEdge) {
      std::reverse(inFlowChildren.begin(), inFlowChildren.end());
    }
    yoga::Node* descend = nullptr;
    for (auto* candidate : inFlowChildren) {
      const float edgeMargin = leadingEdge
          ? candidate->style().computeFlexStartMargin(
                FlexDirection::Column, Direction::LTR, marginOwnerWidth)
          : candidate->style().computeFlexEndMargin(
                FlexDirection::Column, Direction::LTR, marginOwnerWidth);
      accumulator.fold(edgeMargin);
      if (candidate->getLayout().measuredDimension(Dimension::Height) == 0.0f) {
        // Self-collapsing: both of its margins adjoin; the chain continues
        // with the next sibling at this level.
        const float otherMargin = leadingEdge
            ? candidate->style().computeFlexEndMargin(
                  FlexDirection::Column, Direction::LTR, marginOwnerWidth)
            : candidate->style().computeFlexStartMargin(
                  FlexDirection::Column, Direction::LTR, marginOwnerWidth);
        accumulator.fold(otherMargin);
        continue;
      }
      descend = candidate;
      break;
    }
    if (descend == nullptr) {
      break;
    }
    cur = descend;
  }
}

// A placed float: the band it occupies in the block direction and how far it
// intrudes from its side (CSS2 §9.5). Coordinates are in the container's
// content box.
/*
 * `float: inline-start` and `inline-end` in terms of the physical sides the
 * band bookkeeping works in. Left-to-right maps start to left; right-to-left
 * maps it to right, which is the whole point of the logical spelling.
 */
static FloatSide resolveFloatSide(FloatSide side, Direction direction) {
  const bool rtl = direction == Direction::RTL;
  switch (side) {
    case FloatSide::InlineStart:
      return rtl ? FloatSide::Right : FloatSide::Left;
    case FloatSide::InlineEnd:
      return rtl ? FloatSide::Left : FloatSide::Right;
    default:
      return side;
  }
}

/* The same mapping for `clear`. */
static Clear resolveClear(Clear clear, Direction direction) {
  const bool rtl = direction == Direction::RTL;
  switch (clear) {
    case Clear::InlineStart:
      return rtl ? Clear::Right : Clear::Left;
    case Clear::InlineEnd:
      return rtl ? Clear::Left : Clear::Right;
    default:
      return clear;
  }
}

/*
 * A child that shares this block's formatting context, and so takes part in
 * its float bookkeeping. The mirror of `participatesInOwnerBfc` as seen from
 * the owner, which the child computes for itself.
 */
static bool childIsInFlowBlock(const yoga::Node& child) {
  if (child.style().positionType() == PositionType::Absolute ||
      child.style().floatSide() != FloatSide::None) {
    return false;
  }
  // A measured leaf is an inline run, and its LINES are what shorten beside a
  // float (CSS2 §9.5) — the whole reason floats exist. It takes part in the
  // context even though it is not a block box.
  if (child.hasMeasureFunc()) {
    return true;
  }
  return child.style().display() == Display::Block &&
      child.style().overflow() == Overflow::Visible;
}

/*
 * The owner's floats in a child's coordinates: the same bands shifted up by
 * how far down the child starts. A float entirely above the child still has to
 * be carried, with a negative extent — dropping it would let the child's own
 * floats pack into space that is already taken.
 */
static std::vector<PlacedFloat> translateFloatsForChild(
    const std::vector<PlacedFloat>& floats,
    float childTop) {
  std::vector<PlacedFloat> translated;
  translated.reserve(floats.size());
  for (const auto& placed : floats) {
    if (placed.blockEnd <= childTop) {
      continue; // ends above the child: it can no longer intrude
    }
    translated.push_back(PlacedFloat{
        .blockStart = placed.blockStart - childTop,
        .blockEnd = placed.blockEnd - childTop,
        .inlineExtent = placed.inlineExtent,
        .side = placed.side});
  }
  return translated;
}

/*
 * Take over the floats a child could not contain, in this node's coordinates.
 *
 * They keep intruding past the child's own box — that is what makes them this
 * context's floats — so they join the list every later line and float is
 * placed against, and the lowest edge this container grows to hold.
 */
static void adoptEscapedFloats(
    const yoga::Node& child,
    float childBorderEdge,
    std::vector<PlacedFloat>& placedFloats,
    float& lowestFloatEdge) {
  for (const auto& escaped : child.getLayout().escapedFloats()) {
    const float blockEnd = escaped.blockEnd + childBorderEdge;
    placedFloats.push_back(PlacedFloat{
        .blockStart = escaped.blockStart + childBorderEdge,
        .blockEnd = blockEnd,
        .inlineExtent = escaped.inlineExtent,
        .side = escaped.side});
    lowestFloatEdge = yoga::maxOrDefined(lowestFloatEdge, blockEnd);
  }
}

// How far the left/right floats intrude at a given block-direction band.
static float floatIntrusion(
    const std::vector<PlacedFloat>& floats,
    FloatSide side,
    float bandStart,
    float bandEnd) {
  float intrusion = 0.0f;
  for (const auto& placed : floats) {
    if (placed.side != side) {
      continue;
    }
    // Bands touching only at an edge do not overlap.
    if (placed.blockEnd <= bandStart || placed.blockStart >= bandEnd) {
      continue;
    }
    intrusion = yoga::maxOrDefined(intrusion, placed.inlineExtent);
  }
  return intrusion;
}

// Where a float fits, and what already intrudes there.
struct FloatBand {
  float blockStart{0.0f};
  float leftIntrusion{0.0f};
  float rightIntrusion{0.0f};
};

// Finds the first band at or below `blockStart` with room for a float of this
// size (CSS2 §9.5.1 rules 3, 5 and 6): a float is placed as high as it fits,
// and drops below whatever is in its way when it does not.
//
// A float that is wider than the whole container never fits anywhere, so the
// search also stops as soon as nothing intrudes — at that point dropping
// further would only overflow lower down.
static FloatBand findFloatBand(
    const std::vector<PlacedFloat>& floats,
    float blockStart,
    float outerWidth,
    float outerHeight,
    float availableInnerWidth) {
  float top = blockStart;
  while (true) {
    const float bottom = top + outerHeight;
    const FloatBand band{
        .blockStart = top,
        .leftIntrusion =
            floatIntrusion(floats, FloatSide::Left, top, bottom),
        .rightIntrusion =
            floatIntrusion(floats, FloatSide::Right, top, bottom)};
    const float availableHere =
        availableInnerWidth - band.leftIntrusion - band.rightIntrusion;
    if (outerWidth <= availableHere ||
        (band.leftIntrusion == 0.0f && band.rightIntrusion == 0.0f)) {
      return band;
    }
    // Drop to the nearest float bottom still ahead of us. One always exists:
    // reaching here means a float intrudes on a band beginning at `top`, and
    // such a float ends below `top`. Should that ever fail to hold, the float
    // stays in the band it is in rather than the loop running forever — a
    // float that fits nowhere still belongs as high as it can go.
    float nextEdge = std::numeric_limits<float>::max();
    for (const auto& placed : floats) {
      if (placed.blockEnd > top) {
        nextEdge = std::min(nextEdge, placed.blockEnd);
      }
    }
    if (nextEdge == std::numeric_limits<float>::max()) {
      return band;
    }
    top = nextEdge;
  }
}

// The lowest edge of the floats a `clear` value must clear.
static float clearanceEdge(
    const std::vector<PlacedFloat>& floats,
    Clear clear) {
  if (clear == Clear::None) {
    return 0.0f;
  }
  float edge = 0.0f;
  for (const auto& placed : floats) {
    const bool matches = clear == Clear::Both ||
        (clear == Clear::Left && placed.side == FloatSide::Left) ||
        (clear == Clear::Right && placed.side == FloatSide::Right);
    if (matches) {
      edge = yoga::maxOrDefined(edge, placed.blockEnd);
    }
  }
  return edge;
}

// Lays out a node whose display is `Display::Block` as a CSS block formatting
// context (text-children-plan.md §3.A/§4.5): in-flow children stack in the
// block (vertical) direction, each sized to the container's content width (not
// distributed as flex items — a `flex:1` block child does not grow), and the
// container's block size is the sum of the children's margin boxes plus
// padding/border. Vertical margins collapse per CSS2 §8.3.1 (adjacent
// siblings, self-collapsing boxes, and escape through nested block edges —
// Stage 3); floats and clearance are later stages.
//
// Reached only for `Display::Block`, which nothing produces unless
// `enableYogaDisplayBlock` maps RN `display:'block'` onto it — so the flex
// algorithm is entirely untouched (and the flex emulation remains the flag-off
// fallback). Margins/borders/padding on `node` are already resolved by the
// caller; `marginAxisRow`/`marginAxisColumn` are `node`'s own axis margins.
static void calculateBlockLayout(
    yoga::Node* const node,
    const float availableWidth,
    const float availableHeight,
    const Direction direction,
    const SizingMode widthSizingMode,
    const SizingMode heightSizingMode,
    const float ownerWidth,
    const float ownerHeight,
    const float marginAxisRow,
    const float marginAxisColumn,
    const bool performLayout,
    LayoutData& layoutMarkerData,
    const uint32_t depth,
    const uint32_t generationCount) {
  const float paddingAndBorderAxisRow =
      paddingAndBorderForAxis(node, FlexDirection::Row, direction, ownerWidth);
  const float paddingAndBorderAxisColumn = paddingAndBorderForAxis(
      node, FlexDirection::Column, direction, ownerWidth);
  const float leadingPaddingAndBorderColumn =
      node->style().computeFlexStartPaddingAndBorder(
          FlexDirection::Column, direction, ownerWidth);
  const float leadingPaddingAndBorderRow =
      node->style().computeFlexStartPaddingAndBorder(
          FlexDirection::Row, direction, ownerWidth);

  const float availableInnerWidth = calculateAvailableInnerDimension(
      node,
      direction,
      Dimension::Width,
      availableWidth - marginAxisRow,
      paddingAndBorderAxisRow,
      ownerWidth,
      ownerWidth);
  const float availableInnerHeight = calculateAvailableInnerDimension(
      node,
      direction,
      Dimension::Height,
      availableHeight - marginAxisColumn,
      paddingAndBorderAxisColumn,
      ownerHeight,
      ownerWidth);

  // Auto-width block children fill the container's content width only when the
  // container's own width is definite (StretchFit). During a content-measuring
  // pass (MaxContent/FitContent width) they are measured at their content width
  // instead, so the container can shrink-wrap to its widest child.
  const bool stretchChildrenToWidth =
      widthSizingMode == SizingMode::StretchFit &&
      yoga::isDefined(availableInnerWidth);
  const PhysicalEdge inlineStartEdge =
      direction == Direction::RTL ? PhysicalEdge::Right : PhysicalEdge::Left;

  // Block-axis cursor and margin-collapsing accumulator (CSS2 §8.3.1, Stage
  // 3): `accumulatedBlockDim` tracks the border edge of the last in-flow
  // child; between border edges, adjoining vertical margins are folded into a
  // pending set reduced to max(positives) + min(negatives). A self-collapsing
  // child (zero border-box height) folds both of its margins into the pending
  // set without realizing a border edge, so margins collapse through it.
  //
  // Edge containment vs escape (Stage 3b, Safari-verified): a block container
  // that is itself a block-level child of another block container — same BFC —
  // lets the margins adjoining its content edges collapse *through* those
  // edges into the owner's flow (no top/bottom padding or border; bottom
  // additionally needs auto height): the pending set before the first
  // realized border edge (and after the last) realizes to zero here and is
  // re-folded by the owner via `foldEscapedMargins`. Otherwise — flex-item or
  // root block containers, i.e. independent formatting contexts on the web —
  // first/last child margins realize against the container's content edges
  // (contained).
  float accumulatedBlockDim = 0.0f;
  // Floats placed so far, and the lowest float edge.
  //
  // Seeded with the owner's floats when this node shares the owner's context,
  // already translated into this node's coordinates by the owner. They are
  // what this node's own floats have to pack around and what its lines have to
  // avoid — a float does not stop intruding at a box boundary that generates
  // no formatting context of its own.
  std::vector<PlacedFloat> placedFloats = node->getLayout().inheritedFloats();
  const size_t inheritedFloatCount = placedFloats.size();
  float lowestFloatEdge = 0.0f;
  CollapsedMargin pendingMargin;
  const auto* owner = node->getOwner();
  // `overflow` other than visible establishes an INDEPENDENT block formatting
  // context, and a box that establishes one does not collapse margins with its
  // in-flow children (CSS2 §8.3.1) — the same reason a flex item or a root
  // does not.
  const bool participatesInOwnerBfc = owner != nullptr &&
      owner->style().display() == Display::Block &&
      node->style().positionType() != PositionType::Absolute &&
      node->style().overflow() == Overflow::Visible;
  const bool escapeLeadingMargins =
      participatesInOwnerBfc && leadingPaddingAndBorderColumn == 0.0f;
  const bool escapeTrailingMargins = participatesInOwnerBfc &&
      (paddingAndBorderAxisColumn - leadingPaddingAndBorderColumn) == 0.0f &&
      node->style().dimension(Dimension::Height).isAuto();
  bool hasRealizedBorderEdge = false;
  float maxChildInlineDim = 0.0f; // widest child margin box (for shrink-wrap)

  for (auto* child : node->getLayoutChildren()) {
    if (child->style().display() == Display::None) {
      // Mirror the flex algorithm (see computeFlexBasisForChildren): zero the
      // child's layout — but only during layout passes, so measure-only passes
      // do not leak `hasNewLayout` flags into nodes the layout pass may never
      // visit — and clear its dirtiness so the post-layout ownership assertion
      // (`YogaLayoutableShadowNode::layout`) holds.
      if (performLayout) {
        zeroOutLayoutRecursively(child);
        child->setHasNewLayout(true);
        child->setDirty(false);
      }
      continue;
    }
    child->processDimensions();

    if (performLayout) {
      child->setPosition(
          child->resolveDirection(direction),
          availableInnerWidth,
          availableInnerHeight);
    }

    // Absolutely-positioned children do not participate in block flow; they are
    // positioned later by layoutAbsoluteDescendants. Record where the flow had
    // reached first: with no offsets of its own such a child keeps that
    // position (CSS2 §10.6.4), and this is the only place that knows it.
    //
    // The pending margins are folded in because the child's static position is
    // where its margin box would have started, and a following in-flow sibling
    // is unaffected either way — an out-of-flow box neither collapses margins
    // nor advances the flow, so `accumulatedBlockDim` is left alone.
    if (child->style().positionType() == PositionType::Absolute) {
      if (performLayout) {
        child->setLayoutStaticPositionBlockStart(FloatOptional{
            accumulatedBlockDim + pendingMargin.realized()});
      }
      continue;
    }

    // --- CSS floats (CSS2 §9.5) ---
    // A floated child is taken out of the normal flow: it is placed at the
    // current block position (after any clearance), packed against its side
    // after existing floats in the same band, and wrapped to below them when
    // it no longer fits.
    //
    // An in-flow BLOCK box overlapping a float is correct — that is what the
    // web does — and only its LINE boxes shorten beside it. That shortening
    // travels as `inheritedFloats`: the bands reach the run through
    // `LayoutConstraints::floatExclusions` and become exclusion paths on iOS
    // and per-line indents on Android.
    // The logical sides resolve HERE, and only here: `direction` is a layout
    // result that inherits, so the props could not have flattened them.
    const auto childFloat = resolveFloatSide(child->style().floatSide(), direction);
    const auto childClear = resolveClear(child->style().clear(), direction);
    if (childFloat != FloatSide::None) {
      const float floatMarginRow = child->style().computeMarginForAxis(
          FlexDirection::Row, availableInnerWidth);
      const float floatMarginColumn = child->style().computeMarginForAxis(
          FlexDirection::Column, availableInnerWidth);

      float floatWidth = YGUndefined;
      SizingMode floatWidthMode = SizingMode::MaxContent;
      if (child->hasDefiniteLength(Dimension::Width, availableInnerWidth)) {
        floatWidth = child
                         ->getResolvedDimension(
                             direction,
                             Dimension::Width,
                             availableInnerWidth,
                             availableInnerWidth)
                         .unwrap() +
            floatMarginRow;
        floatWidthMode = SizingMode::StretchFit;
      } else if (yoga::isDefined(availableInnerWidth)) {
        // CSS2 §10.3.5: a float with `width: auto` is SHRINK-TO-FIT —
        // min(max(min-content, available), max-content) — which is what
        // `FitContent` against the available width computes. At max-content a
        // float whose contents are wider than the container did not wrap; it
        // laid them on one line and overflowed.
        floatWidth = availableInnerWidth;
        floatWidthMode = SizingMode::FitContent;
      }
      float floatHeight = YGUndefined;
      SizingMode floatHeightMode = SizingMode::MaxContent;
      if (child->hasDefiniteLength(Dimension::Height, availableInnerHeight)) {
        floatHeight = child
                          ->getResolvedDimension(
                              direction,
                              Dimension::Height,
                              availableInnerHeight,
                              availableInnerWidth)
                          .unwrap() +
            floatMarginColumn;
        floatHeightMode = SizingMode::StretchFit;
      }

      calculateLayoutInternal(
          child,
          floatWidth,
          floatHeight,
          node->getLayout().direction(),
          floatWidthMode,
          floatHeightMode,
          availableInnerWidth,
          availableInnerHeight,
          performLayout,
          performLayout ? LayoutPassReason::kFlexLayout
                        : LayoutPassReason::kFlexMeasure,
          layoutMarkerData,
          depth,
          generationCount);

      const float floatOuterWidth =
          child->getLayout().measuredDimension(Dimension::Width) +
          floatMarginRow;
      const float floatOuterHeight =
          child->getLayout().measuredDimension(Dimension::Height) +
          floatMarginColumn;

      // Start at the current flow position, pushed down by any clearance, and
      // pack against the side wherever there is first room for it.
      const FloatBand band = findFloatBand(
          placedFloats,
          yoga::maxOrDefined(
              accumulatedBlockDim + pendingMargin.realized(),
              clearanceEdge(placedFloats, childClear)),
          floatOuterWidth,
          floatOuterHeight,
          availableInnerWidth);
      const float floatTop = band.blockStart;
      const float floatBottom = floatTop + floatOuterHeight;
      const float ownIntrusion = (childFloat == FloatSide::Left
                                      ? band.leftIntrusion
                                      : band.rightIntrusion) +
          floatOuterWidth;
      if (performLayout) {
        // The band places the float's MARGIN box; its own leading margins then
        // separate that from the border box, which is what a rect reports.
        // Without them a float's margins moved it nowhere at all — the outer
        // sizes already counted them toward the space taken, so only the
        // position was wrong. A float's margins never collapse (CSS2 §8.3.1),
        // so these are simply added rather than folded into the pending set.
        const float floatLeadingMarginRow = child->style().computeFlexStartMargin(
            FlexDirection::Row, direction, availableInnerWidth);
        const float floatLeadingMarginColumn =
            child->style().computeFlexStartMargin(
                FlexDirection::Column, direction, availableInnerWidth);
        const float inlineOffset = (childFloat == FloatSide::Left
                                        ? band.leftIntrusion
                                        : availableInnerWidth -
                                            band.rightIntrusion -
                                            floatOuterWidth) +
            floatLeadingMarginRow;
        child->setLayoutPosition(
            leadingPaddingAndBorderColumn + floatTop + floatLeadingMarginColumn,
            PhysicalEdge::Top);
        // PhysicalEdge::Left, not `inlineStartEdge`. Yoga takes a frame from
        // its LEFT edge and derives the trailing one, so under RTL — where
        // inline-start IS the right edge — writing there moves nothing and
        // every float landed at the container's left.
        //
        // The padding and margin added to it are flex-start values, and that
        // is already the left one: flex-start of `Row` is Left whichever
        // direction resolves, which `direction` only changes for the
        // start/end style lookups.
        child->setLayoutPosition(
            leadingPaddingAndBorderRow + inlineOffset, PhysicalEdge::Left);
      }
      placedFloats.push_back(PlacedFloat{
          .blockStart = floatTop,
          .blockEnd = floatBottom,
          .inlineExtent = ownIntrusion,
          .side = childFloat});
      lowestFloatEdge = yoga::maxOrDefined(lowestFloatEdge, floatBottom);
      maxChildInlineDim =
          yoga::maxOrDefined(maxChildInlineDim, floatOuterWidth);
      continue;
    }

    // An in-flow box with `clear` must end up below the floats it clears. How
    // far it moves cannot be decided yet — clearance is measured against where
    // the box would have been WITH its margins, which are folded further down
    // — so only the edge it has to clear is computed here.
    const float childClearanceEdge = childClear != Clear::None
        ? clearanceEdge(placedFloats, childClear)
        : 0.0f;

    // A percentage margin resolves against the CONTAINING BLOCK's width — this
    // container's content width — in both axes (CSS2 §8.3), which is what the
    // flex path passes here too. `ownerWidth` is this container's own owner,
    // one level too high: with a width-less block box anywhere above, a
    // percentage margin resolved against the surface width instead.
    const float childMarginRow = child->style().computeMarginForAxis(
        FlexDirection::Row, availableInnerWidth);
    const float childMarginColumn = child->style().computeMarginForAxis(
        FlexDirection::Column, availableInnerWidth);
    const float childLeadingMarginColumn = child->style().computeFlexStartMargin(
        FlexDirection::Column, direction, availableInnerWidth);

    // The available* values passed to calculateLayoutInternal are margin-box
    // sizes (the callee subtracts the child's own margins). A definite style
    // dimension is passed verbatim (StretchFit); an auto dimension is either
    // stretched to the container (width) or content-driven (height).
    const bool childWidthDefinite =
        child->hasDefiniteLength(Dimension::Width, availableInnerWidth);
    const bool childHeightDefinite =
        child->hasDefiniteLength(Dimension::Height, availableInnerHeight);

    // Inline (cross) axis: a block child fills the container's content width
    // unless it has a definite width; when the container width is indefinite
    // (a measurement pass) it is content-driven so the container can shrink-wrap.
    float childWidth = YGUndefined;
    SizingMode childWidthSizingMode = SizingMode::MaxContent;
    if (childWidthDefinite) {
      childWidth = child
                       ->getResolvedDimension(
                           direction,
                           Dimension::Width,
                           availableInnerWidth,
                           availableInnerWidth)
                       .unwrap() +
          childMarginRow;
      childWidthSizingMode = SizingMode::StretchFit;
    } else if (stretchChildrenToWidth) {
      childWidth = availableInnerWidth;
      childWidthSizingMode = SizingMode::StretchFit;
    }

    // Block (main) axis: content-driven unless the child has a definite height.
    float childHeight = YGUndefined;
    SizingMode childHeightSizingMode = SizingMode::MaxContent;
    if (childHeightDefinite) {
      childHeight = child
                        ->getResolvedDimension(
                            direction,
                            Dimension::Height,
                            availableInnerHeight,
                            availableInnerWidth)
                        .unwrap() +
          childMarginColumn;
      childHeightSizingMode = SizingMode::StretchFit;
    }

    // css-sizing-4 §4: with one axis resolved, `aspect-ratio` determines the
    // other. The flex path does this against the cross axis; in a block
    // container the axes are named rather than relative, so both directions
    // are spelled out. Without it a ratio was simply ignored here, and a box
    // with a width and a ratio and no content measured zero tall.
    const auto& childAspectRatio = child->style().aspectRatio();
    if (childAspectRatio.isDefined()) {
      if (childWidthSizingMode == SizingMode::StretchFit &&
          childHeightSizingMode != SizingMode::StretchFit) {
        childHeight = childMarginColumn +
            (childWidth - childMarginRow) / childAspectRatio.unwrap();
        childHeightSizingMode = SizingMode::StretchFit;
      } else if (
          childHeightSizingMode == SizingMode::StretchFit &&
          childWidthSizingMode != SizingMode::StretchFit) {
        childWidth = childMarginRow +
            (childHeight - childMarginColumn) * childAspectRatio.unwrap();
        childWidthSizingMode = SizingMode::StretchFit;
      }
    }

    constrainMaxSizeForMode(
        child,
        direction,
        FlexDirection::Row,
        availableInnerWidth,
        ownerWidth,
        &childWidthSizingMode,
        &childWidth);
    constrainMaxSizeForMode(
        child,
        direction,
        FlexDirection::Column,
        availableInnerHeight,
        ownerWidth,
        &childHeightSizingMode,
        &childHeight);

    // Hand this context's floats down to a child that shares it, translated
    // into the child's coordinates. Where the child's border edge will land is
    // not final until its own margins are folded below, but the difference is
    // only the descendant margins that escape through its top — so the
    // prospective position is taken from what IS known, the flow so far plus
    // the child's own leading margin.
    // Only when there is something to hand down AND the child would take part
    // in this context. Writing to every child's layout results otherwise
    // touches nodes this pass has no business writing to, and allocates on
    // every block child of every block container in a tree that has no floats
    // at all.
    if (!placedFloats.empty() && childIsInFlowBlock(*child)) {
      auto prospective = pendingMargin;
      prospective.fold(childLeadingMarginColumn);
      child->setLayoutInheritedFloats(translateFloatsForChild(
          placedFloats, accumulatedBlockDim + prospective.realized()));
    }

    calculateLayoutInternal(
        child,
        childWidth,
        childHeight,
        node->getLayout().direction(),
        childWidthSizingMode,
        childHeightSizingMode,
        availableInnerWidth,
        availableInnerHeight,
        performLayout,
        performLayout ? LayoutPassReason::kFlexLayout
                      : LayoutPassReason::kFlexMeasure,
        layoutMarkerData,
        depth,
        generationCount);

    const float childMeasuredHeight =
        child->getLayout().measuredDimension(Dimension::Height);
    const float childMeasuredWidth =
        child->getLayout().measuredDimension(Dimension::Width);

    // Collapse the child's top margin — and any descendant margins escaping
    // through its top edge (Stage 3b) — with the pending adjoining margins,
    // then realize the resulting gap as the child's border-edge position.
    // Margins pending before the first realized border edge escape through
    // this container's own top edge when it participates in the owner's BFC.
    const float childTrailingMarginColumn =
        childMarginColumn - childLeadingMarginColumn;
    pendingMargin.fold(childLeadingMarginColumn);
    foldEscapedMargins(child, /*leadingEdge*/ true, pendingMargin);
    const float uncleared = accumulatedBlockDim +
        ((escapeLeadingMargins && !hasRealizedBorderEdge)
             ? 0.0f
             : pendingMargin.realized());
    // CSS2 §9.5.2: clearance is the SHORTFALL between where the box would have
    // been — margins folded and all — and the bottom edge of the floats it
    // clears, not a floor the margin is then added to. A box with a 25pt top
    // margin clearing a float that ends at 40 has its border edge at 40, not
    // at 65: the margin is absorbed by the clearance rather than added to it.
    const float childBorderEdge = childClear != Clear::None
        ? yoga::maxOrDefined(uncleared, childClearanceEdge)
        : uncleared;

    if (performLayout) {
      // `setPosition` above already stored `leading margin + relative offset`
      // into the layout position; the collapsed `childBorderEdge` replaces
      // the child's own top margin, so subtract it back out (and do not add
      // the row leading margin again on the inline axis).
      child->setLayoutPosition(
          child->getLayout().position(PhysicalEdge::Top) -
              childLeadingMarginColumn + leadingPaddingAndBorderColumn +
              childBorderEdge,
          PhysicalEdge::Top);
      // CSS2 §10.3.3: a block-level box with a definite width and an auto
      // inline margin takes the leftover space — split between them when both
      // are auto, which is what centres `margin: 0 auto`. With an auto width
      // the box already fills the container and there is nothing left to
      // share, so the leftover test covers that case on its own.
      float autoMarginOffset = 0.0f;
      if (yoga::isDefined(availableInnerWidth)) {
        const bool startIsAuto =
            child->style().flexStartMarginIsAuto(FlexDirection::Row, direction);
        const bool endIsAuto =
            child->style().flexEndMarginIsAuto(FlexDirection::Row, direction);
        if (startIsAuto || endIsAuto) {
          const float leftover =
              availableInnerWidth - (childMeasuredWidth + childMarginRow);
          if (leftover > 0.0f) {
            autoMarginOffset = (startIsAuto && endIsAuto) ? leftover / 2.0f
                : startIsAuto                             ? leftover
                                                          : 0.0f;
          }
        }
      }
      const float inlineStartOffset =
          child->getLayout().position(inlineStartEdge) +
          leadingPaddingAndBorderRow + autoMarginOffset;
      if (direction == Direction::RTL && yoga::isDefined(availableInnerWidth)) {
        // Yoga takes a box's frame from its LEFT edge and derives the trailing
        // edge from it, not the other way round — so writing the inline-start
        // offset to `Right` moved nothing and an RTL block child stayed at the
        // container's left. The offset is measured inward from the container's
        // right border edge, so convert it to the left coordinate here.
        child->setLayoutPosition(
            paddingAndBorderAxisRow + availableInnerWidth - inlineStartOffset -
                childMeasuredWidth,
            PhysicalEdge::Left);
      } else {
        child->setLayoutPosition(inlineStartOffset, inlineStartEdge);
      }
    }

    // Adopt the floats the child could not contain, in this node's
    // coordinates. Before the height branch below, because a block holding
    // nothing but floats measures ZERO once it stops containing them — it is
    // self-collapsing precisely BECAUSE its floats escaped, and taking the
    // collapse path must not drop them on the way.
    if (!child->getLayout().escapedFloats().empty()) {
      adoptEscapedFloats(*child, childBorderEdge, placedFloats, lowestFloatEdge);
    }

    if (childMeasuredHeight == 0.0f) {
      // Self-collapsing box (zero border-box height, CSS2 §8.3.1): its top
      // and bottom margins collapse with each other and with the neighbors'
      // — fold the bottom margin into the still-pending set without
      // advancing the cursor past a border edge. (Its escaped descendant
      // margins were folded with the leading walk above.)
      pendingMargin.fold(childTrailingMarginColumn);
    } else {
      accumulatedBlockDim = childBorderEdge + childMeasuredHeight;
      hasRealizedBorderEdge = true;
      pendingMargin = {};
      pendingMargin.fold(childTrailingMarginColumn);
      foldEscapedMargins(child, /*leadingEdge*/ false, pendingMargin);
    }
    maxChildInlineDim =
        yoga::maxOrDefined(maxChildInlineDim, childMeasuredWidth + childMarginRow);
  }

  // Container inline size: fill the available width when definite (a block box
  // fills its containing block), otherwise shrink-wrap to the widest child.
  float measuredWidth;
  if (widthSizingMode == SizingMode::StretchFit &&
      yoga::isDefined(availableWidth)) {
    measuredWidth = availableWidth - marginAxisRow;
  } else {
    measuredWidth = maxChildInlineDim + paddingAndBorderAxisRow;
  }
  node->setLayoutMeasuredDimension(
      boundAxis(
          node, FlexDirection::Row, direction, measuredWidth, ownerWidth, ownerWidth),
      Dimension::Width);

  // Container block size: fill the available height when definite, otherwise
  // the content height — the last border edge plus the still-pending
  // (collapsed) trailing margins — plus padding/border. Trailing pending
  // margins that escape through this container's bottom edge (or through its
  // top, when no border edge was ever realized) belong to the owner's flow
  // and are excluded from the content height.
  float measuredHeight;
  if (heightSizingMode == SizingMode::StretchFit &&
      yoga::isDefined(availableHeight)) {
    measuredHeight = availableHeight - marginAxisColumn;
  } else {
    const bool trailingMarginsEscape = escapeTrailingMargins ||
        (escapeLeadingMargins && !hasRealizedBorderEdge);
    measuredHeight = accumulatedBlockDim +
        (trailingMarginsEscape ? 0.0f : pendingMargin.realized()) +
        paddingAndBorderAxisColumn;
    // Only an INDEPENDENT formatting context grows to contain its floats
    // (CSS2 §10.6.7). A block sharing its owner's context lets them overflow
    // and reports the height it would have had without them — which is why
    // `overflow: hidden` is the classic way to make a container hold its
    // floats up. Those floats are the OWNER's to contain, and it adopts them
    // from `escapedFloats` below.
    if (!participatesInOwnerBfc) {
      measuredHeight = yoga::maxOrDefined(
          measuredHeight, lowestFloatEdge + paddingAndBorderAxisColumn);
    }
  }
  // Hand the floats up. A node sharing its owner's context does not own the
  // ones written inside it, so the owner adopts them and they go on intruding
  // past this box; the inherited ones are already the owner's and are dropped
  // here so they are not adopted twice.
  if (participatesInOwnerBfc && placedFloats.size() > inheritedFloatCount) {
    node->setLayoutEscapedFloats(std::vector<PlacedFloat>(
        placedFloats.begin() +
            static_cast<std::ptrdiff_t>(inheritedFloatCount),
        placedFloats.end()));
  } else if (!node->getLayout().escapedFloats().empty()) {
    node->setLayoutEscapedFloats({});
  }

  node->setLayoutMeasuredDimension(
      boundAxis(
          node,
          FlexDirection::Column,
          direction,
          measuredHeight,
          ownerHeight,
          ownerWidth),
      Dimension::Height);

  // `align-content` on a block container (css-align-3 §5.3). A block
  // container's contents are a SINGLE alignment subject, so the distribution
  // values collapse onto the positional ones: `space-between` behaves as
  // `start`, `space-around` and `space-evenly` as `center`. This is what
  // centres a `<button>`'s content — the reason a radio's dot and a
  // checkbox's tick sit in the middle of their box on the web without the
  // markup saying anything about alignment.
  if (performLayout) {
    const float innerHeight =
        node->getLayout().measuredDimension(Dimension::Height) -
        paddingAndBorderAxisColumn;
    const bool trailingMarginsEscape = escapeTrailingMargins ||
        (escapeLeadingMargins && !hasRealizedBorderEdge);
    // The same rule: floats only count toward the content a block aligns when
    // that block is the one containing them.
    const float flowHeight = accumulatedBlockDim +
        (trailingMarginsEscape ? 0.0f : pendingMargin.realized());
    const float contentHeight = participatesInOwnerBfc
        ? flowHeight
        : yoga::maxOrDefined(flowHeight, lowestFloatEdge);
    const float freeSpace = innerHeight - contentHeight;
    // Only ever pushes content DOWN. Overflowing content stays anchored at the
    // block-start edge rather than spilling out of the top, where it could not
    // be scrolled back into view.
    if (yoga::isDefined(freeSpace) && freeSpace > 0.0f) {
      float offset = 0.0f;
      switch (node->style().alignContent()) {
        case Align::Center:
        case Align::SpaceAround:
        case Align::SpaceEvenly:
          offset = freeSpace / 2.0f;
          break;
        case Align::FlexEnd:
          offset = freeSpace;
          break;
        default:
          // `normal`, `start`, `stretch`, `baseline` and `space-between` all
          // leave the content at the block-start edge.
          break;
      }
      if (offset > 0.0f) {
        for (auto* child : node->getChildren()) {
          if (child->style().display() == Display::None ||
              child->style().positionType() == PositionType::Absolute) {
            continue;
          }
          child->setLayoutPosition(
              child->getLayout().position(PhysicalEdge::Top) + offset,
              PhysicalEdge::Top);
        }
      }
    }
  }

  if (performLayout) {
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

static void calculateLayoutImpl(
    yoga::Node* const node,
    const float availableWidth,
    const float availableHeight,
    const Direction ownerDirection,
    const SizingMode widthSizingMode,
    const SizingMode heightSizingMode,
    const float ownerWidth,
    const float ownerHeight,
    const bool performLayout,
    const LayoutPassReason reason,
    LayoutData& layoutMarkerData,
    const uint32_t depth,
    const uint32_t generationCount) {
  yoga::assertFatalWithNode(
      node,
      yoga::isUndefined(availableWidth)
          ? widthSizingMode == SizingMode::MaxContent
          : true,
      "availableWidth is indefinite so widthSizingMode must be "
      "SizingMode::MaxContent");
  yoga::assertFatalWithNode(
      node,
      yoga::isUndefined(availableHeight)
          ? heightSizingMode == SizingMode::MaxContent
          : true,
      "availableHeight is indefinite so heightSizingMode must be "
      "SizingMode::MaxContent");

  (performLayout ? layoutMarkerData.layouts : layoutMarkerData.measures) += 1;

  // Set the resolved resolution in the node's layout.
  const Direction direction = node->resolveDirection(ownerDirection);
  node->setLayoutDirection(direction);
  const bool fixFlexBasisFitContent =
      node->getConfig()->isExperimentalFeatureEnabled(
          ExperimentalFeature::FixFlexBasisFitContent);
  if (fixFlexBasisFitContent && performLayout) {
    node->setLayoutHadOverflow(false);
  }

  const FlexDirection flexRowDirection =
      resolveDirection(FlexDirection::Row, direction);
  const FlexDirection flexColumnDirection =
      resolveDirection(FlexDirection::Column, direction);

  const auto startEdge =
      direction == Direction::LTR ? PhysicalEdge::Left : PhysicalEdge::Right;
  const auto endEdge =
      direction == Direction::LTR ? PhysicalEdge::Right : PhysicalEdge::Left;

  const float marginRowLeading = node->style().computeInlineStartMargin(
      flexRowDirection, direction, ownerWidth);
  node->setLayoutMargin(marginRowLeading, startEdge);
  const float marginRowTrailing = node->style().computeInlineEndMargin(
      flexRowDirection, direction, ownerWidth);
  node->setLayoutMargin(marginRowTrailing, endEdge);
  const float marginColumnLeading = node->style().computeInlineStartMargin(
      flexColumnDirection, direction, ownerWidth);
  node->setLayoutMargin(marginColumnLeading, PhysicalEdge::Top);
  const float marginColumnTrailing = node->style().computeInlineEndMargin(
      flexColumnDirection, direction, ownerWidth);
  node->setLayoutMargin(marginColumnTrailing, PhysicalEdge::Bottom);

  const float marginAxisRow = marginRowLeading + marginRowTrailing;
  const float marginAxisColumn = marginColumnLeading + marginColumnTrailing;

  node->setLayoutBorder(
      node->style().computeInlineStartBorder(flexRowDirection, direction),
      startEdge);
  node->setLayoutBorder(
      node->style().computeInlineEndBorder(flexRowDirection, direction),
      endEdge);
  node->setLayoutBorder(
      node->style().computeInlineStartBorder(flexColumnDirection, direction),
      PhysicalEdge::Top);
  node->setLayoutBorder(
      node->style().computeInlineEndBorder(flexColumnDirection, direction),
      PhysicalEdge::Bottom);

  node->setLayoutPadding(
      node->style().computeInlineStartPadding(
          flexRowDirection, direction, ownerWidth),
      startEdge);
  node->setLayoutPadding(
      node->style().computeInlineEndPadding(
          flexRowDirection, direction, ownerWidth),
      endEdge);
  node->setLayoutPadding(
      node->style().computeInlineStartPadding(
          flexColumnDirection, direction, ownerWidth),
      PhysicalEdge::Top);
  node->setLayoutPadding(
      node->style().computeInlineEndPadding(
          flexColumnDirection, direction, ownerWidth),
      PhysicalEdge::Bottom);

  if (node->hasMeasureFunc()) {
    measureNodeWithMeasureFunc(
        node,
        direction,
        availableWidth - marginAxisRow,
        availableHeight - marginAxisColumn,
        widthSizingMode,
        heightSizingMode,
        ownerWidth,
        ownerHeight,
        layoutMarkerData,
        reason);

    // Clean and update all display: contents nodes with a direct path to the
    // current node as they will not be traversed
    cleanupContentsNodesRecursively(node, performLayout);
    return;
  }

  const auto childCount = node->getLayoutChildCount();
  if (childCount == 0) {
    measureNodeWithoutChildren(
        node,
        direction,
        availableWidth - marginAxisRow,
        availableHeight - marginAxisColumn,
        widthSizingMode,
        heightSizingMode,
        ownerWidth,
        ownerHeight);

    // Clean and update all display: contents nodes with a direct path to the
    // current node as they will not be traversed
    cleanupContentsNodesRecursively(node, performLayout);
    return;
  }

  // If we're not being asked to perform a full layout we can skip the algorithm
  // if we already know the size
  if (!performLayout &&
      measureNodeWithFixedSize(
          node,
          direction,
          availableWidth - marginAxisRow,
          availableHeight - marginAxisColumn,
          widthSizingMode,
          heightSizingMode,
          ownerWidth,
          ownerHeight)) {
    // Clean and update all display: contents nodes with a direct path to the
    // current node as they will not be traversed
    cleanupContentsNodesRecursively(node, /* didPerformLayout */ false);
    return;
  }

  // At this point we know we're going to perform work. Ensure that each child
  // has a mutable copy.
  node->cloneChildrenIfNeeded();
  if (!fixFlexBasisFitContent || !performLayout) {
    node->setLayoutHadOverflow(false);
  }
  // Clean and update all display: contents nodes with a direct path to the
  // current node as they will not be traversed
  cleanupContentsNodesRecursively(node, performLayout);

  // Grid lanes: tracks in one axis, a flowed stacking axis (css-grid-3).
  if (node->style().display() == Display::GridLanes) {
    calculateGridLanesLayoutInternal(
        node,
        availableWidth,
        availableHeight,
        ownerDirection,
        widthSizingMode,
        heightSizingMode,
        ownerWidth,
        ownerHeight,
        performLayout,
        reason,
        layoutMarkerData,
        depth,
        generationCount);
    return;
  }

  // Grid formatting context: `display: grid` uses the dedicated grid layout
  // path rather than the flex algorithm below. VENDORED — see
  // algorithm/grid/README-VENDORED.md.
  if (node->style().display() == Display::Grid) {
    calculateGridLayoutInternal(
        node,
        availableWidth,
        availableHeight,
        ownerDirection,
        widthSizingMode,
        heightSizingMode,
        ownerWidth,
        ownerHeight,
        performLayout,
        reason,
        layoutMarkerData,
        depth,
        generationCount);
    return;
  }

  // Block formatting context: `display: block` uses a dedicated block layout
  // path rather than the flex algorithm below (text-children-plan.md §3.A/§4.5).
  if (node->style().display() == Display::Block) {
    calculateBlockLayout(
        node,
        availableWidth,
        availableHeight,
        direction,
        widthSizingMode,
        heightSizingMode,
        ownerWidth,
        ownerHeight,
        marginAxisRow,
        marginAxisColumn,
        performLayout,
        layoutMarkerData,
        depth,
        generationCount);
    return;
  }

  // STEP 1: CALCULATE VALUES FOR REMAINDER OF ALGORITHM
  const FlexDirection mainAxis =
      resolveDirection(node->style().flexDirection(), direction);
  const FlexDirection crossAxis = resolveCrossDirection(mainAxis, direction);
  const bool isMainAxisRow = isRow(mainAxis);
  const bool isNodeFlexWrap = node->style().flexWrap() != Wrap::NoWrap;

  const float mainAxisOwnerSize = isMainAxisRow ? ownerWidth : ownerHeight;
  const float crossAxisOwnerSize = isMainAxisRow ? ownerHeight : ownerWidth;

  const float paddingAndBorderAxisMain =
      paddingAndBorderForAxis(node, mainAxis, direction, ownerWidth);
  const float paddingAndBorderAxisCross =
      paddingAndBorderForAxis(node, crossAxis, direction, ownerWidth);
  const float leadingPaddingAndBorderCross =
      node->style().computeFlexStartPaddingAndBorder(
          crossAxis, direction, ownerWidth);

  SizingMode sizingModeMainDim =
      isMainAxisRow ? widthSizingMode : heightSizingMode;
  SizingMode sizingModeCrossDim =
      isMainAxisRow ? heightSizingMode : widthSizingMode;

  const float paddingAndBorderAxisRow =
      isMainAxisRow ? paddingAndBorderAxisMain : paddingAndBorderAxisCross;
  const float paddingAndBorderAxisColumn =
      isMainAxisRow ? paddingAndBorderAxisCross : paddingAndBorderAxisMain;

  // STEP 2: DETERMINE AVAILABLE SIZE IN MAIN AND CROSS DIRECTIONS

  float availableInnerWidth = calculateAvailableInnerDimension(
      node,
      direction,
      Dimension::Width,
      availableWidth - marginAxisRow,
      paddingAndBorderAxisRow,
      ownerWidth,
      ownerWidth);
  float availableInnerHeight = calculateAvailableInnerDimension(
      node,
      direction,
      Dimension::Height,
      availableHeight - marginAxisColumn,
      paddingAndBorderAxisColumn,
      ownerHeight,
      ownerWidth);

  float availableInnerMainDim =
      isMainAxisRow ? availableInnerWidth : availableInnerHeight;
  const float availableInnerCrossDim =
      isMainAxisRow ? availableInnerHeight : availableInnerWidth;

  // STEP 3: DETERMINE FLEX BASIS FOR EACH ITEM

  // Computed basis + margins + gap
  float totalMainDim = 0;
  totalMainDim += computeFlexBasisForChildren(
      node,
      availableInnerWidth,
      availableInnerHeight,
      availableInnerWidth,
      availableInnerHeight,
      widthSizingMode,
      heightSizingMode,
      direction,
      mainAxis,
      performLayout,
      layoutMarkerData,
      depth,
      generationCount);

  if (childCount > 1) {
    totalMainDim +=
        node->style().computeGapForAxis(mainAxis, availableInnerMainDim) *
        static_cast<float>(childCount - 1);
  }

  const bool mainAxisOverflows =
      (sizingModeMainDim != SizingMode::MaxContent) &&
      totalMainDim > availableInnerMainDim;

  if (isNodeFlexWrap && mainAxisOverflows &&
      sizingModeMainDim == SizingMode::FitContent) {
    sizingModeMainDim = SizingMode::StretchFit;
  }
  // STEP 4: COLLECT FLEX ITEMS INTO FLEX LINES

  // Iterator representing the beginning of the current line
  Node::LayoutableChildren::Iterator startOfLineIterator =
      node->getLayoutChildren().begin();

  // Number of lines.
  size_t lineCount = 0;

  // Accumulated cross dimensions of all lines so far.
  float totalLineCrossDim = 0;

  const float crossAxisGap =
      node->style().computeGapForAxis(crossAxis, availableInnerCrossDim);

  // Max main dimension of all the lines.
  float maxLineMainDim = 0;
  for (; startOfLineIterator != node->getLayoutChildren().end(); lineCount++) {
    auto flexLine = calculateFlexLine(
        node,
        ownerDirection,
        ownerWidth,
        mainAxisOwnerSize,
        availableInnerWidth,
        availableInnerMainDim,
        startOfLineIterator,
        lineCount);

    // If we don't need to measure the cross axis, we can skip the entire flex
    // step.
    const bool canSkipFlex =
        !performLayout && sizingModeCrossDim == SizingMode::StretchFit;

    // STEP 5: RESOLVING FLEXIBLE LENGTHS ON MAIN AXIS
    // Calculate the remaining available space that needs to be allocated. If
    // the main dimension size isn't known, it is computed based on the line
    // length, so there's no more space left to distribute.

    bool sizeBasedOnContent = false;
    // If we don't measure with exact main dimension we want to ensure we don't
    // violate min and max
    if (sizingModeMainDim != SizingMode::StretchFit) {
      const auto& style = node->style();
      const float minInnerWidth =
          style
              .resolvedMinDimension(
                  direction, Dimension::Width, ownerWidth, ownerWidth)
              .unwrap() -
          paddingAndBorderAxisRow;
      const float maxInnerWidth =
          style
              .resolvedMaxDimension(
                  direction, Dimension::Width, ownerWidth, ownerWidth)
              .unwrap() -
          paddingAndBorderAxisRow;
      const float minInnerHeight =
          style
              .resolvedMinDimension(
                  direction, Dimension::Height, ownerHeight, ownerWidth)
              .unwrap() -
          paddingAndBorderAxisColumn;
      const float maxInnerHeight =
          style
              .resolvedMaxDimension(
                  direction, Dimension::Height, ownerHeight, ownerWidth)
              .unwrap() -
          paddingAndBorderAxisColumn;

      const float minInnerMainDim =
          isMainAxisRow ? minInnerWidth : minInnerHeight;
      const float maxInnerMainDim =
          isMainAxisRow ? maxInnerWidth : maxInnerHeight;

      if (yoga::isDefined(minInnerMainDim) &&
          flexLine.sizeConsumed < minInnerMainDim) {
        availableInnerMainDim = minInnerMainDim;
      } else if (
          yoga::isDefined(maxInnerMainDim) &&
          flexLine.sizeConsumed > maxInnerMainDim) {
        availableInnerMainDim = maxInnerMainDim;
      } else {
        bool useLegacyStretchBehaviour =
            node->hasErrata(Errata::StretchFlexBasis);

        if (!useLegacyStretchBehaviour &&
            ((yoga::isDefined(flexLine.layout.totalFlexGrowFactors) &&
              flexLine.layout.totalFlexGrowFactors == 0) ||
             (yoga::isDefined(node->resolveFlexGrow()) &&
              node->resolveFlexGrow() == 0))) {
          // If we don't have any children to flex or we can't flex the node
          // itself, space we've used is all space we need. Root node also
          // should be shrunk to minimum
          availableInnerMainDim = flexLine.sizeConsumed;
        }

        sizeBasedOnContent = !useLegacyStretchBehaviour;
      }
    }

    if (!sizeBasedOnContent && yoga::isDefined(availableInnerMainDim)) {
      flexLine.layout.remainingFreeSpace =
          availableInnerMainDim - flexLine.sizeConsumed;
    } else if (flexLine.sizeConsumed < 0) {
      // availableInnerMainDim is indefinite which means the node is being sized
      // based on its content. sizeConsumed is negative which means
      // the node will allocate 0 points for its content. Consequently,
      // remainingFreeSpace is 0 - sizeConsumed.
      flexLine.layout.remainingFreeSpace = -flexLine.sizeConsumed;
    }

    if (!canSkipFlex) {
      resolveFlexibleLength(
          node,
          flexLine,
          mainAxis,
          crossAxis,
          direction,
          ownerWidth,
          mainAxisOwnerSize,
          availableInnerMainDim,
          availableInnerCrossDim,
          availableInnerWidth,
          availableInnerHeight,
          mainAxisOverflows,
          sizingModeCrossDim,
          performLayout,
          layoutMarkerData,
          depth,
          generationCount);
    }

    node->setLayoutHadOverflow(
        node->getLayout().hadOverflow() ||
        (flexLine.layout.remainingFreeSpace < 0));

    // STEP 6: MAIN-AXIS JUSTIFICATION & CROSS-AXIS SIZE DETERMINATION

    // At this point, all the children have their dimensions set in the main
    // axis. Their dimensions are also set in the cross axis with the exception
    // of items that are aligned "stretch". We need to compute these stretch
    // values and set the final positions.

    justifyMainAxis(
        node,
        flexLine,
        mainAxis,
        crossAxis,
        direction,
        sizingModeMainDim,
        sizingModeCrossDim,
        mainAxisOwnerSize,
        ownerWidth,
        availableInnerMainDim,
        availableInnerCrossDim,
        availableInnerWidth,
        performLayout);

    float containerCrossAxis = availableInnerCrossDim;
    if (sizingModeCrossDim == SizingMode::MaxContent ||
        sizingModeCrossDim == SizingMode::FitContent) {
      // Compute the cross axis from the max cross dimension of the children.
      containerCrossAxis =
          boundAxis(
              node,
              crossAxis,
              direction,
              flexLine.layout.crossDim + paddingAndBorderAxisCross,
              crossAxisOwnerSize,
              ownerWidth) -
          paddingAndBorderAxisCross;
    }

    // If there's no flex wrap, the cross dimension is defined by the container.
    if (!isNodeFlexWrap && sizingModeCrossDim == SizingMode::StretchFit) {
      flexLine.layout.crossDim = availableInnerCrossDim;
    }

    // As-per https://www.w3.org/TR/css-flexbox-1/#cross-sizing, the
    // cross-size of the line within a single-line container should be bound to
    // min/max constraints before alignment within the line. In a multi-line
    // container, affecting alignment between the lines.
    if (!isNodeFlexWrap) {
      flexLine.layout.crossDim =
          boundAxis(
              node,
              crossAxis,
              direction,
              flexLine.layout.crossDim + paddingAndBorderAxisCross,
              crossAxisOwnerSize,
              ownerWidth) -
          paddingAndBorderAxisCross;
    }

    // STEP 7: CROSS-AXIS ALIGNMENT
    // We can skip child alignment if we're just measuring the container.
    if (performLayout) {
      for (auto child : flexLine.itemsInFlow) {
        float leadingCrossDim = leadingPaddingAndBorderCross;

        // For a relative children, we're either using alignItems (owner) or
        // alignSelf (child) in order to determine the position in the cross
        // axis
        const Align alignItem = resolveChildAlignment(node, child);

        // If the child uses align stretch, we need to lay it out one more
        // time, this time forcing the cross-axis size to be the computed
        // cross size for the current line.
        if (alignItem == Align::Stretch &&
            !child->style().flexStartMarginIsAuto(crossAxis, direction) &&
            !child->style().flexEndMarginIsAuto(crossAxis, direction)) {
          // If the child defines a definite size for its cross axis, there's
          // no need to stretch.
          if (!child->hasDefiniteLength(
                  dimension(crossAxis), availableInnerCrossDim)) {
            float childMainSize =
                child->getLayout().measuredDimension(dimension(mainAxis));
            const auto& childStyle = child->style();
            float childCrossSize = childStyle.aspectRatio().isDefined()
                ? child->style().computeMarginForAxis(
                      crossAxis, availableInnerWidth) +
                    (isMainAxisRow
                         ? childMainSize / childStyle.aspectRatio().unwrap()
                         : childMainSize * childStyle.aspectRatio().unwrap())
                : flexLine.layout.crossDim;

            childMainSize += child->style().computeMarginForAxis(
                mainAxis, availableInnerWidth);

            SizingMode childMainSizingMode = SizingMode::StretchFit;
            SizingMode childCrossSizingMode = SizingMode::StretchFit;
            constrainMaxSizeForMode(
                child,
                direction,
                mainAxis,
                availableInnerMainDim,
                availableInnerWidth,
                &childMainSizingMode,
                &childMainSize);
            constrainMaxSizeForMode(
                child,
                direction,
                crossAxis,
                availableInnerCrossDim,
                availableInnerWidth,
                &childCrossSizingMode,
                &childCrossSize);

            const float childWidth =
                isMainAxisRow ? childMainSize : childCrossSize;
            const float childHeight =
                !isMainAxisRow ? childMainSize : childCrossSize;

            auto alignContent = node->style().alignContent();
            auto crossAxisDoesNotGrow =
                alignContent != Align::Stretch && isNodeFlexWrap;
            const SizingMode childWidthSizingMode =
                yoga::isUndefined(childWidth) ||
                    (!isMainAxisRow && crossAxisDoesNotGrow)
                ? SizingMode::MaxContent
                : SizingMode::StretchFit;
            const SizingMode childHeightSizingMode =
                yoga::isUndefined(childHeight) ||
                    (isMainAxisRow && crossAxisDoesNotGrow)
                ? SizingMode::MaxContent
                : SizingMode::StretchFit;

            calculateLayoutInternal(
                child,
                childWidth,
                childHeight,
                direction,
                childWidthSizingMode,
                childHeightSizingMode,
                availableInnerWidth,
                availableInnerHeight,
                true,
                LayoutPassReason::kStretch,
                layoutMarkerData,
                depth,
                generationCount);
          }
        } else {
          const float remainingCrossDim = containerCrossAxis -
              child->dimensionWithMargin(crossAxis, availableInnerWidth);

          if (child->style().flexStartMarginIsAuto(crossAxis, direction) &&
              child->style().flexEndMarginIsAuto(crossAxis, direction)) {
            leadingCrossDim += yoga::maxOrDefined(0.0f, remainingCrossDim / 2);
          } else if (child->style().flexEndMarginIsAuto(crossAxis, direction)) {
            // No-Op
          } else if (child->style().flexStartMarginIsAuto(
                         crossAxis, direction)) {
            leadingCrossDim += yoga::maxOrDefined(0.0f, remainingCrossDim);
          } else if (alignItem == Align::FlexStart) {
            // No-Op
          } else if (alignItem == Align::Center) {
            leadingCrossDim += remainingCrossDim / 2;
          } else {
            leadingCrossDim += remainingCrossDim;
          }
        }
        // And we apply the position
        child->setLayoutPosition(
            child->getLayout().position(flexStartEdge(crossAxis)) +
                totalLineCrossDim + leadingCrossDim,
            flexStartEdge(crossAxis));
      }
    }

    const float appliedCrossGap = lineCount != 0 ? crossAxisGap : 0.0f;
    totalLineCrossDim += flexLine.layout.crossDim + appliedCrossGap;
    maxLineMainDim =
        yoga::maxOrDefined(maxLineMainDim, flexLine.layout.mainDim);
  }

  // STEP 8: MULTI-LINE CONTENT ALIGNMENT
  // currentLead stores the size of the cross dim
  if (performLayout && (isNodeFlexWrap || isBaselineLayout(node))) {
    float leadPerLine = 0;
    float currentLead = leadingPaddingAndBorderCross;
    float extraSpacePerLine = 0;

    const float unclampedCrossDim = sizingModeCrossDim == SizingMode::StretchFit
        ? availableInnerCrossDim + paddingAndBorderAxisCross
        : node->hasDefiniteLength(dimension(crossAxis), crossAxisOwnerSize)
        ? node->getResolvedDimension(
                  direction,
                  dimension(crossAxis),
                  crossAxisOwnerSize,
                  ownerWidth)
              .unwrap()
        : totalLineCrossDim + paddingAndBorderAxisCross;

    const float innerCrossDim = boundAxis(
                                    node,
                                    crossAxis,
                                    direction,
                                    unclampedCrossDim,
                                    crossAxisOwnerSize,
                                    ownerWidth) -
        paddingAndBorderAxisCross;

    const float remainingAlignContentDim = innerCrossDim - totalLineCrossDim;

    const auto alignContent = remainingAlignContentDim >= 0
        ? node->style().alignContent()
        : fallbackAlignment(node->style().alignContent());

    switch (alignContent) {
      case Align::Start:
      case Align::End:
        // No-Op
        break;
      case Align::FlexEnd:
        currentLead += remainingAlignContentDim;
        break;
      case Align::Center:
        currentLead += remainingAlignContentDim / 2;
        break;
      case Align::Stretch:
        extraSpacePerLine =
            remainingAlignContentDim / static_cast<float>(lineCount);
        break;
      case Align::SpaceAround:
        currentLead +=
            remainingAlignContentDim / (2 * static_cast<float>(lineCount));
        leadPerLine = remainingAlignContentDim / static_cast<float>(lineCount);
        break;
      case Align::SpaceEvenly:
        currentLead +=
            remainingAlignContentDim / static_cast<float>(lineCount + 1);
        leadPerLine =
            remainingAlignContentDim / static_cast<float>(lineCount + 1);
        break;
      case Align::SpaceBetween:
        if (lineCount > 1) {
          leadPerLine =
              remainingAlignContentDim / static_cast<float>(lineCount - 1);
        }
        break;
      case Align::Auto:
      case Align::FlexStart:
      case Align::Baseline:
        break;
    }
    Node::LayoutableChildren::Iterator endIterator =
        node->getLayoutChildren().begin();
    for (size_t i = 0; i < lineCount; i++) {
      const Node::LayoutableChildren::Iterator startIterator = endIterator;
      auto iterator = startIterator;

      // compute the line's height and find the endIndex
      float lineHeight = 0;
      float maxAscentForCurrentLine = 0;
      float maxDescentForCurrentLine = 0;
      for (; iterator != node->getLayoutChildren().end(); iterator++) {
        const auto child = *iterator;
        if (child->style().display() == Display::None) {
          continue;
        }
        if (child->style().positionType() != PositionType::Absolute) {
          if (child->getLineIndex() != i) {
            break;
          }
          if (child->isLayoutDimensionDefined(crossAxis)) {
            lineHeight = yoga::maxOrDefined(
                lineHeight,
                child->getLayout().measuredDimension(dimension(crossAxis)) +
                    child->style().computeMarginForAxis(
                        crossAxis, availableInnerWidth));
          }
          if (resolveChildAlignment(node, child) == Align::Baseline) {
            const float ascent = calculateBaseline(child) +
                child->style().computeFlexStartMargin(
                    FlexDirection::Column, direction, availableInnerWidth);
            const float descent =
                child->getLayout().measuredDimension(Dimension::Height) +
                child->style().computeMarginForAxis(
                    FlexDirection::Column, availableInnerWidth) -
                ascent;
            maxAscentForCurrentLine =
                yoga::maxOrDefined(maxAscentForCurrentLine, ascent);
            maxDescentForCurrentLine =
                yoga::maxOrDefined(maxDescentForCurrentLine, descent);
            lineHeight = yoga::maxOrDefined(
                lineHeight, maxAscentForCurrentLine + maxDescentForCurrentLine);
          }
        }
      }
      endIterator = iterator;
      currentLead += i != 0 ? crossAxisGap : 0;
      lineHeight += extraSpacePerLine;

      for (iterator = startIterator; iterator != endIterator; iterator++) {
        const auto child = *iterator;
        if (child->style().display() == Display::None) {
          continue;
        }
        if (child->style().positionType() != PositionType::Absolute) {
          switch (resolveChildAlignment(node, child)) {
            case Align::Start:
            case Align::End:
              // Not yet implemented
              break;
            case Align::FlexStart: {
              child->setLayoutPosition(
                  currentLead +
                      child->style().computeFlexStartPosition(
                          crossAxis, direction, availableInnerWidth),
                  flexStartEdge(crossAxis));
              break;
            }
            case Align::FlexEnd: {
              child->setLayoutPosition(
                  currentLead + lineHeight -
                      child->style().computeFlexEndMargin(
                          crossAxis, direction, availableInnerWidth) -
                      child->getLayout().measuredDimension(
                          dimension(crossAxis)),
                  flexStartEdge(crossAxis));
              break;
            }
            case Align::Center: {
              float childHeight =
                  child->getLayout().measuredDimension(dimension(crossAxis));

              child->setLayoutPosition(
                  currentLead + (lineHeight - childHeight) / 2,
                  flexStartEdge(crossAxis));
              break;
            }
            case Align::Stretch: {
              child->setLayoutPosition(
                  currentLead +
                      child->style().computeFlexStartMargin(
                          crossAxis, direction, availableInnerWidth),
                  flexStartEdge(crossAxis));

              // Remeasure child with the line height as it as been only
              // measured with the owners height yet.
              if (!child->hasDefiniteLength(
                      dimension(crossAxis), availableInnerCrossDim)) {
                const float childWidth = isMainAxisRow
                    ? (child->getLayout().measuredDimension(Dimension::Width) +
                       child->style().computeMarginForAxis(
                           mainAxis, availableInnerWidth))
                    : leadPerLine + lineHeight;

                const float childHeight = !isMainAxisRow
                    ? (child->getLayout().measuredDimension(Dimension::Height) +
                       child->style().computeMarginForAxis(
                           crossAxis, availableInnerWidth))
                    : leadPerLine + lineHeight;

                if (!(yoga::inexactEquals(
                          childWidth,
                          child->getLayout().measuredDimension(
                              Dimension::Width)) &&
                      yoga::inexactEquals(
                          childHeight,
                          child->getLayout().measuredDimension(
                              Dimension::Height)))) {
                  calculateLayoutInternal(
                      child,
                      childWidth,
                      childHeight,
                      direction,
                      SizingMode::StretchFit,
                      SizingMode::StretchFit,
                      availableInnerWidth,
                      availableInnerHeight,
                      true,
                      LayoutPassReason::kMultilineStretch,
                      layoutMarkerData,
                      depth,
                      generationCount);
                }
              }
              break;
            }
            case Align::Baseline: {
              child->setLayoutPosition(
                  currentLead + maxAscentForCurrentLine -
                      calculateBaseline(child) +
                      child->style().computeFlexStartPosition(
                          FlexDirection::Column,
                          direction,
                          availableInnerCrossDim),
                  PhysicalEdge::Top);

              break;
            }
            case Align::Auto:
            case Align::SpaceBetween:
            case Align::SpaceAround:
            case Align::SpaceEvenly:
              break;
          }
        }
      }

      currentLead = currentLead + leadPerLine + lineHeight;
    }
  }

  // STEP 9: COMPUTING FINAL DIMENSIONS

  node->setLayoutMeasuredDimension(
      boundAxis(
          node,
          FlexDirection::Row,
          direction,
          availableWidth - marginAxisRow,
          ownerWidth,
          ownerWidth),
      Dimension::Width);

  node->setLayoutMeasuredDimension(
      boundAxis(
          node,
          FlexDirection::Column,
          direction,
          availableHeight - marginAxisColumn,
          ownerHeight,
          ownerWidth),
      Dimension::Height);

  // If the user didn't specify a width or height for the node, set the
  // dimensions based on the children.
  if (sizingModeMainDim == SizingMode::MaxContent ||
      (node->style().overflow() != Overflow::Scroll &&
       sizingModeMainDim == SizingMode::FitContent)) {
    // Clamp the size to the min/max size, if specified, and make sure it
    // doesn't go below the padding and border amount.
    node->setLayoutMeasuredDimension(
        boundAxis(
            node,
            mainAxis,
            direction,
            maxLineMainDim,
            mainAxisOwnerSize,
            ownerWidth),
        dimension(mainAxis));

  } else if (
      sizingModeMainDim == SizingMode::FitContent &&
      node->style().overflow() == Overflow::Scroll) {
    node->setLayoutMeasuredDimension(
        yoga::maxOrDefined(
            yoga::minOrDefined(
                availableInnerMainDim + paddingAndBorderAxisMain,
                boundAxisWithinMinAndMax(
                    node,
                    direction,
                    mainAxis,
                    FloatOptional{maxLineMainDim},
                    mainAxisOwnerSize,
                    ownerWidth)
                    .unwrap()),
            paddingAndBorderAxisMain),
        dimension(mainAxis));
  }

  if (sizingModeCrossDim == SizingMode::MaxContent ||
      (node->style().overflow() != Overflow::Scroll &&
       sizingModeCrossDim == SizingMode::FitContent)) {
    // Clamp the size to the min/max size, if specified, and make sure it
    // doesn't go below the padding and border amount.
    node->setLayoutMeasuredDimension(
        boundAxis(
            node,
            crossAxis,
            direction,
            totalLineCrossDim + paddingAndBorderAxisCross,
            crossAxisOwnerSize,
            ownerWidth),
        dimension(crossAxis));

  } else if (
      sizingModeCrossDim == SizingMode::FitContent &&
      node->style().overflow() == Overflow::Scroll) {
    node->setLayoutMeasuredDimension(
        yoga::maxOrDefined(
            yoga::minOrDefined(
                availableInnerCrossDim + paddingAndBorderAxisCross,
                boundAxisWithinMinAndMax(
                    node,
                    direction,
                    crossAxis,
                    FloatOptional{
                        totalLineCrossDim + paddingAndBorderAxisCross},
                    crossAxisOwnerSize,
                    ownerWidth)
                    .unwrap()),
            paddingAndBorderAxisCross),
        dimension(crossAxis));
  }

  // As we only wrapped in normal direction yet, we need to reverse the
  // positions on wrap-reverse.
  if (performLayout && node->style().flexWrap() == Wrap::WrapReverse) {
    for (auto child : node->getLayoutChildren()) {
      if (child->style().positionType() != PositionType::Absolute) {
        child->setLayoutPosition(
            node->getLayout().measuredDimension(dimension(crossAxis)) -
                child->getLayout().position(flexStartEdge(crossAxis)) -
                child->getLayout().measuredDimension(dimension(crossAxis)),
            flexStartEdge(crossAxis));
      }
    }
  }

  if (performLayout) {
    // STEP 10: SETTING TRAILING POSITIONS FOR CHILDREN
    const bool needsMainTrailingPos = needsTrailingPosition(mainAxis);
    const bool needsCrossTrailingPos = needsTrailingPosition(crossAxis);

    if (needsMainTrailingPos || needsCrossTrailingPos) {
      for (auto child : node->getLayoutChildren()) {
        // Absolute children will be handled by their containing block since we
        // cannot guarantee that their positions are set when their parents are
        // done with layout.
        if (child->style().display() == Display::None ||
            child->style().positionType() == PositionType::Absolute) {
          continue;
        }
        if (needsMainTrailingPos) {
          setChildTrailingPosition(node, child, mainAxis);
        }

        if (needsCrossTrailingPos) {
          setChildTrailingPosition(node, child, crossAxis);
        }
      }
    }

    // STEP 11: SIZING AND POSITIONING ABSOLUTE CHILDREN
    // Let the containing block layout its absolute descendants.
    if (node->style().positionType() != PositionType::Static ||
        node->alwaysFormsContainingBlock() || depth == 1) {
      layoutAbsoluteDescendants(
          node,
          node,
          isMainAxisRow ? sizingModeMainDim : sizingModeCrossDim,
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
}

//
// This is a wrapper around the calculateLayoutImpl function. It determines
// whether the layout request is redundant and can be skipped.
//
// Parameters:
//  Input parameters are the same as calculateLayoutImpl (see above)
//  Return parameter is true if layout was performed, false if skipped
//
bool calculateLayoutInternal(
    yoga::Node* const node,
    const float availableWidth,
    const float availableHeight,
    const Direction ownerDirection,
    const SizingMode widthSizingMode,
    const SizingMode heightSizingMode,
    const float ownerWidth,
    const float ownerHeight,
    const bool performLayout,
    const LayoutPassReason reason,
    LayoutData& layoutMarkerData,
    uint32_t depth,
    const uint32_t generationCount) {
  LayoutResults* layout = &node->getLayout();

  depth++;

  const bool needToVisitNode =
      (node->isDirty() && layout->generationCount != generationCount) ||
      layout->configVersion != node->getConfig()->getVersion() ||
      layout->lastOwnerDirection != ownerDirection;

  if (needToVisitNode) {
    // Invalidate the cached results.
    layout->nextCachedMeasurementsIndex = 0;
    layout->cachedLayout.availableWidth = -1;
    layout->cachedLayout.availableHeight = -1;
    layout->cachedLayout.widthSizingMode = SizingMode::MaxContent;
    layout->cachedLayout.heightSizingMode = SizingMode::MaxContent;
    layout->cachedLayout.computedWidth = -1;
    layout->cachedLayout.computedHeight = -1;
  }

  CachedMeasurement* cachedResults = nullptr;

  // Determine whether the results are already cached. We maintain a separate
  // cache for layouts and measurements. A layout operation modifies the
  // positions and dimensions for nodes in the subtree. The algorithm assumes
  // that each node gets laid out a maximum of one time per tree layout, but
  // multiple measurements may be required to resolve all of the flex
  // dimensions. We handle nodes with measure functions specially here because
  // they are the most expensive to measure, so it's worth avoiding redundant
  // measurements if at all possible.
  if (node->hasMeasureFunc()) {
    const float marginAxisRow =
        node->style().computeMarginForAxis(FlexDirection::Row, ownerWidth);
    const float marginAxisColumn =
        node->style().computeMarginForAxis(FlexDirection::Column, ownerWidth);

    // First, try to use the layout cache.
    if (canUseCachedMeasurement(
            widthSizingMode,
            availableWidth,
            heightSizingMode,
            availableHeight,
            layout->cachedLayout.widthSizingMode,
            layout->cachedLayout.availableWidth,
            layout->cachedLayout.heightSizingMode,
            layout->cachedLayout.availableHeight,
            layout->cachedLayout.computedWidth,
            layout->cachedLayout.computedHeight,
            marginAxisRow,
            marginAxisColumn,
            node->getConfig())) {
      cachedResults = &layout->cachedLayout;
    } else {
      // Try to use the measurement cache.
      for (size_t i = 0; i < layout->nextCachedMeasurementsIndex; i++) {
        if (canUseCachedMeasurement(
                widthSizingMode,
                availableWidth,
                heightSizingMode,
                availableHeight,
                layout->cachedMeasurements[i].widthSizingMode,
                layout->cachedMeasurements[i].availableWidth,
                layout->cachedMeasurements[i].heightSizingMode,
                layout->cachedMeasurements[i].availableHeight,
                layout->cachedMeasurements[i].computedWidth,
                layout->cachedMeasurements[i].computedHeight,
                marginAxisRow,
                marginAxisColumn,
                node->getConfig())) {
          cachedResults = &layout->cachedMeasurements[i];
          break;
        }
      }
    }
  } else if (performLayout) {
    if (yoga::inexactEquals(
            layout->cachedLayout.availableWidth, availableWidth) &&
        yoga::inexactEquals(
            layout->cachedLayout.availableHeight, availableHeight) &&
        layout->cachedLayout.widthSizingMode == widthSizingMode &&
        layout->cachedLayout.heightSizingMode == heightSizingMode) {
      cachedResults = &layout->cachedLayout;
    }
  } else {
    for (uint32_t i = 0; i < layout->nextCachedMeasurementsIndex; i++) {
      if (yoga::inexactEquals(
              layout->cachedMeasurements[i].availableWidth, availableWidth) &&
          yoga::inexactEquals(
              layout->cachedMeasurements[i].availableHeight, availableHeight) &&
          layout->cachedMeasurements[i].widthSizingMode == widthSizingMode &&
          layout->cachedMeasurements[i].heightSizingMode == heightSizingMode) {
        cachedResults = &layout->cachedMeasurements[i];
        break;
      }
    }
  }

  if (!needToVisitNode && cachedResults != nullptr) {
    layout->setMeasuredDimension(
        Dimension::Width, cachedResults->computedWidth);
    layout->setMeasuredDimension(
        Dimension::Height, cachedResults->computedHeight);

    (performLayout ? layoutMarkerData.cachedLayouts
                   : layoutMarkerData.cachedMeasures) += 1;
  } else {
    calculateLayoutImpl(
        node,
        availableWidth,
        availableHeight,
        ownerDirection,
        widthSizingMode,
        heightSizingMode,
        ownerWidth,
        ownerHeight,
        performLayout,
        reason,
        layoutMarkerData,
        depth,
        generationCount);

    layout->lastOwnerDirection = ownerDirection;
    layout->configVersion = node->getConfig()->getVersion();

    if (cachedResults == nullptr) {
      layoutMarkerData.maxMeasureCache = std::max(
          layoutMarkerData.maxMeasureCache,
          layout->nextCachedMeasurementsIndex + 1u);

      if (layout->nextCachedMeasurementsIndex ==
          LayoutResults::MaxCachedMeasurements) {
        layout->nextCachedMeasurementsIndex = 0;
      }

      CachedMeasurement* newCacheEntry = nullptr;
      if (performLayout) {
        // Use the single layout cache entry.
        newCacheEntry = &layout->cachedLayout;
      } else {
        // Allocate a new measurement cache entry.
        newCacheEntry =
            &layout->cachedMeasurements[layout->nextCachedMeasurementsIndex];
        layout->nextCachedMeasurementsIndex++;
      }

      newCacheEntry->availableWidth = availableWidth;
      newCacheEntry->availableHeight = availableHeight;
      newCacheEntry->widthSizingMode = widthSizingMode;
      newCacheEntry->heightSizingMode = heightSizingMode;
      newCacheEntry->computedWidth =
          layout->measuredDimension(Dimension::Width);
      newCacheEntry->computedHeight =
          layout->measuredDimension(Dimension::Height);
    }
  }

  if (performLayout) {
    node->setLayoutDimension(
        node->getLayout().measuredDimension(Dimension::Width),
        Dimension::Width);
    node->setLayoutDimension(
        node->getLayout().measuredDimension(Dimension::Height),
        Dimension::Height);

    node->setHasNewLayout(true);
    node->setDirty(false);
  }

  layout->generationCount = generationCount;

  LayoutType layoutType;
  if (performLayout) {
    layoutType = !needToVisitNode && cachedResults == &layout->cachedLayout
        ? LayoutType::kCachedLayout
        : LayoutType::kLayout;
  } else {
    layoutType = cachedResults != nullptr ? LayoutType::kCachedMeasure
                                          : LayoutType::kMeasure;
  }
  Event::publish<Event::NodeLayout>(node, {layoutType});

  return (needToVisitNode || cachedResults == nullptr);
}

void calculateLayout(
    yoga::Node* const node,
    const float ownerWidth,
    const float ownerHeight,
    const Direction ownerDirection) {
  Event::publish<Event::LayoutPassStart>(node);
  LayoutData markerData = {};

  // Increment the generation count. This will force the recursive routine to
  // visit all dirty nodes at least once. Subsequent visits will be skipped if
  // the input parameters don't change.
  const uint32_t currentGenerationCount =
      gCurrentGenerationCount.fetch_add(1, std::memory_order_relaxed) + 1;
  node->processDimensions();
  const Direction direction = node->resolveDirection(ownerDirection);
  float width = YGUndefined;
  SizingMode widthSizingMode = SizingMode::MaxContent;
  const auto& style = node->style();
  if (node->hasDefiniteLength(Dimension::Width, ownerWidth)) {
    width =
        (node->getResolvedDimension(
                 direction,
                 dimension(FlexDirection::Row),
                 ownerWidth,
                 ownerWidth)
             .unwrap() +
         node->style().computeMarginForAxis(FlexDirection::Row, ownerWidth));
    widthSizingMode = SizingMode::StretchFit;
  } else if (style
                 .resolvedMaxDimension(
                     direction, Dimension::Width, ownerWidth, ownerWidth)
                 .isDefined()) {
    width = style
                .resolvedMaxDimension(
                    direction, Dimension::Width, ownerWidth, ownerWidth)
                .unwrap();
    widthSizingMode = SizingMode::FitContent;
  } else {
    width = ownerWidth;
    widthSizingMode = yoga::isUndefined(width) ? SizingMode::MaxContent
                                               : SizingMode::StretchFit;
  }

  float height = YGUndefined;
  SizingMode heightSizingMode = SizingMode::MaxContent;
  if (node->hasDefiniteLength(Dimension::Height, ownerHeight)) {
    height =
        (node->getResolvedDimension(
                 direction,
                 dimension(FlexDirection::Column),
                 ownerHeight,
                 ownerWidth)
             .unwrap() +
         node->style().computeMarginForAxis(FlexDirection::Column, ownerWidth));
    heightSizingMode = SizingMode::StretchFit;
  } else if (style
                 .resolvedMaxDimension(
                     direction, Dimension::Height, ownerHeight, ownerWidth)
                 .isDefined()) {
    height = style
                 .resolvedMaxDimension(
                     direction, Dimension::Height, ownerHeight, ownerWidth)
                 .unwrap();
    heightSizingMode = SizingMode::FitContent;
  } else {
    height = ownerHeight;
    heightSizingMode = yoga::isUndefined(height) ? SizingMode::MaxContent
                                                 : SizingMode::StretchFit;
  }
  const uint32_t generationCount =
      node->getConfig()->isExperimentalFeatureEnabled(
          ExperimentalFeature::FixFlexBasisFitContent)
      ? currentGenerationCount
      : gCurrentGenerationCount.load(std::memory_order_relaxed);
  if (calculateLayoutInternal(
          node,
          width,
          height,
          ownerDirection,
          widthSizingMode,
          heightSizingMode,
          ownerWidth,
          ownerHeight,
          true,
          LayoutPassReason::kInitial,
          markerData,
          0, // tree root
          generationCount)) {
    node->setPosition(node->getLayout().direction(), ownerWidth, ownerHeight);
    roundLayoutResultsToPixelGrid(node, 0.0f, 0.0f);
  }

  Event::publish<Event::LayoutPassEnd>(node, {&markerData});
}

} // namespace facebook::yoga
