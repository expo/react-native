/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "ListStyle.h"

namespace facebook::react {

ListStyleType listStyleTypeFromString(const std::string& value, ListStyleType fallback) {
  if (value == "none") {
    return ListStyleType::None;
  }
  if (value == "disc") {
    return ListStyleType::Disc;
  }
  if (value == "circle") {
    return ListStyleType::Circle;
  }
  if (value == "square") {
    return ListStyleType::Square;
  }
  if (value == "decimal") {
    return ListStyleType::Decimal;
  }
  if (value == "lower-alpha" || value == "lower-latin") {
    return ListStyleType::LowerAlpha;
  }
  if (value == "upper-alpha" || value == "upper-latin") {
    return ListStyleType::UpperAlpha;
  }
  if (value == "lower-roman") {
    return ListStyleType::LowerRoman;
  }
  if (value == "upper-roman") {
    return ListStyleType::UpperRoman;
  }
  return fallback;
}

ListStylePosition listStylePositionFromString(const std::string& value, ListStylePosition fallback) {
  if (value == "inside") {
    return ListStylePosition::Inside;
  }
  if (value == "outside") {
    return ListStylePosition::Outside;
  }
  return fallback;
}

ListStyleType nestedBulletForDepth(int depth) {
  switch (depth % 3) {
    case 0:
      return ListStyleType::Disc;
    case 1:
      return ListStyleType::Circle;
    default:
      return ListStyleType::Square;
  }
}

namespace {

/*
 * The alphabetic counter style (css-counter-styles-3 §6.2): bijective base-26,
 * so 26 is "z" and 27 is "aa" rather than "a0".
 */
std::string alphabetic(int ordinal, char base) {
  if (ordinal <= 0) {
    // Out of the style's range; a UA falls back to decimal.
    return std::to_string(ordinal);
  }
  std::string result;
  while (ordinal > 0) {
    const auto remainder = (ordinal - 1) % 26;
    result.insert(result.begin(), static_cast<char>(base + remainder));
    ordinal = (ordinal - 1) / 26;
  }
  return result;
}

/*
 * The additive Roman style (css-counter-styles-3 §6.1), including the
 * subtractive pairs. Outside 1..3999 a UA falls back to decimal, and so do we.
 */
std::string roman(int ordinal, bool upper) {
  if (ordinal <= 0 || ordinal > 3999) {
    return std::to_string(ordinal);
  }
  static constexpr int values[] = {1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1};
  static constexpr const char* upperSymbols[] =
      {"M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"};
  static constexpr const char* lowerSymbols[] =
      {"m", "cm", "d", "cd", "c", "xc", "l", "xl", "x", "ix", "v", "iv", "i"};

  std::string result;
  for (size_t i = 0; i < sizeof(values) / sizeof(values[0]); i++) {
    while (ordinal >= values[i]) {
      result += upper ? upperSymbols[i] : lowerSymbols[i];
      ordinal -= values[i];
    }
  }
  return result;
}

} // namespace

std::string listMarkerText(ListStyleType type, int ordinal) {
  switch (type) {
    case ListStyleType::None:
      return {};
    // The bullet glyphs a UA uses for the three unordered styles.
    case ListStyleType::Disc:
      return reinterpret_cast<const char*>(u8"•"); // BULLET
    case ListStyleType::Circle:
      return reinterpret_cast<const char*>(u8"◦"); // WHITE BULLET
    case ListStyleType::Square:
      return reinterpret_cast<const char*>(u8"▪"); // BLACK SMALL SQUARE
    // Counter styles carry the "." suffix their CSS definition specifies.
    case ListStyleType::Decimal:
      return std::to_string(ordinal) + ".";
    case ListStyleType::LowerAlpha:
      return alphabetic(ordinal, 'a') + ".";
    case ListStyleType::UpperAlpha:
      return alphabetic(ordinal, 'A') + ".";
    case ListStyleType::LowerRoman:
      return roman(ordinal, false) + ".";
    case ListStyleType::UpperRoman:
      return roman(ordinal, true) + ".";
  }
  return {};
}

} // namespace facebook::react
