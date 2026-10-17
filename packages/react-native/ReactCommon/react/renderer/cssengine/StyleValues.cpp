/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "StyleValues.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <variant>

#include <react/renderer/css/CSSColor.h>
#include <react/renderer/css/CSSValueParser.h>

namespace facebook::react::cssengine {

namespace {

constexpr int kMaxVariableDepth = 32;
constexpr double kPi = 3.14159265358979323846;

bool isSpace(char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f';
}

bool isIdentifierCharacter(char c) {
  return std::isalnum(static_cast<unsigned char>(c)) || c == '-' || c == '_' ||
      static_cast<unsigned char>(c) >= 0x80;
}

std::string lowercase(std::string_view text) {
  std::string out(text);
  for (char& c : out) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  return out;
}

// A number as CSS writes it, without trailing zeros: 12, 0.5, -3.25
std::string formatNumber(double value) {
  if (std::fabs(value) < 1e-9) {
    return "0";
  }
  char buffer[64];
  std::snprintf(buffer, sizeof(buffer), "%.6f", value);
  std::string text(buffer);
  size_t dot = text.find('.');
  if (dot != std::string::npos) {
    while (!text.empty() && text.back() == '0') {
      text.pop_back();
    }
    if (!text.empty() && text.back() == '.') {
      text.pop_back();
    }
  }
  return text;
}

std::optional<std::string>
substitute(std::string_view value, const CustomProperties& scope, int depth);

thread_local std::unordered_set<std::string>* customPropertyReads = nullptr;

std::optional<std::string> lookupVariable(
    const std::string& name,
    const CustomProperties& scope,
    int depth) {
  recordCustomPropertyRead(name);
  const std::string* found = scope.find(name);
  if (found == nullptr) {
    return std::nullopt;
  }
  // A custom property declared `initial` holds the guaranteed-invalid value
  // (css-variables-1 §2.1), so a reference takes its fallback
  if (trimmed(*found) == "initial") {
    return std::nullopt;
  }
  return substitute(*found, scope, depth + 1);
}

std::optional<std::string>
substitute(std::string_view value, const CustomProperties& scope, int depth) {
  if (depth > kMaxVariableDepth) {
    return std::nullopt;
  }
  if (value.find("var(") == std::string_view::npos) {
    return std::string(value);
  }
  std::string result;
  size_t cursor = 0;
  while (true) {
    auto call = findFunction(value, "var", cursor);
    if (!call) {
      result.append(value.substr(cursor));
      break;
    }
    result.append(value.substr(cursor, call->start - cursor));
    std::string_view arguments =
        value.substr(call->open + 1, call->close - call->open - 1);
    auto parts = splitTopLevel(arguments, ',');
    std::string name(trimmed(parts[0]));
    std::optional<std::string> replacement = lookupVariable(name, scope, depth);
    if (!replacement) {
      if (parts.size() < 2) {
        return std::nullopt;
      }
      // The fallback is everything after the first comma
      size_t comma = arguments.find(',', parts[0].size());
      replacement =
          substitute(trimmed(arguments.substr(comma + 1)), scope, depth + 1);
      if (!replacement) {
        return std::nullopt;
      }
    }
    result.append(*replacement);
    cursor = call->close + 1;
  }
  return result;
}

// -- Colours --

struct Rgba {
  double r{0};
  double g{0};
  double b{0};
  double a{0};
};

std::optional<Rgba> parseRgba(std::string_view text) {
  auto color = parseColor(text);
  if (!color) {
    return std::nullopt;
  }
  return Rgba{
      static_cast<double>((*color >> 16) & 0xFF) / 255,
      static_cast<double>((*color >> 8) & 0xFF) / 255,
      static_cast<double>(*color & 0xFF) / 255,
      static_cast<double>((*color >> 24) & 0xFF) / 255};
}

std::string toCssRgba(const Rgba& color) {
  auto channel = [](double v) {
    return static_cast<int>(
        std::max(0.0, std::min(255.0, std::round(v * 255))));
  };
  return "rgba(" + std::to_string(channel(color.r)) + ", " +
      std::to_string(channel(color.g)) + ", " +
      std::to_string(channel(color.b)) + ", " +
      formatNumber(std::round(color.a * 10000) / 10000) + ")";
}

// Björn Ottosson's matrices: sRGB → linear → LMS → OKLab, and back
double srgbToLinear(double c) {
  return c <= 0.04045 ? c / 12.92 : std::pow((c + 0.055) / 1.055, 2.4);
}

double linearToSrgb(double c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * std::pow(c, 1 / 2.4) - 0.055;
}

void rgbToOklab(double r, double g, double b, double out[3]) {
  double lr = srgbToLinear(r);
  double lg = srgbToLinear(g);
  double lb = srgbToLinear(b);
  double l =
      std::cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  double m =
      std::cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  double s =
      std::cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  out[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

void oklabToRgb(double lightness, double a, double b, double out[3]) {
  double l = std::pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3);
  double m = std::pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3);
  double s = std::pow(lightness - 0.0894841775 * a - 1.291485548 * b, 3);
  out[0] = linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  out[1] =
      linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  out[2] = linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
}

// A number, a percentage of `full`, or `none` (zero)
std::optional<double> oklabNumber(std::string_view text, double full) {
  text = trimmed(text);
  if (text == "none") {
    return 0.0;
  }
  bool percent = !text.empty() && text.back() == '%';
  auto number = parseNumber(percent ? text.substr(0, text.size() - 1) : text);
  if (!number) {
    return std::nullopt;
  }
  return percent ? *number / 100 * full : *number;
}

// An angle in degrees: a bare number, or deg, rad, grad or turn
std::optional<double> hueDegrees(std::string_view text) {
  text = trimmed(text);
  if (text == "none") {
    return 0.0;
  }
  struct Unit {
    std::string_view suffix;
    double scale;
  };
  static const Unit units[] = {
      {"grad", 0.9}, {"turn", 360}, {"rad", 180 / kPi}, {"deg", 1}};
  for (const auto& unit : units) {
    if (text.size() > unit.suffix.size() &&
        text.substr(text.size() - unit.suffix.size()) == unit.suffix) {
      auto number =
          parseNumber(text.substr(0, text.size() - unit.suffix.size()));
      if (!number) {
        return std::nullopt;
      }
      return *number * unit.scale;
    }
  }
  return parseNumber(text);
}

std::optional<std::string> oklabCall(bool chroma, std::string_view arguments) {
  size_t slash = arguments.find('/');
  std::string_view channels =
      slash == std::string_view::npos ? arguments : arguments.substr(0, slash);
  std::vector<std::string_view> parts;
  for (auto part : splitTopLevelWhitespace(channels)) {
    for (auto piece : splitTopLevel(part, ',')) {
      if (!trimmed(piece).empty()) {
        parts.push_back(trimmed(piece));
      }
    }
  }
  if (parts.size() != 3) {
    return std::nullopt;
  }
  auto lightness = oklabNumber(parts[0], 1);
  std::optional<double> a;
  std::optional<double> b;
  if (chroma) {
    auto c = oklabNumber(parts[1], 0.4);
    auto hue = hueDegrees(parts[2]);
    if (!c || !hue) {
      return std::nullopt;
    }
    a = *c * std::cos(*hue * kPi / 180);
    b = *c * std::sin(*hue * kPi / 180);
  } else {
    a = oklabNumber(parts[1], 0.4);
    b = oklabNumber(parts[2], 0.4);
  }
  auto alpha = slash == std::string_view::npos
      ? std::optional<double>(1)
      : oklabNumber(arguments.substr(slash + 1), 1);
  if (!lightness || !a || !b || !alpha) {
    return std::nullopt;
  }
  double rgb[3];
  oklabToRgb(*lightness, *a, *b, rgb);
  auto clamp = [](double v) { return std::max(0.0, std::min(1.0, v)); };
  return toCssRgba(
      {clamp(rgb[0]), clamp(rgb[1]), clamp(rgb[2]), clamp(*alpha)});
}

// css-color-5 §3.2
std::optional<Rgba> mixColors(
    bool oklab,
    const Rgba& c1,
    std::optional<double> p1,
    const Rgba& c2,
    std::optional<double> p2) {
  // Out of [0, 100] makes the function invalid (§3.1), not something to
  // normalise
  auto outOfRange = [](std::optional<double> p) {
    return p && (*p < 0 || *p > 100);
  };
  if (outOfRange(p1) || outOfRange(p2)) {
    return std::nullopt;
  }
  bool neither = !p1 && !p2;
  double w1 = neither ? 50 : p1 ? *p1 : 100 - p2.value_or(0);
  double w2 = neither ? 50 : p2 ? *p2 : 100 - p1.value_or(0);
  double sum = w1 + w2;
  if (!(sum > 0)) {
    return std::nullopt;
  }
  // A shortfall below 100 becomes transparency; an excess is normalised
  double alphaScale = sum < 100 ? sum / 100 : 1;
  double n1 = w1 / sum;
  double n2 = w2 / sum;
  double alpha = c1.a * n1 + c2.a * n2;
  if (oklab) {
    double lab1[3];
    double lab2[3];
    rgbToOklab(c1.r, c1.g, c1.b, lab1);
    rgbToOklab(c2.r, c2.g, c2.b, lab2);
    double rgb[3];
    oklabToRgb(
        lab1[0] * n1 + lab2[0] * n2,
        lab1[1] * n1 + lab2[1] * n2,
        lab1[2] * n1 + lab2[2] * n2,
        rgb);
    return Rgba{rgb[0], rgb[1], rgb[2], alpha * alphaScale};
  }
  // sRGB, premultiplied, so a mix with `transparent` keeps its hue
  if (alpha == 0) {
    return Rgba{0, 0, 0, 0};
  }
  return Rgba{
      (c1.r * c1.a * n1 + c2.r * c2.a * n2) / alpha,
      (c1.g * c1.a * n1 + c2.g * c2.a * n2) / alpha,
      (c1.b * c1.a * n1 + c2.b * c2.a * n2) / alpha,
      alpha * alphaScale};
}

std::optional<double> percentageMath(std::string_view text);

// A colour and the percentage beside it, in either order. The percentage may
// be a math function (css-values-4 §10): Astryx mixes its press colour at
// `calc(var(--strength) * 100%)`.
void splitColorAndPercentage(
    std::string_view text,
    std::string& color,
    std::optional<double>& percentage) {
  percentage = std::nullopt;
  std::string out;
  for (auto part : splitTopLevelWhitespace(text)) {
    if (!part.empty() && part.back() == '%' && !percentage) {
      auto number = parseNumber(part.substr(0, part.size() - 1));
      if (number) {
        percentage = number;
        continue;
      }
    }
    if (!percentage) {
      if (auto evaluated = percentageMath(part)) {
        percentage = evaluated;
        continue;
      }
    }
    if (!out.empty()) {
      out.push_back(' ');
    }
    out.append(part);
  }
  color = std::move(out);
}

std::optional<std::string> colorMixCall(std::string_view arguments) {
  auto parts = splitTopLevel(arguments, ',');
  if (parts.size() != 3) {
    return std::nullopt;
  }
  auto method = splitTopLevelWhitespace(parts[0]);
  if (method.size() != 2 || method[0] != "in") {
    return std::nullopt;
  }
  // DOM-CSS-LIMITATION(color-mix-spaces): only srgb and oklab
  bool oklab = method[1] == "oklab";
  if (!oklab && method[1] != "srgb") {
    return std::nullopt;
  }
  std::string first;
  std::string second;
  std::optional<double> p1;
  std::optional<double> p2;
  splitColorAndPercentage(parts[1], first, p1);
  splitColorAndPercentage(parts[2], second, p2);
  auto c1 = parseRgba(first);
  auto c2 = parseRgba(second);
  if (!c1 || !c2) {
    return std::nullopt;
  }
  auto mixed = mixColors(oklab, *c1, p1, *c2, p2);
  if (!mixed) {
    return std::nullopt;
  }
  return toCssRgba(*mixed);
}

// -- Math (css-values-4 §10) --

class MathParser {
 public:
  MathParser(std::string_view source, const LengthBasis& basis)
      : source_(source), basis_(basis) {}

  /*
   * An expression whose percentages are of nothing but themselves, so one
   * reads as its number (`calc(0.5 * 100%)` is 50): a `<percentage>` in a
   * function's arguments, such as `color-mix()`'s.
   */
  MathParser(
      std::string_view source,
      const LengthBasis& basis,
      bool percentages)
      : source_(source), basis_(basis), percentages_(percentages) {}

  // Whether a percentage was read: an expression of numbers alone is a
  // `<number>`, not a `<percentage>`
  bool readPercentage() const {
    return readPercentage_;
  }

  // A whole expression; nullopt unless it is all consumed
  std::optional<double> parseAll() {
    auto value = parsePrimary();
    skipSpaces();
    if (!value || position_ != source_.size()) {
      return std::nullopt;
    }
    return value;
  }

  std::optional<double> parseSum() {
    auto left = parseProduct();
    while (left) {
      skipSpaces();
      char op = peek();
      if (op != '+' && op != '-') {
        break;
      }
      position_++;
      auto right = parseProduct();
      if (!right) {
        return std::nullopt;
      }
      left = op == '+' ? *left + *right : *left - *right;
    }
    return left;
  }

  size_t position() const {
    return position_;
  }

  void skipSpaces() {
    while (position_ < source_.size() && isSpace(source_[position_])) {
      position_++;
    }
  }

 private:
  char peek() const {
    return position_ < source_.size() ? source_[position_] : '\0';
  }

  bool consume(std::string_view text) {
    if (source_.substr(position_, text.size()) == text) {
      position_ += text.size();
      return true;
    }
    return false;
  }

  std::optional<double> parseProduct() {
    auto left = parsePrimary();
    while (left) {
      skipSpaces();
      char op = peek();
      if (op != '*' && op != '/') {
        break;
      }
      position_++;
      auto right = parsePrimary();
      if (!right) {
        return std::nullopt;
      }
      left = op == '*' ? *left * *right : *left / *right;
    }
    return left;
  }

  std::optional<double> parsePrimary() {
    skipSpaces();
    if (peek() == '(') {
      position_++;
      auto value = parseSum();
      skipSpaces();
      if (peek() != ')') {
        return std::nullopt;
      }
      position_++;
      return value;
    }
    for (std::string_view name : {"calc(", "min(", "max(", "clamp("}) {
      if (!consume(name)) {
        continue;
      }
      std::vector<double> arguments;
      while (true) {
        auto value = parseSum();
        if (!value) {
          return std::nullopt;
        }
        arguments.push_back(*value);
        skipSpaces();
        if (peek() == ',') {
          position_++;
          continue;
        }
        if (peek() != ')') {
          return std::nullopt;
        }
        position_++;
        break;
      }
      if (name == "min(") {
        return *std::min_element(arguments.begin(), arguments.end());
      }
      if (name == "max(") {
        return *std::max_element(arguments.begin(), arguments.end());
      }
      if (name == "clamp(") {
        if (arguments.size() != 3) {
          return std::nullopt;
        }
        return std::min(std::max(arguments[1], arguments[0]), arguments[2]);
      }
      if (arguments.size() != 1) {
        return std::nullopt;
      }
      return arguments[0];
    }
    if (consume("env(")) {
      skipSpaces();
      size_t start = position_;
      while (position_ < source_.size() &&
             (std::isalnum(static_cast<unsigned char>(source_[position_])) ||
              source_[position_] == '-')) {
        position_++;
      }
      std::string_view name = source_.substr(start, position_ - start);
      skipSpaces();
      std::optional<double> fallback;
      if (peek() == ',') {
        position_++;
        fallback = parseSum();
        if (!fallback) {
          return std::nullopt;
        }
        skipSpaces();
      }
      if (peek() != ')') {
        return std::nullopt;
      }
      position_++;
      std::optional<double> known;
      if (basis_.environment) {
        known = basis_.environment(name);
      }
      if (known) {
        return known;
      }
      return fallback;
    }
    // A number and its unit
    size_t start = position_;
    if (peek() == '+' || peek() == '-') {
      position_++;
    }
    size_t digits = position_;
    while (std::isdigit(static_cast<unsigned char>(peek())) || peek() == '.') {
      position_++;
    }
    if (position_ == digits) {
      position_ = start;
      return std::nullopt;
    }
    if (peek() == 'e' &&
        (std::isdigit(
            static_cast<unsigned char>(
                position_ + 1 < source_.size() ? source_[position_ + 1]
                                               : '\0')))) {
      position_++;
      while (std::isdigit(static_cast<unsigned char>(peek()))) {
        position_++;
      }
    }
    auto number = parseNumber(source_.substr(start, position_ - start));
    if (!number) {
      return std::nullopt;
    }
    size_t unitStart = position_;
    while (std::isalpha(static_cast<unsigned char>(peek()))) {
      position_++;
    }
    std::string_view unit = source_.substr(unitStart, position_ - unitStart);
    if (peek() == '%') {
      if (percentages_ && unit.empty()) {
        position_++;
        readPercentage_ = true;
        return number;
      }
      // A percentage needs the box it is of, which layout has
      return std::nullopt;
    }
    auto scale = unitScale(unit);
    if (!scale) {
      return std::nullopt;
    }
    return *number * *scale;
  }

  std::optional<double> unitScale(std::string_view unit) const {
    std::string name = lowercase(unit);
    if (name.empty() || name == "px") {
      return 1.0;
    }
    if (name == "rem") {
      return basis_.rootFontSize;
    }
    if (name == "em") {
      return basis_.fontSize;
    }
    if (name == "lh") {
      return basis_.lineHeight;
    }
    if (name == "rlh") {
      return basis_.rootLineHeight;
    }
    if (name == "pt") {
      return 96.0 / 72;
    }
    if (name == "in") {
      return 96.0;
    }
    if (name == "cm") {
      return 96 / 2.54;
    }
    if (name == "mm") {
      return 96 / 25.4;
    }
    if (name == "q") {
      return 96 / 25.4 / 4;
    }
    if (name == "pc") {
      return 16.0;
    }
    // The viewport's units, and the s/d/l variants of each, which a viewport
    // with no browser chrome to collapse makes all the same
    if (name.size() >= 2 &&
        (name[0] == 's' || name[0] == 'd' || name[0] == 'l') &&
        name[1] == 'v') {
      name.erase(0, 1);
    }
    if (name == "vw" || name == "vi") {
      return basis_.viewportWidth / 100;
    }
    if (name == "vh" || name == "vb") {
      return basis_.viewportHeight / 100;
    }
    if (name == "vmin") {
      return std::min(basis_.viewportWidth, basis_.viewportHeight) / 100;
    }
    if (name == "vmax") {
      return std::max(basis_.viewportWidth, basis_.viewportHeight) / 100;
    }
    if (name == "cqw" || name == "cqi") {
      return basis_.containerWidth / 100;
    }
    if (name == "cqh" || name == "cqb") {
      return basis_.containerHeight / 100;
    }
    return std::nullopt;
  }

  std::string_view source_;
  const LengthBasis& basis_;
  size_t position_{0};
  bool percentages_{false};
  bool readPercentage_{false};
};

// A math function that is a `<percentage>`, as the number of percent
std::optional<double> percentageMath(std::string_view text) {
  bool math = false;
  for (std::string_view name : {"calc(", "min(", "max(", "clamp("}) {
    math = math || text.substr(0, name.size()) == name;
  }
  if (!math || text.back() != ')') {
    return std::nullopt;
  }
  static const LengthBasis noBasis;
  MathParser parser(text, noBasis, /*percentages*/ true);
  auto value = parser.parseAll();
  if (!value || !parser.readPercentage()) {
    return std::nullopt;
  }
  return value;
}

/*
 * `calc(100% + a + b)` where the lengths cancel is the percentage; any other
 * mix of a percentage and a length is left to layout (`mathForLayout`).
 */
std::optional<std::string> percentageWithCancelledLengths(
    std::string_view inner,
    const LengthBasis& basis) {
  std::optional<double> percentage;
  int sign = 1;
  int depth = 0;
  size_t start = 0;
  auto term = [&](std::string_view text, int termSign) -> bool {
    text = trimmed(text);
    if (text.empty()) {
      return true;
    }
    if (text.back() == '%') {
      auto number = parseNumber(text.substr(0, text.size() - 1));
      if (!number || percentage) {
        return false;
      }
      percentage = termSign * *number;
      return true;
    }
    MathParser parser(text, basis);
    auto value = parser.parseSum();
    parser.skipSpaces();
    return value && std::fabs(*value) < 1e-9 &&
        parser.position() == text.size();
  };
  for (size_t i = 0; i <= inner.size(); i++) {
    char c = i < inner.size() ? inner[i] : '\0';
    if (c == '(') {
      depth++;
    } else if (c == ')') {
      depth--;
    } else if (
        i == inner.size() ||
        (depth == 0 && (c == '+' || c == '-') && i > start &&
         isSpace(inner[i - 1]))) {
      if (!term(inner.substr(start, i - start), sign)) {
        return std::nullopt;
      }
      sign = c == '-' ? -1 : 1;
      start = i + 1;
    }
  }
  if (!percentage) {
    return std::nullopt;
  }
  return formatNumber(*percentage) + "%";
}

} // namespace

std::string_view trimmed(std::string_view value) {
  while (!value.empty() && isSpace(value.front())) {
    value.remove_prefix(1);
  }
  while (!value.empty() && isSpace(value.back())) {
    value.remove_suffix(1);
  }
  return value;
}

std::optional<FunctionCall>
findFunction(std::string_view value, std::string_view name, size_t from) {
  while (true) {
    size_t start = value.find(name, from);
    if (start == std::string_view::npos) {
      return std::nullopt;
    }
    size_t open = start + name.size();
    bool boundary = start == 0 || !isIdentifierCharacter(value[start - 1]);
    if (!boundary || open >= value.size() || value[open] != '(') {
      from = start + 1;
      continue;
    }
    int depth = 0;
    for (size_t i = open; i < value.size(); i++) {
      if (value[i] == '(') {
        depth++;
      } else if (value[i] == ')') {
        depth--;
        if (depth == 0) {
          return FunctionCall{start, open, i};
        }
      }
    }
    return std::nullopt;
  }
}

std::vector<std::string_view> splitTopLevel(
    std::string_view value,
    char separator) {
  std::vector<std::string_view> parts;
  int depth = 0;
  size_t start = 0;
  for (size_t i = 0; i < value.size(); i++) {
    char c = value[i];
    if (c == '(') {
      depth++;
    } else if (c == ')') {
      depth--;
    } else if (c == separator && depth == 0) {
      parts.push_back(value.substr(start, i - start));
      start = i + 1;
    }
  }
  parts.push_back(value.substr(start));
  return parts;
}

std::vector<std::string_view> splitTopLevelWhitespace(std::string_view value) {
  std::vector<std::string_view> parts;
  int depth = 0;
  size_t start = std::string_view::npos;
  for (size_t i = 0; i <= value.size(); i++) {
    char c = i < value.size() ? value[i] : ' ';
    if (c == '(') {
      depth++;
    } else if (c == ')') {
      depth--;
    }
    if (depth == 0 && isSpace(c)) {
      if (start != std::string_view::npos) {
        parts.push_back(value.substr(start, i - start));
        start = std::string_view::npos;
      }
      continue;
    }
    if (start == std::string_view::npos) {
      start = i;
    }
  }
  return parts;
}

std::optional<double> parseNumber(std::string_view value) {
  value = trimmed(value);
  if (value.empty()) {
    return std::nullopt;
  }
  std::string text(value);
  char* end = nullptr;
  double number = std::strtod(text.c_str(), &end);
  if (end == text.c_str() || *end != '\0' || !std::isfinite(number)) {
    return std::nullopt;
  }
  return number;
}

std::optional<double> resolveLength(
    std::string_view value,
    const LengthBasis& basis) {
  value = trimmed(value);
  if (value.empty() || value.back() == '%') {
    return std::nullopt;
  }
  MathParser parser(value, basis);
  return parser.parseAll();
}

std::optional<std::string> mathForLayout(
    std::string_view value,
    const LengthBasis& basis) {
  std::string_view text = trimmed(value);
  std::string result;
  result.reserve(text.size());
  bool hasPercentage = false;
  bool startsTerm = true;
  size_t depth = 0;
  size_t i = 0;
  auto isDigit = [](char c) { return c >= '0' && c <= '9'; };
  auto isLetter = [](char c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
  };
  while (i < text.size()) {
    char c = text[i];
    const bool signedNumber = (c == '-' || c == '+') && startsTerm &&
        i + 1 < text.size() && (isDigit(text[i + 1]) || text[i + 1] == '.');
    if (isDigit(c) || c == '.' || signedNumber) {
      size_t start = i++;
      while (i < text.size() && (isDigit(text[i]) || text[i] == '.')) {
        i++;
      }
      size_t unitStart = i;
      while (i < text.size() && (isLetter(text[i]) || text[i] == '%')) {
        i++;
      }
      std::string_view token = text.substr(start, i - start);
      std::string_view unit = text.substr(unitStart, i - unitStart);
      if (unit == "%") {
        hasPercentage = true;
        result.append(token);
      } else if (unit.empty()) {
        result.append(token);
      } else {
        auto points = resolveLength(token, basis);
        if (!points) {
          return std::nullopt;
        }
        result.append(formatNumber(*points)).append("px");
      }
      startsTerm = false;
    } else if (isLetter(c)) {
      size_t start = i;
      while (i < text.size() && (isLetter(text[i]) || text[i] == '-')) {
        i++;
      }
      std::string name = lowercase(text.substr(start, i - start));
      if ((name != "calc" && name != "min" && name != "max" &&
           name != "clamp") ||
          i >= text.size() || text[i] != '(') {
        return std::nullopt;
      }
      result.append(name);
    } else if (c == '(' || c == ',') {
      if (c == '(') {
        depth++;
      } else if (depth == 0) {
        return std::nullopt;
      }
      result.push_back(c);
      startsTerm = true;
      i++;
    } else if (c == ')') {
      if (depth == 0) {
        return std::nullopt;
      }
      depth--;
      result.push_back(c);
      startsTerm = false;
      i++;
    } else if (c == '+' || c == '-' || c == '*' || c == '/') {
      result.push_back(c);
      startsTerm = true;
      i++;
    } else if (isSpace(c)) {
      result.push_back(' ');
      i++;
    } else {
      return std::nullopt;
    }
    // One math function and nothing after it
    if (depth == 0 && i < text.size() && result.size() > 0 &&
        result.back() == ')' && !trimmed(text.substr(i)).empty()) {
      return std::nullopt;
    }
  }
  if (!hasPercentage || depth != 0 || result.empty() || result.back() != ')') {
    return std::nullopt;
  }
  return result;
}

std::string trackListForLayout(
    std::string_view value,
    const LengthBasis& basis) {
  std::string_view text = trimmed(value);
  std::string result;
  result.reserve(text.size());
  auto isDigit = [](char c) { return c >= '0' && c <= '9'; };
  auto isLetter = [](char c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
  };
  size_t i = 0;
  while (i < text.size()) {
    char c = text[i];
    if (c == '[') {
      // Line names stay as they are
      size_t close = text.find(']', i);
      size_t end = close == std::string_view::npos ? text.size() : close + 1;
      result.append(text.substr(i, end - i));
      i = end;
    } else if (isDigit(c) || c == '.') {
      size_t start = i;
      while (i < text.size() && (isDigit(text[i]) || text[i] == '.')) {
        i++;
      }
      size_t unitStart = i;
      while (i < text.size() && (isLetter(text[i]) || text[i] == '%')) {
        i++;
      }
      std::string_view token = text.substr(start, i - start);
      std::string unit = lowercase(text.substr(unitStart, i - unitStart));
      // Keeps what the renderer reads: a number, `px`, a percentage, `fr`
      std::optional<double> points;
      if (!unit.empty() && unit != "px" && unit != "%" && unit != "fr") {
        points = resolveLength(token, basis);
      }
      if (points) {
        result.append(formatNumber(*points)).append("px");
      } else {
        result.append(token);
      }
    } else if (isLetter(c)) {
      size_t start = i;
      while (i < text.size() &&
             (isLetter(text[i]) || isDigit(text[i]) || text[i] == '-')) {
        i++;
      }
      std::string name = lowercase(text.substr(start, i - start));
      size_t close = i;
      if ((name == "calc" || name == "min" || name == "max" ||
           name == "clamp") &&
          i < text.size() && text[i] == '(') {
        for (size_t depth = 0; close < text.size(); close++) {
          if (text[close] == '(') {
            depth++;
          } else if (text[close] == ')' && --depth == 0) {
            break;
          }
        }
      }
      if (close > i && close < text.size()) {
        std::string_view call = text.substr(start, close + 1 - start);
        auto converted = mathForLayout(call, basis);
        if (!converted) {
          converted = substituteMath(call, basis);
        }
        result.append(converted ? std::string_view(*converted) : call);
        i = close + 1;
      } else {
        result.append(text.substr(start, i - start));
      }
    } else {
      result.push_back(c);
      i++;
    }
  }
  return result;
}

std::string cssTextOfPackedColor(uint32_t color) {
  return toCssRgba(Rgba{
      static_cast<double>((color >> 16) & 0xFF) / 255,
      static_cast<double>((color >> 8) & 0xFF) / 255,
      static_cast<double>(color & 0xFF) / 255,
      static_cast<double>((color >> 24) & 0xFF) / 255});
}

std::optional<uint32_t> parseColor(std::string_view value) {
  value = trimmed(value);
  if (value.empty()) {
    return std::nullopt;
  }
  auto parsed = parseCSSProperty<CSSColor>(value);
  if (!std::holds_alternative<CSSColor>(parsed)) {
    return std::nullopt;
  }
  auto color = std::get<CSSColor>(parsed);
  return (static_cast<uint32_t>(color.a) << 24) |
      (static_cast<uint32_t>(color.r) << 16) |
      (static_cast<uint32_t>(color.g) << 8) | static_cast<uint32_t>(color.b);
}

std::optional<std::string> substituteVariables(
    std::string_view value,
    const CustomProperties& scope) {
  return substitute(value, scope, 0);
}

CustomPropertyReadsScope::CustomPropertyReadsScope(
    std::unordered_set<std::string>* reads)
    : previous_(customPropertyReads) {
  customPropertyReads = reads;
}

CustomPropertyReadsScope::~CustomPropertyReadsScope() {
  customPropertyReads = previous_;
}

void recordCustomPropertyRead(const std::string& name) {
  if (customPropertyReads != nullptr) {
    customPropertyReads->insert(name);
  }
}

std::string substituteLightDark(std::string_view value, bool dark) {
  std::string result(value);
  while (true) {
    auto call = findFunction(result, "light-dark");
    if (!call) {
      break;
    }
    auto arguments = std::string_view(result).substr(
        call->open + 1, call->close - call->open - 1);
    auto parts = splitTopLevel(arguments, ',');
    std::string picked(trimmed(dark && parts.size() > 1 ? parts[1] : parts[0]));
    result.replace(call->start, call->close + 1 - call->start, picked);
  }
  return result;
}

std::string substituteOklabColors(std::string_view value) {
  std::string result(value);
  for (std::string_view name : {"oklch", "oklab"}) {
    size_t cursor = 0;
    while (true) {
      auto call = findFunction(result, name, cursor);
      if (!call) {
        break;
      }
      auto replacement = oklabCall(
          name == "oklch",
          std::string_view(result).substr(
              call->open + 1, call->close - call->open - 1));
      if (!replacement) {
        cursor = call->close + 1;
        continue;
      }
      result.replace(call->start, call->close + 1 - call->start, *replacement);
      cursor = call->start + replacement->size();
    }
  }
  return result;
}

std::string substituteColorMix(std::string_view value) {
  std::string result(value);
  for (int guard = 0; guard < 32; guard++) {
    // The innermost mix first: its arguments hold no other
    std::optional<FunctionCall> innermost;
    size_t cursor = 0;
    while (true) {
      auto call = findFunction(result, "color-mix", cursor);
      if (!call) {
        break;
      }
      innermost = call;
      cursor = call->open + 1;
    }
    if (!innermost) {
      break;
    }
    auto mixed = colorMixCall(
        std::string_view(result).substr(
            innermost->open + 1, innermost->close - innermost->open - 1));
    if (!mixed) {
      break;
    }
    result.replace(
        innermost->start, innermost->close + 1 - innermost->start, *mixed);
  }
  return result;
}

std::string substituteCurrentColor(
    std::string_view value,
    std::string_view currentColor) {
  std::string result(value);
  std::string folded = lowercase(result);
  size_t cursor = 0;
  while (true) {
    size_t at = folded.find("currentcolor", cursor);
    if (at == std::string::npos) {
      break;
    }
    bool boundary = (at == 0 || !isIdentifierCharacter(folded[at - 1])) &&
        (at + 12 >= folded.size() || !isIdentifierCharacter(folded[at + 12]));
    if (!boundary) {
      cursor = at + 1;
      continue;
    }
    result.replace(at, 12, currentColor);
    folded = lowercase(result);
    cursor = at + currentColor.size();
  }
  return result;
}

std::optional<std::string> substituteMath(
    std::string_view value,
    const LengthBasis& basis) {
  std::string result(value);
  while (true) {
    // The outermost math function, whichever it is
    std::optional<FunctionCall> call;
    for (std::string_view name : {"calc", "min", "max", "clamp"}) {
      auto found = findFunction(result, name);
      if (found && (!call || found->start < call->start)) {
        call = found;
      }
    }
    if (!call) {
      break;
    }
    std::string_view whole = std::string_view(result).substr(
        call->start, call->close + 1 - call->start);
    MathParser parser(whole, basis);
    auto evaluated = parser.parseAll();
    std::optional<std::string> replacement;
    if (evaluated) {
      replacement = formatNumber(*evaluated) + "px";
    } else {
      replacement = percentageWithCancelledLengths(
          std::string_view(result).substr(
              call->open + 1, call->close - call->open - 1),
          basis);
    }
    if (!replacement) {
      return std::nullopt;
    }
    result.replace(call->start, call->close + 1 - call->start, *replacement);
  }
  return result;
}

} // namespace facebook::react::cssengine
