/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/attributedstring/TextAttributes.h>
#include <react/renderer/components/text/InlineBoxProps.h>
#include <react/renderer/core/Props.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/graphics/Color.h>

namespace facebook::react {

/*
 * `Props`-like class which is used as a base class for all Props classes
 * that can have text attributes (such as Text and Paragraph).
 */
class BaseTextProps {
 public:
  BaseTextProps() = default;
  BaseTextProps(const PropsParserContext &context, const BaseTextProps &sourceProps, const RawProps &rawProps);

  void
  setProp(const PropsParserContext &context, RawPropsPropNameHash hash, const char *propName, const RawValue &value);

#pragma mark - Props

  TextAttributes textAttributes{};

  /*
   * CSS box decorations when this element is used *inline* (box-model-scope.md
   * G2). Empty for the overwhelming majority of text, so consumers can take a
   * zero-cost path via `isEmpty()`.
   */
  InlineBoxProps inlineBox{};

#pragma mark - DebugStringConvertible (partially)

#if RN_DEBUG_STRING_CONVERTIBLE
  SharedDebugStringConvertibleList getDebugProps() const;
#endif

#ifdef RN_SERIALIZABLE_STATE
  void appendTextAttributesProps(folly::dynamic &result, const BaseTextProps *prevProps) const;
#endif
};

} // namespace facebook::react
