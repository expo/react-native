/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/cxxstableapi/FrameworksGuard.h>

#include <optional>
#include <string>

#include <React/Utils.h>
#include <react/renderer/css/CSSDataType.h>
#include <react/renderer/css/CSSValueParser.h>
#include <react/utils/iequals.h>

namespace facebook::react {

/**
 * Representation of a CSS <url>, written unquoted as a url token,
 * `url(photo.png)`, or quoted as a `url()` function holding a string,
 * `url("photo.png")`. The URL is kept as written: an escape in it is not
 * decoded.
 * https://www.w3.org/TR/css-values-4/#urls
 */
struct CSSUrl {
  std::string url{};

  bool operator==(const CSSUrl &rhs) const = default;
};

template <>
struct CSSDataTypeParser<CSSUrl> {
  static auto consumePreservedToken(const CSSPreservedToken &token) -> std::optional<CSSUrl>
  {
    if (token.type() == CSSTokenType::Url) {
      return CSSUrl{.url = std::string{token.stringValue()}};
    }
    return {};
  }

  static auto consumeFunctionBlock(const CSSFunctionBlock &func, CSSValueParser &parser) -> std::optional<CSSUrl>
  {
    if (!iequals(func.name, "url")) {
      return {};
    }
    return parser.syntaxParser().consumeComponentValue<std::optional<CSSUrl>>(
        [](const CSSPreservedToken &token) -> std::optional<CSSUrl> {
          if (token.type() == CSSTokenType::String) {
            return CSSUrl{.url = std::string{token.stringValue()}};
          }
          return {};
        });
  }
};

static_assert(CSSDataType<CSSUrl>);

} // namespace facebook::react
