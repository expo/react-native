/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/cxxstableapi/FrameworksGuard.h>

#include <React/Graphics.h>
#include <React/RendererCore.h>
#include <react/featureflags/ReactNativePublicFeatureFlags.h>

namespace facebook::react {

void parseProcessedBackgroundImage(
    const PropsParserContext &context,
    const RawValue &value,
    std::vector<BackgroundImage> &result);

void parseUnprocessedBackgroundImageList(
    const PropsParserContext &context,
    const std::vector<RawValue> &value,
    std::vector<BackgroundImage> &result);

void parseUnprocessedBackgroundImageString(const std::string &value, std::vector<BackgroundImage> &result);

inline void fromRawValue(const PropsParserContext &context, const RawValue &value, std::vector<BackgroundImage> &result)
{
  // CSS text is parsed here whichever way the flag is set: the style engine
  // (cssengine) hands a gradient over as its declared text, which no
  // JavaScript processing has turned into the processed form
  if (value.hasType<std::string>()) {
    parseUnprocessedBackgroundImageString((std::string)value, result);
    return;
  }
  if (ReactNativeFeatureFlags_DO_NOT_USE::enableNativeCSSParsing()) {
    if (value.hasType<std::vector<RawValue>>()) {
      parseUnprocessedBackgroundImageList(context, (std::vector<RawValue>)value, result);
    } else {
      result = {};
    }
  } else {
    parseProcessedBackgroundImage(context, value, result);
  }
}

} // namespace facebook::react
