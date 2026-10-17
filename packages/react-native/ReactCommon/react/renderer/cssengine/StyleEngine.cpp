/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "StyleEngine.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <unordered_set>

#include <chrono>

#include <cxxreact/TraceSection.h>
#include <folly/json.h>
#include <jsi/JSIDynamic.h>
#include <react/renderer/bridging/bridging.h>
#include <react/renderer/components/root/RootShadowNode.h>
#include <react/renderer/core/ComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/cssengine/ElementStyleInputs.h>
#include <react/renderer/cssengine/RuleSet.h>
#include <react/renderer/cssengine/SelectorMatching.h>
#include <react/renderer/cssengine/StyleProperties.h>
#include <react/renderer/cssengine/StyleValues.h>
#include <react/renderer/dom/NodeNameProvider.h>
#include <react/renderer/mounting/ShadowTree.h>
#include <react/renderer/mounting/ShadowTreeRegistry.h>
#include <react/renderer/uimanager/UIManager.h>

namespace facebook::react {

using cssengine::AuthorEntry;
using cssengine::AuthorStyle;
using cssengine::CustomProperties;
using cssengine::IndexedSelector;
using cssengine::LengthBasis;
using cssengine::Longhand;
using cssengine::MediaEnvironment;
using cssengine::RuleSet;
using cssengine::SharedStyleContext;
using cssengine::StyleContext;
using cssengine::StyleEnvironment;

namespace {

/*
 * The user agent's rules that read state the renderer's own user-agent
 * styles cannot see, and Astryx's reset, in a layer under every other.
 */
constexpr std::string_view kRuntimeSheet = R"css(
@layer astryx-runtime {
  [hidden]:not([hidden="until-found" i]) { display: none; }
  [popover]:not(:popover-open) { display: none; }
  dialog:not([open]) { display: none; }
  p { margin-block: 0; }
}
)css";

std::string lowercase(std::string_view text) {
  std::string result(text);
  for (char& c : result) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  return result;
}

bool startsWith(std::string_view text, std::string_view prefix) {
  return text.size() >= prefix.size() &&
      text.compare(0, prefix.size(), prefix) == 0;
}

// -- Author styles --

/*
 * The properties a number is unitless for, as StyleX and React DOM write
 * them; any other number is in pixels.
 */
bool isUnitlessProperty(std::string_view property) {
  static const std::unordered_set<std::string_view> unitless = {
      "animationIterationCount",
      "aspectRatio",
      "borderImageOutset",
      "borderImageSlice",
      "borderImageWidth",
      "columnCount",
      "columns",
      "flex",
      "flexGrow",
      "flexShrink",
      "flexOrder",
      "fontWeight",
      "gridArea",
      "gridColumn",
      "gridColumnEnd",
      "gridColumnStart",
      "gridRow",
      "gridRowEnd",
      "gridRowStart",
      "lineClamp",
      "lineHeight",
      "opacity",
      "order",
      "orphans",
      "scale",
      "tabSize",
      "widows",
      "zIndex",
      "zoom",
      "fillOpacity",
      "floodOpacity",
      "stopOpacity",
      "strokeDasharray",
      "strokeDashoffset",
      "strokeMiterlimit",
      "strokeOpacity",
      "strokeWidth",
  };
  return unitless.count(property) != 0;
}

std::string formatNumber(double value) {
  if (std::isfinite(value) && value == std::floor(value) &&
      std::fabs(value) < 1e15) {
    return std::to_string(static_cast<long long>(value));
  }
  char buffer[32];
  std::snprintf(buffer, sizeof(buffer), "%.10g", value);
  return buffer;
}

// The pseudo-classes StyleX resolves in a conditional value, in the order a
// later one wins
int pseudoClassPriority(std::string_view key) {
  if (key == ":hover") {
    return 1;
  }
  if (key == ":focus") {
    return 2;
  }
  if (key == ":focus-visible") {
    return 3;
  }
  if (key == ":active") {
    return 4;
  }
  if (key == ":disabled") {
    return 5;
  }
  return 0;
}

// The class an element carrying a StyleX marker has, which a `when.*`
// condition's selector names
constexpr std::string_view kMarkerClassPrefix = ".__stylex-marker-";

/*
 * A `when.*` key (`:where-ancestor(:hover, m3)`) as the selector StyleX's
 * generated rule has: the marked element in the state, and the element
 * related to it. Null for a relation the engine cannot answer (a descendant,
 * a later sibling: `:has()`).
 */
std::shared_ptr<const cssengine::SelectorList> whenSelector(
    std::string_view key) {
  size_t open = key.find('(');
  size_t close = key.rfind(')');
  if (open == std::string_view::npos || close == std::string_view::npos ||
      close < open) {
    return nullptr;
  }
  std::string_view relation = key.substr(7, open - 7);
  std::string_view inner = key.substr(open + 1, close - open - 1);
  size_t comma = inner.rfind(',');
  if (comma == std::string_view::npos) {
    return nullptr;
  }
  std::string_view pseudo = cssengine::trimmed(inner.substr(0, comma));
  std::string_view marker = cssengine::trimmed(inner.substr(comma + 1));
  std::string subject = std::string(kMarkerClassPrefix) + std::string(marker);
  if (pseudo != ":scope") {
    subject += std::string(pseudo);
  }
  std::string text;
  if (relation == "ancestor") {
    text = subject + " *";
  } else if (relation == "sibling-before") {
    text = subject + " ~ *";
  } else {
    return nullptr;
  }
  return std::make_shared<const cssengine::SelectorList>(
      cssengine::parseSelectorList(text));
}

bool selectorReadsSiblings(const cssengine::SelectorList& list) {
  for (const auto& selector : list) {
    for (auto combinator : selector.combinators) {
      if (combinator == cssengine::Combinator::NextSibling ||
          combinator == cssengine::Combinator::SubsequentSibling) {
        return true;
      }
    }
    for (const auto& compound : selector.compounds) {
      for (const auto& pseudo : compound.pseudoClasses) {
        if (pseudo.kind == cssengine::PseudoClass::FirstChild ||
            pseudo.kind == cssengine::PseudoClass::LastChild ||
            pseudo.kind == cssengine::PseudoClass::OnlyChild ||
            pseudo.kind == cssengine::PseudoClass::NthChild ||
            pseudo.kind == cssengine::PseudoClass::NthLastChild) {
          return true;
        }
      }
    }
  }
  return false;
}

void classifyCondition(AuthorEntry& entry) {
  const std::string& key = entry.key;
  if (startsWith(key, ":where-")) {
    entry.selector = whenSelector(key);
    entry.condition = entry.selector != nullptr
        ? AuthorEntry::Condition::Selector
        : AuthorEntry::Condition::Ignored;
    return;
  }
  if (key == "default") {
    entry.condition = AuthorEntry::Condition::Default;
    return;
  }
  if (startsWith(key, "@media")) {
    entry.condition = AuthorEntry::Condition::Media;
    entry.media =
        cssengine::MediaQueryList::parse(std::string_view(key).substr(6));
    return;
  }
  if (startsWith(key, "@container")) {
    // DOM-CSS-DEVIATION(container-query-is-a-media-query): the condition is
    // answered over the window, the container's name dropped
    std::string_view condition = std::string_view(key).substr(10);
    size_t paren = condition.find('(');
    entry.condition = AuthorEntry::Condition::Media;
    entry.media = cssengine::MediaQueryList::parseCondition(
        paren == std::string_view::npos ? condition : condition.substr(paren));
    return;
  }
  if (int priority = pseudoClassPriority(key)) {
    entry.condition = AuthorEntry::Condition::PseudoClass;
    entry.priority = priority;
    return;
  }
  // Any other condition that is a selector of the element itself (an
  // attribute, `:active:where(:not(:disabled))`): matched as one
  if ((startsWith(key, ":") && !startsWith(key, "::")) ||
      startsWith(key, "[")) {
    auto list = std::make_shared<const cssengine::SelectorList>(
        cssengine::parseSelectorList(key));
    bool matchable = false;
    for (const auto& selector : *list) {
      matchable = matchable || selector.matchable;
    }
    if (matchable) {
      entry.condition = AuthorEntry::Condition::Selector;
      entry.selector = std::move(list);
      return;
    }
  }
  entry.condition = AuthorEntry::Condition::Ignored;
}

void parseValue(
    std::string_view property,
    const folly::dynamic& value,
    AuthorEntry& entry);

// A conditional value's entries: each a condition and the value under it
void parseConditions(
    std::string_view property,
    const folly::dynamic& entries,
    std::vector<AuthorEntry>& out) {
  if (!entries.isArray()) {
    return;
  }
  for (const auto& pair : entries) {
    if (!pair.isArray() || pair.size() != 2 || !pair[0].isString()) {
      continue;
    }
    AuthorEntry entry;
    entry.key = pair[0].getString();
    classifyCondition(entry);
    parseValue(property, pair[1], entry);
    out.push_back(std::move(entry));
  }
}

void parseDeclarations(
    const folly::dynamic& entries,
    std::vector<AuthorEntry>& out);

void parseValue(
    std::string_view property,
    const folly::dynamic& value,
    AuthorEntry& entry) {
  if (value.isNull()) {
    entry.kind = AuthorEntry::Kind::Null;
  } else if (value.isString()) {
    entry.kind = AuthorEntry::Kind::Value;
    entry.text = value.getString();
  } else if (value.isNumber()) {
    entry.kind = AuthorEntry::Kind::Value;
    double number = value.asDouble();
    entry.text = formatNumber(number);
    if (number != 0 && !startsWith(property, "--") &&
        !isUnitlessProperty(property)) {
      entry.text += "px";
    }
  } else if (value.isBool()) {
    entry.kind = AuthorEntry::Kind::Null;
  } else if (value.isObject()) {
    if (const auto* raw = value.get_ptr("r")) {
      entry.kind = AuthorEntry::Kind::Raw;
      entry.raw = *raw;
    } else if (const auto* conditions = value.get_ptr("c")) {
      entry.kind = AuthorEntry::Kind::Nested;
      parseConditions(property, *conditions, entry.entries);
    } else {
      entry.kind = AuthorEntry::Kind::Null;
    }
  } else {
    entry.kind = AuthorEntry::Kind::Null;
  }
}

void parseDeclarations(
    const folly::dynamic& entries,
    std::vector<AuthorEntry>& out) {
  if (!entries.isArray()) {
    return;
  }
  for (const auto& pair : entries) {
    if (!pair.isArray() || pair.size() != 2 || !pair[0].isString()) {
      continue;
    }
    AuthorEntry entry;
    entry.key = pair[0].getString();
    const folly::dynamic& value = pair[1];
    bool isBlock = (startsWith(entry.key, ":") || startsWith(entry.key, "@")) &&
        value.isObject() && value.get_ptr("c") != nullptr;
    if (isBlock) {
      entry.block = true;
      entry.kind = AuthorEntry::Kind::Nested;
      classifyCondition(entry);
      parseDeclarations(value["c"], entry.entries);
    } else if (startsWith(entry.key, ":") || startsWith(entry.key, "@")) {
      // A value under a condition with no property to give it to
      continue;
    } else {
      parseValue(entry.key, value, entry);
    }
    out.push_back(std::move(entry));
  }
}

// -- Resolution --

// One declaration in cascade order, its value text or a raw value
struct Declared {
  std::string_view property;
  std::string_view value;
  const folly::dynamic* raw{nullptr};
};

// What StyleX's conditions read of an element
struct ConditionState {
  uint32_t states{0};
  bool disabled{false};
  const MediaEnvironment* media{nullptr};
  // The element, which a `when.*` condition's selector is matched against
  const StyleContext* element{nullptr};

  bool selectorMatches(const AuthorEntry& entry) const {
    return entry.selector != nullptr && element != nullptr &&
        cssengine::matchesSelectorList(*entry.selector, *element);
  }

  bool pseudoClassMatches(int priority) const {
    switch (priority) {
      case 1:
        return (states & cssengine::ElementStateHover) != 0;
      case 2:
      case 3:
        return (states & cssengine::ElementStateFocus) != 0;
      case 4:
        return (states & cssengine::ElementStateActive) != 0;
      case 5:
        return disabled;
      default:
        return false;
    }
  }
};

const AuthorEntry* pickConditional(
    const AuthorEntry& value,
    const ConditionState& state);

// The value an entry under a condition gives, picking again when it is
// conditional itself
const AuthorEntry* resolveInner(
    const AuthorEntry& entry,
    const ConditionState& state) {
  if (entry.kind == AuthorEntry::Kind::Nested) {
    return pickConditional(entry, state);
  }
  return &entry;
}

bool isPresent(const AuthorEntry* entry) {
  return entry != nullptr && entry->kind != AuthorEntry::Kind::Null;
}

/*
 * The branch of a StyleX conditional value that applies, as the web's
 * generated rules would pick it: `default`, then each `@media` that matches,
 * then the pseudo-classes that match in StyleX's order, each also under a
 * matching `@media` (`{'@media (hover: hover)': {':hover': …}}`).
 */
const AuthorEntry* pickConditional(
    const AuthorEntry& value,
    const ConditionState& state) {
  const AuthorEntry* picked = nullptr;
  for (const auto& entry : value.entries) {
    if (entry.condition == AuthorEntry::Condition::Default) {
      picked = resolveInner(entry, state);
    }
  }
  for (const auto& entry : value.entries) {
    if (entry.condition == AuthorEntry::Condition::Media && entry.media &&
        entry.media->matches(*state.media)) {
      const AuthorEntry* resolved = resolveInner(entry, state);
      if (isPresent(resolved)) {
        picked = resolved;
      }
    }
  }
  for (const auto& entry : value.entries) {
    if (entry.condition == AuthorEntry::Condition::Selector &&
        state.selectorMatches(entry)) {
      const AuthorEntry* resolved = resolveInner(entry, state);
      if (isPresent(resolved)) {
        picked = resolved;
      }
    }
  }
  for (int priority = 1; priority <= 5; priority++) {
    if (!state.pseudoClassMatches(priority)) {
      continue;
    }
    for (const auto& entry : value.entries) {
      if (entry.condition == AuthorEntry::Condition::PseudoClass &&
          entry.priority == priority) {
        const AuthorEntry* resolved = resolveInner(entry, state);
        if (isPresent(resolved)) {
          picked = resolved;
        }
      }
    }
    for (const auto& entry : value.entries) {
      if (entry.condition != AuthorEntry::Condition::Media || !entry.media ||
          entry.kind != AuthorEntry::Kind::Nested ||
          !entry.media->matches(*state.media)) {
        continue;
      }
      for (const auto& inner : entry.entries) {
        if (inner.condition == AuthorEntry::Condition::PseudoClass &&
            inner.priority == priority) {
          const AuthorEntry* resolved = resolveInner(inner, state);
          if (isPresent(resolved)) {
            picked = resolved;
          }
        }
      }
    }
  }
  return picked;
}

void appendPicked(
    const std::string& property,
    const AuthorEntry* picked,
    std::vector<Declared>& out) {
  if (!isPresent(picked)) {
    return;
  }
  if (picked->kind == AuthorEntry::Kind::Raw) {
    out.push_back({property, {}, &picked->raw});
  } else if (picked->kind == AuthorEntry::Kind::Value) {
    out.push_back({property, picked->text, nullptr});
  }
}

void collectBase(
    const std::vector<AuthorEntry>& declarations,
    const ConditionState& state,
    std::vector<Declared>& out) {
  for (const auto& entry : declarations) {
    if (entry.block) {
      continue;
    }
    appendPicked(entry.key, resolveInner(entry, state), out);
  }
}

/*
 * A StyleX style's declarations for an element in cascade order: its own,
 * then each whole-block pseudo-class that matches in StyleX's order, each
 * also from under a matching `@media` block.
 */
void collectAuthorStyle(
    const AuthorStyle& style,
    const ConditionState& state,
    std::vector<Declared>& out) {
  collectBase(style.declarations, state, out);
  for (const auto& entry : style.declarations) {
    if (entry.block && entry.condition == AuthorEntry::Condition::Selector &&
        state.selectorMatches(entry)) {
      collectBase(entry.entries, state, out);
    }
  }
  for (int priority = 1; priority <= 5; priority++) {
    if (!state.pseudoClassMatches(priority)) {
      continue;
    }
    for (const auto& entry : style.declarations) {
      if (entry.block &&
          entry.condition == AuthorEntry::Condition::PseudoClass &&
          entry.priority == priority) {
        collectBase(entry.entries, state, out);
      }
    }
    for (const auto& entry : style.declarations) {
      if (!entry.block || entry.condition != AuthorEntry::Condition::Media ||
          !entry.media || !entry.media->matches(*state.media)) {
        continue;
      }
      for (const auto& inner : entry.entries) {
        if (inner.block &&
            inner.condition == AuthorEntry::Condition::PseudoClass &&
            inner.priority == priority) {
          collectBase(inner.entries, state, out);
        }
      }
    }
  }
}

void appendRule(
    const IndexedSelector& matched,
    bool important,
    std::vector<Declared>& out) {
  for (const auto& declaration : matched.rule->declarations) {
    if (declaration.important == important) {
      out.push_back({declaration.property, declaration.value, nullptr});
    }
  }
}

std::string resolveColorFunctions(std::string_view value, bool dark) {
  std::string text = cssengine::substituteLightDark(value, dark);
  if (text.find("ok") != std::string::npos) {
    text = cssengine::substituteOklabColors(text);
  }
  if (text.find("color-mix") != std::string::npos) {
    text = cssengine::substituteColorMix(text);
  }
  return text;
}

/*
 * An element's computed font size in points (css-fonts-4 §2.5): relative to
 * its parent's for `em`, a percentage and the relative keywords, to the
 * root's for `rem`.
 */
std::optional<double> computeFontSize(
    std::string_view value,
    double parentFontSize,
    const LengthBasis& basis) {
  std::string text = lowercase(cssengine::trimmed(value));
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
    return keyword->second;
  }
  if (text == "smaller") {
    return parentFontSize / 1.2;
  }
  if (text == "larger") {
    return parentFontSize * 1.2;
  }
  if (text == "initial") {
    return 16.0;
  }
  if (text == "inherit" || text == "unset" || text == "revert" ||
      text == "revert-layer") {
    return parentFontSize;
  }
  if (!text.empty() && text.back() == '%') {
    auto percent = cssengine::parseNumber(
        std::string_view(text).substr(0, text.size() - 1));
    if (percent && *percent >= 0) {
      return parentFontSize * *percent / 100;
    }
    return std::nullopt;
  }
  // `em` in a font size is the parent's size (css-values-4 §6.1.1)
  LengthBasis fontBasis = basis;
  fontBasis.fontSize = parentFontSize;
  auto evaluated = cssengine::substituteMath(text, fontBasis);
  if (!evaluated) {
    return std::nullopt;
  }
  auto points = cssengine::resolveLength(*evaluated, fontBasis);
  if (points && *points >= 0) {
    return points;
  }
  return std::nullopt;
}

// The names `container-type` and `container-name` make an element a query
// container under (css-contain-3 §2), or none
std::vector<std::string> containerNamesOf(
    std::optional<std::string_view> type,
    std::optional<std::string_view> name,
    std::optional<std::string_view> shorthand) {
  std::string typeText = type ? lowercase(cssengine::trimmed(*type)) : "";
  std::string nameText = name ? std::string(cssengine::trimmed(*name)) : "";
  if (shorthand) {
    std::string_view text = *shorthand;
    size_t slash = text.find('/');
    if (slash == std::string_view::npos) {
      nameText = std::string(cssengine::trimmed(text));
    } else {
      nameText = std::string(cssengine::trimmed(text.substr(0, slash)));
      typeText = lowercase(cssengine::trimmed(text.substr(slash + 1)));
    }
  }
  if (typeText.empty() || typeText == "normal") {
    return {};
  }
  std::vector<std::string> names;
  if (!nameText.empty() && nameText != "none") {
    for (auto part : cssengine::splitTopLevelWhitespace(nameText)) {
      names.emplace_back(part);
    }
  }
  if (names.empty()) {
    names.emplace_back();
  }
  return names;
}

bool sameCustomProperties(
    const std::shared_ptr<const CustomProperties>& a,
    const std::shared_ptr<const CustomProperties>& b) {
  if (a == b) {
    return true;
  }
  if (a == nullptr || b == nullptr) {
    return false;
  }
  return a->parent() == b->parent() && a->own() == b->own();
}

// Whether two contexts say the same to selectors and to descendants
bool sameContext(const StyleContext& a, const StyleContext& b) {
  return a.tag == b.tag && a.classes == b.classes &&
      a.attributes == b.attributes && a.states == b.states &&
      a.isRoot == b.isRoot && a.position == b.position &&
      a.siblingCount == b.siblingCount && a.parent == b.parent &&
      a.previousSibling == b.previousSibling &&
      sameCustomProperties(a.customProperties, b.customProperties) &&
      a.fontSize == b.fontSize && a.color == b.color && a.rtl == b.rtl &&
      a.containerNames == b.containerNames && a.cellAlign == b.cellAlign &&
      a.hidden == b.hidden && a.colorScheme == b.colorScheme &&
      a.darkScheme == b.darkScheme &&
      (a.scrollContent == b.scrollContent ||
       (a.scrollContent != nullptr && b.scrollContent != nullptr &&
        *a.scrollContent == *b.scrollContent)) &&
      (a.computed == b.computed ||
       (a.computed != nullptr && b.computed != nullptr &&
        *a.computed == *b.computed));
}

// Whether two contexts of one element hand its descendants the same
// inherited values and the same ancestors
bool sameInherited(const StyleContext& a, const StyleContext& b) {
  return a.tag == b.tag && a.isRoot == b.isRoot && a.parent == b.parent &&
      sameCustomProperties(a.customProperties, b.customProperties) &&
      a.fontSize == b.fontSize && a.color == b.color && a.rtl == b.rtl &&
      a.containerNames == b.containerNames && a.cellAlign == b.cellAlign &&
      a.hidden == b.hidden && a.colorScheme == b.colorScheme &&
      a.darkScheme == b.darkScheme &&
      (a.scrollContent == b.scrollContent ||
       (a.scrollContent != nullptr && b.scrollContent != nullptr &&
        *a.scrollContent == *b.scrollContent)) &&
      (a.computed == b.computed ||
       (a.computed != nullptr && b.computed != nullptr &&
        *a.computed == *b.computed));
}

// Whether a style's entries say `inherit` on a property that does not
// inherit
bool entriesUseInherit(
    const std::vector<AuthorEntry>& entries,
    std::string_view property) {
  for (const auto& entry : entries) {
    std::string_view name =
        entry.condition == AuthorEntry::Condition::None && !entry.block
        ? std::string_view(entry.key)
        : property;
    if (entry.kind == AuthorEntry::Kind::Value &&
        cssengine::trimmed(entry.text) == "inherit" &&
        !cssengine::isInheritedProperty(name)) {
      return true;
    }
    if (entriesUseInherit(
            entry.entries, entry.block ? std::string_view() : name)) {
      return true;
    }
  }
  return false;
}

void addEntryFeatures(
    cssengine::AncestorFeatures& features,
    const std::vector<AuthorEntry>& entries) {
  for (const auto& entry : entries) {
    if (entry.selector != nullptr) {
      features.addSelectorList(*entry.selector);
    }
    addEntryFeatures(features, entry.entries);
  }
}

} // namespace

namespace cssengine {

namespace {

bool entriesReadSiblings(const std::vector<AuthorEntry>& entries) {
  for (const auto& entry : entries) {
    if (entry.selector != nullptr && selectorReadsSiblings(*entry.selector)) {
      return true;
    }
    if (entriesReadSiblings(entry.entries)) {
      return true;
    }
  }
  return false;
}

} // namespace

AuthorStyle parseAuthorStyle(const folly::dynamic& entries) {
  AuthorStyle style;
  parseDeclarations(entries, style.declarations);
  style.readsSiblings = entriesReadSiblings(style.declarations);
  return style;
}

} // namespace cssengine

// -- Snapshot and cache --

struct StyleEngine::Snapshot {
  uint64_t generation{0};
  std::shared_ptr<const RuleSet> rules;
  std::unordered_map<std::string, std::shared_ptr<const AuthorStyle>> keyframes;
  StyleEnvironment environment;
  // The document's root, a synthetic `html` element, styled
  SharedStyleContext root;
  double rootFontSize{16};
};

struct StyleEngine::CacheEntry {
  std::weak_ptr<const ShadowNodeFamily> family;
  // The node the last pass was given and the one it produced
  std::weak_ptr<const ShadowNode> input;
  std::weak_ptr<const ShadowNode> output;
  // The props it styled, as React wrote them, and the styled ones
  Props::Shared inputProps;
  Props::Shared outputProps;
  // What it wrote over them, and what queries report beside them
  folly::dynamic overlay;
  folly::dynamic extras;
  // Under what
  uint64_t generation{0};
  SharedStyleContext parent;
  SharedStyleContext previousSibling;
  uint32_t position{0};
  uint32_t siblingCount{0};
  // The element's own context; the parent's for a node that is no element
  SharedStyleContext context;
  // The context its children are styled under: its own, or an earlier one
  // that differs from it only in what nothing below can read
  SharedStyleContext childContext;
  bool element{false};
  // The states the engine kept for it when it was resolved
  uint32_t nativeStates{0};
};

struct StyleEngine::Counters {
  std::atomic<uint64_t> passes{0};
  std::atomic<uint64_t> passNanos{0};
  std::atomic<uint64_t> nodesVisited{0};
  std::atomic<uint64_t> subtreesKept{0};
  std::atomic<uint64_t> elementsResolved{0};
  std::atomic<uint64_t> resolvedNew{0};
  std::atomic<uint64_t> resolvedProps{0};
  std::atomic<uint64_t> resolvedParent{0};
  std::atomic<uint64_t> resolvedSiblings{0};
  std::atomic<uint64_t> resolvedGeneration{0};
  std::atomic<uint64_t> resolvedStates{0};
  std::atomic<uint64_t> resolveNanos{0};
  std::atomic<uint64_t> matchNanos{0};
  std::atomic<uint64_t> elementsKept{0};
  std::atomic<uint64_t> childContextsKept{0};
  std::atomic<uint64_t> propsParsed{0};
  std::atomic<uint64_t> propsParseNanos{0};
  std::atomic<uint64_t> nodesCloned{0};
  std::atomic<uint64_t> restyles{0};
  std::atomic<uint64_t> snapshots{0};
  std::atomic<uint64_t> stylesRegistered{0};
  std::atomic<uint64_t> registerNanos{0};
  std::atomic<uint64_t> hintsAsked{0};
  std::atomic<uint64_t> hintsNanos{0};
  std::atomic<uint64_t> stateEvents{0};
  std::atomic<uint64_t> stateCommits{0};
};

namespace {

uint64_t nanosSince(std::chrono::steady_clock::time_point start) {
  return static_cast<uint64_t>(
      std::chrono::duration_cast<std::chrono::nanoseconds>(
          std::chrono::steady_clock::now() - start)
          .count());
}

void add(std::atomic<uint64_t>& counter, uint64_t amount) {
  counter.fetch_add(amount, std::memory_order_relaxed);
}

} // namespace

/*
 * One element's styles, from its inputs and its parent's context.
 */
struct Resolution {
  std::shared_ptr<StyleContext> context;
  folly::dynamic props = folly::dynamic::object();
  // What queries report beside the props: values the element's own runtime
  // reads (a table cell's width, a table's border spacing) that are no prop
  folly::dynamic extras = folly::dynamic::object();
};

namespace {

struct ResolveInputs {
  // Where `explain()` collects what the cascade did, or null
  folly::dynamic* trace{nullptr};
  // Where the time in selector matching is added, or null
  std::atomic<uint64_t>* matchNanos{nullptr};
  const StyleEngine::Snapshot* snapshot{nullptr};
  const AuthorStyle* styleX{nullptr};
  const AuthorStyle* inlineStyle{nullptr};
  const AuthorStyle* presentationalStyle{nullptr};
  uint8_t scrollPart{0};
  // Whether to keep the element's props in its context, for a descendant's
  // `inherit`
  bool keepComputed{false};
  // The element as selectors see it: tag, classes, attributes, states and
  // its place among its siblings, with `parent` set
  std::shared_ptr<StyleContext> element;
  // For the root: the scope its own declarations go over
  std::shared_ptr<const CustomProperties> baseScope;
};

// The custom properties a host surface declares for the viewport its subtree
// sees, and the one an element in the top layer declares for its subtree
constexpr std::string_view kViewportInlineSize =
    "--astryx-viewport-inline-size";
constexpr std::string_view kViewportBlockSize = "--astryx-viewport-block-size";
constexpr std::string_view kInTopLayer = "--astryx-in-top-layer";

std::optional<double> viewportLength(
    const CustomProperties& scope,
    std::string_view name) {
  const std::string* value = scope.find(std::string(name));
  if (value == nullptr) {
    return std::nullopt;
  }
  LengthBasis basis;
  return cssengine::resolveLength(cssengine::trimmed(*value), basis);
}

/*
 * The elements that scroll their content when their style says so: block
 * containers. Text-level elements and the behaviour-mapped ones do not.
 */
bool isScrollContainerTag(std::string_view tag) {
  static const std::unordered_set<std::string_view> tags = {
      "div",
      "section",
      "main",
      "article",
      "aside",
      "nav",
      "header",
      "footer",
      "form",
      "fieldset",
      "figure",
      "ul",
      "ol",
      "menu",
  };
  return tags.count(tag) != 0;
}

/*
 * A block whose block axis overflows (`overflow-y: auto | scroll`) grows to
 * its content instead of scrolling inside the page: its height becomes its
 * minimum, and its maximum and the flex shrinking that let it give way are
 * set aside.
 *
 * DOM-CSS-LIMITATION(no-nested-vertical-scroll): on a phone a page scrolls
 * as one; a region that scrolls on its own captures the drag meant for the
 * page. The inline axis still scrolls, through the platform's horizontal
 * scroll view.
 */
void growOverflow(folly::dynamic& props, bool scrollsSideways) {
  // The `overflow` shorthand's inline axis clips with the box; only an
  // explicit `overflow-x`, which the runtime builds a horizontal scroll view
  // for, keeps it
  if (!scrollsSideways) {
    props.erase("overflow");
  }
  auto isZero = [](const folly::dynamic* value) {
    return value != nullptr && value->isNumber() && value->asDouble() == 0;
  };
  if (const auto* height = props.get_ptr("height"); height != nullptr &&
      !height->isNull() &&
      !(height->isString() && height->getString() == "auto")) {
    const auto* minHeight = props.get_ptr("minHeight");
    if (minHeight == nullptr || minHeight->isNull() || isZero(minHeight)) {
      props["minHeight"] = *height;
    }
    props.erase("height");
  }
  props.erase("maxHeight");
  if (isZero(props.get_ptr("minHeight"))) {
    props.erase("minHeight");
  }
  if (props.get_ptr("flexShrink") != nullptr ||
      props.get_ptr("flexBasis") != nullptr ||
      props.get_ptr("flexGrow") != nullptr) {
    props["flexShrink"] = 0;
    const auto* basis = props.get_ptr("flexBasis");
    if (isZero(basis) ||
        (basis != nullptr && basis->isString() &&
         (basis->getString() == "0%" || basis->getString() == "0"))) {
      props["flexBasis"] = "auto";
    }
  }
}

// The props that stay on a scroll container's box: how it is sized and placed
// among its siblings, and what it paints
bool isScrollViewportProp(const std::string& key) {
  static const std::unordered_set<std::string_view> exact = {
      "width",
      "height",
      "minWidth",
      "minHeight",
      "maxWidth",
      "maxHeight",
      "flex",
      "flexGrow",
      "flexShrink",
      "flexBasis",
      "alignSelf",
      "justifySelf",
      "order",
      "position",
      "top",
      "right",
      "bottom",
      "left",
      "start",
      "end",
      "inset",
      "zIndex",
      "aspectRatio",
      "boxSizing",
      "backgroundColor",
      "backgroundImage",
      "opacity",
      "transform",
      "transformOrigin",
      "boxShadow",
      "filter",
      "borderStyle",
      "outlineWidth",
      "outlineColor",
      "outlineStyle",
      "outlineOffset",
      "pointerEvents",
  };
  if (exact.count(key) != 0) {
    return true;
  }
  return startsWith(key, "margin") || startsWith(key, "grid") ||
      (startsWith(key, "border") &&
       (key.find("Radius") != std::string::npos ||
        key.find("Width") != std::string::npos ||
        key.find("Color") != std::string::npos));
}

/*
 * Splits a scroll container's props: its box keeps what sizes, places and
 * paints it, and lays out the platform's scroll view inside it as a column;
 * the rest (its padding, its children's layout) is returned for the element
 * inside the scroll view.
 */
folly::dynamic splitScrollContainer(folly::dynamic& props) {
  folly::dynamic content = folly::dynamic::object();
  folly::dynamic viewport = folly::dynamic::object();
  for (const auto& [key, value] : props.items()) {
    const std::string& name = key.getString();
    if (name == "overflow") {
      continue;
    }
    if (isScrollViewportProp(name)) {
      viewport[name] = value;
    } else {
      content[name] = value;
    }
  }
  viewport["display"] = "flex";
  viewport["flexDirection"] = "column";
  content["flexGrow"] = 1;
  props = std::move(viewport);
  return content;
}

// The last value a property was cascaded to, or empty
std::string lastLonghand(
    const std::vector<Longhand>& longhands,
    std::string_view property) {
  for (auto it = longhands.rbegin(); it != longhands.rend(); ++it) {
    if (it->property == property) {
      return std::string(cssengine::trimmed(it->value));
    }
  }
  return {};
}

const std::unordered_map<std::string_view, std::string_view>& cellAlignment() {
  static const std::unordered_map<std::string_view, std::string_view> map = {
      {"top", "flex-start"},
      {"baseline", "flex-start"},
      {"middle", "center"},
      {"bottom", "flex-end"},
  };
  return map;
}

LengthBasis basisFor(const StyleEnvironment& environment) {
  LengthBasis basis;
  basis.viewportWidth = environment.media.viewportWidth;
  basis.viewportHeight = environment.media.viewportHeight;
  const auto* variables = &environment.variables;
  basis.environment =
      [variables](std::string_view name) -> std::optional<double> {
    auto found = variables->find(std::string(name));
    if (found == variables->end()) {
      return std::nullopt;
    }
    return found->second;
  };
  return basis;
}

} // namespace

/*
 * The table parts, as the runtime's table layout lays them out (a grid of
 * rows): a cell fills the track it is placed in, so its own `width`,
 * `min-width` and `max-width` are no props (CSS 2.1 §17.5, and browsers do not
 * apply `max-width` to a cell, which `max-width: 0` with an ellipsis relies
 * on); its width sizes its column, which the runtime reads from the engine.
 * `vertical-align` places a cell's content, the cell's own or its row's.
 */
static void applyTableRules(
    StyleContext& element,
    const SharedStyleContext& parent,
    const std::vector<Longhand>& longhands,
    Resolution& resolution) {
  const std::string& tag = element.tag;
  std::string inheritedAlign = parent != nullptr ? parent->cellAlign : "";
  if (tag == "tr" || tag == "thead" || tag == "tbody" || tag == "tfoot") {
    std::string own = lowercase(lastLonghand(longhands, "verticalAlign"));
    element.cellAlign = own.empty() ? inheritedAlign : own;
    return;
  }
  if (tag == "table") {
    element.cellAlign.clear();
    for (std::string_view property :
         {"borderSpacing", "borderCollapse", "tableLayout"}) {
      std::string value = lastLonghand(longhands, property);
      if (!value.empty()) {
        resolution.extras[std::string(property)] = value;
      }
    }
    return;
  }
  if (tag == "td" || tag == "th" || tag == "col") {
    folly::dynamic& props = resolution.props;
    if (const auto* width = props.get_ptr("width")) {
      resolution.extras["width"] = *width;
    }
    if (tag == "col") {
      return;
    }
    props.erase("width");
    props.erase("minWidth");
    props.erase("maxWidth");
    std::string own = lowercase(lastLonghand(longhands, "verticalAlign"));
    std::string align = own.empty() ? inheritedAlign : own;
    props.erase("verticalAlign");
    auto found = cellAlignment().find(align);
    if (found != cellAlignment().end()) {
      props["alignContent"] = std::string(found->second);
    }
    element.cellAlign.clear();
    return;
  }
  element.cellAlign = inheritedAlign;
}

/*
 * `<button>`'s platform chrome withdraws as a unit
 * (DOM-CSS-DEVIATION(button-chrome-withdraws-as-a-unit)): a button whose
 * surface the author paints (a background, a border, `appearance: none`)
 * draws no platter, and the user agent's insets, touch height and label
 * typography go with it; an author who states any padding, or any height,
 * owns that half of the geometry. The user agent's values are the renderer's
 * props under these, spelled however the sheet spells them, so an edge is
 * withdrawn by writing it, and the rest by unsetting them.
 */
static void applyButtonRules(
    const std::vector<Longhand>& longhands,
    Resolution& resolution) {
  std::unordered_set<std::string_view> declared;
  bool surface = false;
  for (const auto& longhand : longhands) {
    std::string_view property = longhand.property;
    declared.insert(property);
    if (property == "backgroundColor" ||
        (startsWith(property, "border") &&
         (property.find("Width") != std::string_view::npos ||
          property.find("Color") != std::string_view::npos ||
          property.find("Radius") != std::string_view::npos)) ||
        (property == "appearance" &&
         lowercase(cssengine::trimmed(longhand.value)) == "none")) {
      surface = true;
    }
  }
  folly::dynamic& props = resolution.props;
  static const std::vector<std::string_view> paddings = {
      "paddingTop", "paddingBottom", "paddingStart", "paddingEnd"};
  static const std::vector<std::string_view> heights = {
      "height", "minHeight", "maxHeight"};
  bool statesPadding =
      std::any_of(paddings.begin(), paddings.end(), [&](std::string_view name) {
        return declared.count(name) != 0;
      });
  bool statesHeight =
      std::any_of(heights.begin(), heights.end(), [&](std::string_view name) {
        return declared.count(name) != 0;
      });
  if (surface) {
    props["hasAuthorChrome"] = true;
  }
  if (surface || statesPadding) {
    for (auto name : paddings) {
      if (declared.count(name) == 0) {
        props[std::string(name)] = 0;
      }
    }
  }
  if (surface || statesHeight) {
    for (auto name : heights) {
      if (declared.count(name) == 0) {
        props[std::string(name)] = nullptr;
      }
    }
  }
  if (surface) {
    for (std::string_view name :
         {"fontSize", "fontWeight", "letterSpacing", "color"}) {
      if (declared.count(name) == 0 && props.get_ptr(name) == nullptr) {
        props[std::string(name)] = nullptr;
      }
    }
  }
}

/*
 * The cascade for one element (css-cascade-5 §6): the sheets' rules under
 * StyleX's layer, the StyleX style, the rules above it, the inline style,
 * then the important declarations, earlier layers winning. Then custom
 * properties, `var()`, the colour functions, shorthands, and the props.
 */
static Resolution resolveElement(
    const ResolveInputs& inputs,
    const StyleEngine::Snapshot& snapshot,
    const SharedStyleContext& parent) {
  StyleContext& element = *inputs.element;
  const RuleSet& rules = *snapshot.rules;
  // The viewport a host surface declares for its subtree (an app's screen, a
  // split view's column), the window otherwise
  MediaEnvironment media = snapshot.environment.media;
  if (parent != nullptr && parent->customProperties != nullptr) {
    if (auto width =
            viewportLength(*parent->customProperties, kViewportInlineSize)) {
      media.width = *width;
      media.viewportWidth = *width;
    }
    if (auto height =
            viewportLength(*parent->customProperties, kViewportBlockSize)) {
      media.height = *height;
      media.viewportHeight = *height;
    }
  }

  thread_local std::vector<cssengine::MatchedRule> matched;
  {
    auto start = std::chrono::steady_clock::now();
    rules.match(element, media, matched);
    if (inputs.matchNanos != nullptr) {
      add(*inputs.matchNanos, nanosSince(start));
    }
  }

  ConditionState state;
  state.states = element.states;
  state.disabled = element.attribute("disabled") != nullptr;
  state.media = &media;
  state.element = &element;

  std::vector<Declared> declared;
  declared.reserve(64);
  if (inputs.presentationalStyle != nullptr) {
    collectAuthorStyle(*inputs.presentationalStyle, state, declared);
  }
  int styleXRank = rules.styleXLayerRank();
  for (const auto& entry : matched) {
    if (styleXRank < 0 || static_cast<int>(entry->layerRank) <= styleXRank) {
      appendRule(*entry.selector, false, declared);
    }
  }
  if (inputs.styleX != nullptr) {
    collectAuthorStyle(*inputs.styleX, state, declared);
  }
  for (const auto& entry : matched) {
    if (styleXRank >= 0 && static_cast<int>(entry->layerRank) > styleXRank) {
      appendRule(*entry.selector, false, declared);
    }
  }
  if (inputs.inlineStyle != nullptr) {
    collectAuthorStyle(*inputs.inlineStyle, state, declared);
  }
  // An important declaration in an earlier layer beats one in a later layer,
  // and a layered one beats an unlayered one (css-cascade-5 §6.4.3)
  std::vector<const IndexedSelector*> important;
  for (const auto& entry : matched) {
    for (const auto& declaration : entry->rule->declarations) {
      if (declaration.important) {
        important.push_back(entry.selector);
        break;
      }
    }
  }
  if (!important.empty()) {
    std::stable_sort(
        important.begin(),
        important.end(),
        [](const IndexedSelector* a, const IndexedSelector* b) {
          return a->layerRank > b->layerRank;
        });
    for (const auto* entry : important) {
      appendRule(*entry, true, declared);
    }
  }

  if (inputs.trace != nullptr) {
    folly::dynamic list = folly::dynamic::array();
    for (const auto& item : declared) {
      list.push_back(
          folly::dynamic::array(
              std::string(item.property),
              item.raw != nullptr ? folly::toJson(*item.raw)
                                  : std::string(item.value)));
    }
    (*inputs.trace)["declared"] = std::move(list);
    folly::dynamic rules = folly::dynamic::array();
    for (const auto& entry : matched) {
      rules.push_back(
          folly::dynamic::object("layer", entry->rule->layer)(
              "specificity", entry->specificity)(
              "declarations",
              static_cast<int64_t>(entry->rule->declarations.size())));
    }
    (*inputs.trace)["rules"] = std::move(rules);
  }

  // -- Custom properties (css-variables-1 §2) --

  std::shared_ptr<const CustomProperties> inherited =
      parent != nullptr ? parent->customProperties : inputs.baseScope;
  std::vector<std::pair<std::string, std::string_view>> own;
  for (const auto& item : declared) {
    if (item.raw == nullptr && startsWith(item.property, "--")) {
      std::string name(item.property);
      auto existing =
          std::find_if(own.begin(), own.end(), [&](const auto& pair) {
            return pair.first == name;
          });
      if (existing != own.end()) {
        existing->second = item.value;
      } else {
        own.emplace_back(std::move(name), item.value);
      }
    }
  }
  std::shared_ptr<const CustomProperties> scope = inherited;
  if (!own.empty()) {
    // Each declaration's own `var()`s resolve against the element's scope,
    // so a descendant reads a value rather than a reference it could
    // redeclare; one that cannot resolve holds the guaranteed-invalid value
    CustomProperties raw(inherited);
    for (const auto& [name, value] : own) {
      raw.set(name, std::string(cssengine::trimmed(value)));
    }
    auto resolved = std::make_shared<CustomProperties>(inherited);
    for (const auto& [name, value] : own) {
      auto substituted = cssengine::substituteVariables(value, raw);
      resolved->set(
          name,
          substituted ? std::string(cssengine::trimmed(*substituted))
                      : std::string("initial"));
    }
    scope = resolved;
  }

  // The used colour scheme: `color-scheme` inherits, `light dark` follows
  // the device, a lone `dark` is dark, and `light` or `normal` light
  // (css-color-adjust-1 §2.1)
  std::string colorScheme = parent != nullptr ? parent->colorScheme : "normal";
  for (auto it = declared.rbegin(); it != declared.rend(); ++it) {
    if (it->property == "colorScheme" && it->raw == nullptr) {
      auto value = cssengine::substituteVariables(
          it->value, scope != nullptr ? *scope : CustomProperties());
      if (value) {
        std::string keyword = lowercase(cssengine::trimmed(*value));
        if (keyword == "inherit" || keyword == "unset") {
          // the parent's, as it is
        } else if (keyword == "initial") {
          colorScheme = "normal";
        } else {
          colorScheme = keyword;
        }
      }
      break;
    }
  }
  bool dark = false;
  {
    bool offersDark = false;
    bool offersLight = false;
    for (auto word : cssengine::splitTopLevelWhitespace(colorScheme)) {
      offersDark = offersDark || word == "dark";
      offersLight = offersLight || word == "light";
    }
    dark = offersDark && (!offersLight || media.dark);
  }
  element.colorScheme = colorScheme;
  element.darkScheme = dark;
  // The value a declaration computes to, `var()` substituted and the colour
  // functions resolved; nullopt when it is invalid at computed-value time
  auto valueOf = [&](std::string_view value) -> std::optional<std::string> {
    std::optional<std::string> substituted;
    if (value.find("var(") != std::string_view::npos) {
      substituted = cssengine::substituteVariables(
          value, scope != nullptr ? *scope : CustomProperties());
      if (!substituted) {
        return std::nullopt;
      }
    } else {
      substituted = std::string(value);
    }
    if (substituted->find('(') != std::string::npos) {
      return resolveColorFunctions(*substituted, dark);
    }
    return substituted;
  };

  // The winning declaration of a property that descendants read
  auto lastOf = [&](std::string_view property) -> const Declared* {
    for (auto it = declared.rbegin(); it != declared.rend(); ++it) {
      if (it->property == property) {
        return &*it;
      }
    }
    return nullptr;
  };

  double parentFontSize = parent != nullptr ? parent->fontSize : 16;
  std::string parentColor = parent != nullptr ? parent->color : "black";
  bool parentRtl = parent != nullptr && parent->rtl;

  LengthBasis basis = basisFor(snapshot.environment);
  basis.viewportWidth = media.viewportWidth;
  basis.viewportHeight = media.viewportHeight;
  // A container unit with no query container to measure takes the viewport's
  // size (css-contain-3 §6.1).
  // DOM-CSS-DEVIATION(container-query-is-a-media-query): containers report no
  // size of their own yet, so every container unit is the viewport's
  basis.containerWidth = media.viewportWidth;
  basis.containerHeight = media.viewportHeight;
  basis.rootFontSize = element.isRoot ? 16 : snapshot.rootFontSize;

  // -- What descendants read: font size, colour, direction, containers --

  double fontSize = parentFontSize;
  if (const Declared* declaration = lastOf("fontSize");
      declaration != nullptr && declaration->raw == nullptr) {
    auto value = valueOf(declaration->value);
    if (value) {
      if (auto computed = computeFontSize(*value, parentFontSize, basis)) {
        fontSize = *computed;
      }
    }
  } else if (declaration != nullptr && declaration->raw->isNumber()) {
    fontSize = declaration->raw->asDouble();
  }
  basis.fontSize = fontSize;
  if (element.isRoot) {
    basis.rootFontSize = fontSize;
  }

  std::string color = parentColor;
  if (const Declared* declaration = lastOf("color");
      declaration != nullptr && declaration->raw == nullptr) {
    auto value = valueOf(declaration->value);
    if (value) {
      std::string text = cssengine::substituteCurrentColor(*value, parentColor);
      std::string keyword = lowercase(cssengine::trimmed(text));
      if (keyword == "initial") {
        color = "black";
      } else if (
          keyword != "inherit" && keyword != "unset" &&
          cssengine::parseColor(text)) {
        color = std::string(cssengine::trimmed(text));
      }
    }
  }

  bool rtl = parentRtl;
  if (const std::string* dir = element.attribute("dir")) {
    std::string keyword = lowercase(*dir);
    if (keyword == "rtl") {
      rtl = true;
    } else if (keyword == "ltr") {
      rtl = false;
    }
  }
  if (const Declared* declaration = lastOf("direction");
      declaration != nullptr && declaration->raw == nullptr) {
    auto value = valueOf(declaration->value);
    if (value) {
      std::string keyword = lowercase(cssengine::trimmed(*value));
      if (keyword == "rtl") {
        rtl = true;
      } else if (keyword == "ltr") {
        rtl = false;
      }
    }
  }

  {
    std::optional<std::string> type, name, shorthand;
    if (const Declared* d = lastOf("containerType"); d && !d->raw) {
      type = valueOf(d->value);
    }
    if (const Declared* d = lastOf("containerName"); d && !d->raw) {
      name = valueOf(d->value);
    }
    if (const Declared* d = lastOf("container"); d && !d->raw) {
      shorthand = valueOf(d->value);
    }
    element.containerNames = containerNamesOf(
        type ? std::optional<std::string_view>(*type) : std::nullopt,
        name ? std::optional<std::string_view>(*name) : std::nullopt,
        shorthand ? std::optional<std::string_view>(*shorthand) : std::nullopt);
  }

  element.customProperties = scope;
  element.fontSize = fontSize;
  element.color = color;
  element.rtl = rtl;

  // -- The props --

  Resolution resolution;
  std::vector<Longhand> longhands;
  longhands.reserve(declared.size() + 16);
  // The raw values that win, by property, and the order they won in
  std::unordered_map<std::string_view, const folly::dynamic*> raws;
  for (const auto& item : declared) {
    if (startsWith(item.property, "--") || item.property == "containerType" ||
        item.property == "containerName" || item.property == "container" ||
        item.property == "direction" || item.property == "colorScheme") {
      continue;
    }
    if (item.raw != nullptr) {
      raws[item.property] = item.raw;
      longhands.erase(
          std::remove_if(
              longhands.begin(),
              longhands.end(),
              [&](const Longhand& longhand) {
                return longhand.property == item.property;
              }),
          longhands.end());
      continue;
    }
    auto value = valueOf(item.value);
    size_t before = longhands.size();
    // A declaration invalid at computed-value time is `unset`
    // (css-variables-1 §3.1)
    cssengine::expandDeclaration(
        item.property,
        value ? std::string_view(*value) : "unset",
        rtl,
        longhands);
    bool fromVariable = item.value.find("var(") != std::string_view::npos;
    for (size_t i = before; i < longhands.size(); i++) {
      raws.erase(longhands[i].property);
      longhands[i].fromVariable = fromVariable;
    }
  }

  // `animation-name` names keyframes from a sheet or from StyleX
  const StyleEngine::Snapshot* snapshotPointer = &snapshot;
  auto keyframes = [snapshotPointer, scope, basis, color, rtl, dark, fontSize](
                       std::string_view name) -> folly::dynamic {
    std::string key(cssengine::trimmed(name));
    std::vector<std::pair<double, std::vector<Declared>>> stops;
    if (const auto* rule = snapshotPointer->rules->keyframes(key)) {
      for (const auto& [offset, declarations] : rule->stops) {
        std::vector<Declared> items;
        for (const auto& declaration : declarations) {
          items.push_back({declaration.property, declaration.value, nullptr});
        }
        stops.emplace_back(offset, std::move(items));
      }
    } else {
      auto found = snapshotPointer->keyframes.find(key);
      if (found == snapshotPointer->keyframes.end()) {
        return nullptr;
      }
      for (const auto& stop : found->second->declarations) {
        double offset = 0;
        if (stop.key == "from") {
          offset = 0;
        } else if (stop.key == "to") {
          offset = 1;
        } else {
          std::string_view text = cssengine::trimmed(stop.key);
          if (text.empty() || text.back() != '%') {
            continue;
          }
          auto percent =
              cssengine::parseNumber(text.substr(0, text.size() - 1));
          if (!percent) {
            continue;
          }
          offset = *percent / 100;
        }
        std::vector<Declared> items;
        for (const auto& entry : stop.entries) {
          if (entry.kind == AuthorEntry::Kind::Value) {
            items.push_back({entry.key, entry.text, nullptr});
          }
        }
        stops.emplace_back(offset, std::move(items));
      }
    }
    std::stable_sort(
        stops.begin(), stops.end(), [](const auto& a, const auto& b) {
          return a.first < b.first;
        });
    folly::dynamic result = folly::dynamic::array();
    cssengine::ConversionContext context;
    context.basis = basis;
    context.parentFontSize = fontSize;
    context.currentColor = color;
    context.rtl = rtl;
    for (const auto& [offset, items] : stops) {
      std::vector<Longhand> longhands;
      std::optional<std::string> transform;
      for (const auto& item : items) {
        std::optional<std::string> value;
        if (item.value.find("var(") != std::string_view::npos) {
          value = cssengine::substituteVariables(
              item.value, scope != nullptr ? *scope : CustomProperties());
        } else {
          value = std::string(item.value);
        }
        if (!value) {
          continue;
        }
        std::string text = resolveColorFunctions(*value, dark);
        if (item.property == "transform") {
          // The animation engine reads a transform as CSS text
          transform = text;
          continue;
        }
        cssengine::expandDeclaration(item.property, text, rtl, longhands);
      }
      folly::dynamic frame = folly::dynamic::object();
      cssengine::convertLonghands(longhands, context, frame);
      if (transform) {
        frame["transform"] = *transform;
      }
      frame["offset"] = offset;
      result.push_back(std::move(frame));
    }
    return result.empty() ? folly::dynamic(nullptr) : result;
  };

  cssengine::ConversionContext context;
  context.basis = basis;
  context.parentFontSize = parentFontSize;
  context.currentColor = color;
  context.rtl = rtl;
  context.keyframes = keyframes;
  cssengine::convertLonghands(longhands, context, resolution.props);
  if (inputs.trace != nullptr) {
    folly::dynamic list = folly::dynamic::array();
    for (const auto& longhand : longhands) {
      list.push_back(folly::dynamic::array(longhand.property, longhand.value));
    }
    (*inputs.trace)["longhands"] = std::move(list);
    folly::dynamic own = folly::dynamic::object();
    if (scope != nullptr && scope != inherited) {
      for (const auto& [name, value] : scope->own()) {
        own[name] = value;
      }
    }
    (*inputs.trace)["customProperties"] = std::move(own);
    (*inputs.trace)["fontSize"] = fontSize;
    (*inputs.trace)["color"] = color;
  }
  for (const auto& [property, raw] : raws) {
    resolution.props[std::string(property)] = *raw;
  }

  // An element that generates no box hides its subtree, which the pass then
  // leaves unstyled; the renderer does the rest of `display: none` (no
  // layout, no drawing, no animation)
  if (const auto* display = resolution.props.get_ptr("display");
      display != nullptr && display->isString() &&
      display->getString() == "none") {
    element.hidden = true;
  }

  applyTableRules(element, parent, longhands, resolution);
  if (element.tag == "button") {
    applyButtonRules(longhands, resolution);
  }

  if (isScrollContainerTag(element.tag)) {
    bool inTopLayer =
        scope != nullptr && scope->find(std::string(kInTopLayer)) != nullptr;
    std::string overflowY;
    for (auto it = longhands.rbegin(); it != longhands.rend(); ++it) {
      if (it->property == "overflowY") {
        overflowY = lowercase(cssengine::trimmed(it->value));
        break;
      }
    }
    if (!inTopLayer && (overflowY == "auto" || overflowY == "scroll")) {
      growOverflow(resolution.props, inputs.scrollPart == 1);
    }
    if (inputs.scrollPart == 1 || inputs.scrollPart == 2) {
      element.scrollContent = std::make_shared<const folly::dynamic>(
          splitScrollContainer(resolution.props));
    }
  }
  // `inherit` on a property that does not inherit takes the parent's value
  // (css-cascade-5 §7.2); on one that does, the renderer's own inheritance
  // supplies it
  if (inputs.keepComputed) {
    std::unordered_map<std::string_view, std::string_view> winners;
    for (const auto& longhand : longhands) {
      winners[longhand.property] = longhand.value;
    }
    for (const auto& [property, value] : winners) {
      if (cssengine::trimmed(value) != "inherit" ||
          cssengine::isInheritedProperty(property)) {
        continue;
      }
      const folly::dynamic* inheritedValue =
          parent != nullptr && parent->computed != nullptr
          ? parent->computed->get_ptr(property)
          : nullptr;
      resolution.props[std::string(property)] =
          inheritedValue != nullptr ? *inheritedValue : folly::dynamic(nullptr);
    }
    element.computed = std::make_shared<const folly::dynamic>(resolution.props);
  }
  resolution.context = inputs.element;
  return resolution;
}

// -- The style pass --

class StyleEngine::Pass {
 public:
  Pass(
      StyleEngine& engine,
      std::shared_ptr<const Snapshot> snapshot,
      const ContextContainer& contextContainer,
      SurfaceId surfaceId)
      : engine_(engine),
        snapshot_(std::move(snapshot)),
        stylesLock_(engine.stylesMutex_),
        parserContext_{surfaceId, contextContainer},
        readsSiblings_(
            snapshot_->rules->readsSiblings() || engine.stylesReadSiblings_) {
    std::scoped_lock lock(engine.nativeStatesMutex_);
    for (const auto& [tag, state] : engine.nativeStates_) {
      nativeStates_.emplace(tag, state.states);
    }
  }

  std::shared_ptr<const ShadowNode> visit(
      const std::shared_ptr<const ShadowNode>& node,
      const SharedStyleContext& parent,
      const SharedStyleContext& previousSibling,
      uint32_t position,
      uint32_t siblingCount,
      SharedStyleContext& elementContext) {
    add(counters_.nodesVisited, 1);
    const ShadowNodeFamily* family = &node->getFamily();
    std::shared_ptr<CacheEntry>& slot = engine_.cache_[family];
    if (slot == nullptr || slot->family.expired()) {
      slot = std::make_shared<CacheEntry>();
      slot->family = node->getFamilyShared();
    }
    CacheEntry& entry = *slot;

    const auto* inputsProvider =
        dynamic_cast<const ElementStyleInputsProvider*>(node->getProps().get());
    // Under an element that generates no box nothing is drawn, so nothing is
    // styled until it is shown again, when its context changes
    bool isElement = inputsProvider != nullptr &&
        inputsProvider->elementStyleInputs().styled &&
        (parent == nullptr || !parent->hidden);
    if (!isElement) {
      position = 0;
      siblingCount = 0;
    }

    bool sameUnder = entry.generation == snapshot_->generation &&
        entry.parent == parent && entry.previousSibling == previousSibling &&
        entry.position == position && entry.siblingCount == siblingCount &&
        entry.element == isElement;

    // The whole subtree as the last pass left it
    if (sameUnder) {
      auto output = entry.output.lock();
      if (output != nullptr && (output == node || entry.input.lock() == node)) {
        add(counters_.subtreesKept, 1);
        elementContext = isElement ? entry.context : nullptr;
        return output;
      }
    }

    Props::Shared outputProps = node->getProps();
    SharedStyleContext context = parent;
    SharedStyleContext childContext = parent;
    if (isElement) {
      // React's props, under any props a pass wrote over them
      Props::Shared base = node->getProps();
      if (entry.outputProps != nullptr && base == entry.outputProps) {
        base = entry.inputProps;
      }
      uint32_t nativeStates = 0;
      if (!nativeStates_.empty()) {
        auto found = nativeStates_.find(node->getTag());
        if (found != nativeStates_.end()) {
          nativeStates = found->second;
        }
      }
      if (sameUnder && base == entry.inputProps && entry.context != nullptr &&
          entry.nativeStates == nativeStates) {
        add(counters_.elementsKept, 1);
        context = entry.context;
        childContext =
            entry.childContext != nullptr ? entry.childContext : entry.context;
        outputProps = entry.outputProps;
      } else {
        const auto& inputs =
            dynamic_cast<const ElementStyleInputsProvider*>(base.get())
                ->elementStyleInputs();
        Resolution resolution;
        if (inputs.scrollPart == 3) {
          // The element inside a scroll container's scroll view: the
          // container's own children's layout, and no element of its own to
          // selectors, so its children see the container
          resolution.context = std::const_pointer_cast<StyleContext>(parent);
          if (parent != nullptr && parent->scrollContent != nullptr) {
            resolution.props = *parent->scrollContent;
          }
        } else {
          if (entry.context == nullptr) {
            add(counters_.resolvedNew, 1);
          } else if (base != entry.inputProps) {
            add(counters_.resolvedProps, 1);
          } else if (entry.generation != snapshot_->generation) {
            add(counters_.resolvedGeneration, 1);
          } else if (entry.nativeStates != nativeStates) {
            add(counters_.resolvedStates, 1);
          } else if (entry.parent != parent) {
            add(counters_.resolvedParent, 1);
          } else {
            add(counters_.resolvedSiblings, 1);
          }
          resolution = resolve(
              *node,
              *base,
              inputs,
              nativeStates,
              parent,
              previousSibling,
              position,
              siblingCount);
        }
        context = resolution.context;
        if (entry.context != nullptr && context != nullptr &&
            sameContext(*entry.context, *context)) {
          context = entry.context;
        }
        childContext = context;
        // Descendants keep what they resolved when nothing they can read
        // changed: the inherited values, and what any selector reads of an
        // ancestor
        if (context != entry.context && entry.childContext != nullptr &&
            context != nullptr && entry.context != nullptr &&
            sameInherited(*entry.childContext, *context) &&
            !snapshot_->rules->ancestorFeatures().distinguishes(
                *entry.childContext, *context) &&
            !engine_.stylesFeatures_->distinguishes(
                *entry.childContext, *context)) {
          childContext = entry.childContext;
          add(counters_.childContextsKept, 1);
        }
        if (base == entry.inputProps && entry.outputProps != nullptr &&
            resolution.props == entry.overlay) {
          outputProps = entry.outputProps;
        } else if (resolution.props.empty()) {
          outputProps = base;
        } else {
          auto start = std::chrono::steady_clock::now();
          outputProps = node->getComponentDescriptor().cloneProps(
              parserContext_, base, RawProps(resolution.props));
          add(counters_.propsParsed, 1);
          add(counters_.propsParseNanos, nanosSince(start));
        }
        entry.overlay = std::move(resolution.props);
        entry.extras = std::move(resolution.extras);
        entry.inputProps = base;
        entry.outputProps = outputProps;
        entry.nativeStates = nativeStates;
      }
      elementContext = context;
    } else {
      elementContext = nullptr;
    }

    auto children = visitChildren(*node, isElement ? childContext : parent);
    std::shared_ptr<const ShadowNode> output;
    if (outputProps == node->getProps() && children == nullptr) {
      output = node;
    } else {
      add(counters_.nodesCloned, 1);
      output = node->clone(
          {.props = outputProps == node->getProps()
               ? ShadowNodeFragment::propsPlaceholder()
               : outputProps,
           .children = children != nullptr
               ? children
               : ShadowNodeFragment::childrenPlaceholder(),
           .runtimeShadowNodeReference = false});
    }

    entry.input = node;
    entry.output = output;
    entry.generation = snapshot_->generation;
    entry.parent = parent;
    entry.previousSibling = previousSibling;
    entry.position = position;
    entry.siblingCount = siblingCount;
    entry.context = context;
    entry.childContext = isElement ? childContext : nullptr;
    entry.element = isElement;
    return output;
  }

  std::shared_ptr<std::vector<std::shared_ptr<const ShadowNode>>> visitChildren(
      const ShadowNode& node,
      const SharedStyleContext& context) {
    const auto& children = node.getChildren();
    if (children.empty()) {
      return nullptr;
    }
    uint32_t count = 0;
    if (readsSiblings_) {
      for (const auto& child : children) {
        const auto* provider = dynamic_cast<const ElementStyleInputsProvider*>(
            child->getProps().get());
        if (provider != nullptr && provider->elementStyleInputs().styled) {
          count++;
        }
      }
    }
    std::shared_ptr<std::vector<std::shared_ptr<const ShadowNode>>> result;
    SharedStyleContext previous;
    uint32_t position = 0;
    for (size_t i = 0; i < children.size(); i++) {
      SharedStyleContext childContext;
      auto output = visit(
          children[i],
          context,
          readsSiblings_ ? previous : nullptr,
          readsSiblings_ ? position + 1 : 0,
          readsSiblings_ ? count : 0,
          childContext);
      if (childContext != nullptr && readsSiblings_) {
        previous = childContext;
        position++;
      }
      if (output != children[i]) {
        if (result == nullptr) {
          result =
              std::make_shared<std::vector<std::shared_ptr<const ShadowNode>>>(
                  children);
        }
        (*result)[i] = output;
      }
    }
    return result;
  }

 private:
  Resolution resolve(
      const ShadowNode& /*node*/,
      const Props& props,
      const ElementStyleInputs& inputs,
      uint32_t nativeStates,
      const SharedStyleContext& parent,
      const SharedStyleContext& previousSibling,
      uint32_t position,
      uint32_t siblingCount) {
    auto element = std::make_shared<StyleContext>();
    if (!inputs.tag.empty()) {
      element->tag = lowercase(inputs.tag);
    } else if (
        const auto* named = dynamic_cast<const NodeNameProvider*>(&props)) {
      element->tag = lowercase(named->domNodeName());
    }
    element->classes = inputs.classes;
    element->attributes = inputs.attributes;
    element->states = inputs.states;
    // The states the engine keeps, which a disabled element does not have
    if (nativeStates != 0 &&
        std::none_of(
            inputs.attributes.begin(),
            inputs.attributes.end(),
            [](const auto& attribute) {
              return attribute.first == "disabled";
            })) {
      element->states |= nativeStates;
    }
    element->parent = parent;
    element->previousSibling = previousSibling;
    element->position = position;
    element->siblingCount = siblingCount;

    ResolveInputs resolveInputs;
    resolveInputs.snapshot = snapshot_.get();
    resolveInputs.element = element;
    std::shared_ptr<const AuthorStyle> styleX;
    if (inputs.styleId > 0 &&
        static_cast<size_t>(inputs.styleId) <= engine_.styles_.size()) {
      styleX = engine_.styles_[static_cast<size_t>(inputs.styleId) - 1];
      resolveInputs.styleX = styleX.get();
    }
    AuthorStyle inlineStyle;
    if (!inputs.inlineStyle.isNull()) {
      inlineStyle = cssengine::parseAuthorStyle(inputs.inlineStyle);
      resolveInputs.inlineStyle = &inlineStyle;
    }
    AuthorStyle presentationalStyle;
    if (!inputs.presentationalStyle.isNull()) {
      presentationalStyle =
          cssengine::parseAuthorStyle(inputs.presentationalStyle);
      resolveInputs.presentationalStyle = &presentationalStyle;
    }
    resolveInputs.scrollPart = inputs.scrollPart;
    resolveInputs.keepComputed = snapshot_->rules->usesExplicitInheritance() ||
        engine_.stylesUseInherit_;
    resolveInputs.matchNanos = &counters_.matchNanos;
    auto start = std::chrono::steady_clock::now();
    auto resolution = resolveElement(resolveInputs, *snapshot_, parent);
    add(counters_.elementsResolved, 1);
    add(counters_.resolveNanos, nanosSince(start));
    return resolution;
  }

  StyleEngine& engine_;
  Counters& counters_{*engine_.counters_};
  std::shared_ptr<const Snapshot> snapshot_;
  std::shared_lock<std::shared_mutex> stylesLock_;
  PropsParserContext parserContext_;
  bool readsSiblings_;
  // The states the engine keeps, as of the pass's start
  std::unordered_map<Tag, uint32_t> nativeStates_;
};

// -- StyleEngine --

StyleEngine::StyleEngine(UIManager& uiManager)
    : uiManager_(uiManager),
      stylesFeatures_(std::make_unique<cssengine::AncestorFeatures>()),
      counters_(std::make_unique<Counters>()) {
  {
    std::scoped_lock lock(stateMutex_);
    sheets_.emplace_back(0, cssengine::parseStyleSheet(kRuntimeSheet));
    environment_.media.width = 390;
    environment_.media.height = 844;
    environment_.media.viewportWidth = 390;
    environment_.media.viewportHeight = 844;
    rebuildLocked();
  }
  uiManager_.registerCommitHook(*this);
}

StyleEngine::~StyleEngine() {
  uiManager_.unregisterCommitHook(*this);
}

void StyleEngine::commitHookWasRegistered(
    const UIManager& /*uiManager*/) noexcept {}

void StyleEngine::commitHookWasUnregistered(
    const UIManager& /*uiManager*/) noexcept {}

std::shared_ptr<const StyleEngine::Snapshot> StyleEngine::snapshot() const {
  std::scoped_lock lock(snapshotMutex_);
  return snapshot_;
}

void StyleEngine::rebuildLocked(bool sheetsChanged, bool invalidates) {
  TraceSection trace("StyleEngine::rebuild");
  add(counters_->snapshots, 1);
  auto previous = snapshot();
  auto next = std::make_shared<Snapshot>();
  next->generation =
      invalidates || previous == nullptr ? ++generation_ : generation_;
  if (sheetsChanged || previous == nullptr) {
    std::vector<std::shared_ptr<const cssengine::StyleSheet>> sheets;
    sheets.reserve(sheets_.size());
    for (const auto& [id, sheet] : sheets_) {
      sheets.push_back(sheet);
    }
    next->rules = std::make_shared<RuleSet>(std::move(sheets));
  } else {
    next->rules = previous->rules;
  }
  next->keyframes = keyframes_;
  next->environment = environment_;

  // The tokens are the root's custom properties under every sheet's, each
  // resolved against the others
  CustomProperties rawTokens;
  for (const auto& [name, value] : tokens_) {
    rawTokens.set(name, value);
  }
  auto tokens = std::make_shared<CustomProperties>();
  for (const auto& [name, value] : tokens_) {
    auto substituted = cssengine::substituteVariables(value, rawTokens);
    tokens->set(name, substituted ? *substituted : std::string("initial"));
  }

  // The root element: `html`, with the class a dark scheme puts on it, as
  // the themes Astryx ships expect
  auto root = std::make_shared<StyleContext>();
  root->tag = "html";
  root->isRoot = true;
  if (environment_.media.dark) {
    root->classes.emplace_back("dark");
  }
  ResolveInputs inputs;
  inputs.snapshot = next.get();
  inputs.element = root;
  inputs.baseScope = tokens;
  auto resolution = resolveElement(inputs, *next, nullptr);
  next->root = resolution.context;
  // The same root while it says the same, so a snapshot that keeps the
  // generation keeps every element's parent
  if (previous != nullptr && previous->root != nullptr &&
      sameContext(*previous->root, *next->root)) {
    next->root = previous->root;
  }
  next->rootFontSize = next->root->fontSize;

  std::scoped_lock lock(snapshotMutex_);
  snapshot_ = std::move(next);
}

void StyleEngine::flush() {
  restyleAll();
}

void StyleEngine::restyleAll() {
  TraceSection trace("StyleEngine::restyleAll");
  uint64_t generation = snapshot()->generation;
  uiManager_.getShadowTreeRegistry().enumerate(
      [&](const ShadowTree& shadowTree, bool& /*stop*/) {
        {
          std::scoped_lock lock(cacheMutex_);
          auto found = styledGeneration_.find(shadowTree.getSurfaceId());
          if (found != styledGeneration_.end() && found->second >= generation) {
            return;
          }
        }
        add(counters_->restyles, 1);
        shadowTree.commit(
            [](const RootShadowNode& oldRootShadowNode) {
              return std::static_pointer_cast<RootShadowNode>(
                  oldRootShadowNode.ShadowNode::clone(
                      {.runtimeShadowNodeReference = false}));
            },
            {.enableStateReconciliation = false,
             .mountSynchronously = true,
             .source = ShadowTreeCommitSource::Unknown});
      });
}

namespace {

/*
 * The node at the end of `ancestors` cloned, and each ancestor with the
 * clone in its place, up to a clone of the root. None takes React's runtime
 * reference: React keeps its own nodes, which the pass styles from.
 */
std::shared_ptr<const ShadowNode> clonePath(
    const ShadowNodeFamily::AncestorList& ancestors) {
  const auto& [parent, index] = ancestors.back();
  std::shared_ptr<const ShadowNode> child =
      parent.get().getChildren().at(index)->clone(
          {.runtimeShadowNodeReference = false});
  for (auto it = ancestors.rbegin(); it != ancestors.rend(); ++it) {
    const ShadowNode& node = it->first.get();
    auto children = node.getChildren();
    children[it->second] = child;
    child = node.clone(
        {.children =
             std::make_shared<std::vector<std::shared_ptr<const ShadowNode>>>(
                 std::move(children)),
         .runtimeShadowNodeReference = false});
  }
  return child;
}

// The path from `node` down to the node tagged `tag`, both included
bool findPath(
    const ShadowNode& node,
    Tag tag,
    std::vector<const ShadowNode*>& path) {
  path.push_back(&node);
  if (node.getTag() == tag) {
    return true;
  }
  for (const auto& child : node.getChildren()) {
    if (findPath(*child, tag, path)) {
      return true;
    }
  }
  path.pop_back();
  return false;
}

bool isStateful(const ShadowNode& node) {
  const auto* provider =
      dynamic_cast<const ElementStyleInputsProvider*>(node.getProps().get());
  return provider != nullptr && provider->elementStyleInputs().styled &&
      provider->elementStyleInputs().stateful;
}

} // namespace

bool StyleEngine::handleEvent(const RawEvent& event) {
  if (!active_.load(std::memory_order_acquire) ||
      event.eventTarget == nullptr) {
    return false;
  }
  // What the event sets and clears, and whether it reaches the target's
  // ancestors, as `:active` does on the web, where it bubbles
  const std::string& type = event.type;
  uint32_t set = 0;
  uint32_t clear = 0;
  bool reachesAncestors = false;
  bool clearsEverywhere = false;
  if (type == "topPointerEnter") {
    set = cssengine::ElementStateHover;
  } else if (type == "topPointerLeave") {
    clear = cssengine::ElementStateHover | cssengine::ElementStateActive;
  } else if (type == "topPointerDown") {
    set = cssengine::ElementStateActive;
    reachesAncestors = true;
  } else if (type == "topPointerUp" || type == "topPointerCancel") {
    clear = cssengine::ElementStateActive;
    clearsEverywhere = true;
  } else if (type == "topFocus") {
    set = cssengine::ElementStateFocus | cssengine::ElementStateFocusVisible;
  } else if (type == "topBlur") {
    clear = cssengine::ElementStateFocus | cssengine::ElementStateFocusVisible;
  } else {
    return false;
  }

  Tag tag = event.eventTarget->getTag();
  SurfaceId surfaceId = event.eventTarget->getSurfaceId();

  // The stateful elements the event reaches: the target, and its ancestors
  // for an event that bubbles
  std::vector<std::pair<Tag, std::shared_ptr<const ShadowNodeFamily>>> targets;
  if (!clearsEverywhere) {
    uiManager_.getShadowTreeRegistry().visit(
        surfaceId, [&](const ShadowTree& shadowTree) {
          auto root = shadowTree.getCurrentRevision().rootShadowNode;
          std::vector<const ShadowNode*> path;
          if (root == nullptr || !findPath(*root, tag, path)) {
            return;
          }
          for (auto it = path.rbegin(); it != path.rend(); ++it) {
            if (isStateful(**it)) {
              targets.emplace_back((*it)->getTag(), (*it)->getFamilyShared());
            }
            if (!reachesAncestors) {
              break;
            }
          }
        });
  }

  std::vector<std::shared_ptr<const ShadowNodeFamily>> changed;
  {
    std::scoped_lock lock(nativeStatesMutex_);
    if (clearsEverywhere) {
      // Releasing the pointer ends the press wherever it began
      for (auto it = nativeStates_.begin(); it != nativeStates_.end();) {
        auto& state = it->second;
        if (state.surfaceId == surfaceId && (state.states & clear) != 0) {
          state.states &= ~clear;
          if (auto family = state.family.lock()) {
            changed.push_back(std::move(family));
          }
        }
        if (state.states == 0) {
          it = nativeStates_.erase(it);
        } else {
          ++it;
        }
      }
    } else {
      for (auto& [targetTag, family] : targets) {
        auto& state = nativeStates_[targetTag];
        uint32_t states = (state.states & ~clear) | set;
        if (states != state.states) {
          state.states = states;
          state.surfaceId = surfaceId;
          state.family = family;
          changed.push_back(family);
        }
        if (states == 0) {
          nativeStates_.erase(targetTag);
        }
      }
    }
  }
  if (!changed.empty()) {
    add(counters_->stateEvents, 1);
    restyleElements(surfaceId, changed);
  }
  return false;
}

void StyleEngine::restyleElements(
    SurfaceId surfaceId,
    const std::vector<std::shared_ptr<const ShadowNodeFamily>>& families) {
  TraceSection trace("StyleEngine::restyleElements");
  uiManager_.getShadowTreeRegistry().visit(
      surfaceId, [&](const ShadowTree& shadowTree) {
        add(counters_->stateCommits, 1);
        shadowTree.commit(
            [&](const RootShadowNode& oldRootShadowNode)
                -> RootShadowNode::Unshared {
              std::shared_ptr<const ShadowNode> root;
              for (const auto& family : families) {
                const ShadowNode& from =
                    root != nullptr ? *root : oldRootShadowNode;
                auto ancestors = family->getAncestors(from);
                if (!ancestors.empty()) {
                  root = clonePath(ancestors);
                }
              }
              return root != nullptr
                  ? std::static_pointer_cast<RootShadowNode>(
                        std::const_pointer_cast<ShadowNode>(root))
                  : nullptr;
            },
            {.enableStateReconciliation = false,
             .mountSynchronously = true,
             .source = ShadowTreeCommitSource::Unknown});
      });
}

namespace {

/*
 * Whether swapping sheet `before` for `after` (either may be absent) can
 * change what any element matches: style rules, or a layer named for the
 * first time, which reorders the cascade. A sheet of `@position-try` rules,
 * `@font-face` or keyframes alone changes no element styled so far.
 */
bool changesMatching(
    const cssengine::StyleSheet* before,
    const cssengine::StyleSheet* after) {
  for (const auto* sheet : {before, after}) {
    if (sheet != nullptr &&
        (!sheet->rules.empty() || !sheet->layerOrder.empty())) {
      return true;
    }
  }
  return false;
}

} // namespace

int StyleEngine::addStyleSheet(const std::string& text) {
  active_.store(true, std::memory_order_release);
  std::scoped_lock lock(stateMutex_);
  int id = nextSheetId_++;
  auto sheet = cssengine::parseStyleSheet(text);
  bool invalidates = changesMatching(nullptr, sheet.get());
  sheets_.emplace_back(id, std::move(sheet));
  rebuildLocked(/*sheetsChanged*/ true, invalidates);
  return id;
}

void StyleEngine::replaceStyleSheet(int id, const std::string& text) {
  std::scoped_lock lock(stateMutex_);
  bool invalidates = false;
  for (auto& [sheetId, sheet] : sheets_) {
    if (sheetId == id) {
      auto replacement = cssengine::parseStyleSheet(text);
      invalidates = changesMatching(sheet.get(), replacement.get());
      sheet = std::move(replacement);
    }
  }
  rebuildLocked(/*sheetsChanged*/ true, invalidates);
}

void StyleEngine::removeStyleSheet(int id) {
  std::scoped_lock lock(stateMutex_);
  bool invalidates = false;
  for (const auto& [sheetId, sheet] : sheets_) {
    if (sheetId == id) {
      invalidates = changesMatching(sheet.get(), nullptr);
    }
  }
  sheets_.erase(
      std::remove_if(
          sheets_.begin(),
          sheets_.end(),
          [id](const auto& pair) { return pair.first == id; }),
      sheets_.end());
  rebuildLocked(/*sheetsChanged*/ true, invalidates);
}

int64_t StyleEngine::registerStyle(const folly::dynamic& entries) {
  active_.store(true, std::memory_order_release);
  auto start = std::chrono::steady_clock::now();
  auto style =
      std::make_shared<const AuthorStyle>(cssengine::parseAuthorStyle(entries));
  cssengine::AncestorFeatures features;
  addEntryFeatures(features, style->declarations);
  std::unique_lock lock(stylesMutex_);
  stylesReadSiblings_ = stylesReadSiblings_ || style->readsSiblings;
  stylesFeatures_->merge(features);
  stylesUseInherit_ =
      stylesUseInherit_ || entriesUseInherit(style->declarations, {});
  styles_.push_back(std::move(style));
  add(counters_->stylesRegistered, 1);
  add(counters_->registerNanos, nanosSince(start));
  return static_cast<int64_t>(styles_.size());
}

void StyleEngine::registerTokens(const folly::dynamic& entries) {
  active_.store(true, std::memory_order_release);
  {
    std::scoped_lock lock(stateMutex_);
    bool changed = false;
    if (entries.isArray()) {
      for (const auto& pair : entries) {
        if (!pair.isArray() || pair.size() != 2 || !pair[0].isString()) {
          continue;
        }
        std::string name = pair[0].getString();
        std::string value = pair[1].isString() ? pair[1].getString()
            : pair[1].isNumber() ? formatNumber(pair[1].asDouble())
                                 : std::string("initial");
        auto existing = std::find_if(
            tokens_.begin(), tokens_.end(), [&](const auto& token) {
              return token.first == name;
            });
        if (existing != tokens_.end()) {
          changed = changed || existing->second != value;
          existing->second = std::move(value);
        } else {
          changed = true;
          tokens_.emplace_back(std::move(name), std::move(value));
        }
      }
    }
    if (changed) {
      rebuildLocked(/*sheetsChanged*/ false, /*invalidates*/ true);
    }
  }
}

void StyleEngine::registerKeyframes(
    const std::string& name,
    const folly::dynamic& frames) {
  std::scoped_lock lock(stateMutex_);
  // Each stop is a block of declarations
  auto style = std::make_shared<AuthorStyle>();
  if (frames.isArray()) {
    for (const auto& pair : frames) {
      if (!pair.isArray() || pair.size() != 2 || !pair[0].isString()) {
        continue;
      }
      AuthorEntry stop;
      stop.key = pair[0].getString();
      stop.block = true;
      stop.kind = AuthorEntry::Kind::Nested;
      if (pair[1].isObject() && pair[1].get_ptr("c") != nullptr) {
        parseDeclarations(pair[1]["c"], stop.entries);
      }
      style->declarations.push_back(std::move(stop));
    }
  }
  keyframes_[name] = std::move(style);
  // Only a style that names them reads them, and it is new
  rebuildLocked(/*sheetsChanged*/ false, /*invalidates*/ false);
}

namespace {

bool sameEnvironment(const StyleEnvironment& a, const StyleEnvironment& b) {
  const MediaEnvironment& x = a.media;
  const MediaEnvironment& y = b.media;
  return x.width == y.width && x.height == y.height &&
      x.viewportWidth == y.viewportWidth &&
      x.viewportHeight == y.viewportHeight && x.resolution == y.resolution &&
      x.dark == y.dark && x.reducedMotion == y.reducedMotion &&
      x.pointer == y.pointer && x.hover == y.hover && x.gamut == y.gamut &&
      x.highDynamicRange == y.highDynamicRange && a.variables == b.variables;
}

} // namespace

void StyleEngine::setEnvironment(StyleEnvironment environment) {
  active_.store(true, std::memory_order_release);
  std::scoped_lock lock(stateMutex_);
  // Told again on every appearance or window event, often with nothing new
  if (sameEnvironment(environment_, environment)) {
    return;
  }
  environment_ = std::move(environment);
  rebuildLocked(/*sheetsChanged*/ false, /*invalidates*/ true);
}

std::shared_ptr<const cssengine::AuthorStyle> StyleEngine::style(
    int64_t id) const {
  std::shared_lock lock(stylesMutex_);
  if (id <= 0 || static_cast<size_t>(id) > styles_.size()) {
    return nullptr;
  }
  return styles_[static_cast<size_t>(id) - 1];
}

RootShadowNode::Unshared StyleEngine::shadowTreeWillCommit(
    const ShadowTree& shadowTree,
    const RootShadowNode::Shared& /*oldRootShadowNode*/,
    const RootShadowNode::Unshared& newRootShadowNode,
    const ShadowTreeCommitOptions& /*commitOptions*/) noexcept {
  if (!active_.load(std::memory_order_acquire)) {
    return newRootShadowNode;
  }
  auto current = snapshot();
  // The root's own descriptor has none; the elements' props are parsed with
  // the one every component descriptor was made with
  auto contextContainer = uiManager_.getContextContainer();
  if (contextContainer == nullptr) {
    return newRootShadowNode;
  }
  TraceSection trace("StyleEngine::pass");
  auto start = std::chrono::steady_clock::now();
  std::scoped_lock lock(cacheMutex_);
  Pass pass(*this, current, *contextContainer, shadowTree.getSurfaceId());
  auto children = pass.visitChildren(*newRootShadowNode, current->root);
  styledGeneration_[shadowTree.getSurfaceId()] = current->generation;
  add(counters_->passes, 1);
  add(counters_->passNanos, nanosSince(start));

  // Forget the families that are gone, once the cache has doubled
  if (cache_.size() > 2 * cacheSizeAtLastSweep_ + 1024) {
    for (auto it = cache_.begin(); it != cache_.end();) {
      if (it->second->family.expired()) {
        it = cache_.erase(it);
      } else {
        ++it;
      }
    }
    cacheSizeAtLastSweep_ = cache_.size();
  }

  if (children == nullptr) {
    return newRootShadowNode;
  }
  return std::static_pointer_cast<RootShadowNode>(
      newRootShadowNode->ShadowNode::clone(
          {.children = children, .runtimeShadowNodeReference = false}));
}

// -- Queries --

std::shared_ptr<const StyleEngine::CacheEntry> StyleEngine::entryFor(
    const ShadowNode& node) const {
  auto found = cache_.find(&node.getFamily());
  if (found == cache_.end() || found->second->family.expired()) {
    return nullptr;
  }
  return found->second;
}

folly::dynamic StyleEngine::computedStyle(const ShadowNode& node) const {
  std::scoped_lock lock(cacheMutex_);
  auto entry = entryFor(node);
  if (entry == nullptr || !entry->element || entry->context == nullptr) {
    return nullptr;
  }
  folly::dynamic result =
      entry->overlay.isObject() ? entry->overlay : folly::dynamic::object();
  if (entry->extras.isObject()) {
    for (const auto& [key, value] : entry->extras.items()) {
      result[key] = value;
    }
  }
  result["__color"] = entry->context->color;
  result["__fontSize"] = entry->context->fontSize;
  return result;
}

folly::dynamic StyleEngine::customProperty(
    const ShadowNode& node,
    const std::string& name) const {
  std::scoped_lock lock(cacheMutex_);
  auto entry = entryFor(node);
  if (entry == nullptr || entry->context == nullptr ||
      entry->context->customProperties == nullptr) {
    return nullptr;
  }
  const std::string* value = entry->context->customProperties->find(name);
  if (value == nullptr || *value == "initial") {
    return nullptr;
  }
  return *value;
}

namespace {

bool isStyledElement(const ShadowNode& node) {
  const auto* provider =
      dynamic_cast<const ElementStyleInputsProvider*>(node.getProps().get());
  return provider != nullptr && provider->elementStyleInputs().styled;
}

} // namespace

cssengine::SharedStyleContext StyleEngine::queryContext(
    const ShadowNode& node) const {
  RootShadowNode::Shared root;
  uiManager_.getShadowTreeRegistry().visit(
      node.getSurfaceId(), [&](const ShadowTree& shadowTree) {
        root = shadowTree.getCurrentRevision().rootShadowNode;
      });
  if (root == nullptr) {
    return nullptr;
  }
  auto path = node.getFamily().getAncestors(*root);
  SharedStyleContext parentContext = snapshot()->root;
  SharedStyleContext result;
  for (const auto& [ancestor, index] : path) {
    const auto& children = ancestor.get().getChildren();
    if (index < 0 || static_cast<size_t>(index) >= children.size() ||
        !isStyledElement(*children[static_cast<size_t>(index)])) {
      continue;
    }
    uint32_t count = 0;
    for (const auto& child : children) {
      count += isStyledElement(*child) ? 1 : 0;
    }
    SharedStyleContext previous;
    uint32_t position = 0;
    std::shared_ptr<StyleContext> built;
    std::vector<std::shared_ptr<StyleContext>> siblings;
    for (size_t i = 0; i < children.size(); i++) {
      const ShadowNode& child = *children[i];
      if (!isStyledElement(child)) {
        continue;
      }
      position++;
      auto entry = entryFor(child);
      auto copy = entry != nullptr && entry->context != nullptr
          ? std::make_shared<StyleContext>(*entry->context)
          : std::make_shared<StyleContext>();
      copy->parent = parentContext;
      copy->previousSibling = previous;
      copy->position = position;
      copy->siblingCount = count;
      previous = copy;
      siblings.push_back(copy);
      if (i == static_cast<size_t>(index)) {
        built = copy;
      }
    }
    // Each sibling's later ones, for `:nth-last-child(… of S)`
    for (size_t i = 0; i < siblings.size(); i++) {
      siblings[i]->followingSiblings = std::make_shared<
          const std::vector<std::shared_ptr<const StyleContext>>>(
          siblings.begin() + static_cast<std::ptrdiff_t>(i) + 1,
          siblings.end());
    }
    parentContext = built;
    result = built;
  }
  return result;
}

bool StyleEngine::matches(const ShadowNode& node, const std::string& selectors)
    const {
  std::shared_ptr<const cssengine::SelectorList> list;
  {
    std::scoped_lock lock(selectorsMutex_);
    auto& slot = selectors_[selectors];
    if (slot == nullptr) {
      slot = std::make_shared<const cssengine::SelectorList>(
          cssengine::parseSelectorList(selectors));
    }
    list = slot;
  }
  std::scoped_lock lock(cacheMutex_);
  auto entry = entryFor(node);
  if (entry == nullptr || !entry->element || entry->context == nullptr) {
    return false;
  }
  auto context = queryContext(node);
  return cssengine::matchesSelectorList(
      *list, context != nullptr ? *context : *entry->context);
}

folly::dynamic StyleEngine::explain(const ShadowNode& node) const {
  std::shared_ptr<const CacheEntry> entry;
  {
    std::scoped_lock lock(cacheMutex_);
    entry = entryFor(node);
  }
  if (entry == nullptr || !entry->element || entry->context == nullptr ||
      entry->inputProps == nullptr) {
    return nullptr;
  }
  const auto* provider =
      dynamic_cast<const ElementStyleInputsProvider*>(entry->inputProps.get());
  if (provider == nullptr) {
    return nullptr;
  }
  const ElementStyleInputs& inputs = provider->elementStyleInputs();
  auto current = snapshot();
  auto element = std::make_shared<StyleContext>();
  element->tag = entry->context->tag;
  element->classes = entry->context->classes;
  element->attributes = entry->context->attributes;
  element->states = entry->context->states;
  element->parent = entry->parent;
  element->previousSibling = entry->previousSibling;
  element->position = entry->position;
  element->siblingCount = entry->siblingCount;

  folly::dynamic trace = folly::dynamic::object();
  ResolveInputs resolveInputs;
  resolveInputs.trace = &trace;
  resolveInputs.snapshot = current.get();
  resolveInputs.element = element;
  auto styleX = style(inputs.styleId);
  resolveInputs.styleX = styleX.get();
  AuthorStyle inlineStyle;
  if (!inputs.inlineStyle.isNull()) {
    inlineStyle = cssengine::parseAuthorStyle(inputs.inlineStyle);
    resolveInputs.inlineStyle = &inlineStyle;
  }
  AuthorStyle presentationalStyle;
  if (!inputs.presentationalStyle.isNull()) {
    presentationalStyle =
        cssengine::parseAuthorStyle(inputs.presentationalStyle);
    resolveInputs.presentationalStyle = &presentationalStyle;
  }
  resolveInputs.scrollPart = inputs.scrollPart;
  auto resolution = resolveElement(resolveInputs, *current, entry->parent);
  trace["tag"] = element->tag;
  trace["styleId"] = inputs.styleId;
  trace["position"] = entry->position;
  trace["siblingCount"] = entry->siblingCount;
  trace["props"] = std::move(resolution.props);
  return trace;
}

namespace {

bool isBoxDisplay(std::string_view value) {
  std::string keyword = lowercase(cssengine::trimmed(value));
  return keyword == "flex" || keyword == "inline-flex" || keyword == "block" ||
      keyword == "inline-block" || keyword == "grid" ||
      keyword == "inline-grid" || keyword == "flow-root";
}

// What one declaration, in any branch, says about the hints
uint32_t hintsOfDeclaration(std::string_view property, std::string_view value) {
  uint32_t hints = 0;
  std::string keyword = lowercase(cssengine::trimmed(value));
  if (property == "display") {
    if (isBoxDisplay(keyword)) {
      hints |= cssengine::StyleHintBox;
    } else if (keyword == "contents") {
      hints |= cssengine::StyleHintContents;
    }
  } else if (property == "position") {
    if (keyword == "absolute" || keyword == "fixed") {
      hints |= cssengine::StyleHintBox;
    }
  } else if (property == "float") {
    if (keyword != "none") {
      hints |= cssengine::StyleHintBox;
    }
  } else if (
      property == "gridRow" || property == "gridRowStart" ||
      property == "gridRowEnd" || property == "gridColumn" ||
      property == "gridColumnStart" || property == "gridColumnEnd" ||
      property == "gridArea") {
    hints |= cssengine::StyleHintBox;
  } else if (
      property == "overflow" || property == "overflowX" ||
      property == "overflowY" || property == "overflowInline" ||
      property == "overflowBlock") {
    // Only an explicit `overflow-x` scrolls sideways; the shorthand names a
    // region that scrolls in the block axis
    if (keyword.find("auto") != std::string::npos ||
        keyword.find("scroll") != std::string::npos) {
      hints |= property == "overflowX" || property == "overflowInline"
          ? cssengine::StyleHintScroll
          : cssengine::StyleHintScrollBlock;
    }
  } else if (property == "backgroundImage" || property == "background") {
    if (keyword.find("url(") != std::string::npos) {
      hints |= cssengine::StyleHintBackgroundImage;
    }
  } else if (property == "containerType" || property == "container") {
    hints |= cssengine::StyleHintContainer;
  }
  return hints;
}

bool readsState(const cssengine::CompoundSelector& compound);

uint32_t hintsOfEntries(
    const std::vector<AuthorEntry>& entries,
    std::string_view property) {
  uint32_t hints = 0;
  for (const auto& entry : entries) {
    if (entry.condition == AuthorEntry::Condition::PseudoClass &&
        entry.priority != 5) {
      hints |= cssengine::StyleHintStates;
    }
    if (entry.condition == AuthorEntry::Condition::Selector &&
        entry.selector != nullptr) {
      // A condition on the element's own state; one on a marked ancestor's
      // is the ancestor's to report
      for (const auto& selector : *entry.selector) {
        if (selector.compounds.size() == 1 &&
            readsState(selector.compounds.back())) {
          hints |= cssengine::StyleHintStates;
        }
      }
    }
    std::string_view name = entry.condition == AuthorEntry::Condition::None
        ? std::string_view(entry.key)
        : property;
    if (entry.kind == AuthorEntry::Kind::Nested) {
      hints |= hintsOfEntries(
          entry.entries, entry.block ? std::string_view() : name);
    } else if (entry.kind == AuthorEntry::Kind::Value) {
      hints |= hintsOfDeclaration(name, entry.text);
    }
  }
  return hints;
}

bool isStatePseudoClass(cssengine::PseudoClass kind) {
  return kind == cssengine::PseudoClass::Hover ||
      kind == cssengine::PseudoClass::Active ||
      kind == cssengine::PseudoClass::Focus ||
      kind == cssengine::PseudoClass::FocusVisible;
}

bool readsState(const cssengine::CompoundSelector& compound) {
  for (const auto& pseudo : compound.pseudoClasses) {
    if (isStatePseudoClass(pseudo.kind)) {
      return true;
    }
    if (pseudo.arguments != nullptr) {
      for (const auto& selector : *pseudo.arguments) {
        for (const auto& inner : selector.compounds) {
          if (readsState(inner)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

} // namespace

uint32_t StyleEngine::hints(
    const std::string& tag,
    const std::string& className,
    const folly::dynamic& attributes,
    int64_t styleId,
    const folly::dynamic& inlineStyle) const {
  auto start = std::chrono::steady_clock::now();
  uint32_t result =
      hintsUncounted(tag, className, attributes, styleId, inlineStyle);
  add(counters_->hintsAsked, 1);
  add(counters_->hintsNanos, nanosSince(start));
  return result;
}

uint32_t StyleEngine::hintsUncounted(
    const std::string& tag,
    const std::string& className,
    const folly::dynamic& attributes,
    int64_t styleId,
    const folly::dynamic& inlineStyle) const {
  uint32_t result = 0;
  if (auto styleX = style(styleId)) {
    result |= hintsOfEntries(styleX->declarations, {});
  }
  if (inlineStyle.isArray()) {
    auto parsed = cssengine::parseAuthorStyle(inlineStyle);
    result |= hintsOfEntries(parsed.declarations, {});
  }

  // The element as its own compounds would see it, in no state
  StyleContext element;
  element.tag = lowercase(tag);
  size_t i = 0;
  while (i < className.size()) {
    while (i < className.size() &&
           std::isspace(static_cast<unsigned char>(className[i]))) {
      i++;
    }
    size_t start = i;
    while (i < className.size() &&
           !std::isspace(static_cast<unsigned char>(className[i]))) {
      i++;
    }
    if (i > start) {
      element.classes.push_back(className.substr(start, i - start));
    }
  }
  if (attributes.isObject()) {
    for (const auto& [key, value] : attributes.items()) {
      if (!key.isString() || value.isNull() ||
          (value.isBool() && !value.asBool())) {
        continue;
      }
      element.attributes.emplace_back(
          lowercase(key.getString()),
          value.isString()       ? value.getString()
              : value.isNumber() ? formatNumber(value.asDouble())
                                 : std::string());
    }
  }

  std::vector<std::shared_ptr<const cssengine::StyleSheet>> sheets;
  {
    std::scoped_lock lock(stateMutex_);
    for (const auto& [id, sheet] : sheets_) {
      sheets.push_back(sheet);
    }
  }
  for (const auto& sheet : sheets) {
    for (const auto& rule : sheet->rules) {
      bool subjectMayMatch = false;
      for (const auto& selector : rule.selectors) {
        if (selector.compounds.empty()) {
          continue;
        }
        if (cssengine::compoundCouldMatch(selector.compounds.back(), element)) {
          subjectMayMatch = true;
        }
        for (const auto& compound : selector.compounds) {
          if (readsState(compound) &&
              cssengine::compoundCouldMatch(compound, element)) {
            result |= cssengine::StyleHintStates;
          }
        }
      }
      if (!subjectMayMatch) {
        continue;
      }
      for (const auto& declaration : rule.declarations) {
        result |= hintsOfDeclaration(declaration.property, declaration.value);
      }
    }
  }
  return result;
}

StyleEngine::Stats StyleEngine::stats() const {
  const Counters& c = *counters_;
  auto load = [](const std::atomic<uint64_t>& counter) {
    return counter.load(std::memory_order_relaxed);
  };
  Stats stats;
  stats.passes = load(c.passes);
  stats.passNanos = load(c.passNanos);
  stats.nodesVisited = load(c.nodesVisited);
  stats.subtreesKept = load(c.subtreesKept);
  stats.elementsResolved = load(c.elementsResolved);
  stats.resolvedNew = load(c.resolvedNew);
  stats.resolvedProps = load(c.resolvedProps);
  stats.resolvedParent = load(c.resolvedParent);
  stats.resolvedSiblings = load(c.resolvedSiblings);
  stats.resolvedGeneration = load(c.resolvedGeneration);
  stats.resolvedStates = load(c.resolvedStates);
  stats.resolveNanos = load(c.resolveNanos);
  stats.matchNanos = load(c.matchNanos);
  stats.elementsKept = load(c.elementsKept);
  stats.childContextsKept = load(c.childContextsKept);
  stats.propsParsed = load(c.propsParsed);
  stats.propsParseNanos = load(c.propsParseNanos);
  stats.nodesCloned = load(c.nodesCloned);
  stats.restyles = load(c.restyles);
  stats.snapshots = load(c.snapshots);
  stats.stylesRegistered = load(c.stylesRegistered);
  stats.registerNanos = load(c.registerNanos);
  stats.hintsAsked = load(c.hintsAsked);
  stats.hintsNanos = load(c.hintsNanos);
  stats.stateEvents = load(c.stateEvents);
  stats.stateCommits = load(c.stateCommits);
  return stats;
}

void StyleEngine::resetStats() {
  Counters& c = *counters_;
  for (auto* counter : {&c.passes,           &c.passNanos,
                        &c.nodesVisited,     &c.subtreesKept,
                        &c.elementsResolved, &c.resolvedNew,
                        &c.resolvedProps,    &c.resolvedParent,
                        &c.resolvedSiblings, &c.resolvedGeneration,
                        &c.resolveNanos,     &c.matchNanos,
                        &c.elementsKept,     &c.childContextsKept,
                        &c.propsParsed,      &c.propsParseNanos,
                        &c.nodesCloned,      &c.restyles,
                        &c.snapshots,        &c.stylesRegistered,
                        &c.registerNanos,    &c.hintsAsked,
                        &c.hintsNanos,       &c.resolvedStates,
                        &c.stateEvents,      &c.stateCommits}) {
    counter->store(0, std::memory_order_relaxed);
  }
}

// -- JavaScript --

namespace {

std::shared_ptr<const ShadowNode> nodeFromValue(
    jsi::Runtime& runtime,
    const jsi::Value& value) {
  if (!value.isObject()) {
    return nullptr;
  }
  try {
    return Bridging<std::shared_ptr<const ShadowNode>>::fromJs(runtime, value);
  } catch (const jsi::JSError&) {
    return nullptr;
  } catch (const jsi::JSINativeException&) {
    return nullptr;
  }
}

MediaEnvironment::Pointer pointerOf(const std::string& value) {
  if (value == "fine") {
    return MediaEnvironment::Pointer::Fine;
  }
  if (value == "none") {
    return MediaEnvironment::Pointer::None;
  }
  return MediaEnvironment::Pointer::Coarse;
}

MediaEnvironment::Gamut gamutOf(const std::string& value) {
  if (value == "p3") {
    return MediaEnvironment::Gamut::P3;
  }
  if (value == "rec2020") {
    return MediaEnvironment::Gamut::Rec2020;
  }
  return MediaEnvironment::Gamut::Srgb;
}

} // namespace

void StyleEngine::installBindings(
    jsi::Runtime& runtime,
    std::weak_ptr<StyleEngine> weakEngine) {
  jsi::Object binding(runtime);
  auto define =
      [&](const char* name,
          unsigned int count,
          std::function<jsi::Value(
              jsi::Runtime&, StyleEngine&, const jsi::Value*, size_t)> body) {
        binding.setProperty(
            runtime,
            name,
            jsi::Function::createFromHostFunction(
                runtime,
                jsi::PropNameID::forAscii(runtime, name),
                count,
                [weakEngine, body = std::move(body)](
                    jsi::Runtime& rt,
                    const jsi::Value& /*thisValue*/,
                    const jsi::Value* arguments,
                    size_t argumentCount) -> jsi::Value {
                  auto engine = weakEngine.lock();
                  if (engine == nullptr) {
                    return jsi::Value::undefined();
                  }
                  return body(rt, *engine, arguments, argumentCount);
                }));
      };

  define(
      "addStyleSheet",
      1,
      [](jsi::Runtime& rt,
         StyleEngine& engine,
         const jsi::Value* args,
         size_t count) {
        if (count < 1 || !args[0].isString()) {
          return jsi::Value(-1);
        }
        return jsi::Value(engine.addStyleSheet(args[0].getString(rt).utf8(rt)));
      });
  define(
      "replaceStyleSheet",
      2,
      [](jsi::Runtime& rt,
         StyleEngine& engine,
         const jsi::Value* args,
         size_t count) {
        if (count >= 2 && args[0].isNumber() && args[1].isString()) {
          engine.replaceStyleSheet(
              static_cast<int>(args[0].getNumber()),
              args[1].getString(rt).utf8(rt));
        }
        return jsi::Value::undefined();
      });
  define(
      "removeStyleSheet",
      1,
      [](jsi::Runtime& /*rt*/,
         StyleEngine& engine,
         const jsi::Value* args,
         size_t count) {
        if (count >= 1 && args[0].isNumber()) {
          engine.removeStyleSheet(static_cast<int>(args[0].getNumber()));
        }
        return jsi::Value::undefined();
      });
  define(
      "registerStyle",
      1,
      [](jsi::Runtime& rt,
         StyleEngine& engine,
         const jsi::Value* args,
         size_t count) {
        if (count < 1) {
          return jsi::Value(0);
        }
        return jsi::Value(
            static_cast<double>(
                engine.registerStyle(jsi::dynamicFromValue(rt, args[0]))));
      });
  define(
      "registerTokens",
      1,
      [](jsi::Runtime& rt,
         StyleEngine& engine,
         const jsi::Value* args,
         size_t count) {
        if (count >= 1) {
          engine.registerTokens(jsi::dynamicFromValue(rt, args[0]));
        }
        return jsi::Value::undefined();
      });
  define(
      "registerKeyframes",
      2,
      [](jsi::Runtime& rt,
         StyleEngine& engine,
         const jsi::Value* args,
         size_t count) {
        if (count >= 2 && args[0].isString()) {
          engine.registerKeyframes(
              args[0].getString(rt).utf8(rt),
              jsi::dynamicFromValue(rt, args[1]));
        }
        return jsi::Value::undefined();
      });
  define(
      "setEnvironment",
      1,
      [](jsi::Runtime& rt,
         StyleEngine& engine,
         const jsi::Value* args,
         size_t count) {
        if (count < 1 || !args[0].isObject()) {
          return jsi::Value::undefined();
        }
        folly::dynamic value = jsi::dynamicFromValue(rt, args[0]);
        StyleEnvironment environment;
        auto number = [&](const char* key, double fallback) {
          const auto* found = value.get_ptr(key);
          return found != nullptr && found->isNumber() ? found->asDouble()
                                                       : fallback;
        };
        auto boolean = [&](const char* key) {
          const auto* found = value.get_ptr(key);
          return found != nullptr && found->isBool() && found->asBool();
        };
        auto string = [&](const char* key) {
          const auto* found = value.get_ptr(key);
          return found != nullptr && found->isString() ? found->getString()
                                                       : std::string();
        };
        auto& media = environment.media;
        media.width = number("width", 0);
        media.height = number("height", 0);
        media.viewportWidth = number("viewportWidth", media.width);
        media.viewportHeight = number("viewportHeight", media.height);
        media.resolution = number("resolution", 1);
        media.dark = boolean("dark");
        media.reducedMotion = boolean("reducedMotion");
        media.pointer = pointerOf(string("pointer"));
        media.hover = boolean("hover");
        media.gamut = gamutOf(string("gamut"));
        media.highDynamicRange = boolean("highDynamicRange");
        if (const auto* variables = value.get_ptr("env");
            variables != nullptr && variables->isObject()) {
          for (const auto& [key, entry] : variables->items()) {
            if (key.isString() && entry.isNumber()) {
              environment.variables[key.getString()] = entry.asDouble();
            }
          }
        }
        engine.setEnvironment(std::move(environment));
        return jsi::Value::undefined();
      });
  define(
      "computedStyle",
      1,
      [](jsi::Runtime& rt,
         StyleEngine& engine,
         const jsi::Value* args,
         size_t count) {
        if (count < 1) {
          return jsi::Value::null();
        }
        auto node = nodeFromValue(rt, args[0]);
        if (node == nullptr) {
          return jsi::Value::null();
        }
        return jsi::valueFromDynamic(rt, engine.computedStyle(*node));
      });
  define(
      "customProperty",
      2,
      [](jsi::Runtime& rt,
         StyleEngine& engine,
         const jsi::Value* args,
         size_t count) {
        if (count < 2 || !args[1].isString()) {
          return jsi::Value::null();
        }
        auto node = nodeFromValue(rt, args[0]);
        if (node == nullptr) {
          return jsi::Value::null();
        }
        return jsi::valueFromDynamic(
            rt, engine.customProperty(*node, args[1].getString(rt).utf8(rt)));
      });
  define(
      "matches",
      2,
      [](jsi::Runtime& rt,
         StyleEngine& engine,
         const jsi::Value* args,
         size_t count) {
        if (count < 2 || !args[1].isString()) {
          return jsi::Value(false);
        }
        auto node = nodeFromValue(rt, args[0]);
        if (node == nullptr) {
          return jsi::Value(false);
        }
        return jsi::Value(
            engine.matches(*node, args[1].getString(rt).utf8(rt)));
      });
  define(
      "flush",
      0,
      [](jsi::Runtime& /*rt*/,
         StyleEngine& engine,
         const jsi::Value* /*args*/,
         size_t /*count*/) {
        engine.flush();
        return jsi::Value::undefined();
      });
  define(
      "stats",
      0,
      [](jsi::Runtime& rt,
         StyleEngine& engine,
         const jsi::Value* /*args*/,
         size_t /*count*/) {
        auto stats = engine.stats();
        auto ms = [](uint64_t nanos) {
          return static_cast<double>(nanos) / 1e6;
        };
        jsi::Object out(rt);
        out.setProperty(rt, "passes", static_cast<double>(stats.passes));
        out.setProperty(rt, "passMs", ms(stats.passNanos));
        out.setProperty(
            rt, "nodesVisited", static_cast<double>(stats.nodesVisited));
        out.setProperty(
            rt, "subtreesKept", static_cast<double>(stats.subtreesKept));
        out.setProperty(
            rt,
            "elementsResolved",
            static_cast<double>(stats.elementsResolved));
        out.setProperty(
            rt, "resolvedNew", static_cast<double>(stats.resolvedNew));
        out.setProperty(
            rt, "resolvedProps", static_cast<double>(stats.resolvedProps));
        out.setProperty(
            rt, "resolvedParent", static_cast<double>(stats.resolvedParent));
        out.setProperty(
            rt,
            "resolvedSiblings",
            static_cast<double>(stats.resolvedSiblings));
        out.setProperty(
            rt,
            "resolvedGeneration",
            static_cast<double>(stats.resolvedGeneration));
        out.setProperty(rt, "resolveMs", ms(stats.resolveNanos));
        out.setProperty(rt, "matchMs", ms(stats.matchNanos));
        out.setProperty(
            rt, "elementsKept", static_cast<double>(stats.elementsKept));
        out.setProperty(
            rt,
            "childContextsKept",
            static_cast<double>(stats.childContextsKept));
        out.setProperty(
            rt, "propsParsed", static_cast<double>(stats.propsParsed));
        out.setProperty(rt, "propsParseMs", ms(stats.propsParseNanos));
        out.setProperty(
            rt, "nodesCloned", static_cast<double>(stats.nodesCloned));
        out.setProperty(rt, "restyles", static_cast<double>(stats.restyles));
        out.setProperty(rt, "snapshots", static_cast<double>(stats.snapshots));
        out.setProperty(
            rt,
            "stylesRegistered",
            static_cast<double>(stats.stylesRegistered));
        out.setProperty(rt, "registerMs", ms(stats.registerNanos));
        out.setProperty(
            rt, "hintsAsked", static_cast<double>(stats.hintsAsked));
        out.setProperty(rt, "hintsMs", ms(stats.hintsNanos));
        out.setProperty(
            rt, "resolvedStates", static_cast<double>(stats.resolvedStates));
        out.setProperty(
            rt, "stateEvents", static_cast<double>(stats.stateEvents));
        out.setProperty(
            rt, "stateCommits", static_cast<double>(stats.stateCommits));
        return jsi::Value(rt, out);
      });
  define(
      "resetStats",
      0,
      [](jsi::Runtime& /*rt*/,
         StyleEngine& engine,
         const jsi::Value* /*args*/,
         size_t /*count*/) {
        engine.resetStats();
        return jsi::Value::undefined();
      });
  define(
      "explain",
      1,
      [](jsi::Runtime& rt,
         StyleEngine& engine,
         const jsi::Value* args,
         size_t count) {
        if (count < 1) {
          return jsi::Value::null();
        }
        auto node = nodeFromValue(rt, args[0]);
        if (node == nullptr) {
          return jsi::Value::null();
        }
        return jsi::valueFromDynamic(rt, engine.explain(*node));
      });
  define(
      "hints",
      5,
      [](jsi::Runtime& rt,
         StyleEngine& engine,
         const jsi::Value* args,
         size_t count) {
        if (count < 5) {
          return jsi::Value(0);
        }
        std::string tag =
            args[0].isString() ? args[0].getString(rt).utf8(rt) : std::string();
        std::string className =
            args[1].isString() ? args[1].getString(rt).utf8(rt) : std::string();
        folly::dynamic attributes = args[2].isObject()
            ? jsi::dynamicFromValue(rt, args[2])
            : folly::dynamic(nullptr);
        int64_t styleId =
            args[3].isNumber() ? static_cast<int64_t>(args[3].getNumber()) : 0;
        folly::dynamic inlineStyle = args[4].isObject()
            ? jsi::dynamicFromValue(rt, args[4])
            : folly::dynamic(nullptr);
        return jsi::Value(
            static_cast<double>(engine.hints(
                tag, className, attributes, styleId, inlineStyle)));
      });

  runtime.global().setProperty(runtime, "__cssEngine", std::move(binding));
}

} // namespace facebook::react
