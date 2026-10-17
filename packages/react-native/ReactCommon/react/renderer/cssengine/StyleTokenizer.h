/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace facebook::react::cssengine {

/*
 * The tokens of css-syntax-3 §4. React Native's own `CSSTokenizer` reads
 * property values and has no strings, at-keywords, colons or semicolons, all
 * of which a stylesheet is made of.
 */
enum class TokenType : uint8_t {
  Ident,
  Function,
  AtKeyword,
  Hash,
  String,
  BadString,
  Url,
  BadUrl,
  Delim,
  Number,
  Percentage,
  Dimension,
  Whitespace,
  CDO,
  CDC,
  Colon,
  Semicolon,
  Comma,
  OpenSquare,
  CloseSquare,
  OpenParen,
  CloseParen,
  OpenCurly,
  CloseCurly,
};

struct Token {
  TokenType type{TokenType::Whitespace};
  // A name (ident, function, at-keyword, hash), a string's or url's contents,
  // a dimension's unit or a delim's character, with escapes decoded
  std::string value;
  double number{0};
  // A hash that would start an identifier is an id selector (§4.3.1)
  bool idHash{false};
  // The token's span in the source, which serializes a value as written
  uint32_t begin{0};
  uint32_t end{0};
};

std::vector<Token> tokenize(std::string_view source);

/*
 * The source of `tokens[first, last)` as written, with each run of whitespace
 * (comments included) collapsed to one space and the ends trimmed.
 */
std::string serializeTokens(std::string_view source, const std::vector<Token> &tokens, size_t first, size_t last);

} // namespace facebook::react::cssengine
