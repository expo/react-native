/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <string_view>

#include <react/renderer/cssengine/StyleContext.h>

namespace facebook::react::cssengine {

/*
 * What relative lengths resolve against for one element (css-values-4 §6):
 * its font size for `em`, the root's for `rem`, the viewport for the
 * viewport units and its nearest container for the container ones, and the
 * app's answers for `env()`.
 */
struct LengthBasis {
  double fontSize{16};
  double rootFontSize{16};
  double viewportWidth{0};
  double viewportHeight{0};
  double containerWidth{0};
  double containerHeight{0};
  std::function<std::optional<double>(std::string_view)> environment;
};

/*
 * Substitutes every `var()` (css-variables-1 §3) from `scope`. Nullopt when
 * the value is invalid at computed-value time: a reference to a property
 * nothing declared (or declared `initial`) with no fallback, or a cycle.
 */
std::optional<std::string> substituteVariables(std::string_view value, const CustomProperties &scope);

/*
 * `light-dark(a, b)` (css-color-5 §2), the light branch or the dark one.
 */
std::string substituteLightDark(std::string_view value, bool dark);

/*
 * `oklch()` and `oklab()` (css-color-4 §9) written as the sRGB `rgba()` they
 * clip to; React Native's colour parser knows neither.
 * DOM-CSS-LIMITATION(oklab-colours-are-srgb)
 */
std::string substituteOklabColors(std::string_view value);

/*
 * Each `color-mix()` (css-color-5 §3), innermost first, as `rgba()`. One it
 * cannot mix is left in place, so the declaration it is in drops.
 */
std::string substituteColorMix(std::string_view value);

/*
 * `currentColor` written as the colour it means.
 */
std::string substituteCurrentColor(std::string_view value, std::string_view currentColor);

/*
 * Each `calc()`, `min()`, `max()` and `clamp()` (css-values-4 §10) evaluated
 * to points. A sum of one percentage and lengths that come to nothing is that
 * percentage (`calc(100% + var(--pad, 0px))` where the padding is unset).
 * Nullopt when one cannot be evaluated before layout.
 */
std::optional<std::string> substituteMath(std::string_view value, const LengthBasis &basis);

/*
 * A length on its own (`12px`, `1.5rem`, `2em`, `50vw`, `0`) in points.
 */
std::optional<double> resolveLength(std::string_view value, const LengthBasis &basis);

/*
 * A plain number (`1.5`, `-2`, `.5`).
 */
std::optional<double> parseNumber(std::string_view value);

/*
 * A colour as React Native's packed 0xAARRGGBB, or nullopt.
 */
std::optional<uint32_t> parseColor(std::string_view value);

/*
 * The text of `value` without leading and trailing whitespace.
 */
std::string_view trimmed(std::string_view value);

/*
 * The index of `name(` at or after `from`, where `name` is not the tail of a
 * longer identifier, and of its closing parenthesis.
 */
struct FunctionCall {
  size_t start;
  size_t open;
  size_t close;
};
std::optional<FunctionCall> findFunction(std::string_view value, std::string_view name, size_t from = 0);

/*
 * Splits at top-level occurrences of `separator`, outside parentheses.
 */
std::vector<std::string_view> splitTopLevel(std::string_view value, char separator);

/*
 * Splits at top-level whitespace, outside parentheses.
 */
std::vector<std::string_view> splitTopLevelWhitespace(std::string_view value);

} // namespace facebook::react::cssengine
