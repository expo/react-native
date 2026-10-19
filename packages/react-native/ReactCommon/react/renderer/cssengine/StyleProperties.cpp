/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "StyleProperties.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <unordered_map>
#include <unordered_set>

#include <folly/json.h>

namespace facebook::react::cssengine {

namespace {

std::string lowercase(std::string_view text) {
  std::string out(text);
  for (char& c : out) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  return out;
}

bool startsWith(std::string_view text, std::string_view prefix) {
  return text.substr(0, prefix.size()) == prefix;
}

bool endsWith(std::string_view text, std::string_view suffix) {
  return text.size() >= suffix.size() &&
      text.substr(text.size() - suffix.size()) == suffix;
}

// -- Expansion --

enum class Edge : uint8_t { Top, Right, Bottom, Left, Start, End };

// The name the engine writes an edge under: inline sides as Start and End,
// block sides as Top and Bottom
std::string_view edgeName(Edge edge, bool rtl) {
  switch (edge) {
    case Edge::Top:
      return "Top";
    case Edge::Bottom:
      return "Bottom";
    case Edge::Start:
      return "Start";
    case Edge::End:
      return "End";
    case Edge::Left:
      return rtl ? "End" : "Start";
    case Edge::Right:
      return rtl ? "Start" : "End";
  }
  return "Top";
}

// A family of four edges and how a longhand of it is named
struct BoxFamily {
  std::string_view prefix;
  std::string_view suffix;
  // Insets are written `top` and `start`, lowercase, without a prefix
  bool lowercaseEdge{false};
};

constexpr BoxFamily kPadding{"padding", "", false};
constexpr BoxFamily kMargin{"margin", "", false};
constexpr BoxFamily kInset{"", "", true};
constexpr BoxFamily kBorderWidth{"border", "Width", false};
constexpr BoxFamily kBorderColor{"border", "Color", false};
constexpr BoxFamily kBorderStyle{"border", "Style", false};

std::string familyProperty(const BoxFamily& family, Edge edge, bool rtl) {
  std::string name(edgeName(edge, rtl));
  if (family.lowercaseEdge) {
    name[0] =
        static_cast<char>(std::tolower(static_cast<unsigned char>(name[0])));
  }
  return std::string(family.prefix) + name + std::string(family.suffix);
}

void emitEdge(
    const BoxFamily& family,
    Edge edge,
    std::string_view value,
    bool rtl,
    std::vector<Longhand>& out) {
  out.push_back({familyProperty(family, edge, rtl), std::string(value)});
}

// CSS's 1-to-4-value order: top, right, bottom, left
bool emitFourSides(
    const BoxFamily& family,
    std::string_view value,
    bool rtl,
    std::vector<Longhand>& out) {
  auto parts = splitTopLevelWhitespace(value);
  if (parts.empty() || parts.size() > 4) {
    return false;
  }
  std::string_view top = parts[0];
  std::string_view right = parts.size() > 1 ? parts[1] : top;
  std::string_view bottom = parts.size() > 2 ? parts[2] : top;
  std::string_view left = parts.size() > 3 ? parts[3] : right;
  emitEdge(family, Edge::Top, top, rtl, out);
  emitEdge(family, Edge::Right, right, rtl, out);
  emitEdge(family, Edge::Bottom, bottom, rtl, out);
  emitEdge(family, Edge::Left, left, rtl, out);
  return true;
}

// The 1-or-2-value logical shorthands: start then end
bool emitTwoSides(
    const BoxFamily& family,
    Edge first,
    Edge second,
    std::string_view value,
    bool rtl,
    std::vector<Longhand>& out) {
  auto parts = splitTopLevelWhitespace(value);
  if (parts.empty() || parts.size() > 2) {
    return false;
  }
  emitEdge(family, first, parts[0], rtl, out);
  emitEdge(family, second, parts.size() > 1 ? parts[1] : parts[0], rtl, out);
  return true;
}

// `paddingTop`, `paddingInlineStart`, `paddingInline`, … for one family;
// `name` is the property with the family's prefix and suffix removed
bool expandFamilyMember(
    const BoxFamily& family,
    std::string_view name,
    std::string_view value,
    bool rtl,
    std::vector<Longhand>& out) {
  if (name.empty()) {
    return emitFourSides(family, value, rtl, out);
  }
  static const std::unordered_map<std::string_view, Edge> single = {
      {"Top", Edge::Top},
      {"Bottom", Edge::Bottom},
      {"Left", Edge::Left},
      {"Right", Edge::Right},
      {"Start", Edge::Start},
      {"End", Edge::End},
      {"InlineStart", Edge::Start},
      {"InlineEnd", Edge::End},
      {"BlockStart", Edge::Top},
      {"BlockEnd", Edge::Bottom},
  };
  auto found = single.find(name);
  if (found != single.end()) {
    emitEdge(family, found->second, value, rtl, out);
    return true;
  }
  if (name == "Inline" || name == "Horizontal") {
    return emitTwoSides(family, Edge::Start, Edge::End, value, rtl, out);
  }
  if (name == "Block" || name == "Vertical") {
    return emitTwoSides(family, Edge::Top, Edge::Bottom, value, rtl, out);
  }
  return false;
}

// An inset longhand: `top`, `left`, `insetInlineStart`, `insetBlock`, …
bool expandInset(
    std::string_view property,
    std::string_view value,
    bool rtl,
    std::vector<Longhand>& out) {
  if (property == "inset") {
    return emitFourSides(kInset, value, rtl, out);
  }
  static const std::unordered_map<std::string_view, std::string_view> names = {
      {"top", "Top"},
      {"bottom", "Bottom"},
      {"left", "Left"},
      {"right", "Right"},
      {"start", "Start"},
      {"end", "End"},
  };
  auto found = names.find(property);
  if (found != names.end()) {
    return expandFamilyMember(kInset, found->second, value, rtl, out);
  }
  if (startsWith(property, "inset")) {
    return expandFamilyMember(kInset, property.substr(5), value, rtl, out);
  }
  return false;
}

const std::unordered_set<std::string_view>& borderStyleKeywords() {
  static const std::unordered_set<std::string_view> keywords = {
      "none",
      "hidden",
      "solid",
      "dashed",
      "dotted",
      "double",
      "groove",
      "ridge",
      "inset",
      "outset"};
  return keywords;
}

bool isBorderWidthToken(std::string_view token) {
  if (token == "thin" || token == "medium" || token == "thick") {
    return true;
  }
  if (token.empty()) {
    return false;
  }
  char first = token[0];
  if (std::isdigit(static_cast<unsigned char>(first)) || first == '.' ||
      first == '-' || first == '+') {
    return true;
  }
  return startsWith(token, "calc(") || startsWith(token, "min(") ||
      startsWith(token, "max(") || startsWith(token, "clamp(");
}

// `border: <width> || <style> || <color>` for some edges: what it omits is
// the initial value (css-backgrounds-3 §4.4)
void expandBorder(
    std::string_view value,
    const std::vector<Edge>& edges,
    bool rtl,
    std::vector<Longhand>& out) {
  std::string width = "medium";
  std::string style = "none";
  std::string color = "currentcolor";
  for (auto part : splitTopLevelWhitespace(value)) {
    std::string token = lowercase(part);
    if (borderStyleKeywords().count(token) != 0) {
      style = token;
    } else if (isBorderWidthToken(token)) {
      width = std::string(part);
    } else {
      color = std::string(part);
    }
  }
  for (Edge edge : edges) {
    emitEdge(kBorderWidth, edge, width, rtl, out);
    emitEdge(kBorderStyle, edge, style, rtl, out);
    emitEdge(kBorderColor, edge, color, rtl, out);
  }
}

bool expandBorderShorthand(
    std::string_view property,
    std::string_view value,
    bool rtl,
    std::vector<Longhand>& out) {
  static const std::unordered_map<std::string_view, std::vector<Edge>> sides = {
      {"border", {Edge::Top, Edge::Right, Edge::Bottom, Edge::Left}},
      {"borderTop", {Edge::Top}},
      {"borderRight", {Edge::Right}},
      {"borderBottom", {Edge::Bottom}},
      {"borderLeft", {Edge::Left}},
      {"borderBlockStart", {Edge::Top}},
      {"borderBlockEnd", {Edge::Bottom}},
      {"borderInlineStart", {Edge::Start}},
      {"borderInlineEnd", {Edge::End}},
      {"borderBlock", {Edge::Top, Edge::Bottom}},
      {"borderInline", {Edge::Start, Edge::End}},
  };
  auto found = sides.find(property);
  if (found == sides.end()) {
    return false;
  }
  expandBorder(value, found->second, rtl, out);
  return true;
}

// `border-radius` (css-backgrounds-3 §5.1): the horizontal radii, top-left
// first; an elliptical vertical radius after `/` is not drawn
bool expandBorderRadius(
    std::string_view property,
    std::string_view value,
    bool rtl,
    std::vector<Longhand>& out) {
  std::string_view horizontal = value;
  size_t slash = value.find('/');
  if (slash != std::string_view::npos) {
    horizontal = trimmed(value.substr(0, slash));
  }
  if (property == "borderRadius") {
    auto parts = splitTopLevelWhitespace(horizontal);
    if (parts.empty() || parts.size() > 4) {
      return true;
    }
    std::string_view topLeft = parts[0];
    std::string_view topRight = parts.size() > 1 ? parts[1] : topLeft;
    std::string_view bottomRight = parts.size() > 2 ? parts[2] : topLeft;
    std::string_view bottomLeft = parts.size() > 3 ? parts[3] : topRight;
    out.push_back({"borderTopLeftRadius", std::string(topLeft)});
    out.push_back({"borderTopRightRadius", std::string(topRight)});
    out.push_back({"borderBottomRightRadius", std::string(bottomRight)});
    out.push_back({"borderBottomLeftRadius", std::string(bottomLeft)});
    return true;
  }
  static const std::unordered_map<
      std::string_view,
      std::pair<std::string_view, std::string_view>>
      corners = {
          // logical → physical in a left-to-right line, then right-to-left
          {"borderStartStartRadius",
           {"borderTopLeftRadius", "borderTopRightRadius"}},
          {"borderTopStartRadius",
           {"borderTopLeftRadius", "borderTopRightRadius"}},
          {"borderStartEndRadius",
           {"borderTopRightRadius", "borderTopLeftRadius"}},
          {"borderTopEndRadius",
           {"borderTopRightRadius", "borderTopLeftRadius"}},
          {"borderEndStartRadius",
           {"borderBottomLeftRadius", "borderBottomRightRadius"}},
          {"borderBottomStartRadius",
           {"borderBottomLeftRadius", "borderBottomRightRadius"}},
          {"borderEndEndRadius",
           {"borderBottomRightRadius", "borderBottomLeftRadius"}},
          {"borderBottomEndRadius",
           {"borderBottomRightRadius", "borderBottomLeftRadius"}},
          {"borderTopLeftRadius",
           {"borderTopLeftRadius", "borderTopLeftRadius"}},
          {"borderTopRightRadius",
           {"borderTopRightRadius", "borderTopRightRadius"}},
          {"borderBottomLeftRadius",
           {"borderBottomLeftRadius", "borderBottomLeftRadius"}},
          {"borderBottomRightRadius",
           {"borderBottomRightRadius", "borderBottomRightRadius"}},
      };
  auto found = corners.find(property);
  if (found == corners.end()) {
    return false;
  }
  auto parts = splitTopLevelWhitespace(horizontal);
  if (parts.empty()) {
    return true;
  }
  out.push_back(
      {std::string(rtl ? found->second.second : found->second.first),
       std::string(parts[0])});
  return true;
}

bool isNumberToken(std::string_view token) {
  return parseNumber(token).has_value();
}

// `flex` (css-flexbox-1 §7.1)
void expandFlex(std::string_view value, std::vector<Longhand>& out) {
  std::string keyword = lowercase(trimmed(value));
  std::string grow = "0";
  std::string shrink = "1";
  std::string basis = "auto";
  if (keyword == "none") {
    shrink = "0";
  } else if (keyword == "auto") {
    grow = "1";
  } else if (keyword != "initial") {
    auto parts = splitTopLevelWhitespace(value);
    std::vector<std::string_view> numbers;
    std::optional<std::string_view> length;
    for (auto part : parts) {
      if (isNumberToken(part) && numbers.size() < 2) {
        numbers.push_back(part);
      } else {
        length = part;
      }
    }
    if (numbers.empty() && !length) {
      return;
    }
    grow = numbers.empty() ? "1" : std::string(numbers[0]);
    shrink = numbers.size() > 1 ? std::string(numbers[1]) : "1";
    // A number alone sets the basis to zero
    basis = length ? std::string(*length) : "0%";
  }
  out.push_back({"flexGrow", grow});
  out.push_back({"flexShrink", shrink});
  out.push_back({"flexBasis", basis});
}

const std::unordered_set<std::string_view>& timingKeywords() {
  static const std::unordered_set<std::string_view> keywords = {
      "linear",
      "ease",
      "ease-in",
      "ease-out",
      "ease-in-out",
      "step-start",
      "step-end"};
  return keywords;
}

bool isTime(std::string_view token) {
  if (endsWith(token, "ms")) {
    return isNumberToken(token.substr(0, token.size() - 2));
  }
  if (endsWith(token, "s")) {
    return isNumberToken(token.substr(0, token.size() - 1));
  }
  return false;
}

bool isTiming(std::string_view token) {
  return timingKeywords().count(token) != 0 ||
      startsWith(token, "cubic-bezier(") || startsWith(token, "steps(");
}

// A length or a percentage, as a number starts one or a math function
// computes one
bool isLengthPercentageToken(std::string_view token) {
  if (token.empty()) {
    return false;
  }
  char first = token[0];
  if (std::isdigit(static_cast<unsigned char>(first)) || first == '.' ||
      first == '-' || first == '+') {
    return true;
  }
  return startsWith(token, "calc(") || startsWith(token, "min(") ||
      startsWith(token, "max(") || startsWith(token, "clamp(");
}

bool isBackgroundImage(std::string_view token) {
  std::string word = lowercase(token);
  return word == "none" || startsWith(word, "url(") ||
      word.find("gradient(") != std::string::npos;
}

bool isBackgroundPositionWord(std::string_view token) {
  std::string word = lowercase(token);
  return word == "left" || word == "right" || word == "top" ||
      word == "bottom" || word == "center" || isLengthPercentageToken(word);
}

// A `<repeat-style>` keyword that names one axis's repeat
bool isRepeatStyle(std::string_view token) {
  std::string word = lowercase(token);
  return word == "repeat" || word == "space" || word == "round" ||
      word == "no-repeat";
}

bool isBackgroundSizeWord(std::string_view token) {
  std::string word = lowercase(token);
  return word == "auto" || word == "cover" || word == "contain" ||
      isLengthPercentageToken(word);
}

/*
 * `background` (css-backgrounds-3 §3.10): each layer's image, position, size
 * and repeat, and the last layer's colour, with what a layer leaves out at its
 * initial value. A value that is none of these drops the declaration.
 * DOM-CSS-LIMITATION(background-boxes-are-fixed): the attachment and the
 * origin and clip boxes are read and dropped, as the view places a background
 * against its padding box, paints it to its border box and scrolls it with
 * itself
 */
void expandBackground(std::string_view value, std::vector<Longhand>& out) {
  std::string images;
  std::string positions;
  std::string sizes;
  std::string repeats;
  std::string color = "transparent";
  auto join = [](std::string& list, const std::string& item) {
    if (!list.empty()) {
      list += ", ";
    }
    list += item;
  };
  auto layers = splitTopLevel(value, ',');
  for (size_t index = 0; index < layers.size(); index++) {
    bool last = index + 1 == layers.size();
    // `<position> / <size>` may be written without spaces around the slash
    auto halves = splitTopLevel(layers[index], '/');
    if (halves.size() > 2) {
      return;
    }
    std::vector<std::string_view> tokens = splitTopLevelWhitespace(halves[0]);
    if (halves.size() == 2) {
      tokens.emplace_back("/");
      for (auto token : splitTopLevelWhitespace(halves[1])) {
        tokens.push_back(token);
      }
    }
    std::optional<std::string> image;
    std::optional<std::string> position;
    std::optional<std::string> size;
    std::optional<std::string> repeat;
    std::optional<std::string> layerColor;
    auto run = [&](size_t& i, auto&& accepts, size_t most) {
      std::string words;
      size_t first = i;
      while (i < tokens.size() && i - first < most && accepts(tokens[i])) {
        if (!words.empty()) {
          words += " ";
        }
        words += std::string(tokens[i]);
        i++;
      }
      return words;
    };
    size_t i = 0;
    while (i < tokens.size()) {
      std::string word = lowercase(tokens[i]);
      if (isBackgroundImage(tokens[i]) && !image) {
        image = std::string(tokens[i++]);
      } else if (word == "repeat-x" || word == "repeat-y") {
        if (repeat) {
          return;
        }
        repeat = word;
        i++;
      } else if (isRepeatStyle(word) && !repeat) {
        repeat = run(i, isRepeatStyle, 2);
      } else if (word == "scroll" || word == "fixed" || word == "local") {
        i++;
      } else if (
          word == "border-box" || word == "padding-box" ||
          word == "content-box" || word == "text") {
        i++;
      } else if (isBackgroundPositionWord(tokens[i]) && !position) {
        position = run(i, isBackgroundPositionWord, 4);
        if (i < tokens.size() && tokens[i] == "/") {
          i++;
          size = run(i, isBackgroundSizeWord, 2);
          if (size->empty()) {
            return;
          }
        }
      } else if (
          last && !layerColor &&
          (parseColor(tokens[i]) || startsWith(tokens[i], "var(") ||
           word == "currentcolor")) {
        layerColor = std::string(tokens[i++]);
      } else {
        return;
      }
    }
    join(images, image.value_or("none"));
    join(positions, position.value_or("0% 0%"));
    join(sizes, size.value_or("auto"));
    join(repeats, repeat.value_or("repeat"));
    if (layerColor) {
      color = *layerColor;
    }
  }
  out.push_back({"backgroundImage", images});
  out.push_back({"backgroundPosition", positions});
  out.push_back({"backgroundSize", sizes});
  out.push_back({"backgroundRepeat", repeats});
  out.push_back({"backgroundColor", color});
}

// `transition` (css-transitions-1 §2.5): comma lists the renderer zips
void expandTransition(std::string_view value, std::vector<Longhand>& out) {
  std::string properties;
  std::string durations;
  std::string timings;
  std::string delays;
  for (auto segment : splitTopLevel(value, ',')) {
    std::string property = "all";
    std::string duration = "0s";
    std::string timing = "ease";
    std::string delay = "0s";
    bool sawDuration = false;
    for (auto token : splitTopLevelWhitespace(segment)) {
      if (isTime(token)) {
        if (!sawDuration) {
          duration = std::string(token);
          sawDuration = true;
        } else {
          delay = std::string(token);
        }
      } else if (isTiming(token)) {
        timing = std::string(token);
      } else {
        property = std::string(token);
      }
    }
    auto join = [](std::string& list, const std::string& item) {
      if (!list.empty()) {
        list += ", ";
      }
      list += item;
    };
    join(properties, property);
    join(durations, duration);
    join(timings, timing);
    join(delays, delay);
  }
  out.push_back({"transitionProperty", properties});
  out.push_back({"transitionDuration", durations});
  out.push_back({"transitionTimingFunction", timings});
  out.push_back({"transitionDelay", delays});
}

// `animation` (css-animations-1 §3.10). One animation per element: a comma
// list takes the first, which is what the renderer runs
void expandAnimation(std::string_view value, std::vector<Longhand>& out) {
  auto first = trimmed(splitTopLevel(value, ',')[0]);
  if (first.empty() || first == "none") {
    out.push_back({"animationName", "none"});
    return;
  }
  bool sawDuration = false;
  for (auto token : splitTopLevelWhitespace(first)) {
    if (isTime(token)) {
      out.push_back(
          {sawDuration ? "animationDelay" : "animationDuration",
           std::string(token)});
      sawDuration = true;
    } else if (isTiming(token)) {
      out.push_back({"animationTimingFunction", std::string(token)});
    } else if (token == "infinite" || isNumberToken(token)) {
      out.push_back({"animationIterationCount", std::string(token)});
    } else if (
        token == "normal" || token == "reverse" || token == "alternate" ||
        token == "alternate-reverse") {
      out.push_back({"animationDirection", std::string(token)});
    } else if (
        token == "none" || token == "forwards" || token == "backwards" ||
        token == "both") {
      out.push_back({"animationFillMode", std::string(token)});
    } else if (token == "running" || token == "paused") {
      // The play state is not modelled
    } else {
      out.push_back({"animationName", std::string(token)});
    }
  }
}

// `grid-column: 1 / 3`, `grid-row: span 2`
void expandGridLine(
    std::string_view start,
    std::string_view end,
    std::string_view value,
    std::vector<Longhand>& out) {
  auto parts = splitTopLevel(value, '/');
  std::string first(trimmed(parts[0]));
  std::string second;
  if (parts.size() > 1) {
    second = std::string(trimmed(parts[1]));
  } else {
    // A custom ident on its own names both lines; anything else leaves the
    // end automatic (css-grid-2 §8.4)
    bool ident = !first.empty() &&
        (std::isalpha(static_cast<unsigned char>(first[0])) ||
         first[0] == '_') &&
        first != "auto" && !startsWith(first, "span");
    second = ident ? first : "auto";
  }
  out.push_back({std::string(start), first});
  out.push_back({std::string(end), second});
}

} // namespace

void expandDeclaration(
    std::string_view property,
    std::string_view value,
    bool rtl,
    std::vector<Longhand>& out) {
  // The box families, by prefix and suffix
  if (startsWith(property, "padding")) {
    if (expandFamilyMember(kPadding, property.substr(7), value, rtl, out)) {
      return;
    }
  } else if (startsWith(property, "margin")) {
    if (expandFamilyMember(kMargin, property.substr(6), value, rtl, out)) {
      return;
    }
  } else if (startsWith(property, "border") && endsWith(property, "Width")) {
    if (expandFamilyMember(
            kBorderWidth,
            property.substr(6, property.size() - 11),
            value,
            rtl,
            out)) {
      return;
    }
  } else if (startsWith(property, "border") && endsWith(property, "Color")) {
    if (expandFamilyMember(
            kBorderColor,
            property.substr(6, property.size() - 11),
            value,
            rtl,
            out)) {
      return;
    }
  } else if (startsWith(property, "border") && endsWith(property, "Style")) {
    if (expandFamilyMember(
            kBorderStyle,
            property.substr(6, property.size() - 11),
            value,
            rtl,
            out)) {
      return;
    }
  } else if (endsWith(property, "Radius") && startsWith(property, "border")) {
    if (expandBorderRadius(property, value, rtl, out)) {
      return;
    }
  }
  if (expandInset(property, value, rtl, out)) {
    return;
  }
  if (expandBorderShorthand(property, value, rtl, out)) {
    return;
  }
  if (property == "gap" || property == "gridGap") {
    auto parts = splitTopLevelWhitespace(value);
    if (parts.empty() || parts.size() > 2) {
      return;
    }
    out.push_back({"rowGap", std::string(parts[0])});
    out.push_back(
        {"columnGap", std::string(parts.size() > 1 ? parts[1] : parts[0])});
    return;
  }
  if (property == "gridRowGap") {
    out.push_back({"rowGap", std::string(value)});
    return;
  }
  if (property == "gridColumnGap") {
    out.push_back({"columnGap", std::string(value)});
    return;
  }
  if (property == "flex") {
    expandFlex(value, out);
    return;
  }
  if (property == "flexFlow") {
    for (auto part : splitTopLevelWhitespace(value)) {
      bool wrap = part == "wrap" || part == "nowrap" || part == "wrap-reverse";
      out.push_back({wrap ? "flexWrap" : "flexDirection", std::string(part)});
    }
    return;
  }
  if (property == "placeContent" || property == "placeItems" ||
      property == "placeSelf") {
    auto parts = splitTopLevelWhitespace(value);
    if (parts.empty()) {
      return;
    }
    std::string block(parts[0]);
    std::string inlineValue(parts.size() > 1 ? parts[1] : parts[0]);
    std::string_view suffix = property.substr(5);
    out.push_back({"align" + std::string(suffix), block});
    out.push_back({"justify" + std::string(suffix), inlineValue});
    return;
  }
  if (property == "listStyle") {
    for (auto part : splitTopLevelWhitespace(value)) {
      if (part == "inside" || part == "outside") {
        out.push_back({"listStylePosition", std::string(part)});
      } else if (!startsWith(part, "url(") && !startsWith(part, "symbols(")) {
        // list-style-image is not drawn
        out.push_back({"listStyleType", std::string(part)});
      }
    }
    return;
  }
  if (property == "overflow") {
    auto parts = splitTopLevelWhitespace(value);
    if (parts.empty() || parts.size() > 2) {
      return;
    }
    out.push_back({"overflowX", std::string(parts[0])});
    out.push_back(
        {"overflowY", std::string(parts.size() > 1 ? parts[1] : parts[0])});
    return;
  }
  if (property == "textDecoration") {
    std::string lines;
    for (auto part : splitTopLevelWhitespace(value)) {
      std::string token = lowercase(part);
      if (token == "underline" || token == "line-through" ||
          token == "overline" || token == "none") {
        if (!lines.empty()) {
          lines += " ";
        }
        lines += token;
      } else if (
          token == "solid" || token == "double" || token == "dotted" ||
          token == "dashed" || token == "wavy") {
        out.push_back({"textDecorationStyle", token});
      } else {
        out.push_back({"textDecorationColor", std::string(part)});
      }
    }
    if (!lines.empty()) {
      out.push_back({"textDecorationLine", lines});
    }
    return;
  }
  if (property == "background") {
    expandBackground(value, out);
    return;
  }
  if (property == "transition") {
    expandTransition(value, out);
    return;
  }
  if (property == "animation") {
    expandAnimation(value, out);
    return;
  }
  if (property == "gridColumn") {
    expandGridLine("gridColumnStart", "gridColumnEnd", value, out);
    return;
  }
  if (property == "gridRow") {
    expandGridLine("gridRowStart", "gridRowEnd", value, out);
    return;
  }
  if (property == "inlineSize") {
    out.push_back({"width", std::string(value)});
    return;
  }
  if (property == "blockSize") {
    out.push_back({"height", std::string(value)});
    return;
  }
  if (property == "minInlineSize") {
    out.push_back({"minWidth", std::string(value)});
    return;
  }
  if (property == "maxInlineSize") {
    out.push_back({"maxWidth", std::string(value)});
    return;
  }
  if (property == "minBlockSize") {
    out.push_back({"minHeight", std::string(value)});
    return;
  }
  if (property == "maxBlockSize") {
    out.push_back({"maxHeight", std::string(value)});
    return;
  }
  out.push_back({std::string(property), std::string(value)});
}

bool isInheritedProperty(std::string_view property) {
  static const std::unordered_set<std::string_view> inherited = {
      "color",
      "pointerEvents",
      "fontFamily",
      "fontSize",
      "fontStyle",
      "fontVariant",
      "fontWeight",
      "letterSpacing",
      "lineHeight",
      "textAlign",
      "textTransform",
      "whiteSpace",
      "overflowWrap",
      "wordWrap",
      "writingDirection",
      "direction",
      "visibility",
      "listStyleType",
      "listStylePosition",
  };
  return inherited.count(property) != 0;
}

bool isDroppedProperty(std::string_view property) {
  static const std::vector<std::string_view> prefixes = {
      "cursor",
      "outline",
      "willChange",
      "contain",
      "scroll",
      "textWrap",
      "overscroll",
      "appearance",
      "anchorName",
      "viewTransition",
      "backdropFilter",
      "clipPath",
      "mask",
      "content",
      "Webkit",
      "Moz",
      "accentColor",
      "colorScheme",
      "forcedColorAdjust",
      "textRendering",
      "textSizeAdjust",
      "fontSmoothing",
      "fontFeatureSettings",
      "fontKerning",
      "fontOpticalSizing",
      "tabSize",
      "touchAction",
      "resize",
      "hyphens",
      "wordBreak",
      "textOverflow",
      "speak",
      "quotes",
      "caretColor",
      "fieldSizing",
      "interpolateSize",
  };
  for (auto prefix : prefixes) {
    if (startsWith(property, prefix)) {
      return true;
    }
  }
  return false;
}

namespace {

// -- Conversion --

using Dynamic = folly::dynamic;

std::optional<double> numberValue(std::string_view value) {
  return parseNumber(value);
}

enum class LengthKind : uint8_t {
  Size,
  MaxSize,
  Margin,
  Padding,
  Inset,
  FlexBasis,
  Gap,
  BorderWidth,
  BorderRadius,
};

// A length the way React Native's prop of that kind takes it: points as a
// number, a percentage as a string, and the keywords the prop knows
std::optional<Dynamic> convertLength(
    LengthKind kind,
    std::string_view value,
    const LengthBasis& basis) {
  std::string text = lowercase(trimmed(value));
  if (text == "auto") {
    if (kind == LengthKind::Size || kind == LengthKind::Margin ||
        kind == LengthKind::Inset || kind == LengthKind::FlexBasis) {
      return Dynamic("auto");
    }
    return std::nullopt;
  }
  if (kind == LengthKind::MaxSize && text == "none") {
    return Dynamic(nullptr);
  }
  if (kind == LengthKind::FlexBasis && text == "content") {
    return Dynamic("auto");
  }
  if (kind == LengthKind::Size || kind == LengthKind::MaxSize) {
    if (text == "max-content" || text == "fit-content" || text == "stretch" ||
        text == "-webkit-fill-available") {
      return Dynamic(text == "-webkit-fill-available" ? "stretch" : text);
    }
    if (text == "min-content") {
      // DOM-CSS-LIMITATION(grid-min-content): measured as max-content
      return Dynamic("max-content");
    }
  }
  if (kind == LengthKind::BorderWidth) {
    if (text == "thin") {
      return Dynamic(1.0);
    }
    if (text == "medium") {
      return Dynamic(3.0);
    }
    if (text == "thick") {
      return Dynamic(5.0);
    }
  }
  auto evaluated = substituteMath(text, basis);
  if (!evaluated) {
    // A percentage in a math function is resolved by layout, against what
    // the property's percentages are of; a border's width takes none, and a
    // radius's are of the box itself
    if (kind != LengthKind::BorderWidth && kind != LengthKind::BorderRadius) {
      if (auto math = mathForLayout(text, basis)) {
        return Dynamic(std::move(*math));
      }
    }
    return std::nullopt;
  }
  std::string_view resolved = trimmed(*evaluated);
  if (!resolved.empty() && resolved.back() == '%') {
    auto number = parseNumber(resolved.substr(0, resolved.size() - 1));
    if (!number || kind == LengthKind::BorderWidth) {
      return std::nullopt;
    }
    return Dynamic(std::string(resolved));
  }
  auto length = resolveLength(resolved, basis);
  if (!length) {
    return std::nullopt;
  }
  if (kind == LengthKind::Padding || kind == LengthKind::BorderWidth ||
      kind == LengthKind::Gap || kind == LengthKind::BorderRadius ||
      kind == LengthKind::Size || kind == LengthKind::MaxSize) {
    if (*length < 0) {
      return std::nullopt;
    }
  }
  return Dynamic(*length);
}

std::optional<LengthKind> lengthKindOf(std::string_view property) {
  static const std::unordered_map<std::string_view, LengthKind> kinds = {
      {"width", LengthKind::Size},
      {"height", LengthKind::Size},
      {"minWidth", LengthKind::Size},
      {"minHeight", LengthKind::Size},
      {"maxWidth", LengthKind::MaxSize},
      {"maxHeight", LengthKind::MaxSize},
      {"marginTop", LengthKind::Margin},
      {"marginBottom", LengthKind::Margin},
      {"marginStart", LengthKind::Margin},
      {"marginEnd", LengthKind::Margin},
      {"paddingTop", LengthKind::Padding},
      {"paddingBottom", LengthKind::Padding},
      {"paddingStart", LengthKind::Padding},
      {"paddingEnd", LengthKind::Padding},
      {"top", LengthKind::Inset},
      {"bottom", LengthKind::Inset},
      {"start", LengthKind::Inset},
      {"end", LengthKind::Inset},
      {"flexBasis", LengthKind::FlexBasis},
      {"rowGap", LengthKind::Gap},
      {"columnGap", LengthKind::Gap},
      {"borderTopWidth", LengthKind::BorderWidth},
      {"borderBottomWidth", LengthKind::BorderWidth},
      {"borderStartWidth", LengthKind::BorderWidth},
      {"borderEndWidth", LengthKind::BorderWidth},
      {"borderTopLeftRadius", LengthKind::BorderRadius},
      {"borderTopRightRadius", LengthKind::BorderRadius},
      {"borderBottomLeftRadius", LengthKind::BorderRadius},
      {"borderBottomRightRadius", LengthKind::BorderRadius},
  };
  auto found = kinds.find(property);
  if (found == kinds.end()) {
    return std::nullopt;
  }
  return found->second;
}

bool isColorProperty(std::string_view property) {
  static const std::unordered_set<std::string_view> colors = {
      "color",
      "backgroundColor",
      "borderTopColor",
      "borderBottomColor",
      "borderStartColor",
      "borderEndColor",
      "textDecorationColor",
      "tintColor",
      "overlayColor",
      "textShadowColor",
      "shadowColor",
  };
  return colors.count(property) != 0;
}

std::optional<Dynamic> convertColor(
    std::string_view value,
    const ConversionContext& context) {
  std::string text = substituteCurrentColor(value, context.currentColor);
  auto color = parseColor(text);
  if (!color) {
    return std::nullopt;
  }
  // React Native's packed colour, the signed 32-bit 0xAARRGGBB its
  // `processColor` hands Android: Android reads a colour prop as an `int`, so
  // an opaque colour written unsigned, above INT32_MAX, saturates to
  // 0x7FFFFFFF, a half-transparent white. The C++ props read either form.
  return Dynamic(static_cast<int64_t>(static_cast<int32_t>(*color)));
}

// A CSS transform list as React Native's array of one-key objects. A
// percentage translate stays a string, which the renderer resolves against
// the box; an angle stays a string with its unit.
std::optional<Dynamic> convertTransform(
    std::string_view value,
    const LengthBasis& basis) {
  std::string text(trimmed(value));
  if (text == "none") {
    return Dynamic::array();
  }
  Dynamic out = Dynamic::array();
  size_t cursor = 0;
  while (cursor < text.size()) {
    size_t open = text.find('(', cursor);
    if (open == std::string::npos) {
      break;
    }
    std::string name(
        trimmed(std::string_view(text).substr(cursor, open - cursor)));
    auto call = findFunction(text, name, cursor);
    if (!call) {
      return std::nullopt;
    }
    auto arguments = splitTopLevel(
        std::string_view(text).substr(
            call->open + 1, call->close - call->open - 1),
        ',');
    auto length = [&](std::string_view argument) -> std::optional<Dynamic> {
      std::string_view trimmedArgument = trimmed(argument);
      if (!trimmedArgument.empty() && trimmedArgument.back() == '%') {
        return Dynamic(std::string(trimmedArgument));
      }
      auto evaluated = substituteMath(trimmedArgument, basis);
      if (!evaluated) {
        return std::nullopt;
      }
      auto points = resolveLength(*evaluated, basis);
      if (!points) {
        return std::nullopt;
      }
      return Dynamic(*points);
    };
    auto number = [&](std::string_view argument) -> std::optional<Dynamic> {
      std::string_view trimmedArgument = trimmed(argument);
      if (!trimmedArgument.empty() && trimmedArgument.back() == '%') {
        auto percent =
            parseNumber(trimmedArgument.substr(0, trimmedArgument.size() - 1));
        if (!percent) {
          return std::nullopt;
        }
        return Dynamic(*percent / 100);
      }
      auto parsed = parseNumber(trimmedArgument);
      if (!parsed) {
        return std::nullopt;
      }
      return Dynamic(*parsed);
    };
    auto angle = [&](std::string_view argument) -> std::optional<Dynamic> {
      std::string_view trimmedArgument = trimmed(argument);
      if (trimmedArgument == "0") {
        return Dynamic("0deg");
      }
      return Dynamic(std::string(trimmedArgument));
    };
    auto push = [&](std::string_view key, std::optional<Dynamic> item) {
      if (!item) {
        return false;
      }
      out.push_back(Dynamic::object(std::string(key), std::move(*item)));
      return true;
    };
    bool ok = true;
    if (name == "translate" || name == "translate3d") {
      ok = push("translateX", length(arguments[0]));
      if (ok && arguments.size() > 1) {
        ok = push("translateY", length(arguments[1]));
      }
    } else if (name == "translateX") {
      ok = push("translateX", length(arguments[0]));
    } else if (name == "translateY") {
      ok = push("translateY", length(arguments[0]));
    } else if (name == "scale" || name == "scale3d") {
      if (arguments.size() > 1 &&
          trimmed(arguments[1]) != trimmed(arguments[0])) {
        ok = push("scaleX", number(arguments[0])) &&
            push("scaleY", number(arguments[1]));
      } else {
        ok = push("scale", number(arguments[0]));
      }
    } else if (name == "scaleX") {
      ok = push("scaleX", number(arguments[0]));
    } else if (name == "scaleY") {
      ok = push("scaleY", number(arguments[0]));
    } else if (
        name == "rotate" || name == "rotateZ" || name == "rotateX" ||
        name == "rotateY" || name == "skewX" || name == "skewY") {
      ok = push(name == "rotateZ" ? "rotate" : name, angle(arguments[0]));
    } else if (name == "perspective") {
      ok = push("perspective", length(arguments[0]));
    } else if (name == "matrix") {
      Dynamic matrix = Dynamic::array();
      if (arguments.size() != 6) {
        return std::nullopt;
      }
      double v[6];
      for (size_t i = 0; i < 6; i++) {
        auto parsed = parseNumber(arguments[i]);
        if (!parsed) {
          return std::nullopt;
        }
        v[i] = *parsed;
      }
      // The 2D matrix as the 4×4 one React Native reads
      for (double item :
           {v[0],
            v[1],
            0.0,
            0.0,
            v[2],
            v[3],
            0.0,
            0.0,
            0.0,
            0.0,
            1.0,
            0.0,
            v[4],
            v[5],
            0.0,
            1.0}) {
        matrix.push_back(item);
      }
      out.push_back(Dynamic::object("matrix", std::move(matrix)));
    } else {
      return std::nullopt;
    }
    if (!ok) {
      return std::nullopt;
    }
    cursor = call->close + 1;
    while (cursor < text.size() &&
           std::isspace(static_cast<unsigned char>(text[cursor]))) {
      cursor++;
    }
  }
  return out;
}

// `transform-origin` as React Native's [x, y, z]
std::optional<Dynamic> convertTransformOrigin(
    std::string_view value,
    const LengthBasis& basis) {
  auto parts = splitTopLevelWhitespace(value);
  if (parts.empty() || parts.size() > 3) {
    return std::nullopt;
  }
  auto keywordPercent =
      [](std::string_view word) -> std::optional<std::string> {
    if (word == "left" || word == "top") {
      return "0%";
    }
    if (word == "center") {
      return "50%";
    }
    if (word == "right" || word == "bottom") {
      return "100%";
    }
    return std::nullopt;
  };
  std::string first(parts[0]);
  std::string second(parts.size() > 1 ? std::string(parts[1]) : "center");
  // `top left` names the vertical one first
  if (first == "top" || first == "bottom" ||
      (second == "left" || second == "right")) {
    std::swap(first, second);
  }
  Dynamic origin = Dynamic::array();
  for (const std::string& part : {first, second}) {
    auto keyword = keywordPercent(part);
    if (keyword) {
      origin.push_back(*keyword);
      continue;
    }
    if (!part.empty() && part.back() == '%') {
      origin.push_back(part);
      continue;
    }
    auto points = resolveLength(part, basis);
    if (!points) {
      return std::nullopt;
    }
    origin.push_back(*points);
  }
  double z = 0;
  if (parts.size() > 2) {
    auto points = resolveLength(parts[2], basis);
    if (!points) {
      return std::nullopt;
    }
    z = *points;
  }
  origin.push_back(z);
  return origin;
}

// A percentage as written, `50%`, or a length in points, which is how React
// Native's background props take an offset or a size
std::optional<Dynamic> backgroundLength(
    std::string_view part,
    const LengthBasis& basis) {
  std::string word = lowercase(trimmed(part));
  if (!word.empty() && word.back() == '%') {
    if (!parseNumber(std::string_view(word).substr(0, word.size() - 1))) {
      return std::nullopt;
    }
    return Dynamic(word);
  }
  auto points = resolveLength(word, basis);
  if (!points) {
    return std::nullopt;
  }
  return Dynamic(*points);
}

// `background-size` (css-backgrounds-3 §3.9) as React Native's list, a layer
// each: `cover`, `contain`, or an `{x, y}` of lengths, percentages or `auto`
std::optional<Dynamic> convertBackgroundSize(
    std::string_view value,
    const LengthBasis& basis) {
  Dynamic sizes = Dynamic::array();
  for (auto layer : splitTopLevel(value, ',')) {
    auto parts = splitTopLevelWhitespace(layer);
    if (parts.size() == 1 &&
        (lowercase(parts[0]) == "cover" || lowercase(parts[0]) == "contain")) {
      sizes.push_back(lowercase(parts[0]));
      continue;
    }
    if (parts.empty() || parts.size() > 2) {
      return std::nullopt;
    }
    auto component = [&](std::string_view part) -> std::optional<Dynamic> {
      if (lowercase(part) == "auto") {
        return Dynamic("auto");
      }
      auto length = backgroundLength(part, basis);
      // A size is never negative
      if (!length || (length->isNumber() && length->asDouble() < 0) ||
          (length->isString() && length->asString().front() == '-')) {
        return std::nullopt;
      }
      return length;
    };
    auto x = component(parts[0]);
    auto y = parts.size() > 1 ? component(parts[1])
                              : std::optional<Dynamic>(Dynamic("auto"));
    if (!x || !y) {
      return std::nullopt;
    }
    sizes.push_back(Dynamic::object("x", std::move(*x))("y", std::move(*y)));
  }
  return sizes;
}

// One layer's `<bg-position>` (css-backgrounds-3 §3.6) as the edges React
// Native offsets the image from: `{left|right, top|bottom}`
std::optional<Dynamic> convertBackgroundPositionLayer(
    std::string_view layer,
    const LengthBasis& basis) {
  std::vector<std::string> words;
  for (auto part : splitTopLevelWhitespace(layer)) {
    words.push_back(lowercase(part));
  }
  auto isKeyword = [](const std::string& word) {
    return word == "left" || word == "right" || word == "top" ||
        word == "bottom" || word == "center";
  };
  Dynamic position = Dynamic::object();
  if (words.size() == 1 || words.size() == 2) {
    std::string x = words[0];
    std::string y = words.size() == 2 ? words[1] : "center";
    // Two keywords may come in either order, and a lone vertical one names y
    if ((x == "top" || x == "bottom") && isKeyword(y)) {
      std::swap(x, y);
    } else if ((y == "left" || y == "right") && isKeyword(x)) {
      std::swap(x, y);
    }
    if (x == "top" || x == "bottom" || y == "left" || y == "right") {
      return std::nullopt;
    }
    auto offset = [&](const std::string& word,
                      std::string_view start,
                      std::string_view end) -> std::optional<Dynamic> {
      if (word == start) {
        return Dynamic("0%");
      }
      if (word == "center") {
        return Dynamic("50%");
      }
      if (word == end) {
        return Dynamic("100%");
      }
      return backgroundLength(word, basis);
    };
    auto left = offset(x, "left", "right");
    auto top = offset(y, "top", "bottom");
    if (!left || !top) {
      return std::nullopt;
    }
    position["left"] = std::move(*left);
    position["top"] = std::move(*top);
    return position;
  }
  if (words.size() > 4) {
    return std::nullopt;
  }
  // Three or four values: each keyword with the offset after it, if any
  bool horizontal = false;
  bool vertical = false;
  size_t centers = 0;
  for (size_t i = 0; i < words.size(); i++) {
    const std::string& keyword = words[i];
    if (!isKeyword(keyword)) {
      return std::nullopt;
    }
    std::optional<Dynamic> offset;
    if (i + 1 < words.size() && !isKeyword(words[i + 1])) {
      if (keyword == "center") {
        return std::nullopt;
      }
      offset = backgroundLength(words[++i], basis);
      if (!offset) {
        return std::nullopt;
      }
    }
    if (keyword == "center") {
      centers++;
      continue;
    }
    bool isHorizontal = keyword == "left" || keyword == "right";
    if ((isHorizontal && horizontal) || (!isHorizontal && vertical)) {
      return std::nullopt;
    }
    (isHorizontal ? horizontal : vertical) = true;
    position[keyword] = offset ? std::move(*offset) : Dynamic("0%");
  }
  if (centers + (horizontal ? 1 : 0) + (vertical ? 1 : 0) != 2) {
    return std::nullopt;
  }
  if (!horizontal) {
    position["left"] = "50%";
  }
  if (!vertical) {
    position["top"] = "50%";
  }
  return position;
}

// `background-position` as React Native's list, a layer each
std::optional<Dynamic> convertBackgroundPosition(
    std::string_view value,
    const LengthBasis& basis) {
  Dynamic positions = Dynamic::array();
  for (auto layer : splitTopLevel(value, ',')) {
    auto position = convertBackgroundPositionLayer(layer, basis);
    if (!position) {
      return std::nullopt;
    }
    positions.push_back(std::move(*position));
  }
  return positions;
}

// `background-repeat` (css-backgrounds-3 §3.4) as React Native's list, a
// layer each: `{x, y}`
std::optional<Dynamic> convertBackgroundRepeat(std::string_view value) {
  Dynamic repeats = Dynamic::array();
  for (auto layer : splitTopLevel(value, ',')) {
    std::vector<std::string> words;
    for (auto part : splitTopLevelWhitespace(layer)) {
      words.push_back(lowercase(part));
    }
    std::string x;
    std::string y;
    if (words.size() == 1 && words[0] == "repeat-x") {
      x = "repeat";
      y = "no-repeat";
    } else if (words.size() == 1 && words[0] == "repeat-y") {
      x = "no-repeat";
      y = "repeat";
    } else if (words.size() == 1 && isRepeatStyle(words[0])) {
      x = y = words[0];
    } else if (
        words.size() == 2 && isRepeatStyle(words[0]) &&
        isRepeatStyle(words[1])) {
      x = words[0];
      y = words[1];
    } else {
      return std::nullopt;
    }
    repeats.push_back(Dynamic::object("x", x)("y", y));
  }
  return repeats;
}

// `box-shadow` (css-backgrounds-3 §6.1) as React Native's array of shadows
std::optional<Dynamic> convertBoxShadow(
    std::string_view value,
    const ConversionContext& context) {
  std::string text = lowercase(trimmed(value));
  if (text == "none") {
    return Dynamic::array();
  }
  Dynamic shadows = Dynamic::array();
  for (auto layer : splitTopLevel(value, ',')) {
    Dynamic shadow = Dynamic::object();
    std::vector<double> lengths;
    std::optional<Dynamic> color;
    bool inset = false;
    for (auto token : splitTopLevelWhitespace(layer)) {
      if (lowercase(token) == "inset") {
        inset = true;
        continue;
      }
      auto evaluated = substituteMath(token, context.basis);
      if (evaluated) {
        auto points = resolveLength(*evaluated, context.basis);
        if (points) {
          lengths.push_back(*points);
          continue;
        }
      }
      auto parsed = convertColor(token, context);
      if (!parsed) {
        return std::nullopt;
      }
      color = parsed;
    }
    if (lengths.size() < 2 || lengths.size() > 4) {
      return std::nullopt;
    }
    shadow["offsetX"] = lengths[0];
    shadow["offsetY"] = lengths[1];
    if (lengths.size() > 2) {
      if (lengths[2] < 0) {
        return std::nullopt;
      }
      shadow["blurRadius"] = lengths[2];
    }
    if (lengths.size() > 3) {
      shadow["spreadDistance"] = lengths[3];
    }
    if (inset) {
      shadow["inset"] = true;
    }
    if (!color) {
      color = convertColor(context.currentColor, context);
    }
    if (color) {
      shadow["color"] = *color;
    }
    shadows.push_back(std::move(shadow));
  }
  return shadows;
}

// `filter` (filter-effects-1 §5) as React Native's array of one-key objects
std::optional<Dynamic> convertFilter(
    std::string_view value,
    const ConversionContext& context) {
  std::string text = lowercase(trimmed(value));
  if (text == "none") {
    return Dynamic::array();
  }
  Dynamic filters = Dynamic::array();
  size_t cursor = 0;
  while (cursor < text.size()) {
    size_t open = text.find('(', cursor);
    if (open == std::string::npos) {
      break;
    }
    std::string name(
        trimmed(std::string_view(text).substr(cursor, open - cursor)));
    auto call = findFunction(text, name, cursor);
    if (!call) {
      return std::nullopt;
    }
    std::string_view argument = trimmed(
        std::string_view(text).substr(
            call->open + 1, call->close - call->open - 1));
    // Original case, for a colour
    std::string_view original = trimmed(
        std::string_view(value).substr(
            call->open + 1, call->close - call->open - 1));
    auto amount = [&](double full) -> std::optional<double> {
      if (!argument.empty() && argument.back() == '%') {
        auto percent = parseNumber(argument.substr(0, argument.size() - 1));
        if (!percent) {
          return std::nullopt;
        }
        return *percent / 100 * full;
      }
      return parseNumber(argument);
    };
    if (name == "blur") {
      auto points = resolveLength(argument, context.basis);
      if (!points) {
        return std::nullopt;
      }
      filters.push_back(Dynamic::object("blur", *points));
    } else if (name == "hue-rotate") {
      filters.push_back(Dynamic::object("hueRotate", std::string(argument)));
    } else if (name == "drop-shadow") {
      auto shadow = convertBoxShadow(original, context);
      if (!shadow || shadow->empty()) {
        return std::nullopt;
      }
      Dynamic params = Dynamic::object();
      params["offsetX"] = (*shadow)[0]["offsetX"];
      params["offsetY"] = (*shadow)[0]["offsetY"];
      if ((*shadow)[0].count("blurRadius") != 0) {
        params["standardDeviation"] = (*shadow)[0]["blurRadius"];
      }
      if ((*shadow)[0].count("color") != 0) {
        params["color"] = (*shadow)[0]["color"];
      }
      filters.push_back(Dynamic::object("dropShadow", std::move(params)));
    } else {
      static const std::unordered_map<std::string_view, std::string_view> keys =
          {
              {"brightness", "brightness"},
              {"contrast", "contrast"},
              {"grayscale", "grayscale"},
              {"invert", "invert"},
              {"opacity", "opacity"},
              {"saturate", "saturate"},
              {"sepia", "sepia"},
          };
      auto key = keys.find(name);
      if (key == keys.end()) {
        return std::nullopt;
      }
      auto parsed = amount(1);
      if (!parsed) {
        return std::nullopt;
      }
      filters.push_back(Dynamic::object(std::string(key->second), *parsed));
    }
    cursor = call->close + 1;
    while (cursor < text.size() &&
           std::isspace(static_cast<unsigned char>(text[cursor]))) {
      cursor++;
    }
  }
  return filters;
}

// `font-size`: points, or the `em` factor the renderer's text cascade
// resolves against the inherited size
void convertFontSize(
    std::string_view value,
    const ConversionContext& context,
    Dynamic& props) {
  std::string text = lowercase(trimmed(value));
  static const std::unordered_map<std::string_view, double> absolute = {
      {"xx-small", 9},
      {"x-small", 10},
      {"small", 13},
      {"medium", 16},
      {"large", 18},
      {"x-large", 24},
      {"xx-large", 32},
      {"xxx-large", 48},
  };
  auto keyword = absolute.find(text);
  if (keyword != absolute.end()) {
    props["fontSize"] = keyword->second;
    return;
  }
  if (text == "smaller" || text == "larger") {
    props["fontSizeEm"] = text == "smaller" ? 1 / 1.2 : 1.2;
    return;
  }
  if (endsWith(text, "em") && !endsWith(text, "rem")) {
    auto factor =
        parseNumber(std::string_view(text).substr(0, text.size() - 2));
    if (factor && *factor >= 0) {
      props["fontSizeEm"] = *factor;
    }
    return;
  }
  if (!text.empty() && text.back() == '%') {
    auto percent =
        parseNumber(std::string_view(text).substr(0, text.size() - 1));
    if (percent && *percent >= 0) {
      props["fontSizeEm"] = *percent / 100;
    }
    return;
  }
  // `em` inside a math function is the parent's size (css-values-4 §6.1.1)
  LengthBasis basis = context.basis;
  basis.fontSize = context.parentFontSize;
  auto evaluated = substituteMath(text, basis);
  if (!evaluated) {
    return;
  }
  auto points = resolveLength(*evaluated, basis);
  if (points && *points >= 0) {
    props["fontSize"] = *points;
  }
}

std::optional<Dynamic> convertFontWeight(std::string_view value) {
  std::string text = lowercase(trimmed(value));
  if (text == "normal") {
    return Dynamic(400);
  }
  if (text == "bold") {
    return Dynamic(700);
  }
  auto number = parseNumber(text);
  if (!number || *number < 1 || *number > 1000) {
    return std::nullopt;
  }
  // The renderer names the hundreds
  int rounded = static_cast<int>(std::round(*number / 100)) * 100;
  return Dynamic(std::max(100, std::min(900, rounded)));
}

const std::unordered_set<std::string_view>& passedThroughStrings() {
  static const std::unordered_set<std::string_view> names = {
      "flexDirection",
      "flexWrap",
      "alignItems",
      "alignSelf",
      "alignContent",
      "justifyContent",
      "justifyItems",
      "justifySelf",
      "boxSizing",
      "textTransform",
      "fontStyle",
      "fontFamily",
      "whiteSpace",
      "overflowWrap",
      "wordWrap",
      "verticalAlign",
      "textDecorationLine",
      "textDecorationStyle",
      "pointerEvents",
      "backfaceVisibility",
      "mixBlendMode",
      "isolation",
      "userSelect",
      "objectFit",
      "listStyleType",
      "listStylePosition",
      "gridTemplateColumns",
      "gridTemplateRows",
      "gridTemplateAreas",
      "gridAutoColumns",
      "gridAutoRows",
      "gridAutoFlow",
      "gridArea",
      "gridColumnStart",
      "gridColumnEnd",
      "gridRowStart",
      "gridRowEnd",
      "transitionProperty",
      "transitionDuration",
      "transitionDelay",
      "transitionTimingFunction",
      "animationDuration",
      "animationDelay",
      "animationTimingFunction",
      "animationIterationCount",
      "animationDirection",
      "animationFillMode",
      "float",
      "clear",
      "writingDirection",
      "positionAnchor",
      "positionArea",
      "positionTryFallbacks",
      "positionTryOrder",
      "cornerShape",
      "dynamicRangeLimit",
  };
  return names;
}

} // namespace

// Whether a longhand's prop has its own name, as all but the ones folded
// into another prop do
static bool writesItsOwnName(std::string_view property) {
  return !(
      (startsWith(property, "border") && endsWith(property, "Style")) ||
      property == "overflowX" || property == "overflowY" ||
      property == "fontSize" || property == "visibility" ||
      property == "animationName");
}

void convertLonghands(
    const std::vector<Longhand>& cascaded,
    const ConversionContext& context,
    folly::dynamic& props) {
  std::unordered_map<std::string_view, std::string_view> byName;
  for (const auto& longhand : cascaded) {
    byName[longhand.property] = longhand.value;
  }
  auto valueOf = [&](std::string_view name) -> std::optional<std::string_view> {
    auto found = byName.find(name);
    if (found == byName.end()) {
      return std::nullopt;
    }
    return found->second;
  };

  // The used border width of a side whose style is `none` or `hidden` is zero
  // (css-backgrounds-3 §4.3); React Native draws one style for all four
  std::optional<std::string> borderStyle;
  std::unordered_set<std::string> noBorder;
  for (std::string_view edge : {"Top", "Bottom", "Start", "End"}) {
    auto style = valueOf("border" + std::string(edge) + "Style");
    if (!style) {
      continue;
    }
    std::string keyword = lowercase(trimmed(*style));
    if (keyword == "none" || keyword == "hidden") {
      noBorder.insert(std::string(edge));
    } else if (!borderStyle) {
      borderStyle =
          keyword == "solid" || keyword == "dashed" || keyword == "dotted"
          ? keyword
          : "solid";
    }
  }
  if (borderStyle) {
    props["borderStyle"] = *borderStyle;
  }

  auto convertOne = [&](const Longhand& longhand) {
    const std::string& property = longhand.property;
    std::string_view value = longhand.value;
    std::string keyword = lowercase(trimmed(value));

    if (endsWith(property, "Style") && startsWith(property, "border")) {
      return;
    }
    if (property == "overflowX" || property == "overflowY" ||
        property == "fontSize" || property == "visibility") {
      return;
    }
    if (keyword == "inherit" || keyword == "initial" || keyword == "unset" ||
        keyword == "revert" || keyword == "revert-layer") {
      // `null` cancels the layers under the author's: the renderer's cascade
      // supplies an inherited property's value, and React Native's default is
      // the initial value of the rest
      props[property] = nullptr;
      return;
    }
    if (auto kind = lengthKindOf(property)) {
      if (*kind == LengthKind::BorderWidth) {
        std::string edge = property.substr(6, property.size() - 11);
        if (noBorder.count(edge) != 0) {
          props[property] = 0.0;
          return;
        }
      }
      auto converted = convertLength(*kind, value, context.basis);
      if (converted) {
        props[property] = std::move(*converted);
      }
      return;
    }
    if (isColorProperty(property)) {
      auto converted = convertColor(value, context);
      if (converted) {
        props[property] = std::move(*converted);
      }
      return;
    }
    if (property == "opacity") {
      std::optional<double> number;
      if (!keyword.empty() && keyword.back() == '%') {
        auto percent = parseNumber(
            std::string_view(keyword).substr(0, keyword.size() - 1));
        if (percent) {
          number = *percent / 100;
        }
      } else {
        number = numberValue(keyword);
      }
      if (number) {
        props["opacity"] = std::max(0.0, std::min(1.0, *number));
      }
      return;
    }
    if (property == "flexGrow" || property == "flexShrink") {
      auto number = numberValue(keyword);
      if (number && *number >= 0) {
        props[property] = *number;
      }
      return;
    }
    if (property == "order") {
      // `order: <integer>` (css-flexbox-1 §5.4); a number that is not an
      // integer is invalid, and the declaration is dropped
      auto number = numberValue(keyword);
      if (number && std::floor(*number) == *number) {
        props["order"] = static_cast<int64_t>(*number);
      }
      return;
    }
    if (property == "zIndex") {
      auto number = numberValue(keyword);
      if (number) {
        props["zIndex"] = static_cast<int64_t>(std::round(*number));
      } else if (keyword == "auto") {
        props["zIndex"] = nullptr;
      }
      return;
    }
    if (property == "aspectRatio") {
      auto parts = splitTopLevel(keyword, '/');
      auto width = numberValue(parts[0]);
      auto height =
          parts.size() > 1 ? numberValue(parts[1]) : std::optional<double>(1);
      if (width && height && *height != 0) {
        props["aspectRatio"] = *width / *height;
      } else if (keyword == "auto") {
        props["aspectRatio"] = nullptr;
      }
      return;
    }
    if (property == "fontWeight") {
      auto converted = convertFontWeight(value);
      if (converted) {
        props["fontWeight"] = std::move(*converted);
      }
      return;
    }
    if (property == "lineHeight") {
      if (keyword == "normal") {
        props["lineHeight"] = nullptr;
        return;
      }
      double fontSize = context.basis.fontSize;
      if (auto number = numberValue(keyword)) {
        // A unitless line height multiplies the font size; React Native's is
        // absolute
        props["lineHeight"] = *number * fontSize;
        return;
      }
      if (!keyword.empty() && keyword.back() == '%') {
        auto percent = parseNumber(
            std::string_view(keyword).substr(0, keyword.size() - 1));
        if (percent) {
          props["lineHeight"] = *percent / 100 * fontSize;
        }
        return;
      }
      auto evaluated = substituteMath(keyword, context.basis);
      if (evaluated) {
        if (auto points = resolveLength(*evaluated, context.basis)) {
          props["lineHeight"] = *points;
        }
      }
      return;
    }
    if (property == "letterSpacing") {
      if (keyword == "normal") {
        props["letterSpacing"] = nullptr;
        return;
      }
      auto evaluated = substituteMath(keyword, context.basis);
      if (evaluated) {
        if (auto points = resolveLength(*evaluated, context.basis)) {
          props["letterSpacing"] = *points;
        }
      }
      return;
    }
    if (property == "display") {
      std::string display = keyword;
      if (display == "-webkit-box" || display == "-webkit-inline-box") {
        display = "flex";
      }
      props["display"] = display;
      return;
    }
    if (property == "pointerEvents") {
      // CSS's `none` leaves the element out of hit testing but a descendant
      // that sets `auto` is still a target, and the property inherits, so a
      // subtree opts out element by element. React Native's `none` takes the
      // whole subtree out; its `box-none` is CSS's `none` on the element
      // alone, and the inherited value reaches each descendant as its own.
      props["pointerEvents"] = keyword == "none" ? "box-none" : keyword;
      return;
    }
    if (property == "position") {
      // DOM-CSS-LIMITATION(position-fixed-as-absolute)
      if (keyword == "fixed") {
        props["position"] = "absolute";
      } else if (keyword == "sticky") {
        props["position"] = "relative";
      } else {
        props["position"] = keyword;
      }
      return;
    }
    if (property == "textAlign") {
      std::string align = keyword;
      if (align == "start") {
        align = context.rtl ? "right" : "left";
      } else if (align == "end") {
        align = context.rtl ? "left" : "right";
      } else if (align == "-webkit-center" || align == "-moz-center") {
        align = "center";
      } else if (align == "match-parent") {
        return;
      }
      props["textAlign"] = align;
      return;
    }
    if (property == "direction") {
      props["direction"] = keyword;
      return;
    }
    if (property == "transform") {
      if (auto converted = convertTransform(value, context.basis)) {
        props["transform"] = std::move(*converted);
      }
      return;
    }
    if (property == "transformOrigin") {
      if (auto converted = convertTransformOrigin(value, context.basis)) {
        props["transformOrigin"] = std::move(*converted);
      }
      return;
    }
    if (property == "boxShadow") {
      if (auto converted = convertBoxShadow(value, context)) {
        props["boxShadow"] = std::move(*converted);
      }
      return;
    }
    if (property == "filter") {
      if (auto converted = convertFilter(value, context)) {
        props["filter"] = std::move(*converted);
      }
      return;
    }
    if (property == "fontVariant") {
      Dynamic variants = Dynamic::array();
      if (keyword != "normal") {
        for (auto part : splitTopLevelWhitespace(keyword)) {
          variants.push_back(std::string(part));
        }
      }
      props["fontVariant"] = std::move(variants);
      return;
    }
    if (property == "animationName") {
      if (keyword == "none" || !context.keyframes) {
        props["animationKeyframes"] = nullptr;
        return;
      }
      auto frames = context.keyframes(trimmed(value));
      if (!frames.isNull()) {
        props["animationKeyframes"] = folly::toJson(frames);
      }
      return;
    }
    if (property == "backgroundImage") {
      // The renderer's own `backgroundImage` draws each layer under the
      // children: a gradient, or an image its view loads from the URL, which
      // the runtime resolved before the style reached the engine
      if (keyword == "none") {
        props["backgroundImage"] = nullptr;
      } else {
        props["backgroundImage"] = std::string(trimmed(value));
      }
      return;
    }
    // The background longhands leave out their initial values, which are
    // the renderer's defaults, as the `background` shorthand states them on
    // every element it colours; a later initial value takes back an earlier
    // one
    if (property == "backgroundSize") {
      auto converted = convertBackgroundSize(value, context.basis);
      if (converted ==
          Dynamic::array(Dynamic::object("x", "auto")("y", "auto"))) {
        props.erase("backgroundSize");
      } else if (converted) {
        props["backgroundSize"] = std::move(*converted);
      }
      return;
    }
    if (property == "backgroundPosition") {
      auto converted = convertBackgroundPosition(value, context.basis);
      if (converted ==
          Dynamic::array(Dynamic::object("left", "0%")("top", "0%"))) {
        props.erase("backgroundPosition");
      } else if (converted) {
        props["backgroundPosition"] = std::move(*converted);
      }
      return;
    }
    if (property == "backgroundRepeat") {
      auto converted = convertBackgroundRepeat(value);
      if (converted ==
          Dynamic::array(Dynamic::object("x", "repeat")("y", "repeat"))) {
        props.erase("backgroundRepeat");
      } else if (converted) {
        props["backgroundRepeat"] = std::move(*converted);
      }
      return;
    }
    if (property == "gridTemplateColumns" || property == "gridTemplateRows" ||
        property == "gridAutoColumns" || property == "gridAutoRows") {
      props[property] = trackListForLayout(value, context.basis);
      return;
    }
    if (passedThroughStrings().count(property) != 0) {
      props[property] = std::string(trimmed(value));
      return;
    }
    // Everything else is a property the renderer has no prop for
  };
  for (const auto& longhand : cascaded) {
    // A declaration whose `var()`s substituted to a value its property does
    // not take is invalid at computed-value time, and so unset
    // (css-variables-1 §3.1): unlike an invalid value written as it is, which
    // is dropped, it hides the declarations before it
    bool unsetWhenInvalid =
        longhand.fromVariable && writesItsOwnName(longhand.property);
    if (unsetWhenInvalid) {
      props.erase(longhand.property);
    }
    convertOne(longhand);
    if (unsetWhenInvalid && props.get_ptr(longhand.property) == nullptr) {
      props[longhand.property] = nullptr;
    }
  }

  // `overflow`, one prop for both axes: clipped if either clips, a scroll
  // container if either scrolls
  auto overflowX = valueOf("overflowX");
  auto overflowY = valueOf("overflowY");
  if (overflowX || overflowY) {
    std::string x = overflowX ? lowercase(trimmed(*overflowX)) : "visible";
    std::string y = overflowY ? lowercase(trimmed(*overflowY)) : "visible";
    auto clips = [](const std::string& v) {
      return v == "hidden" || v == "clip";
    };
    auto scrolls = [](const std::string& v) {
      return v == "scroll" || v == "auto";
    };
    props["overflow"] = clips(x) || clips(y) ? "hidden"
        : scrolls(x) || scrolls(y)           ? "scroll"
                                             : "visible";
  }

  // `visibility: hidden` draws nothing and takes no touches.
  // DOM-CSS-LIMITATION(visibility-is-opacity)
  if (auto visibility = valueOf("visibility")) {
    std::string keyword = lowercase(trimmed(*visibility));
    if (keyword == "hidden" || keyword == "collapse") {
      props["opacity"] = 0.0;
      props["pointerEvents"] = "none";
    }
  }

  if (auto fontSize = valueOf("fontSize")) {
    std::string keyword = lowercase(trimmed(*fontSize));
    if (keyword == "inherit" || keyword == "initial" || keyword == "unset") {
      props["fontSize"] = nullptr;
    } else {
      convertFontSize(*fontSize, context, props);
    }
  }
}

} // namespace facebook::react::cssengine
