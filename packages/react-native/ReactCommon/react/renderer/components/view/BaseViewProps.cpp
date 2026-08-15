/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "BaseViewProps.h"

#include <cmath>

#include <react/renderer/components/view/TransitionConversions.h>

#include <algorithm>

#include <react/renderer/attributedstring/conversions.h>
#include <react/renderer/components/view/BackgroundImagePropsConversions.h>
#include <react/renderer/components/view/BoxShadowPropsConversions.h>
#include <react/renderer/components/view/FilterPropsConversions.h>
#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/renderer/components/view/conversions.h>
#include <react/renderer/components/view/primitives.h>
#include <react/renderer/components/view/propsConversions.h>
#include <react/renderer/core/graphicsConversions.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/debug/debugStringConvertibleUtils.h>
#include <react/renderer/graphics/ValueUnit.h>

namespace facebook::react {

namespace {

std::array<float, 3> getTranslateForTransformOrigin(
    float viewWidth,
    float viewHeight,
    TransformOrigin transformOrigin) {
  float viewCenterX = viewWidth / 2;
  float viewCenterY = viewHeight / 2;

  std::array<float, 3> origin = {viewCenterX, viewCenterY, transformOrigin.z};

  for (size_t i = 0; i < transformOrigin.xy.size(); ++i) {
    auto& currentOrigin = transformOrigin.xy[i];
    if (currentOrigin.unit == UnitType::Point) {
      origin[i] = currentOrigin.value;
    } else if (currentOrigin.unit == UnitType::Percent) {
      origin[i] =
          ((i == 0) ? viewWidth : viewHeight) * currentOrigin.value / 100.0f;
    }
  }

  float newTranslateX = -viewCenterX + origin[0];
  float newTranslateY = -viewCenterY + origin[1];
  float newTranslateZ = origin[2];

  return std::array{newTranslateX, newTranslateY, newTranslateZ};
}

} // namespace

// The public constructor exists only to read `enableStringChildren` once and
// hand the answer to the real one. See the note on ResolvedFlag in the header:
// the flag getter is a cross-module call ending in a sequentially-consistent
// atomic load, so asking it twelve times per View cost more than the twelve
// raw-prop probes it was gating.
BaseViewProps::BaseViewProps(
    const PropsParserContext& context,
    const BaseViewProps& sourceProps,
    const RawProps& rawProps,
    const std::function<bool(const std::string&)>& filterObjectKeys,
    bool parseInheritedTextProps)
    : BaseViewProps(
          context,
          sourceProps,
          rawProps,
          filterObjectKeys,
          parseInheritedTextProps,
          ReactNativeFeatureFlags::enableStringChildren(),
          ResolvedFlag{}) {}

BaseViewProps::BaseViewProps(
    const PropsParserContext& context,
    const BaseViewProps& sourceProps,
    const RawProps& rawProps,
    const std::function<bool(const std::string&)>& filterObjectKeys,
    bool parseInheritedTextProps,
    bool stringChildrenEnabled,
    ResolvedFlag)
    : YogaStylableProps(context, sourceProps, rawProps, filterObjectKeys),
      AccessibilityProps(context, sourceProps, rawProps),
      opacity(convertRawProp(
          context,
          rawProps,
          "opacity",
          sourceProps.opacity,
          (Float)1.0)),
      backgroundColor(convertRawProp(
          context,
          rawProps,
          "backgroundColor",
          sourceProps.backgroundColor,
          {})),
      // The inheritable text props are gated per-field, IN PLACE: with
      // `enableStringChildren` off they cost zero raw-prop probes
      // (pay-for-what-you-use), and with it on the probes sit exactly here,
      // in declaration order — RawPropsParser optimizes monotonic key
      // access, and hoisting these probes after the later keys makes its
      // index roll over per parse (measured: +26% on <Text>-row mounts).
      inheritedColor(
          parseInheritedTextProps && stringChildrenEnabled
              ? convertRawProp(
                    context,
                    rawProps,
                    "color",
                    sourceProps.inheritedColor,
                    {})
              : sourceProps.inheritedColor),
      inheritedFontSize(
          parseInheritedTextProps && stringChildrenEnabled
              ? convertRawProp(
                    context,
                    rawProps,
                    "fontSize",
                    sourceProps.inheritedFontSize,
                    std::numeric_limits<Float>::quiet_NaN())
              : sourceProps.inheritedFontSize),
      inheritedFontFamily(
          parseInheritedTextProps && stringChildrenEnabled
              ? convertRawProp(
                    context,
                    rawProps,
                    "fontFamily",
                    sourceProps.inheritedFontFamily,
                    {})
              : sourceProps.inheritedFontFamily),
      inheritedFontWeight(
          parseInheritedTextProps && stringChildrenEnabled
              ? convertRawProp(
                    context,
                    rawProps,
                    "fontWeight",
                    sourceProps.inheritedFontWeight,
                    {})
              : sourceProps.inheritedFontWeight),
      inheritedFontStyle(
          parseInheritedTextProps && stringChildrenEnabled
              ? convertRawProp(
                    context,
                    rawProps,
                    "fontStyle",
                    sourceProps.inheritedFontStyle,
                    {})
              : sourceProps.inheritedFontStyle),
      inheritedFontVariant(
          parseInheritedTextProps && stringChildrenEnabled
              ? convertRawProp(
                    context,
                    rawProps,
                    "fontVariant",
                    sourceProps.inheritedFontVariant,
                    {})
              : sourceProps.inheritedFontVariant),
      inheritedLetterSpacing(
          parseInheritedTextProps && stringChildrenEnabled
              ? convertRawProp(
                    context,
                    rawProps,
                    "letterSpacing",
                    sourceProps.inheritedLetterSpacing,
                    std::numeric_limits<Float>::quiet_NaN())
              : sourceProps.inheritedLetterSpacing),
      inheritedLineHeight(
          parseInheritedTextProps && stringChildrenEnabled
              ? convertRawProp(
                    context,
                    rawProps,
                    "lineHeight",
                    sourceProps.inheritedLineHeight,
                    std::numeric_limits<Float>::quiet_NaN())
              : sourceProps.inheritedLineHeight),
      inheritedTextAlign(
          parseInheritedTextProps && stringChildrenEnabled
              ? convertRawProp(
                    context,
                    rawProps,
                    "textAlign",
                    sourceProps.inheritedTextAlign,
                    {})
              : sourceProps.inheritedTextAlign),
      inheritedTextTransform(
          parseInheritedTextProps && stringChildrenEnabled
              ? convertRawProp(
                    context,
                    rawProps,
                    "textTransform",
                    sourceProps.inheritedTextTransform,
                    {})
              : sourceProps.inheritedTextTransform),
      inheritedWhiteSpace(
          parseInheritedTextProps && stringChildrenEnabled
              ? convertRawProp(
                    context,
                    rawProps,
                    "whiteSpace",
                    sourceProps.inheritedWhiteSpace,
                    {})
              : sourceProps.inheritedWhiteSpace),
      borderRadii(convertRawProp(
          context,
          rawProps,
          CascadedRectangleCornersNames{
              .topLeft = "borderTopLeftRadius",
              .topRight = "borderTopRightRadius",
              .bottomLeft = "borderBottomLeftRadius",
              .bottomRight = "borderBottomRightRadius",
              .topStart = "borderTopStartRadius",
              .topEnd = "borderTopEndRadius",
              .bottomStart = "borderBottomStartRadius",
              .bottomEnd = "borderBottomEndRadius",
              .endEnd = "borderEndEndRadius",
              .endStart = "borderEndStartRadius",
              .startEnd = "borderStartEndRadius",
              .startStart = "borderStartStartRadius",
              .all = "borderRadius"},
          sourceProps.borderRadii,
          {})),
      borderColors(convertRawProp(
          context,
          rawProps,
          CascadedRectangleEdgesNames{
              .left = "borderLeftColor",
              .right = "borderRightColor",
              .top = "borderTopColor",
              .bottom = "borderBottomColor",
              .start = "borderStartColor",
              .end = "borderEndColor",
              .horizontal = "borderHorizontalColor",
              .vertical = "borderVerticalColor",
              .block = "borderBlockColor",
              .blockEnd = "borderBlockEndColor",
              .blockStart = "borderBlockStartColor",
              .all = "borderColor"},
          sourceProps.borderColors,
          {})),
      borderCurves(convertRawProp(
          context,
          rawProps,
          CascadedRectangleCornersNames{
              .topLeft = "borderTopLeftCurve",
              .topRight = "borderTopRightCurve",
              .bottomLeft = "borderBottomLeftCurve",
              .bottomRight = "borderBottomRightCurve",
              .topStart = "borderTopStartCurve",
              .topEnd = "borderTopEndCurve",
              .bottomStart = "borderBottomStartCurve",
              .bottomEnd = "borderBottomEndCurve",
              .endEnd = "borderEndEndCurve",
              .endStart = "borderEndStartCurve",
              .startEnd = "borderStartEndCurve",
              .startStart = "borderStartStartCurve",
              .all = "borderCurve"},
          sourceProps.borderCurves,
          {})),
      borderStyles(convertRawProp(
          context,
          rawProps,
          CascadedRectangleEdgesNames{
              .left = "borderLeftStyle",
              .right = "borderRightStyle",
              .top = "borderTopStyle",
              .bottom = "borderBottomStyle",
              .start = "borderStartStyle",
              .end = "borderEndStyle",
              .horizontal = "borderHorizontalStyle",
              .vertical = "borderVerticalStyle",
              .block = "borderBlockStyle",
              .blockEnd = "borderBlockEndStyle",
              .blockStart = "borderBlockStartStyle",
              .all = "borderStyle"},
          sourceProps.borderStyles,
          {})),
      outlineColor(convertRawProp(
          context,
          rawProps,
          "outlineColor",
          sourceProps.outlineColor,
          {})),
      outlineOffset(convertRawProp(
          context,
          rawProps,
          "outlineOffset",
          sourceProps.outlineOffset,
          {})),
      outlineStyle(convertRawProp(
          context,
          rawProps,
          "outlineStyle",
          sourceProps.outlineStyle,
          {})),
      outlineWidth(convertRawProp(
          context,
          rawProps,
          "outlineWidth",
          sourceProps.outlineWidth,
          {})),
      shadowColor(convertRawProp(
          context,
          rawProps,
          "shadowColor",
          sourceProps.shadowColor,
          {})),
      shadowOffset(convertRawProp(
          context,
          rawProps,
          "shadowOffset",
          sourceProps.shadowOffset,
          {})),
      shadowOpacity(convertRawProp(
          context,
          rawProps,
          "shadowOpacity",
          sourceProps.shadowOpacity,
          {})),
      shadowRadius(convertRawProp(
          context,
          rawProps,
          "shadowRadius",
          sourceProps.shadowRadius,
          {})),
      cursor(
          convertRawProp(context, rawProps, "cursor", sourceProps.cursor, {})),
      // Only meaningful when a View paints its own text, so it costs nothing
      // to parse when that cannot happen.
      userSelect(
          stringChildrenEnabled
              ? convertRawProp(
                    context, rawProps, "userSelect", sourceProps.userSelect, {})
              : sourceProps.userSelect),
      boxShadow(convertRawProp(
          context,
          rawProps,
          "boxShadow",
          sourceProps.boxShadow,
          {})),
      filter(
          convertRawProp(context, rawProps, "filter", sourceProps.filter, {})),
      backgroundImage(convertRawProp(
          context,
          rawProps,
          "backgroundImage",
          convertRawProp(
              context,
              rawProps,
              "experimental_backgroundImage",
              sourceProps.backgroundImage,
              {}),
          {})),
      backgroundSize(convertRawProp(
          context,
          rawProps,
          "experimental_backgroundSize",
          sourceProps.backgroundSize,
          {})),
      backgroundPosition(convertRawProp(
          context,
          rawProps,
          "experimental_backgroundPosition",
          sourceProps.backgroundPosition,
          {})),
      backgroundRepeat(convertRawProp(
          context,
          rawProps,
          "experimental_backgroundRepeat",
          sourceProps.backgroundRepeat,
          {})),
      mixBlendMode(convertRawProp(
          context,
          rawProps,
          "mixBlendMode",
          sourceProps.mixBlendMode,
          {})),
      isolation(convertRawProp(
          context,
          rawProps,
          "isolation",
          sourceProps.isolation,
          {})),
      transform(convertRawProp(
          context,
          rawProps,
          "transform",
          sourceProps.transform,
          {})),
      transformOrigin(convertRawProp(
          context,
          rawProps,
          "transformOrigin",
          sourceProps.transformOrigin,
          {})),
      backfaceVisibility(convertRawProp(
          context,
          rawProps,
          "backfaceVisibility",
          sourceProps.backfaceVisibility,
          {})),
      shouldRasterize(convertRawProp(
          context,
          rawProps,
          "shouldRasterizeIOS",
          sourceProps.shouldRasterize,
          {})),
      zIndex(
          convertRawProp(context, rawProps, "zIndex", sourceProps.zIndex, {})),
      pointerEvents(convertRawProp(
          context,
          rawProps,
          "pointerEvents",
          sourceProps.pointerEvents,
          {})),
      hitSlop(convertRawProp(
          context,
          rawProps,
          "hitSlop",
          sourceProps.hitSlop,
          {})),
      onLayout(convertRawProp(
          context,
          rawProps,
          "onLayout",
          sourceProps.onLayout,
          {})),
      events(convertRawProp(context, rawProps, sourceProps.events, {})),
      collapsable(convertRawProp(
          context,
          rawProps,
          "collapsable",
          sourceProps.collapsable,
          true)),
      collapsableChildren(convertRawProp(
          context,
          rawProps,
          "collapsableChildren",
          sourceProps.collapsableChildren,
          true)),
      removeClippedSubviews(convertRawProp(
          context,
          rawProps,
          "removeClippedSubviews",
          sourceProps.removeClippedSubviews,
          false)) {
  hasInheritedTextProps = computeHasInheritedTextProps();

  // `transition` and `animation` (css-transitions-1, css-animations-1).
  //
  // Parsed into a local and side-allocated only if something was authored.
  // Inline these were 368 bytes on EVERY view — eleven authored longhands, the
  // zipped transitions and an optional animation — and empty on essentially
  // all of them, copied again on every props clone.
  //
  // Three outcomes, in the order they are worth having:
  //  - nothing authored and none inherited: the pointer stays null and no
  //    allocation happens at all, which is every view in almost every app;
  //  - the same longhands as the source: SHARE its allocation. A props clone
  //    carries only the keys that changed, so an animating view re-parses to
  //    the identical strings on every commit, and allocating a fresh copy of
  //    them each time is exactly the cost this change exists to remove;
  //  - genuinely different: allocate, and zip the longhands once here rather
  //    than re-parsing strings while a frame is being interpolated.
  {
    const auto* inherited = sourceProps.cssMotion.get();
    auto motion = CssMotion{};
    const auto raw = [&](const char* name, const std::string& fallback) {
      return convertRawProp(context, rawProps, name, fallback, std::string{});
    };
    static const std::string kEmpty{};
    motion.transitionPropertyRaw = raw("transitionProperty", inherited ? inherited->transitionPropertyRaw : kEmpty);
    motion.transitionDurationRaw = raw("transitionDuration", inherited ? inherited->transitionDurationRaw : kEmpty);
    motion.transitionDelayRaw = raw("transitionDelay", inherited ? inherited->transitionDelayRaw : kEmpty);
    motion.transitionTimingFunctionRaw =
        raw("transitionTimingFunction", inherited ? inherited->transitionTimingFunctionRaw : kEmpty);
    motion.animationKeyframesRaw = raw("animationKeyframes", inherited ? inherited->animationKeyframesRaw : kEmpty);
    motion.animationDurationRaw = raw("animationDuration", inherited ? inherited->animationDurationRaw : kEmpty);
    motion.animationDelayRaw = raw("animationDelay", inherited ? inherited->animationDelayRaw : kEmpty);
    motion.animationTimingFunctionRaw =
        raw("animationTimingFunction", inherited ? inherited->animationTimingFunctionRaw : kEmpty);
    motion.animationIterationCountRaw =
        raw("animationIterationCount", inherited ? inherited->animationIterationCountRaw : kEmpty);
    motion.animationDirectionRaw = raw("animationDirection", inherited ? inherited->animationDirectionRaw : kEmpty);
    motion.animationFillModeRaw = raw("animationFillMode", inherited ? inherited->animationFillModeRaw : kEmpty);

    if (inherited != nullptr && motion.rawsEqual(*inherited)) {
      cssMotion = sourceProps.cssMotion;
    } else if (!motion.isEmpty()) {
      motion.transitions = buildTransitions(
          motion.transitionPropertyRaw,
          motion.transitionDurationRaw,
          motion.transitionDelayRaw,
          motion.transitionTimingFunctionRaw);
      motion.animation = buildAnimation(
          motion.animationKeyframesRaw,
          motion.animationDurationRaw,
          motion.animationDelayRaw,
          motion.animationTimingFunctionRaw,
          motion.animationIterationCountRaw,
          motion.animationDirectionRaw,
          motion.animationFillModeRaw);
      cssMotion = std::make_shared<const CssMotion>(std::move(motion));
    }
  }

  // `flow-tolerance: normal` is 1em (css-grid-3 §4.2). Yoga has no font model,
  // so the em size is supplied here, where the element's own font-size has
  // just been parsed. Without this, `normal` would always mean 16 and a lanes
  // container with a larger font would tie lanes too tightly.
  if (yogaStyle.display() == yoga::Display::GridLanes &&
      yogaStyle.flowTolerance().kind == yoga::FlowToleranceKind::Normal &&
      !std::isnan(inheritedFontSize) && inheritedFontSize > 0) {
    auto tolerance = yogaStyle.flowTolerance();
    tolerance.emSize = inheritedFontSize;
    yogaStyle.setFlowTolerance(tolerance);
  }

  // `all` — parsed by hand: its value space here is tiny and a boundary is
  // structural enough that a malformed value should mean "no declaration".
  // The keyword is stored verbatim and resolved against the element's
  // user-agent origin in isInheritanceBoundary(): `unset` erases the cascaded
  // value from every origin — for inherited properties that means inherit —
  // so it is the author's switch for turning OFF a user-agent boundary
  // (<Text style={{all: 'unset'}}>), while `revert` only rolls back to it.
  if (const auto* rawValue =
          stringChildrenEnabled ? rawProps.at("all", nullptr, nullptr)
                                : nullptr) {
    if (rawValue->hasType<std::string>()) {
      const auto stringValue = (std::string)*rawValue;
      // `inherit` explicitly inherits every property; since this `all` is
      // scoped to inherited properties only, that is the same resolved value
      // as `unset` (css-cascade-4 §7.3) — and like `unset` it overrides a
      // user-agent boundary.
      cascadeReset = stringValue == "initial" ? CascadeReset::Initial
          : stringValue == "revert"           ? CascadeReset::Revert
          : stringValue == "unset"            ? CascadeReset::Unset
          : stringValue == "inherit"          ? CascadeReset::Unset
                                              : CascadeReset::None;
    } else {
      cascadeReset = CascadeReset::None;
    }
  } else {
    cascadeReset = sourceProps.cascadeReset;
  }
}

bool BaseViewProps::computeHasInheritedTextProps() const {
  return inheritedColor || !std::isnan(inheritedFontSize) ||
      !inheritedFontFamily.empty() || inheritedFontWeight.has_value() ||
      inheritedFontStyle.has_value() || inheritedFontVariant.has_value() ||
      !std::isnan(inheritedLetterSpacing) || !std::isnan(inheritedLineHeight) ||
      inheritedTextAlign.has_value() || inheritedTextTransform.has_value() ||
      inheritedWhiteSpace.has_value();
}

#define VIEW_EVENT_CASE(eventType)                      \
  case CONSTEXPR_RAW_PROPS_KEY_HASH("on" #eventType): { \
    const auto offset = ViewEvents::Offset::eventType;  \
    ViewEvents defaultViewEvents{};                     \
    bool res = defaultViewEvents[offset];               \
    if (value.hasValue()) {                             \
      fromRawValue(context, value, res);                \
    }                                                   \
    events[offset] = res;                               \
    return;                                             \
  }

void BaseViewProps::setProp(
    const PropsParserContext& context,
    RawPropsPropNameHash hash,
    const char* propName,
    const RawValue& value) {
  // All Props structs setProp methods must always, unconditionally,
  // call all super::setProp methods, since multiple structs may
  // reuse the same values.
  YogaStylableProps::setProp(context, hash, propName, value);
  AccessibilityProps::setProp(context, hash, propName, value);

  static auto defaults = BaseViewProps{};

  switch (hash) {
    RAW_SET_PROP_SWITCH_CASE_BASIC(opacity);
    RAW_SET_PROP_SWITCH_CASE_BASIC(backgroundColor);
    RAW_SET_PROP_SWITCH_CASE(inheritedColor, "color");
    RAW_SET_PROP_SWITCH_CASE(inheritedFontSize, "fontSize");
    RAW_SET_PROP_SWITCH_CASE(inheritedFontFamily, "fontFamily");
    RAW_SET_PROP_SWITCH_CASE(inheritedFontWeight, "fontWeight");
    RAW_SET_PROP_SWITCH_CASE(inheritedFontStyle, "fontStyle");
    RAW_SET_PROP_SWITCH_CASE(inheritedFontVariant, "fontVariant");
    RAW_SET_PROP_SWITCH_CASE(inheritedLetterSpacing, "letterSpacing");
    RAW_SET_PROP_SWITCH_CASE(inheritedLineHeight, "lineHeight");
    RAW_SET_PROP_SWITCH_CASE(inheritedTextAlign, "textAlign");
    RAW_SET_PROP_SWITCH_CASE(inheritedTextTransform, "textTransform");
    RAW_SET_PROP_SWITCH_CASE(inheritedWhiteSpace, "whiteSpace");
    RAW_SET_PROP_SWITCH_CASE_BASIC(backgroundImage);
    RAW_SET_PROP_SWITCH_CASE(backgroundImage, "experimental_backgroundImage");
    RAW_SET_PROP_SWITCH_CASE(backgroundSize, "experimental_backgroundSize");
    RAW_SET_PROP_SWITCH_CASE(
        backgroundPosition, "experimental_backgroundPosition");
    RAW_SET_PROP_SWITCH_CASE(backgroundRepeat, "experimental_backgroundRepeat");
    RAW_SET_PROP_SWITCH_CASE_BASIC(shadowColor);
    RAW_SET_PROP_SWITCH_CASE_BASIC(shadowOffset);
    RAW_SET_PROP_SWITCH_CASE_BASIC(shadowOpacity);
    RAW_SET_PROP_SWITCH_CASE_BASIC(shadowRadius);
    RAW_SET_PROP_SWITCH_CASE_BASIC(transform);
    RAW_SET_PROP_SWITCH_CASE_BASIC(transformOrigin);
    RAW_SET_PROP_SWITCH_CASE_BASIC(backfaceVisibility);
    RAW_SET_PROP_SWITCH_CASE_BASIC(shouldRasterize);
    RAW_SET_PROP_SWITCH_CASE_BASIC(zIndex);
    RAW_SET_PROP_SWITCH_CASE_BASIC(pointerEvents);
    RAW_SET_PROP_SWITCH_CASE_BASIC(isolation);
    RAW_SET_PROP_SWITCH_CASE_BASIC(hitSlop);
    RAW_SET_PROP_SWITCH_CASE_BASIC(onLayout);
    RAW_SET_PROP_SWITCH_CASE_BASIC(collapsable);
    RAW_SET_PROP_SWITCH_CASE_BASIC(collapsableChildren);
    RAW_SET_PROP_SWITCH_CASE_BASIC(removeClippedSubviews);
    RAW_SET_PROP_SWITCH_CASE_BASIC(cursor);
    RAW_SET_PROP_SWITCH_CASE_BASIC(userSelect);
    RAW_SET_PROP_SWITCH_CASE_BASIC(outlineColor);
    RAW_SET_PROP_SWITCH_CASE_BASIC(outlineOffset);
    RAW_SET_PROP_SWITCH_CASE_BASIC(outlineStyle);
    RAW_SET_PROP_SWITCH_CASE_BASIC(outlineWidth);
    RAW_SET_PROP_SWITCH_CASE_BASIC(filter);
    RAW_SET_PROP_SWITCH_CASE_BASIC(boxShadow);
    RAW_SET_PROP_SWITCH_CASE_BASIC(mixBlendMode);
    // events field
    VIEW_EVENT_CASE(PointerEnter);
    VIEW_EVENT_CASE(PointerEnterCapture);
    VIEW_EVENT_CASE(PointerMove);
    VIEW_EVENT_CASE(PointerMoveCapture);
    VIEW_EVENT_CASE(PointerLeave);
    VIEW_EVENT_CASE(PointerLeaveCapture);
    VIEW_EVENT_CASE(PointerOver);
    VIEW_EVENT_CASE(PointerOverCapture);
    VIEW_EVENT_CASE(PointerOut);
    VIEW_EVENT_CASE(PointerOutCapture);
    VIEW_EVENT_CASE(Click);
    VIEW_EVENT_CASE(ClickCapture);
    VIEW_EVENT_CASE(PointerDown);
    VIEW_EVENT_CASE(PointerDownCapture);
    VIEW_EVENT_CASE(PointerUp);
    VIEW_EVENT_CASE(PointerUpCapture);
    VIEW_EVENT_CASE(GotPointerCapture);
    VIEW_EVENT_CASE(LostPointerCapture);
    VIEW_EVENT_CASE(MoveShouldSetResponder);
    VIEW_EVENT_CASE(MoveShouldSetResponderCapture);
    VIEW_EVENT_CASE(StartShouldSetResponder);
    VIEW_EVENT_CASE(StartShouldSetResponderCapture);
    VIEW_EVENT_CASE(ResponderGrant);
    VIEW_EVENT_CASE(ResponderReject);
    VIEW_EVENT_CASE(ResponderStart);
    VIEW_EVENT_CASE(ResponderEnd);
    VIEW_EVENT_CASE(ResponderRelease);
    VIEW_EVENT_CASE(ResponderMove);
    VIEW_EVENT_CASE(ResponderTerminate);
    VIEW_EVENT_CASE(ResponderTerminationRequest);
    VIEW_EVENT_CASE(ShouldBlockNativeResponder);
    VIEW_EVENT_CASE(TouchStart);
    VIEW_EVENT_CASE(TouchMove);
    VIEW_EVENT_CASE(TouchEnd);
    VIEW_EVENT_CASE(TouchCancel);
    // BorderRadii
    SET_CASCADED_RECTANGLE_CORNERS(borderRadii, "border", "Radius", value);
    SET_CASCADED_RECTANGLE_EDGES(borderColors, "border", "Color", value);
    SET_CASCADED_RECTANGLE_CORNERS(borderCurves, "border", "Curve", value);
    SET_CASCADED_RECTANGLE_EDGES(borderStyles, "border", "Style", value);
  }
}

#pragma mark - Convenience Methods

static BorderRadii ensureNoOverlap(const BorderRadii& radii, const Size& size) {
  // "Corner curves must not overlap: When the sum of any two adjacent border
  // radii exceeds the size of the border box, UAs must proportionally reduce
  // the used values of all border radii until none of them overlap."
  // Source: https://www.w3.org/TR/css-backgrounds-3/#corner-overlap

  float leftEdgeRadii = radii.topLeft.vertical + radii.bottomLeft.vertical;
  float topEdgeRadii = radii.topLeft.horizontal + radii.topRight.horizontal;
  float rightEdgeRadii = radii.topRight.vertical + radii.bottomRight.vertical;
  float bottomEdgeRadii =
      radii.bottomLeft.horizontal + radii.bottomRight.horizontal;

  float leftEdgeRadiiScale =
      (leftEdgeRadii > 0) ? std::min(size.height / leftEdgeRadii, (Float)1) : 0;
  float topEdgeRadiiScale =
      (topEdgeRadii > 0) ? std::min(size.width / topEdgeRadii, (Float)1) : 0;
  float rightEdgeRadiiScale = (rightEdgeRadii > 0)
      ? std::min(size.height / rightEdgeRadii, (Float)1)
      : 0;
  float bottomEdgeRadiiScale = (bottomEdgeRadii > 0)
      ? std::min(size.width / bottomEdgeRadii, (Float)1)
      : 0;

  return BorderRadii{
      .topLeft =
          {static_cast<float>(
               radii.topLeft.vertical *
               std::min(topEdgeRadiiScale, leftEdgeRadiiScale)),
           static_cast<float>(
               radii.topLeft.horizontal *
               std::min(topEdgeRadiiScale, leftEdgeRadiiScale))},
      .topRight =
          {static_cast<float>(
               radii.topRight.vertical *
               std::min(topEdgeRadiiScale, rightEdgeRadiiScale)),
           static_cast<float>(
               radii.topRight.horizontal *
               std::min(topEdgeRadiiScale, rightEdgeRadiiScale))},
      .bottomLeft =
          {static_cast<float>(
               radii.bottomLeft.vertical *
               std::min(bottomEdgeRadiiScale, leftEdgeRadiiScale)),
           static_cast<float>(
               radii.bottomLeft.horizontal *
               std::min(bottomEdgeRadiiScale, leftEdgeRadiiScale))},
      .bottomRight =
          {static_cast<float>(
               radii.bottomRight.vertical *
               std::min(bottomEdgeRadiiScale, rightEdgeRadiiScale)),
           static_cast<float>(
               radii.bottomRight.horizontal *
               std::min(bottomEdgeRadiiScale, rightEdgeRadiiScale))},
  };
}

static BorderRadii radiiPercentToPoint(
    const RectangleCorners<ValueUnit>& radii,
    const Size& size) {
  return BorderRadii{
      .topLeft =
          {radii.topLeft.resolve(size.height),
           radii.topLeft.resolve(size.width)},
      .topRight =
          {radii.topRight.resolve(size.height),
           radii.topRight.resolve(size.width)},
      .bottomLeft =
          {radii.bottomLeft.resolve(size.height),
           radii.bottomLeft.resolve(size.width)},
      .bottomRight =
          {radii.bottomRight.resolve(size.height),
           radii.bottomRight.resolve(size.width)},
  };
}

CascadedBorderWidths BaseViewProps::getBorderWidths() const {
  return CascadedBorderWidths{
      .left = optionalFloatFromYogaValue(yogaStyle.border(yoga::Edge::Left)),
      .top = optionalFloatFromYogaValue(yogaStyle.border(yoga::Edge::Top)),
      .right = optionalFloatFromYogaValue(yogaStyle.border(yoga::Edge::Right)),
      .bottom =
          optionalFloatFromYogaValue(yogaStyle.border(yoga::Edge::Bottom)),
      .start = optionalFloatFromYogaValue(yogaStyle.border(yoga::Edge::Start)),
      .end = optionalFloatFromYogaValue(yogaStyle.border(yoga::Edge::End)),
      .horizontal =
          optionalFloatFromYogaValue(yogaStyle.border(yoga::Edge::Horizontal)),
      .vertical =
          optionalFloatFromYogaValue(yogaStyle.border(yoga::Edge::Vertical)),
      .all = optionalFloatFromYogaValue(yogaStyle.border(yoga::Edge::All)),
  };
}

BorderMetrics BaseViewProps::resolveBorderMetrics(
    const LayoutMetrics& layoutMetrics) const {
  auto isRTL =
      bool{layoutMetrics.layoutDirection == LayoutDirection::RightToLeft};

  auto borderWidths = getBorderWidths();

  BorderRadii radii = radiiPercentToPoint(
      borderRadii.resolve(isRTL, ValueUnit{0.0f, UnitType::Point}),
      layoutMetrics.frame.size);

  return {
      .borderColors = borderColors.resolve(isRTL, {}),
      .borderWidths = borderWidths.resolve(isRTL, 0),
      .borderRadii = ensureNoOverlap(radii, layoutMetrics.frame.size),
      .borderCurves = borderCurves.resolve(isRTL, BorderCurve::Circular),
      .borderStyles = borderStyles.resolve(isRTL, BorderStyle::Solid),
  };
}

Transform BaseViewProps::resolveTransform(
    const LayoutMetrics& layoutMetrics) const {
  const auto& frameSize = layoutMetrics.frame.size;
  return resolveTransform(frameSize, transform, transformOrigin);
}

Transform BaseViewProps::resolveTransform(
    const Size& frameSize,
    const Transform& transform,
    const TransformOrigin& transformOrigin) {
  auto transformMatrix = Transform{};

  // transform is matrix
  if (transform.operations.size() == 1 &&
      transform.operations[0].type == TransformOperationType::Arbitrary) {
    transformMatrix = transform;
  } else {
    for (const auto& operation : transform.operations) {
      transformMatrix = transformMatrix *
          Transform::FromTransformOperation(operation, frameSize, transform);
    }
  }

  if (transformOrigin.isSet()) {
    std::array<float, 3> translateOffsets = getTranslateForTransformOrigin(
        frameSize.width, frameSize.height, transformOrigin);
    transformMatrix =
        Transform::Translate(
            translateOffsets[0], translateOffsets[1], translateOffsets[2]) *
        transformMatrix *
        Transform::Translate(
            -translateOffsets[0], -translateOffsets[1], -translateOffsets[2]);
  }

  return transformMatrix;
}

bool BaseViewProps::getClipsContentToBounds() const {
  return yogaStyle.overflow() != yoga::Overflow::Visible;
}

void BaseViewProps::applyInheritedTextAttributes(
    TextAttributes& textAttributes) const {
  if (inheritedColor) {
    textAttributes.foregroundColor = inheritedColor;
  }
  if (!std::isnan(inheritedFontSize)) {
    textAttributes.fontSize = inheritedFontSize;
  }
  if (!inheritedFontFamily.empty()) {
    textAttributes.fontFamily = inheritedFontFamily;
  }
  if (inheritedFontWeight) {
    textAttributes.fontWeight = inheritedFontWeight;
  }
  if (inheritedFontStyle) {
    textAttributes.fontStyle = inheritedFontStyle;
  }
  if (inheritedFontVariant) {
    textAttributes.fontVariant = inheritedFontVariant;
  }
  if (!std::isnan(inheritedLetterSpacing)) {
    textAttributes.letterSpacing = inheritedLetterSpacing;
  }
  if (!std::isnan(inheritedLineHeight)) {
    textAttributes.lineHeight = inheritedLineHeight;
  }
  if (inheritedTextAlign) {
    textAttributes.alignment = inheritedTextAlign;
  }
  if (inheritedTextTransform) {
    textAttributes.textTransform = inheritedTextTransform;
  }
  if (inheritedWhiteSpace) {
    textAttributes.whiteSpace = inheritedWhiteSpace;
  }
}

#pragma mark - DebugStringConvertible

#if RN_DEBUG_STRING_CONVERTIBLE
SharedDebugStringConvertibleList BaseViewProps::getDebugProps() const {
  const auto& defaultBaseViewProps = BaseViewProps();

  return AccessibilityProps::getDebugProps() +
      YogaStylableProps::getDebugProps() +
      SharedDebugStringConvertibleList{
          debugStringConvertibleItem(
              "opacity", opacity, defaultBaseViewProps.opacity),
          debugStringConvertibleItem(
              "backgroundColor",
              backgroundColor,
              defaultBaseViewProps.backgroundColor),
          debugStringConvertibleItem(
              "zIndex", zIndex, defaultBaseViewProps.zIndex.value_or(0)),
          debugStringConvertibleItem(
              "pointerEvents",
              pointerEvents,
              defaultBaseViewProps.pointerEvents),
          debugStringConvertibleItem(
              "transform", transform, defaultBaseViewProps.transform),
          debugStringConvertibleItem(
              "backgroundImage",
              backgroundImage,
              defaultBaseViewProps.backgroundImage),
      };
}
#endif

} // namespace facebook::react
