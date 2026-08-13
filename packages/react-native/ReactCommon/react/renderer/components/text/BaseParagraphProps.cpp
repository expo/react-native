/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "BaseParagraphProps.h"

#include <react/featureflags/ReactNativeFeatureFlags.h>

#include <react/renderer/attributedstring/conversions.h>
#include <react/renderer/attributedstring/primitives.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/debug/debugStringConvertibleUtils.h>

#include <glog/logging.h>

namespace facebook::react {

BaseParagraphProps::BaseParagraphProps(
    const PropsParserContext& context,
    const BaseParagraphProps& sourceProps,
    const RawProps& rawProps)
    : ViewProps(
          context,
          sourceProps,
          rawProps,
          nullptr,
          /*parseInheritedTextProps*/ false),
      BaseTextProps(context, sourceProps, rawProps, /*parseInlineBox*/ false),
      paragraphAttributes(convertRawProp(
          context,
          rawProps,
          sourceProps.paragraphAttributes,
          {})),
      isSelectable(convertRawProp(
          context,
          rawProps,
          "selectable",
          sourceProps.isSelectable,
          false)),
      onTextLayout(convertRawProp(
          context,
          rawProps,
          "onTextLayout",
          sourceProps.onTextLayout,
          {})) {
  if (ReactNativeFeatureFlags::enableStringChildren()) {
    // The inheritable text fields for the element cascade (a paragraph can be
    // a cascade SOURCE for real children — inline attachments and their
    // subtrees). BaseTextProps already probed these exact style keys into
    // `textAttributes`; copy the parsed values instead of probing rawProps a
    // second time — the double parse measured +33% on <Text>-heavy mounts.
    // `whiteSpace` is the one key TextAttributes does not carry (it is
    // cascade-only), so it keeps its probe.
    inheritedColor = textAttributes.foregroundColor;
    inheritedFontSize = textAttributes.fontSize;
    inheritedFontFamily = textAttributes.fontFamily;
    inheritedFontWeight = textAttributes.fontWeight;
    inheritedFontStyle = textAttributes.fontStyle;
    inheritedFontVariant = textAttributes.fontVariant;
    inheritedLetterSpacing = textAttributes.letterSpacing;
    inheritedLineHeight = textAttributes.lineHeight;
    inheritedTextAlign = textAttributes.alignment;
    inheritedTextTransform = textAttributes.textTransform;
    inheritedWhiteSpace = convertRawProp(
        context, rawProps, "whiteSpace", sourceProps.inheritedWhiteSpace, {});
    hasInheritedTextProps = computeHasInheritedTextProps();
  }

  /*
   * These props are applied to `View`, therefore they must not be a part of
   * base text attributes.
   */
  textAttributes.opacity = std::numeric_limits<Float>::quiet_NaN();
  textAttributes.backgroundColor = {};
};

void BaseParagraphProps::setProp(
    const PropsParserContext& context,
    RawPropsPropNameHash hash,
    const char* propName,
    const RawValue& value) {
  // All Props structs setProp methods must always, unconditionally,
  // call all super::setProp methods, since multiple structs may
  // reuse the same values.
  ViewProps::setProp(context, hash, propName, value);
  BaseTextProps::setProp(context, hash, propName, value);

  static auto defaults = BaseParagraphProps{};

  // ParagraphAttributes has its own switch statement - to keep all
  // of these fields together, and because there are some collisions between
  // propnames parsed here and outside of ParagraphAttributes.
  // This code is also duplicated in AndroidTextInput.
  static auto paDefaults = ParagraphAttributes{};
  switch (hash) {
    REBUILD_FIELD_SWITCH_CASE(
        paDefaults,
        value,
        paragraphAttributes,
        maximumNumberOfLines,
        "numberOfLines");
    REBUILD_FIELD_SWITCH_CASE(
        paDefaults, value, paragraphAttributes, ellipsizeMode, "ellipsizeMode");
    REBUILD_FIELD_SWITCH_CASE(
        paDefaults,
        value,
        paragraphAttributes,
        textBreakStrategy,
        "textBreakStrategy");
    REBUILD_FIELD_SWITCH_CASE(
        paDefaults,
        value,
        paragraphAttributes,
        adjustsFontSizeToFit,
        "adjustsFontSizeToFit");
    REBUILD_FIELD_SWITCH_CASE(
        paDefaults,
        value,
        paragraphAttributes,
        minimumFontScale,
        "minimumFontScale");
    REBUILD_FIELD_SWITCH_CASE(
        paDefaults,
        value,
        paragraphAttributes,
        minimumFontSize,
        "minimumFontSize");
    REBUILD_FIELD_SWITCH_CASE(
        paDefaults,
        value,
        paragraphAttributes,
        maximumFontSize,
        "maximumFontSize");
    REBUILD_FIELD_SWITCH_CASE(
        paDefaults,
        value,
        paragraphAttributes,
        includeFontPadding,
        "includeFontPadding");
    REBUILD_FIELD_SWITCH_CASE(
        paDefaults,
        value,
        paragraphAttributes,
        android_hyphenationFrequency,
        "android_hyphenationFrequency");
    REBUILD_FIELD_SWITCH_CASE(
        paDefaults,
        value,
        paragraphAttributes,
        textAlignVertical,
        "textAlignVertical");
  }

  switch (hash) {
    RAW_SET_PROP_SWITCH_CASE(isSelectable, "selectable");
    RAW_SET_PROP_SWITCH_CASE_BASIC(onTextLayout);
  }

  /*
   * These props are applied to `View`, therefore they must not be a part of
   * base text attributes.
   */
  textAttributes.opacity = std::numeric_limits<Float>::quiet_NaN();
  textAttributes.backgroundColor = {};
}

#pragma mark - DebugStringConvertible

#if RN_DEBUG_STRING_CONVERTIBLE
SharedDebugStringConvertibleList BaseParagraphProps::getDebugProps() const {
  return ViewProps::getDebugProps() + BaseTextProps::getDebugProps() +
      paragraphAttributes.getDebugProps() +
      SharedDebugStringConvertibleList{
          debugStringConvertibleItem("selectable", isSelectable)};
}
#endif
} // namespace facebook::react
