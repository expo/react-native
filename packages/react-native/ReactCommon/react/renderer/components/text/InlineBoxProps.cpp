/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "InlineBoxProps.h"

#include <react/renderer/core/propsConversions.h>
#include <react/renderer/core/graphicsConversions.h>

namespace facebook::react {

namespace {

using OptionalFloat = std::optional<Float>;

// Reads one prop, distinguishing "absent" from "present and zero" — which the
// CSS cascade below needs and a plain Float cannot express.
OptionalFloat optionalProp(
    const PropsParserContext& context,
    const RawProps& rawProps,
    const char* name) {
  return convertRawProp(
      context, rawProps, name, OptionalFloat{}, OptionalFloat{});
}

// First authored value wins; absent stays absent.
template <typename... Rest>
OptionalFloat firstOf(OptionalFloat first, Rest... rest) {
  if (first.has_value()) {
    return first;
  }
  if constexpr (sizeof...(rest) == 0) {
    return {};
  } else {
    return firstOf(rest...);
  }
}

// Nothing authored keeps the source props' value, which is how every other
// prop group clones.
Float resolve(OptionalFloat value, Float sourceValue) {
  return value.has_value() ? *value : sourceValue;
}

struct EdgeNames {
  const char* left;
  const char* top;
  const char* right;
  const char* bottom;
  const char* horizontal;
  const char* vertical;
  const char* all;
  // CSS logical properties. Astryx styles almost exclusively in these.
  const char* start;
  const char* end;
  const char* inlineStart;
  const char* inlineEnd;
  const char* inlineAxis;
  const char* blockStart;
  const char* blockEnd;
  const char* blockAxis;
};

/*
 * Every name is read EXACTLY ONCE, and the cascade is resolved afterwards in
 * plain C++.
 *
 * This is not a style preference. `RawProps` is a cursor over the keys in the
 * order they were seen when the parser was prepared, so reading the same name
 * more than once per props construction is not reliable. Every other prop
 * group in the renderer (see ViewProps' propsConversions.h) reads each name
 * once; this does too.
 *
 * The precedence deliberately mirrors what a `<View>` does, so the same style
 * object means the same thing on a `<div>` and a `<span>`. It is the
 * composition of Yoga's edge resolution (`Style::computeLeftEdge` et al:
 * Start > Left > Horizontal > All in LTR) with the order
 * `YogaLayoutableShadowNode` applies the logical props in — `inlineStart`
 * overwrites `start`, `inlineAxis` overwrites the physical axis, while
 * `blockStart`/`blockEnd` are applied only when the physical edge is
 * undefined.
 *
 * Both directions are resolved here, because that is the only place where
 * the names may be read: the direction is a layout result and is not known
 * yet, but the two answers differ ONLY in which physical edge each logical
 * value lands on, which is decidable from the same single read of each name.
 */
struct ResolvedEdges {
  RectangleEdges<Float> ltr;
  /** The inline-axis pair under RTL; the block axis cannot differ. */
  Float rtlLeft;
  Float rtlRight;
};

ResolvedEdges edges(
    const PropsParserContext& context,
    const RawProps& rawProps,
    const RectangleEdges<Float>& sourceValue,
    const EdgeNames& names) {
  auto all = optionalProp(context, rawProps, names.all);
  auto horizontal = optionalProp(context, rawProps, names.horizontal);
  auto vertical = optionalProp(context, rawProps, names.vertical);
  auto left = optionalProp(context, rawProps, names.left);
  auto top = optionalProp(context, rawProps, names.top);
  auto right = optionalProp(context, rawProps, names.right);
  auto bottom = optionalProp(context, rawProps, names.bottom);
  auto start = optionalProp(context, rawProps, names.start);
  auto end = optionalProp(context, rawProps, names.end);
  auto inlineStart = optionalProp(context, rawProps, names.inlineStart);
  auto inlineEnd = optionalProp(context, rawProps, names.inlineEnd);
  auto inlineAxis = optionalProp(context, rawProps, names.inlineAxis);
  auto blockStart = optionalProp(context, rawProps, names.blockStart);
  auto blockEnd = optionalProp(context, rawProps, names.blockEnd);
  auto blockAxis = optionalProp(context, rawProps, names.blockAxis);

  auto inlineFallback = firstOf(inlineAxis, horizontal, all);
  auto blockFallback = firstOf(blockAxis, vertical, all);

  // Under RTL the inline-START edge is the right one and the inline-END edge
  // is the left, so the logical names swap sides while the physical `left` /
  // `right` and the axis shorthands stay exactly where they were authored.
  return ResolvedEdges{
      .ltr =
          RectangleEdges<Float>{
              .left = resolve(
                  firstOf(inlineStart, start, left, inlineFallback),
                  sourceValue.left),
              .top = resolve(
                  firstOf(top, blockStart, blockFallback), sourceValue.top),
              .right = resolve(
                  firstOf(inlineEnd, end, right, inlineFallback),
                  sourceValue.right),
              .bottom = resolve(
                  firstOf(bottom, blockEnd, blockFallback),
                  sourceValue.bottom)},
      .rtlLeft = resolve(
          firstOf(inlineEnd, end, left, inlineFallback), sourceValue.left),
      .rtlRight = resolve(
          firstOf(inlineStart, start, right, inlineFallback),
          sourceValue.right)};
}

} // namespace

InlineBoxProps parseInlineBoxProps(
    const PropsParserContext& context,
    const InlineBoxProps& sourceProps,
    const RawProps& rawProps) {
  InlineBoxProps props{};

  auto margin = edges(
      context,
      rawProps,
      sourceProps.ltr.margin,
      EdgeNames{
          .left = "marginLeft",
          .top = "marginTop",
          .right = "marginRight",
          .bottom = "marginBottom",
          .horizontal = "marginHorizontal",
          .vertical = "marginVertical",
          .all = "margin",
          .start = "marginStart",
          .end = "marginEnd",
          .inlineStart = "marginInlineStart",
          .inlineEnd = "marginInlineEnd",
          .inlineAxis = "marginInline",
          .blockStart = "marginBlockStart",
          .blockEnd = "marginBlockEnd",
          .blockAxis = "marginBlock"});
  props.ltr.margin = margin.ltr;
  props.rtlMarginLeft = margin.rtlLeft;
  props.rtlMarginRight = margin.rtlRight;

  auto padding = edges(
      context,
      rawProps,
      sourceProps.ltr.padding,
      EdgeNames{
          .left = "paddingLeft",
          .top = "paddingTop",
          .right = "paddingRight",
          .bottom = "paddingBottom",
          .horizontal = "paddingHorizontal",
          .vertical = "paddingVertical",
          .all = "padding",
          .start = "paddingStart",
          .end = "paddingEnd",
          .inlineStart = "paddingInlineStart",
          .inlineEnd = "paddingInlineEnd",
          .inlineAxis = "paddingInline",
          .blockStart = "paddingBlockStart",
          .blockEnd = "paddingBlockEnd",
          .blockAxis = "paddingBlock"});
  props.ltr.padding = padding.ltr;
  props.rtlPaddingLeft = padding.rtlLeft;
  props.rtlPaddingRight = padding.rtlRight;

  // Border has no axis or logical shorthands in RN — just the per-edge widths
  // and the all-edges `borderWidth`.
  {
    auto all = optionalProp(context, rawProps, "borderWidth");
    auto left = optionalProp(context, rawProps, "borderLeftWidth");
    auto top = optionalProp(context, rawProps, "borderTopWidth");
    auto right = optionalProp(context, rawProps, "borderRightWidth");
    auto bottom = optionalProp(context, rawProps, "borderBottomWidth");
    props.ltr.borderWidth = RectangleEdges<Float>{
        .left = resolve(firstOf(left, all), sourceProps.ltr.borderWidth.left),
        .top = resolve(firstOf(top, all), sourceProps.ltr.borderWidth.top),
        .right = resolve(firstOf(right, all), sourceProps.ltr.borderWidth.right),
        .bottom = resolve(firstOf(bottom, all), sourceProps.ltr.borderWidth.bottom)};
  }

  // Read once, used as the fallback for all four edges.
  auto borderColorAll = convertRawProp(
      context,
      rawProps,
      "borderColor",
      sourceProps.ltr.borderColor.left,
      sourceProps.ltr.borderColor.left);
  props.ltr.borderColor = RectangleEdges<SharedColor>{
      .left = convertRawProp(
          context, rawProps, "borderLeftColor", borderColorAll, borderColorAll),
      .top = convertRawProp(
          context, rawProps, "borderTopColor", borderColorAll, borderColorAll),
      .right = convertRawProp(
          context, rawProps, "borderRightColor", borderColorAll, borderColorAll),
      .bottom = convertRawProp(
          context,
          rawProps,
          "borderBottomColor",
          borderColorAll,
          borderColorAll)};

  props.ltr.borderRadius = convertRawProp(
      context,
      rawProps,
      "borderRadius",
      sourceProps.ltr.borderRadius,
      sourceProps.ltr.borderRadius);

  props.ltr.outlineColor = convertRawProp(
      context,
      rawProps,
      "outlineColor",
      sourceProps.ltr.outlineColor,
      sourceProps.ltr.outlineColor);
  props.ltr.outlineWidth = convertRawProp(
      context,
      rawProps,
      "outlineWidth",
      sourceProps.ltr.outlineWidth,
      sourceProps.ltr.outlineWidth);
  props.ltr.outlineOffset = convertRawProp(
      context,
      rawProps,
      "outlineOffset",
      sourceProps.ltr.outlineOffset,
      sourceProps.ltr.outlineOffset);

  return props;
}

} // namespace facebook::react
