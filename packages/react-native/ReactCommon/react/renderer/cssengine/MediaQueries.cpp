/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "MediaQueries.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <functional>
#include <string>

namespace facebook::react::cssengine {

using Environment = MediaEnvironment;

struct MediaQueryList::Condition {
  enum class Kind : uint8_t { Test, Unknown, Not, And, Or };
  Kind kind{Kind::Unknown};
  std::function<bool(const Environment&)> test;
  std::vector<std::shared_ptr<const Condition>> operands;
};

namespace {

using Condition = MediaQueryList::Condition;
using ConditionPointer = std::shared_ptr<const Condition>;

enum class Truth : uint8_t { False, True, Unknown };

ConditionPointer unknownCondition() {
  static auto unknown = std::make_shared<const Condition>();
  return unknown;
}

ConditionPointer testCondition(std::function<bool(const Environment&)> test) {
  auto condition = std::make_shared<Condition>();
  condition->kind = Condition::Kind::Test;
  condition->test = std::move(test);
  return condition;
}

Truth evaluate(const Condition& condition, const Environment& environment) {
  switch (condition.kind) {
    case Condition::Kind::Test:
      return condition.test(environment) ? Truth::True : Truth::False;
    case Condition::Kind::Unknown:
      return Truth::Unknown;
    case Condition::Kind::Not: {
      Truth value = evaluate(*condition.operands[0], environment);
      if (value == Truth::Unknown) {
        return value;
      }
      return value == Truth::True ? Truth::False : Truth::True;
    }
    case Condition::Kind::And: {
      Truth result = Truth::True;
      for (const auto& operand : condition.operands) {
        Truth value = evaluate(*operand, environment);
        if (value == Truth::False) {
          return Truth::False;
        }
        if (value == Truth::Unknown) {
          result = Truth::Unknown;
        }
      }
      return result;
    }
    case Condition::Kind::Or: {
      Truth result = Truth::False;
      for (const auto& operand : condition.operands) {
        Truth value = evaluate(*operand, environment);
        if (value == Truth::True) {
          return Truth::True;
        }
        if (value == Truth::Unknown) {
          result = Truth::Unknown;
        }
      }
      return result;
    }
  }
  return Truth::Unknown;
}

bool evaluateQuery(
    const MediaQueryList::Query& query,
    const Environment& environment) {
  Truth result = query.typeMatches ? Truth::True : Truth::False;
  if (result == Truth::True && query.condition != nullptr) {
    result = evaluate(*query.condition, environment);
  }
  if (query.negated) {
    return result == Truth::False;
  }
  return result == Truth::True;
}

// -- The grammar (Media Queries 4 §2 and §3) --

struct Token {
  enum class Kind : uint8_t { Word, Parens, Function };
  Kind kind;
  // A word, lowercased, or what is between a pair of parentheses
  std::string text;
};

bool isSpace(char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f';
}

std::string lowercase(std::string_view text) {
  std::string out(text);
  for (char& c : out) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  return out;
}

std::string_view trim(std::string_view text) {
  while (!text.empty() && isSpace(text.front())) {
    text.remove_prefix(1);
  }
  while (!text.empty() && isSpace(text.back())) {
    text.remove_suffix(1);
  }
  return text;
}

// The index after the quote closing the string at `open`, or npos
size_t stringEnd(std::string_view text, size_t open) {
  char quote = text[open];
  for (size_t i = open + 1; i < text.size(); i++) {
    if (text[i] == '\\') {
      i++;
    } else if (text[i] == quote) {
      return i + 1;
    }
  }
  return std::string_view::npos;
}

// The index of the bracket closing the one at `open`, skipping strings; npos
// when a bracket inside doesn't match (CSS Syntax §8.2) or it never closes
size_t matchingBracket(std::string_view text, size_t open) {
  std::string expected;
  for (size_t i = open; i < text.size(); i++) {
    char c = text[i];
    if (c == '"' || c == '\'') {
      size_t end = stringEnd(text, i);
      if (end == std::string_view::npos) {
        return std::string_view::npos;
      }
      i = end - 1;
    } else if (c == '(') {
      expected.push_back(')');
    } else if (c == '[') {
      expected.push_back(']');
    } else if (c == '{') {
      expected.push_back('}');
    } else if (c == ')' || c == ']' || c == '}') {
      if (expected.empty() || expected.back() != c) {
        return std::string_view::npos;
      }
      expected.pop_back();
      if (expected.empty()) {
        return i;
      }
    }
  }
  return std::string_view::npos;
}

std::optional<std::vector<Token>> tokenizeQuery(std::string_view text) {
  std::vector<Token> tokens;
  size_t i = 0;
  while (i < text.size()) {
    char c = text[i];
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c == ')') {
      return std::nullopt;
    }
    size_t end = i;
    while (end < text.size() && !isSpace(text[end]) && text[end] != '(' &&
           text[end] != ')') {
      end++;
    }
    if (end < text.size() && text[end] == '(') {
      size_t close = matchingBracket(text, end);
      if (close == std::string_view::npos) {
        return std::nullopt;
      }
      if (end == i) {
        tokens.push_back(
            {Token::Kind::Parens,
             std::string(text.substr(end + 1, close - end - 1))});
      } else {
        tokens.push_back({Token::Kind::Function, {}});
      }
      i = close + 1;
      continue;
    }
    tokens.push_back({Token::Kind::Word, lowercase(text.substr(i, end - i))});
    i = end;
  }
  return tokens;
}

std::vector<std::string_view> splitTopLevelCommas(std::string_view text) {
  std::vector<std::string_view> parts;
  int depth = 0;
  size_t start = 0;
  for (size_t i = 0; i < text.size(); i++) {
    char c = text[i];
    if (c == '"' || c == '\'') {
      size_t end = stringEnd(text, i);
      if (end == std::string_view::npos) {
        break;
      }
      i = end - 1;
    } else if (c == '(' || c == '[' || c == '{') {
      depth++;
    } else if (c == ')' || c == ']' || c == '}') {
      depth = std::max(0, depth - 1);
    } else if (c == ',' && depth == 0) {
      parts.push_back(text.substr(start, i - start));
      start = i + 1;
    }
  }
  parts.push_back(text.substr(start));
  return parts;
}

// -- Media features (Media Queries 4 §2.4, §4 and §5; Media Queries 5) --

using Value = std::function<double(const Environment&)>;

struct RangeFeature {
  std::function<double(const Environment&)> read;
  std::function<std::optional<Value>(std::string_view)> parse;
};

struct DiscreteFeature {
  std::vector<std::string_view> values;
  std::function<bool(const Environment&, std::string_view)> matches;
  // A feature named on its own (§2.4.2) is true unless its value would be
  // `none`, `no-preference` or zero
  std::function<bool(const Environment&)> inBooleanContext;
};

// A CSS number and the identifier after it: `600px`, `1.5`, `2dppx`
bool parseDimension(std::string_view text, double& amount, std::string& unit) {
  text = trim(text);
  if (text.empty()) {
    return false;
  }
  size_t i = 0;
  if (text[i] == '+' || text[i] == '-') {
    i++;
  }
  size_t digitsStart = i;
  while (i < text.size() && std::isdigit(static_cast<unsigned char>(text[i]))) {
    i++;
  }
  if (i < text.size() && text[i] == '.') {
    i++;
    size_t fraction = i;
    while (i < text.size() &&
           std::isdigit(static_cast<unsigned char>(text[i]))) {
      i++;
    }
    if (i == fraction) {
      return false;
    }
  }
  if (i == digitsStart) {
    return false;
  }
  if (i < text.size() && (text[i] == 'e' || text[i] == 'E')) {
    size_t mark = i;
    i++;
    if (i < text.size() && (text[i] == '+' || text[i] == '-')) {
      i++;
    }
    size_t exponent = i;
    while (i < text.size() &&
           std::isdigit(static_cast<unsigned char>(text[i]))) {
      i++;
    }
    if (i == exponent) {
      i = mark;
    }
  }
  std::string number(text.substr(0, i));
  amount = std::strtod(number.c_str(), nullptr);
  unit = lowercase(text.substr(i));
  for (char c : unit) {
    if (!std::isalpha(static_cast<unsigned char>(c))) {
      return false;
    }
  }
  return true;
}

std::optional<Value> parseLength(std::string_view text) {
  double amount = 0;
  std::string unit;
  if (!parseDimension(text, amount, unit)) {
    return std::nullopt;
  }
  if (unit.empty()) {
    // Only zero may go without a unit
    if (amount != 0) {
      return std::nullopt;
    }
    return Value([](const Environment&) { return 0.0; });
  }
  // `em` and `rem` are the initial font size, 16px, in a query (§1.3)
  static const std::vector<std::pair<std::string_view, double>> absolute = {
      {"px", 1},
      {"em", 16},
      {"rem", 16},
      {"in", 96},
      {"cm", 96 / 2.54},
      {"mm", 96 / 25.4},
      {"q", 96 / 101.6},
      {"pt", 96.0 / 72},
      {"pc", 16},
  };
  for (const auto& [name, scale] : absolute) {
    if (unit == name) {
      double pixels = amount * scale;
      return Value([pixels](const Environment&) { return pixels; });
    }
  }
  if (unit == "vw") {
    return Value([amount](const Environment& environment) {
      return amount * environment.viewportWidth / 100;
    });
  }
  if (unit == "vh") {
    return Value([amount](const Environment& environment) {
      return amount * environment.viewportHeight / 100;
    });
  }
  if (unit == "vmin") {
    return Value([amount](const Environment& environment) {
      return amount *
          std::min(environment.viewportWidth, environment.viewportHeight) / 100;
    });
  }
  if (unit == "vmax") {
    return Value([amount](const Environment& environment) {
      return amount *
          std::max(environment.viewportWidth, environment.viewportHeight) / 100;
    });
  }
  return std::nullopt;
}

std::optional<Value> parseRatio(std::string_view text) {
  text = trim(text);
  size_t slash = text.find('/');
  double numerator = 0;
  double denominator = 1;
  std::string unit;
  if (!parseDimension(text.substr(0, slash), numerator, unit) ||
      !unit.empty()) {
    return std::nullopt;
  }
  if (slash != std::string_view::npos &&
      (!parseDimension(text.substr(slash + 1), denominator, unit) ||
       !unit.empty())) {
    return std::nullopt;
  }
  if (numerator < 0 || denominator < 0) {
    return std::nullopt;
  }
  double ratio = numerator / denominator;
  return Value([ratio](const Environment&) { return ratio; });
}

// A non-negative integer, as `color` and `monochrome` take
std::optional<Value> parseInteger(std::string_view text) {
  double amount = 0;
  std::string unit;
  if (!parseDimension(trim(text), amount, unit) || !unit.empty() ||
      amount < 0 || amount != std::floor(amount)) {
    return std::nullopt;
  }
  return Value([amount](const Environment&) { return amount; });
}

std::optional<Value> parseResolution(std::string_view text) {
  double amount = 0;
  std::string unit;
  if (!parseDimension(text, amount, unit)) {
    return std::nullopt;
  }
  double scale = 0;
  if (unit == "dppx" || unit == "x") {
    scale = 1;
  } else if (unit == "dpi") {
    scale = 1.0 / 96;
  } else if (unit == "dpcm") {
    scale = 2.54 / 96;
  } else {
    return std::nullopt;
  }
  double dppx = amount * scale;
  return Value([dppx](const Environment&) { return dppx; });
}

const RangeFeature* rangeFeature(std::string_view name) {
  static const RangeFeature width{
      [](const Environment& environment) { return environment.width; },
      parseLength};
  static const RangeFeature height{
      [](const Environment& environment) { return environment.height; },
      parseLength};
  static const RangeFeature aspectRatio{
      [](const Environment& environment) {
        return environment.width / environment.height;
      },
      parseRatio};
  static const RangeFeature resolution{
      [](const Environment& environment) { return environment.resolution; },
      parseResolution};
  if (name == "width") {
    return &width;
  }
  if (name == "height") {
    return &height;
  }
  if (name == "aspect-ratio") {
    return &aspectRatio;
  }
  if (name == "resolution") {
    return &resolution;
  }
  // The display's bits per colour component, and its palette and greys:
  // every display this draws on is a colour one (mediaqueries-4 §6)
  static const RangeFeature color{
      [](const Environment&) { return 8.0; }, parseInteger};
  static const RangeFeature none{
      [](const Environment&) { return 0.0; }, parseInteger};
  if (name == "color") {
    return &color;
  }
  if (name == "color-index" || name == "monochrome") {
    return &none;
  }
  return nullptr;
}

int gamutRank(std::string_view name) {
  if (name == "srgb") {
    return 0;
  }
  if (name == "p3") {
    return 1;
  }
  return 2;
}

const DiscreteFeature* discreteFeature(std::string_view name) {
  static const DiscreteFeature orientation{
      {"portrait", "landscape"},
      [](const Environment& environment, std::string_view value) {
        return value ==
            (environment.height >= environment.width ? "portrait"
                                                     : "landscape");
      },
      [](const Environment&) { return true; }};
  static const DiscreteFeature hover{
      {"none", "hover"},
      [](const Environment& environment, std::string_view value) {
        return value == (environment.hover ? "hover" : "none");
      },
      [](const Environment& environment) { return environment.hover; }};
  static const DiscreteFeature pointer{
      {"none", "coarse", "fine"},
      [](const Environment& environment, std::string_view value) {
        switch (environment.pointer) {
          case Environment::Pointer::None:
            return value == "none";
          case Environment::Pointer::Coarse:
            return value == "coarse";
          case Environment::Pointer::Fine:
            return value == "fine";
        }
        return false;
      },
      [](const Environment& environment) {
        return environment.pointer != Environment::Pointer::None;
      }};
  static const DiscreteFeature colorScheme{
      {"light", "dark"},
      [](const Environment& environment, std::string_view value) {
        return value == (environment.dark ? "dark" : "light");
      },
      [](const Environment&) { return true; }};
  static const DiscreteFeature reducedMotion{
      {"no-preference", "reduce"},
      [](const Environment& environment, std::string_view value) {
        return value ==
            (environment.reducedMotion ? "reduce" : "no-preference");
      },
      [](const Environment& environment) { return environment.reducedMotion; }};
  // P3 is true of a P3 display "or more"
  static const DiscreteFeature colorGamut{
      {"srgb", "p3", "rec2020"},
      [](const Environment& environment, std::string_view value) {
        return gamutRank(value) <= static_cast<int>(environment.gamut);
      },
      [](const Environment&) { return true; }};
  // `standard` holds on every display, `high` on one that shows HDR
  static const DiscreteFeature dynamicRange{
      {"standard", "high"},
      [](const Environment& environment, std::string_view value) {
        return value == "standard" || environment.highDynamicRange;
      },
      [](const Environment&) { return true; }};
  if (name == "orientation") {
    return &orientation;
  }
  if (name == "hover" || name == "any-hover") {
    return &hover;
  }
  if (name == "pointer" || name == "any-pointer") {
    return &pointer;
  }
  if (name == "prefers-color-scheme") {
    return &colorScheme;
  }
  if (name == "prefers-reduced-motion") {
    return &reducedMotion;
  }
  if (name == "color-gamut") {
    return &colorGamut;
  }
  if (name == "dynamic-range" || name == "video-dynamic-range") {
    return &dynamicRange;
  }
  return nullptr;
}

bool compare(double actual, std::string_view op, double expected) {
  if (op == "<") {
    return actual < expected;
  }
  if (op == "<=") {
    return actual <= expected;
  }
  if (op == ">") {
    return actual > expected;
  }
  if (op == ">=") {
    return actual >= expected;
  }
  return actual == expected;
}

std::string_view reverseOperator(std::string_view op) {
  if (op == "<") {
    return ">";
  }
  if (op == "<=") {
    return ">=";
  }
  if (op == ">") {
    return "<";
  }
  if (op == ">=") {
    return "<=";
  }
  return op;
}

// `(width >= 600px)`, `(600px < width)`, `(400px <= width < 800px)`
ConditionPointer parseRange(std::string_view source) {
  std::vector<std::string> parts;
  size_t start = 0;
  for (size_t i = 0; i < source.size(); i++) {
    char c = source[i];
    if (c == '<' || c == '>' || c == '=') {
      parts.emplace_back(trim(source.substr(start, i - start)));
      size_t length =
          (c != '=' && i + 1 < source.size() && source[i + 1] == '=') ? 2 : 1;
      parts.emplace_back(source.substr(i, length));
      i += length - 1;
      start = i + 1;
    }
  }
  parts.emplace_back(trim(source.substr(start)));
  if (parts.size() == 3) {
    std::string op = parts[1];
    if (const RangeFeature* named = rangeFeature(parts[0])) {
      auto expected = named->parse(parts[2]);
      if (!expected) {
        return nullptr;
      }
      return testCondition([named, op, expected](const Environment& env) {
        return compare(named->read(env), op, (*expected)(env));
      });
    }
    if (const RangeFeature* flipped = rangeFeature(parts[2])) {
      auto expected = flipped->parse(parts[0]);
      if (!expected) {
        return nullptr;
      }
      std::string reversed(reverseOperator(op));
      return testCondition(
          [flipped, reversed, expected](const Environment& env) {
            return compare(flipped->read(env), reversed, (*expected)(env));
          });
    }
    return nullptr;
  }
  if (parts.size() == 5) {
    const RangeFeature* feature = rangeFeature(parts[2]);
    std::string low = parts[1];
    std::string high = parts[3];
    bool bothLess = low[0] == '<' && high[0] == '<';
    bool bothGreater = low[0] == '>' && high[0] == '>';
    if (feature == nullptr || (!bothLess && !bothGreater)) {
      return nullptr;
    }
    auto lower = feature->parse(parts[0]);
    auto upper = feature->parse(parts[4]);
    if (!lower || !upper) {
      return nullptr;
    }
    std::string reversedLow(reverseOperator(low));
    return testCondition(
        [feature, reversedLow, high, lower, upper](const Environment& env) {
          double actual = feature->read(env);
          return compare(actual, reversedLow, (*lower)(env)) &&
              compare(actual, high, (*upper)(env));
        });
  }
  return nullptr;
}

// <mf-plain>, <mf-boolean> or <mf-range>; null when it is none of them, which
// leaves it <general-enclosed>
ConditionPointer parseFeature(std::string_view text) {
  std::string source = lowercase(trim(text));
  if (source.find_first_of("<>=") != std::string::npos) {
    return parseRange(source);
  }
  size_t colon = source.find(':');
  if (colon == std::string::npos) {
    if (const RangeFeature* range = rangeFeature(source)) {
      return testCondition(
          [range](const Environment& env) { return range->read(env) != 0; });
    }
    if (const DiscreteFeature* discrete = discreteFeature(source)) {
      return testCondition(discrete->inBooleanContext);
    }
    return nullptr;
  }
  std::string name(trim(std::string_view(source).substr(0, colon)));
  std::string value(trim(std::string_view(source).substr(colon + 1)));
  std::string_view prefix;
  std::string_view base = name;
  if (name.rfind("min-", 0) == 0) {
    prefix = "min";
    base = std::string_view(name).substr(4);
  } else if (name.rfind("max-", 0) == 0) {
    prefix = "max";
    base = std::string_view(name).substr(4);
  }
  if (const RangeFeature* range = rangeFeature(base)) {
    auto expected = range->parse(value);
    if (!expected) {
      return nullptr;
    }
    std::string op = prefix == "min" ? ">=" : prefix == "max" ? "<=" : "=";
    return testCondition([range, op, expected](const Environment& env) {
      return compare(range->read(env), op, (*expected)(env));
    });
  }
  const DiscreteFeature* discrete =
      prefix.empty() ? discreteFeature(name) : nullptr;
  if (discrete == nullptr ||
      std::find(discrete->values.begin(), discrete->values.end(), value) ==
          discrete->values.end()) {
    return nullptr;
  }
  return testCondition([discrete, value](const Environment& env) {
    return discrete->matches(env, value);
  });
}

ConditionPointer parseConditionTokens(
    const std::vector<Token>& tokens,
    size_t first,
    bool allowOr);

// <media-in-parens> = ( <media-condition> ) | <media-feature>
//   | <general-enclosed>, which is unknown
ConditionPointer parseInParens(const Token& token) {
  if (token.kind == Token::Kind::Function) {
    return unknownCondition();
  }
  if (token.kind != Token::Kind::Parens) {
    return nullptr;
  }
  auto inner = tokenizeQuery(token.text);
  if (!inner || inner->empty()) {
    return unknownCondition();
  }
  const Token& head = (*inner)[0];
  if (head.kind != Token::Kind::Word || head.text == "not") {
    auto condition = parseConditionTokens(*inner, 0, true);
    return condition != nullptr ? condition : unknownCondition();
  }
  auto feature = parseFeature(token.text);
  return feature != nullptr ? feature : unknownCondition();
}

// <media-condition> = <media-not> | <media-in-parens> [ <media-and>* |
// <media-or>* ]; `and` and `or` don't mix without parentheses
ConditionPointer parseConditionTokens(
    const std::vector<Token>& tokens,
    size_t first,
    bool allowOr) {
  size_t count = tokens.size() - first;
  if (count == 0) {
    return nullptr;
  }
  const Token& head = tokens[first];
  if (head.kind == Token::Kind::Word && head.text == "not") {
    if (count != 2) {
      return nullptr;
    }
    auto operand = parseInParens(tokens[first + 1]);
    if (operand == nullptr) {
      return nullptr;
    }
    auto condition = std::make_shared<Condition>();
    condition->kind = Condition::Kind::Not;
    condition->operands.push_back(operand);
    return condition;
  }
  std::vector<ConditionPointer> operands;
  std::string joiner;
  for (size_t i = 0; i < count; i++) {
    const Token& token = tokens[first + i];
    if (i % 2 == 1) {
      if (token.kind != Token::Kind::Word ||
          (token.text != "and" && token.text != "or") ||
          (!joiner.empty() && joiner != token.text) ||
          (token.text == "or" && !allowOr) || i == count - 1) {
        return nullptr;
      }
      joiner = token.text;
      continue;
    }
    auto operand = parseInParens(token);
    if (operand == nullptr) {
      return nullptr;
    }
    operands.push_back(operand);
  }
  if (operands.size() == 1) {
    return operands[0];
  }
  auto condition = std::make_shared<Condition>();
  condition->kind = joiner == "or" ? Condition::Kind::Or : Condition::Kind::And;
  condition->operands = std::move(operands);
  return condition;
}

bool isIdentifier(std::string_view text) {
  if (text.empty()) {
    return false;
  }
  size_t i = 0;
  if (text[0] == '-') {
    i = 1;
    if (i < text.size() && text[i] == '-') {
      return true;
    }
  }
  if (i >= text.size()) {
    return false;
  }
  auto start = static_cast<unsigned char>(text[i]);
  if (!(std::isalpha(start) || start == '_' || start >= 0x80)) {
    return false;
  }
  for (; i < text.size(); i++) {
    auto c = static_cast<unsigned char>(text[i]);
    if (!(std::isalnum(c) || c == '-' || c == '_' || c >= 0x80)) {
      return false;
    }
  }
  return true;
}

// <media-query> = <media-condition>
//   | [ not | only ]? <media-type> [ and <media-condition-without-or> ]?
std::optional<MediaQueryList::Query> parseQuery(std::string_view text) {
  auto tokens = tokenizeQuery(text);
  if (!tokens || tokens->empty()) {
    return std::nullopt;
  }
  const Token& first = (*tokens)[0];
  if (first.kind != Token::Kind::Word || first.text == "not") {
    bool startsWithType = first.kind == Token::Kind::Word &&
        tokens->size() > 1 && (*tokens)[1].kind == Token::Kind::Word;
    if (!startsWithType) {
      auto condition = parseConditionTokens(*tokens, 0, true);
      if (condition == nullptr) {
        return std::nullopt;
      }
      return MediaQueryList::Query{false, true, condition};
    }
  }
  size_t index = 0;
  bool negated = false;
  if (first.kind == Token::Kind::Word &&
      (first.text == "not" || first.text == "only") && tokens->size() > 1) {
    negated = first.text == "not";
    index = 1;
  }
  const Token& type = (*tokens)[index];
  if (type.kind != Token::Kind::Word || type.text == "only" ||
      type.text == "not" || type.text == "and" || type.text == "or" ||
      type.text == "layer" || !isIdentifier(type.text)) {
    return std::nullopt;
  }
  ConditionPointer condition;
  if (index + 1 < tokens->size()) {
    const Token& joiner = (*tokens)[index + 1];
    if (joiner.kind != Token::Kind::Word || joiner.text != "and") {
      return std::nullopt;
    }
    condition = parseConditionTokens(*tokens, index + 2, false);
    if (condition == nullptr) {
      return std::nullopt;
    }
  }
  return MediaQueryList::Query{
      negated, type.text == "all" || type.text == "screen", condition};
}

} // namespace

std::shared_ptr<const MediaQueryList> MediaQueryList::parse(
    std::string_view text) {
  auto list = std::make_shared<MediaQueryList>();
  if (trim(text).empty()) {
    return list;
  }
  for (std::string_view part : splitTopLevelCommas(text)) {
    list->queries_.push_back(parseQuery(part));
  }
  return list;
}

std::shared_ptr<const MediaQueryList> MediaQueryList::parseCondition(
    std::string_view text) {
  auto list = std::make_shared<MediaQueryList>();
  auto tokens = tokenizeQuery(text);
  if (!tokens || tokens->empty()) {
    list->queries_.push_back(std::nullopt);
    return list;
  }
  auto condition = parseConditionTokens(*tokens, 0, true);
  if (condition == nullptr) {
    list->queries_.push_back(std::nullopt);
    return list;
  }
  list->queries_.push_back(Query{false, true, condition});
  return list;
}

bool MediaQueryList::matches(const MediaEnvironment& environment) const {
  // An empty list is true (§2.1)
  if (queries_.empty()) {
    return true;
  }
  for (const auto& query : queries_) {
    if (query && evaluateQuery(*query, environment)) {
      return true;
    }
  }
  return false;
}

} // namespace facebook::react::cssengine
