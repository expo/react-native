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
#include <optional>
#include <unordered_set>

#include <chrono>

#include <cxxreact/TraceSection.h>
#include <folly/ScopeGuard.h>
#include <folly/json.h>
#include <jsi/JSIDynamic.h>
#include <react/renderer/bridging/bridging.h>
#include <react/renderer/components/root/RootShadowNode.h>
#include <react/renderer/components/view/ViewPropsOf.h>
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
  [popover] { width: fit-content; height: fit-content; }
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

// The pseudo-classes the engine answers in a conditional value from the
// element's states and its `disabled`, as `AuthorEntry::pseudoClass` names
// them; 0 for any other
int pseudoClassOf(std::string_view key) {
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
 * related to it. Null for a relation the engine cannot answer.
 * DOM-CSS-LIMITATION(when-relations-need-has): `when.descendant`,
 * `when.siblingAfter` and `when.anySibling` compile to `:has()` on the web,
 * which the engine does not match, so a condition on one never holds.
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
  if (key == "@starting-style") {
    entry.condition = AuthorEntry::Condition::Starting;
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
  if (int pseudoClass = pseudoClassOf(key)) {
    entry.condition = AuthorEntry::Condition::PseudoClass;
    entry.pseudoClass = pseudoClass;
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

void foldBlock(AuthorEntry&& block, std::vector<AuthorEntry>& declarations);

/*
 * A list of declarations, each a property and its value. A block in it
 * (`':hover': {color: …}`, `'@media …': {…}`) is folded into the values of
 * the properties it declares, after the list's own declarations.
 */
void parseDeclarations(
    const folly::dynamic& entries,
    std::vector<AuthorEntry>& out) {
  if (!entries.isArray()) {
    return;
  }
  std::vector<AuthorEntry> blocks;
  for (const auto& pair : entries) {
    if (!pair.isArray() || pair.size() != 2 || !pair[0].isString()) {
      continue;
    }
    AuthorEntry entry;
    entry.key = pair[0].getString();
    const folly::dynamic& value = pair[1];
    if (startsWith(entry.key, ":") || startsWith(entry.key, "@")) {
      // Skip a value under a condition with no property to give it to
      if (value.isObject() && value.get_ptr("c") != nullptr) {
        classifyCondition(entry);
        parseDeclarations(value["c"], entry.entries);
        blocks.push_back(std::move(entry));
      }
      continue;
    }
    parseValue(entry.key, value, entry);
    out.push_back(std::move(entry));
  }
  for (auto& block : blocks) {
    foldBlock(std::move(block), out);
  }
}

/*
 * A block's declarations as branches of its properties' values, under its
 * condition. StyleX compiles `':hover': {color: …}` to the rule it compiles
 * `color: {':hover': …}` to, so the two resolve as one: the property's value
 * becomes the `default` of a conditional value where it is not one already,
 * and a property the list does not declare gains a value with no `default`.
 */
void foldBlock(AuthorEntry&& block, std::vector<AuthorEntry>& declarations) {
  for (auto& declaration : block.entries) {
    auto value = std::find_if(
        declarations.rbegin(), declarations.rend(), [&](const auto& entry) {
          return entry.key == declaration.key;
        });
    if (value == declarations.rend()) {
      AuthorEntry added;
      added.key = declaration.key;
      added.kind = AuthorEntry::Kind::Nested;
      declarations.push_back(std::move(added));
      value = declarations.rbegin();
    } else if (value->kind != AuthorEntry::Kind::Nested) {
      AuthorEntry fallback = std::move(*value);
      fallback.key = "default";
      fallback.condition = AuthorEntry::Condition::Default;
      *value = AuthorEntry{};
      value->key = declaration.key;
      value->kind = AuthorEntry::Kind::Nested;
      value->entries.push_back(std::move(fallback));
    }
    AuthorEntry branch = std::move(declaration);
    branch.key = block.key;
    branch.condition = block.condition;
    branch.pseudoClass = block.pseudoClass;
    branch.media = block.media;
    branch.selector = block.selector;
    value->entries.push_back(std::move(branch));
  }
}

// -- Resolution --

// One declaration in cascade order, its value text or a raw value
struct Declared {
  std::string_view property;
  std::string_view value;
  const folly::dynamic* raw{nullptr};
};

// The interaction state a StyleX pseudo-class reads (`pseudoClassOf`): none
// for `:disabled`, which is the element's attribute
uint32_t stateOfPseudoClass(int pseudoClass) {
  switch (pseudoClass) {
    case 1:
      return cssengine::ElementStateHover;
    case 2:
    case 3:
      return cssengine::ElementStateFocus;
    case 4:
      return cssengine::ElementStateActive;
    default:
      return 0;
  }
}

// What StyleX's conditions read of an element
struct ConditionState {
  uint32_t states{0};
  bool disabled{false};
  const MediaEnvironment* media{nullptr};
  // The element, which a `when.*` condition's selector is matched against
  const StyleContext* element{nullptr};
  // Whether the element's starting style is being resolved, where
  // `@starting-style` holds; and where a `@starting-style` value seen is
  // noted, which says the element has a starting style
  bool starting{false};
  bool* sawStarting{nullptr};

  bool selectorMatches(const AuthorEntry& entry) const {
    return entry.selector != nullptr && element != nullptr &&
        cssengine::matchesSelectorList(*entry.selector, *element);
  }

  bool pseudoClassMatches(int pseudoClass) const {
    if (pseudoClass == 5) {
      return disabled;
    }
    return (states & stateOfPseudoClass(pseudoClass)) != 0;
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
 * StyleX's priority of a condition key: its compiler's `getPriority`
 * (@stylexjs/babel-plugin 0.19), with its table of pseudo-classes as it has
 * it (`:focusVisible` is spelled there as a camel-cased key, so
 * `:focus-visible` counts as any other pseudo-class, 40). It orders the rules
 * StyleX generates for the branches of one value and writes that order into
 * their specificity, so of the branches whose conditions hold, the one whose
 * conditions sum highest wins.
 */
double stylexConditionPriority(std::string_view key) {
  static const std::unordered_map<std::string_view, double> pseudoClasses = {
      {":is", 40},
      {":where", 40},
      {":not", 40},
      {":has", 45},
      {":dir", 50},
      {":lang", 51},
      {":first-child", 52},
      {":first-of-type", 53},
      {":last-child", 54},
      {":last-of-type", 55},
      {":only-child", 56},
      {":only-of-type", 57},
      {":nth-child", 60},
      {":nth-last-child", 61},
      {":nth-of-type", 62},
      {":nth-last-of-type", 63},
      {":empty", 70},
      {":link", 80},
      {":any-link", 81},
      {":local-link", 82},
      {":target-within", 83},
      {":target", 84},
      {":visited", 85},
      {":enabled", 91},
      {":disabled", 92},
      {":required", 93},
      {":optional", 94},
      {":read-only", 95},
      {":read-write", 96},
      {":placeholder-shown", 97},
      {":in-range", 98},
      {":out-of-range", 99},
      {":default", 100},
      {":checked", 101},
      {":indeterminate", 101},
      {":blank", 102},
      {":valid", 103},
      {":invalid", 104},
      {":user-invalid", 105},
      {":autofill", 110},
      {":picture-in-picture", 120},
      {":modal", 121},
      {":fullscreen", 122},
      {":paused", 123},
      {":playing", 124},
      {":current", 125},
      {":past", 126},
      {":future", 127},
      {":hover", 130},
      {":focusWithin", 140},
      {":focus", 150},
      {":focusVisible", 160},
      {":active", 170},
  };
  auto pseudoClass = [&](std::string_view name) -> double {
    auto found = pseudoClasses.find(name);
    return found != pseudoClasses.end() ? found->second : 40;
  };
  if (key == "default") {
    return 0;
  }
  if (startsWith(key, "@supports")) {
    return 30;
  }
  if (startsWith(key, "@media")) {
    return 200;
  }
  if (startsWith(key, "@container")) {
    return 300;
  }
  if (startsWith(key, ":where-")) {
    // A `when.*` key as the runtime writes it (`:where-ancestor(:hover, m)`),
    // ranked as the selector StyleX writes for it (`:where(.m:hover *)`): by
    // its relation, and a hundredth of its pseudo-class's priority. A
    // relation to anything but a pseudo-class is a plain `:where`.
    size_t open = key.find('(');
    size_t comma = key.rfind(',');
    if (open != std::string_view::npos && comma != std::string_view::npos &&
        comma > open) {
      std::string_view relation = key.substr(7, open - 7);
      std::string_view pseudo =
          cssengine::trimmed(key.substr(open + 1, comma - open - 1));
      bool simple =
          pseudo.size() > 1 && pseudo[0] == ':' &&
          std::all_of(pseudo.begin() + 1, pseudo.end(), [](char c) {
            return std::isalpha(static_cast<unsigned char>(c)) || c == '-';
          });
      double base = relation == "ancestor" ? 10
          : relation == "descendant"       ? 15
          : relation == "any-sibling"      ? 20
          : relation == "sibling-before"   ? 30
          : relation == "sibling-after"    ? 40
                                           : 0;
      if (simple && base != 0) {
        return base + pseudoClass(pseudo) / 100;
      }
    }
    return 40;
  }
  if (startsWith(key, ":")) {
    // A compound of pseudo-classes and no argument (`:hover:active`) sums
    // its parts; any other is ranked by its first
    if (key.find('(') == std::string_view::npos) {
      double total = 0;
      int parts = 0;
      size_t at = 0;
      while (at < key.size()) {
        size_t next = key.find(':', at + 1);
        while (next != std::string_view::npos && key[next - 1] == ':') {
          next = key.find(':', next + 1);
        }
        std::string_view part = key.substr(
            at,
            next == std::string_view::npos ? std::string_view::npos
                                           : next - at);
        total += startsWith(part, "::") ? 5000 : pseudoClass(part);
        parts++;
        at = next == std::string_view::npos ? key.size() : next;
      }
      if (parts > 1) {
        return total;
      }
    }
    if (startsWith(key, "::")) {
      return 5000;
    }
    return pseudoClass(key.substr(0, key.find('(')));
  }
  // An attribute selector, and any other key that names no property
  return 3000;
}

// Whether a branch's condition holds for the element
bool conditionHolds(const AuthorEntry& entry, const ConditionState& state) {
  switch (entry.condition) {
    case AuthorEntry::Condition::Default:
      return true;
    case AuthorEntry::Condition::Media:
      return entry.media && entry.media->matches(*state.media);
    case AuthorEntry::Condition::Starting:
      if (state.sawStarting != nullptr) {
        *state.sawStarting = true;
      }
      return state.starting;
    case AuthorEntry::Condition::Selector:
      return state.selectorMatches(entry);
    case AuthorEntry::Condition::PseudoClass:
      return state.pseudoClassMatches(entry.pseudoClass);
    case AuthorEntry::Condition::None:
    case AuthorEntry::Condition::Ignored:
      return false;
  }
  return false;
}

// A branch of a conditional value that applies, and the priority of the
// conditions on its way there
struct PickedBranch {
  const AuthorEntry* entry{nullptr};
  double priority{0};
};

PickedBranch pickBranch(const AuthorEntry& value, const ConditionState& state) {
  PickedBranch best;
  for (const auto& entry : value.entries) {
    if (!conditionHolds(entry, state)) {
      continue;
    }
    PickedBranch branch = entry.kind == AuthorEntry::Kind::Nested
        ? pickBranch(entry, state)
        : PickedBranch{&entry, 0};
    if (!isPresent(branch.entry)) {
      continue;
    }
    branch.priority += stylexConditionPriority(entry.key);
    // A tie goes to the later branch, as StyleX writes its rules in order
    if (best.entry == nullptr || branch.priority >= best.priority) {
      best = branch;
    }
  }
  return best;
}

/*
 * The branch of a StyleX conditional value that applies, as the web's
 * generated rules pick it: of the branches whose conditions all hold, the
 * one whose conditions' StyleX priorities sum highest, the later one on a
 * tie. A `default` adds nothing to the sum, and a `null` branch declares
 * nothing.
 */
const AuthorEntry* pickConditional(
    const AuthorEntry& value,
    const ConditionState& state) {
  return pickBranch(value, state).entry;
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

// A StyleX style's declarations for an element, in the order it declares
// them, each its value under the conditions that hold
void collectAuthorStyle(
    const AuthorStyle& style,
    const ConditionState& state,
    std::vector<Declared>& out) {
  for (const auto& entry : style.declarations) {
    appendPicked(entry.key, resolveInner(entry, state), out);
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

// An element's computed line height in points, which `lh` means
// (css-values-4 §6.1.1). DOM-CSS-LIMITATION(lh-normal-is-a-ratio): `normal`
// counts as 1.2 times the font size, where the web measures the font's own
// metrics
double computedLineHeight(const StyleContext& context) {
  if (context.lineHeightLength) {
    return *context.lineHeightLength;
  }
  return context.fontSize * context.lineHeightFactor.value_or(1.2);
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

// Whether two contexts hand their rows the same table layout
bool sameTableLayout(
    const std::shared_ptr<const cssengine::TableLayout>& a,
    const std::shared_ptr<const cssengine::TableLayout>& b) {
  return a == b || (a != nullptr && b != nullptr && *a == *b);
}

// Whether two contexts say the same to selectors and to descendants
bool sameContext(const StyleContext& a, const StyleContext& b) {
  return a.tag == b.tag && a.classes == b.classes &&
      a.attributes == b.attributes && a.states == b.states &&
      a.isRoot == b.isRoot && a.position == b.position &&
      a.siblingCount == b.siblingCount && a.parent == b.parent &&
      a.previousSibling == b.previousSibling &&
      sameCustomProperties(a.customProperties, b.customProperties) &&
      a.fontSize == b.fontSize && a.lineHeightFactor == b.lineHeightFactor &&
      a.lineHeightLength == b.lineHeightLength && a.color == b.color &&
      a.rtl == b.rtl && a.containerNames == b.containerNames &&
      a.cellAlign == b.cellAlign &&
      sameTableLayout(a.tableLayout, b.tableLayout) && a.hidden == b.hidden &&
      a.colorScheme == b.colorScheme && a.darkScheme == b.darkScheme &&
      a.pointerEventsNone == b.pointerEventsNone &&
      a.laysOutItems == b.laysOutItems &&
      a.clipsBlockBelow == b.clipsBlockBelow &&
      (a.scrollContent == b.scrollContent ||
       (a.scrollContent != nullptr && b.scrollContent != nullptr &&
        *a.scrollContent == *b.scrollContent)) &&
      (a.computed == b.computed ||
       (a.computed != nullptr && b.computed != nullptr &&
        *a.computed == *b.computed));
}

// Whether two contexts hand their descendants the same inherited values,
// whatever their ancestors and custom properties
bool sameInheritedValues(const StyleContext& a, const StyleContext& b) {
  return a.tag == b.tag && a.isRoot == b.isRoot && a.fontSize == b.fontSize &&
      a.lineHeightFactor == b.lineHeightFactor &&
      a.lineHeightLength == b.lineHeightLength && a.color == b.color &&
      a.rtl == b.rtl && a.containerNames == b.containerNames &&
      a.cellAlign == b.cellAlign && a.hidden == b.hidden &&
      a.colorScheme == b.colorScheme && a.darkScheme == b.darkScheme &&
      a.pointerEventsNone == b.pointerEventsNone &&
      a.laysOutItems == b.laysOutItems &&
      a.clipsBlockBelow == b.clipsBlockBelow;
}

// Whether two contexts are the same previous sibling to a selector
bool sameSiblingForSelectors(const StyleContext& a, const StyleContext& b) {
  return a.tag == b.tag && a.classes == b.classes &&
      a.attributes == b.attributes && a.states == b.states &&
      a.position == b.position && a.siblingCount == b.siblingCount;
}

// Whether every custom property whose value differs between the two scopes
// is outside `reads`. The scopes are chains ending in shared tokens, so the
// walk compares each level's own declarations until the chains meet.
bool customPropertiesDifferOnlyOutside(
    const std::shared_ptr<const CustomProperties>& before,
    const std::shared_ptr<const CustomProperties>& after,
    const std::unordered_set<std::string>& reads) {
  if (before == after) {
    return true;
  }
  // The shared tail: the first scope on `before`'s chain that `after`'s
  // chain also holds
  const CustomProperties* shared = nullptr;
  for (const CustomProperties* s = before.get();
       s != nullptr && shared == nullptr;
       s = s->parent().get()) {
    for (const CustomProperties* t = after.get(); t != nullptr;
         t = t->parent().get()) {
      if (t == s) {
        shared = s;
        break;
      }
    }
  }
  // Every name declared on a chain down to the shared tail, with the value
  // the chain gives it
  auto declared = [](const std::shared_ptr<const CustomProperties>& scope,
                     const CustomProperties* stop,
                     std::unordered_map<std::string, std::string>& out) {
    for (const CustomProperties* s = scope.get(); s != nullptr && s != stop;
         s = s->parent().get()) {
      for (const auto& [name, value] : s->own()) {
        out.emplace(name, value);
      }
    }
  };
  std::unordered_map<std::string, std::string> beforeOwn;
  std::unordered_map<std::string, std::string> afterOwn;
  declared(before, shared, beforeOwn);
  declared(after, shared, afterOwn);
  auto differs =
      [&](const std::string& name,
          const std::string& value,
          const std::unordered_map<std::string, std::string>& other) {
        auto found = other.find(name);
        const std::string* otherValue = found != other.end()
            ? &found->second
            : (shared != nullptr ? shared->find(name) : nullptr);
        return otherValue == nullptr || *otherValue != value;
      };
  for (const auto& [name, value] : beforeOwn) {
    if (reads.count(name) != 0 && differs(name, value, afterOwn)) {
      return false;
    }
  }
  for (const auto& [name, value] : afterOwn) {
    if (beforeOwn.count(name) == 0 && reads.count(name) != 0 &&
        differs(name, value, beforeOwn)) {
      return false;
    }
  }
  return true;
}

// Whether two contexts of one element hand its descendants the same
// inherited values and the same ancestors
bool sameInherited(const StyleContext& a, const StyleContext& b) {
  return a.tag == b.tag && a.isRoot == b.isRoot && a.parent == b.parent &&
      sameCustomProperties(a.customProperties, b.customProperties) &&
      a.fontSize == b.fontSize && a.lineHeightFactor == b.lineHeightFactor &&
      a.lineHeightLength == b.lineHeightLength && a.color == b.color &&
      a.rtl == b.rtl && a.containerNames == b.containerNames &&
      a.cellAlign == b.cellAlign &&
      sameTableLayout(a.tableLayout, b.tableLayout) && a.hidden == b.hidden &&
      a.colorScheme == b.colorScheme && a.darkScheme == b.darkScheme &&
      a.pointerEventsNone == b.pointerEventsNone &&
      a.laysOutItems == b.laysOutItems &&
      a.clipsBlockBelow == b.clipsBlockBelow &&
      (a.scrollContent == b.scrollContent ||
       (a.scrollContent != nullptr && b.scrollContent != nullptr &&
        *a.scrollContent == *b.scrollContent)) &&
      (a.computed == b.computed ||
       (a.computed != nullptr && b.computed != nullptr &&
        *a.computed == *b.computed));
}

// The properties that do not inherit on which a style's entries say
// `inherit`, added to `out`
void collectExplicitInherits(
    const std::vector<AuthorEntry>& entries,
    std::string_view property,
    std::unordered_set<std::string>& out) {
  for (const auto& entry : entries) {
    std::string_view name = entry.condition == AuthorEntry::Condition::None
        ? std::string_view(entry.key)
        : property;
    if (entry.kind == AuthorEntry::Kind::Value &&
        cssengine::trimmed(entry.text) == "inherit" &&
        !cssengine::isInheritedProperty(name)) {
      // The longhands, under both directions: what a descendant looks up in
      // its parent's computed style
      for (bool rtl : {false, true}) {
        std::vector<Longhand> longhands;
        cssengine::expandDeclaration(name, "inherit", rtl, longhands);
        for (const auto& longhand : longhands) {
          out.emplace(longhand.property);
        }
      }
    }
    collectExplicitInherits(entry.entries, name, out);
  }
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

bool entriesHaveStartingStyle(const std::vector<AuthorEntry>& entries) {
  for (const auto& entry : entries) {
    if (entry.condition == AuthorEntry::Condition::Starting ||
        entriesHaveStartingStyle(entry.entries)) {
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
  style.hasStartingStyle = entriesHaveStartingStyle(style.declarations);
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
  double rootLineHeight{16 * 1.2};
};

/*
 * What script wrote to one element that the cascade reads: its inline style
 * (`element.style`) and its attributes (`setAttribute`). Each write keeps the
 * value React had given the property or the attribute when script wrote it,
 * and React writing anew takes the write back, as the last write wins (see
 * `setScriptStyles` and `setScriptAttributes`).
 */
struct StyleEngine::ScriptWrites {
  struct Declaration {
    std::string property;
    folly::dynamic value;
    // React's value for the property when script wrote it; null for none
    folly::dynamic reactValue;
  };
  struct Attribute {
    // Lowercased, as selectors match it
    std::string name;
    // Absent for an attribute script removed
    std::optional<std::string> value;
    // React's value for the attribute when script wrote it; absent for none
    std::optional<std::string> reactValue;
  };
  std::vector<Declaration> declarations;
  std::vector<Attribute> attributes;
  // The declarations as the cascade takes them
  std::shared_ptr<const AuthorStyle> style;
  SurfaceId surfaceId{0};
  std::weak_ptr<const ShadowNodeFamily> family;

  // The element's script writes of `declarations` and `attributes`; null for
  // none
  static std::shared_ptr<const ScriptWrites> make(
      std::vector<Declaration> declarations,
      std::vector<Attribute> attributes,
      SurfaceId surfaceId,
      std::weak_ptr<const ShadowNodeFamily> family) {
    if (declarations.empty() && attributes.empty()) {
      return nullptr;
    }
    folly::dynamic entries = folly::dynamic::array();
    for (const auto& declaration : declarations) {
      entries.push_back(
          folly::dynamic::array(declaration.property, declaration.value));
    }
    auto made = std::make_shared<ScriptWrites>();
    made->declarations = std::move(declarations);
    made->attributes = std::move(attributes);
    made->style =
        std::make_shared<const AuthorStyle>(cssengine::parseAuthorStyle(entries));
    made->surfaceId = surfaceId;
    made->family = std::move(family);
    return made;
  }

  // The element's attributes as selectors see them: React's, with what
  // script wrote over them
  void applyAttributes(
      std::vector<std::pair<std::string, std::string>>& onto) const {
    for (const auto& attribute : attributes) {
      onto.erase(
          std::remove_if(
              onto.begin(),
              onto.end(),
              [&](const auto& pair) { return pair.first == attribute.name; }),
          onto.end());
      if (attribute.value.has_value()) {
        onto.emplace_back(attribute.name, *attribute.value);
      }
    }
  }
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
  // The custom properties the element's resolution read; see
  // `keptAcrossParent` in the pass
  std::shared_ptr<const std::unordered_set<std::string>> customReads;
  bool element{false};
  // The states the engine kept for it when it was resolved
  uint32_t nativeStates{0};
  // What script had written to its inline style and its attributes when it
  // was resolved
  std::shared_ptr<const ScriptWrites> scriptWrites;
  // Whether its resolution read an `env()` value, and the surface's values
  // it was resolved under (`EnvironmentValues::generation`)
  bool readsEnvironment{false};
  uint32_t resolvedEnvironment{0};
  // Whether it or an element below it reads one, as of the last pass that
  // visited it, and that pass's values: a subtree that reads none is kept
  // whole when they change
  bool subtreeReadsEnvironment{false};
  uint32_t visitedEnvironment{0};
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
  std::atomic<uint64_t> resolvedEnvironment{0};
  std::atomic<uint64_t> resolvedScriptWrites{0};
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
  // Elements kept although their parent's context object changed, since
  // nothing they read of it did
  std::atomic<uint64_t> elementsKeptAcrossParent{0};
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
  // The custom properties the resolution read through `var()`, which are all
  // of the parent's scope it depends on
  std::unordered_set<std::string> customReads;
  // Whether it read an `env()` value, so a change to the surface's values
  // resolves it again
  bool readsEnvironment{false};
  // Whether a `@starting-style` value or rule bears on the element, so it has
  // a starting style to resolve
  bool hasStartingStyle{false};
  // Resolving the starting style: its values for what a transition
  // interpolates, as a keyframe stop gives them
  folly::dynamic startingStyle = nullptr;
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
  // What `env()` reads: the values of the surface the element is in, or null
  // for the root, which is in none
  const EnvironmentValues* environment{nullptr};
  const AuthorStyle* styleX{nullptr};
  const AuthorStyle* inlineStyle{nullptr};
  // What script wrote to the inline style, over React's
  const AuthorStyle* scriptStyle{nullptr};
  // Resolving the element's starting style (css-transitions-2 §3.3), where
  // `@starting-style` applies
  bool starting{false};
  const AuthorStyle* presentationalStyle{nullptr};
  uint8_t scrollPart{0};
  // The properties a descendant's `inherit` may read from this element's
  // computed style (the rules' and the styles' explicit inherits), which are
  // all the element keeps in its context: keeping every prop made any change
  // to one, a width a table plugin writes, re-resolve the whole subtree
  const std::unordered_set<std::string>* explicitInherits{nullptr};
  const std::unordered_set<std::string>* stylesExplicitInherits{nullptr};
  // The element as selectors see it: tag, classes, attributes, states and
  // its place among its siblings, with `parent` set
  std::shared_ptr<StyleContext> element;
  // For the root: the scope its own declarations go over
  std::shared_ptr<const CustomProperties> baseScope;
  // For a table: the layout the last pass found for it, whose columns stand
  // until the pass has styled the table's rows again
  std::shared_ptr<const cssengine::TableLayout> tableLayout;
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
 * scroll view. A region in the top layer, or below a box that clips its
 * block axis, keeps scrolling: what it grew by would be cut off there.
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
      "gridArea",
      "gridRow",
      "gridRowStart",
      "gridRowEnd",
      "gridColumn",
      "gridColumnStart",
      "gridColumnEnd",
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
      "backgroundSize",
      "backgroundPosition",
      "backgroundRepeat",
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
  return startsWith(key, "margin") ||
      (startsWith(key, "border") &&
       (key.find("Radius") != std::string::npos ||
        key.find("Width") != std::string::npos ||
        key.find("Color") != std::string::npos));
}

/*
 * Splits a scroll container's props: its box keeps what sizes, places and
 * paints it, and lays out the platform's scroll view inside it as a grid of
 * one cell; the rest (its padding, its children's layout, its own grid
 * template) is returned for the element inside the scroll view.
 *
 * The box clips what it holds, as a scroll container does (css-overflow-3
 * §3): the platform's scroll view clips to its own rectangle only, so a card
 * with rounded corners drew its image's corners square past them. Clipping
 * also gives the box the automatic minimum size of a scroll container, zero
 * (css-flexbox-1 §4.5), as on the web.
 *
 * The scroll view is a grid item stretched to its cell in both axes, and a
 * `minmax(0, 1fr)` track is the box's size where that is definite and the
 * scroll view's otherwise, as a scrollport is. Laid out as a flex column,
 * the scroll view grew to whatever height the box's parent offered when the
 * box's own height was auto (Yoga's legacy stretch), so a code block in a
 * shrink-to-fit chat bubble was thousands of points tall.
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
  const auto* display = props.get_ptr("display");
  const bool hidden = display != nullptr && display->isString() &&
      display->getString() == "none";
  viewport["display"] = hidden ? "none" : "grid";
  viewport["overflow"] = "hidden";
  viewport["gridTemplateColumns"] = "minmax(0, 1fr)";
  viewport["gridTemplateRows"] = "minmax(0, 1fr)";
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

/*
 * What `env()` answers (css-env-1 §3): the surface's value for a name it
 * defines, once the surface has published its values; the fallback for any
 * other name, and on a surface that has published nothing. `reads` notes that
 * the element read a name the surface defines, whose value may change.
 */
LengthBasis basisFor(const EnvironmentValues& environment, bool& reads) {
  LengthBasis basis;
  basis.environment = [environment,
                       &reads](std::string_view name) -> std::optional<double> {
    auto variable = environmentVariableFromName(name);
    if (!variable) {
      return std::nullopt;
    }
    reads = true;
    if (environment.generation == 0) {
      return std::nullopt;
    }
    return environment.resolve(*variable);
  };
  return basis;
}

} // namespace

/*
 * A percentage of `basis` written as the points it comes to: a percentage
 * alone, or the percentages in a math function, which then evaluates to a
 * length. Nullopt for anything else, which stays as it is.
 */
static std::optional<double> resolvePercentage(
    const folly::dynamic& value,
    double basis) {
  if (!value.isString()) {
    return std::nullopt;
  }
  std::string_view text = cssengine::trimmed(value.getString());
  if (text.find('%') == std::string_view::npos) {
    return std::nullopt;
  }
  if (text.ends_with('%')) {
    if (auto number = cssengine::parseNumber(text.substr(0, text.size() - 1))) {
      return *number * basis / 100;
    }
  }
  // Each `N%` in the function as the length it is
  std::string lengths;
  size_t i = 0;
  while (i < text.size()) {
    size_t start = i;
    while (i < text.size() &&
           (std::isdigit(static_cast<unsigned char>(text[i])) ||
            text[i] == '.')) {
      i++;
    }
    if (i > start && i < text.size() && text[i] == '%') {
      auto number = cssengine::parseNumber(text.substr(start, i - start));
      if (!number) {
        return std::nullopt;
      }
      lengths += folly::to<std::string>(*number * basis / 100) + "px";
      i++;
    } else if (i > start) {
      lengths += text.substr(start, i - start);
    } else {
      lengths += text[i++];
    }
  }
  auto evaluated = cssengine::substituteMath(lengths, LengthBasis{});
  if (!evaluated || !evaluated->ends_with("px")) {
    return std::nullopt;
  }
  return cssengine::parseNumber(
      std::string_view(*evaluated).substr(0, evaluated->size() - 2));
}

/*
 * The containing block of a fixed element is the viewport (CSS 2.1 §10.1),
 * and so is a top-layer element's (css-position-4 §3.2), whichever box the
 * renderer lays it out in: a fixed element is absolutely positioned in its
 * nearest positioned ancestor (DOM-CSS-LIMITATION(position-fixed-as-absolute)),
 * and a top-layer element in its 0-tall handle, where a modal sheet's
 * `height: 100%` came to nothing and hung the sheet above the screen. So its
 * percentages are the viewport's, written as points: its width, its inline
 * insets and its margins and paddings, which all four take the width
 * (CSS 2.1 §8.3, §8.4), against the viewport's width, and its height and
 * block insets against its height.
 */
static void resolvePercentagesInViewport(
    folly::dynamic& props,
    double viewportWidth,
    double viewportHeight) {
  static const std::unordered_set<std::string_view> blockAxis = {
      "height", "minHeight", "maxHeight", "top", "bottom"};
  static const std::unordered_set<std::string_view> inlineAxis = {
      "width",        "minWidth",     "maxWidth",      "left",
      "right",        "start",        "end",           "marginTop",
      "marginBottom", "marginStart",  "marginEnd",     "marginLeft",
      "marginRight",  "paddingTop",   "paddingBottom", "paddingStart",
      "paddingEnd",   "paddingLeft",  "paddingRight"};
  for (auto& [key, value] : props.items()) {
    const std::string& name = key.getString();
    double basis;
    if (blockAxis.count(name) != 0) {
      basis = viewportHeight;
    } else if (inlineAxis.count(name) != 0) {
      basis = viewportWidth;
    } else {
      continue;
    }
    if (auto points = resolvePercentage(value, basis)) {
      value = *points;
    }
  }
}

// HTML clamps a cell's `colspan` to 1000 (§4.9.11)
constexpr double kMaxColumnSpan = 1000;

// A cell's `colspan` or a column's `span`: a number of columns, at least one
static int columnSpanOf(const StyleContext& element, std::string_view name) {
  const std::string* attribute = element.attribute(name);
  std::optional<double> span = attribute != nullptr
      ? cssengine::parseNumber(cssengine::trimmed(*attribute))
      : std::nullopt;
  if (!span || !(*span > 1)) {
    return 1;
  }
  return static_cast<int>(std::min(kMaxColumnSpan, std::floor(*span)));
}

/*
 * A cell's or a column's `width` divided over the columns it spans: points
 * and percentages divide, and anything else (`auto`, a math function that
 * needs the layout) sizes none of them.
 */
static void appendColumnsOf(
    const folly::dynamic* width,
    int span,
    std::vector<cssengine::TableColumn>& columns) {
  using Kind = cssengine::TableColumn::Kind;
  cssengine::TableColumn each;
  if (width != nullptr && width->isNumber()) {
    each = {Kind::Points, width->asDouble() / span};
  } else if (width != nullptr && width->isString()) {
    std::string_view text = cssengine::trimmed(width->getString());
    Kind kind = text.ends_with("px") ? Kind::Points
        : text.ends_with("%")        ? Kind::Percent
                                     : Kind::Auto;
    if (kind != Kind::Auto) {
      text.remove_suffix(kind == Kind::Points ? 2 : 1);
      if (auto number = cssengine::parseNumber(text); number && *number >= 0) {
        each = {kind, *number / span};
      }
    }
  }
  columns.insert(columns.end(), static_cast<size_t>(span), each);
}

// A number as CSS writes it, as short as it reads back
static std::string cssNumber(double value) {
  return folly::to<std::string>(value);
}

/*
 * The rows' `grid-template-columns` for a fixed table's columns (CSS 2.1
 * §17.5.2.1): a sized column takes its width, and the columns nothing sizes
 * share what is left equally (`minmax(0, 1fr)`). When every column is sized,
 * the widths follow WebKit's fixed table layout, which Mobile Safari answers
 * with: percentage columns share what the pixel columns leave, in proportion
 * to their percentages, and without percentage columns the pixel columns
 * grow in proportion to their widths.
 *
 * DOM-CSS-LIMITATION(table-percent-columns-need-the-width): two cases need the
 * table's laid-out width, which the template is written without. Pixel and
 * percentage columns that leave part of the table unfilled keep their pixel
 * widths and give the percentage columns the rest, where WebKit grows every
 * column in proportion; and percentage columns beside a column nothing sizes
 * are percentages of the table, where WebKit, when they overflow it, shares
 * what the pixel columns leave among them and leaves the unsized column empty.
 */
static std::string columnTemplate(
    const std::vector<cssengine::TableColumn>& columns) {
  using Kind = cssengine::TableColumn::Kind;
  bool anyAuto = false;
  bool anyPercent = false;
  for (const auto& column : columns) {
    anyAuto |= column.kind == Kind::Auto;
    anyPercent |= column.kind == Kind::Percent;
  }
  std::string grid;
  for (const auto& column : columns) {
    if (!grid.empty()) {
      grid += ' ';
    }
    std::string value = cssNumber(column.value);
    switch (column.kind) {
      case Kind::Points:
        grid += anyAuto || anyPercent || column.value == 0
            ? value + "px"
            : "minmax(" + value + "px, " + value + "fr)";
        break;
      case Kind::Percent:
        grid += anyAuto ? value + "%" : "minmax(0, " + value + "fr)";
        break;
      case Kind::Auto:
        grid += "minmax(0, 1fr)";
        break;
    }
  }
  return grid;
}

/*
 * How wide a table is at least, whatever width it states (§17.5.2.1): its
 * sized columns and the spacing around them. Percentage columns that share
 * what the pixel columns leave can be empty; beside a column nothing sizes
 * they are percentages of the table, and the sum is not known up front.
 */
static std::optional<double> columnsMinWidth(
    const cssengine::TableLayout& layout) {
  using Kind = cssengine::TableColumn::Kind;
  bool anyAuto = std::any_of(
      layout.columns.begin(), layout.columns.end(), [](const auto& column) {
        return column.kind == Kind::Auto;
      });
  double sum = layout.inlineSpacing *
      static_cast<double>(layout.columns.size() + 1);
  for (const auto& column : layout.columns) {
    if (column.kind == Kind::Percent) {
      if (anyAuto) {
        return std::nullopt;
      }
    } else if (column.kind == Kind::Points) {
      sum += column.value;
    }
  }
  return sum;
}

/*
 * A table's `border-spacing` when its borders are separate (CSS 2.1 §17.6.1):
 * one length for both axes, or the horizontal then the vertical, and the user
 * agent's 2px unless the author's style says otherwise; none when they
 * collapse.
 */
static std::pair<double, double> borderSpacingOf(
    const std::vector<Longhand>& longhands,
    const LengthBasis& basis) {
  if (lowercase(lastLonghand(longhands, "borderCollapse")) == "collapse") {
    return {0, 0};
  }
  std::string spacing = lastLonghand(longhands, "borderSpacing");
  auto parts = cssengine::splitTopLevelWhitespace(spacing);
  std::optional<double> inlineSpacing = !parts.empty()
      ? cssengine::resolveLength(parts[0], basis)
      : std::nullopt;
  if (!inlineSpacing) {
    return {2, 2};
  }
  std::optional<double> blockSpacing = parts.size() > 1
      ? cssengine::resolveLength(parts[1], basis)
      : std::nullopt;
  return {*inlineSpacing, blockSpacing.value_or(*inlineSpacing)};
}

// Writes a prop the cascade left unset
static void defaultProp(
    folly::dynamic& props,
    std::string_view name,
    folly::dynamic value) {
  if (props.get_ptr(name) == nullptr) {
    props[std::string(name)] = std::move(value);
  }
}

/*
 * The props a table writes from its layout: its spacing as the padding
 * around its rows and the gap between them, and the width its sized columns
 * need. The author's `min-width` stands where it is at least that.
 */
static void applyTableLayout(
    const cssengine::TableLayout& layout,
    const folly::dynamic* authorMinWidth,
    folly::dynamic& props) {
  if (layout.inlineSpacing > 0 || layout.blockSpacing > 0) {
    props["paddingHorizontal"] = layout.inlineSpacing;
    props["paddingVertical"] = layout.blockSpacing;
    defaultProp(props, "rowGap", layout.blockSpacing);
  }
  props.erase("minWidth");
  if (authorMinWidth != nullptr) {
    props["minWidth"] = *authorMinWidth;
  }
  if (layout.columns.empty()) {
    return;
  }
  if (auto minWidth = columnsMinWidth(layout); minWidth &&
      !(authorMinWidth != nullptr && authorMinWidth->isNumber() &&
        authorMinWidth->asDouble() >= *minWidth)) {
    props["minWidth"] = *minWidth;
  }
}

/*
 * The table parts (HTML §15.3.8) as CSS 2.1 §17.5's fixed table layout, over
 * the grid the renderer has: the table and its row groups stack their rows,
 * and each row is a grid with the table's columns, so the cells of every row
 * line up and a row still draws its own background and borders. The columns
 * come from the first row (§17.5.2.1), which the pass finds once it has
 * styled the table's rows: a cell's `width` sizes the columns it spans, and
 * the columns nothing sizes share what is left equally. A `<col>`'s width
 * comes before the first row's. Until a table has columns its rows share
 * their width equally among their cells, which is what a table with no
 * widths comes to anyway.
 *
 * A cell fills the track it is placed in, so its own `width`, `min-width` and
 * `max-width` are no props (§17.5, and browsers do not apply `max-width` to a
 * cell, which `max-width: 0` with an ellipsis relies on). `vertical-align`
 * places a cell's content, the cell's own or its row's.
 *
 * DOM-CSS-LIMITATION(table-layout-auto-is-fixed): `table-layout: auto` (the
 * HTML default) is laid out as `fixed`: columns are not sized from the
 * content of every row, which needs each cell's min- and max-content first.
 * DOM-CSS-LIMITATION(table-rowspan): a cell's `rowSpan` does not reach into the
 * next row, since each row is its own grid; `colSpan` spans columns.
 * DOM-CSS-LIMITATION(table-cell-vertical-align): a cell's `vertical-align` of
 * `top`, `middle` or `bottom` places its content as `align-content` does on a
 * block (`baseline` is `top`); cells are not aligned on a shared baseline.
 */
static void applyTableRules(
    StyleContext& element,
    const SharedStyleContext& parent,
    const std::vector<Longhand>& longhands,
    const LengthBasis& basis,
    const std::shared_ptr<const cssengine::TableLayout>& previousLayout,
    Resolution& resolution) {
  const std::string& tag = element.tag;
  std::string inheritedAlign = parent != nullptr ? parent->cellAlign : "";
  folly::dynamic& props = resolution.props;
  const std::shared_ptr<const cssengine::TableLayout> parentLayout =
      parent != nullptr ? parent->tableLayout : nullptr;
  if (tag == "table") {
    element.cellAlign.clear();
    for (std::string_view property :
         {"borderSpacing", "borderCollapse", "tableLayout"}) {
      std::string value = lastLonghand(longhands, property);
      if (!value.empty()) {
        resolution.extras[std::string(property)] = value;
      }
    }
    // The columns the last pass found, which the pass corrects once it has
    // styled the rows, should the first row have changed them
    auto [inlineSpacing, blockSpacing] = borderSpacingOf(longhands, basis);
    auto layout = std::make_shared<cssengine::TableLayout>();
    layout->inlineSpacing = inlineSpacing;
    layout->blockSpacing = blockSpacing;
    if (previousLayout != nullptr) {
      layout->columns = previousLayout->columns;
    }
    if (const auto* minWidth = props.get_ptr("minWidth")) {
      resolution.extras["minWidth"] = *minWidth;
    }
    applyTableLayout(*layout, resolution.extras.get_ptr("minWidth"), props);
    element.tableLayout = std::move(layout);
    return;
  }
  if (tag == "thead" || tag == "tbody" || tag == "tfoot") {
    std::string own = lowercase(lastLonghand(longhands, "verticalAlign"));
    element.cellAlign = own.empty() ? inheritedAlign : own;
    element.tableLayout = parentLayout;
    if (parentLayout != nullptr && parentLayout->blockSpacing > 0) {
      defaultProp(props, "rowGap", parentLayout->blockSpacing);
    }
    return;
  }
  if (tag == "tr") {
    std::string own = lowercase(lastLonghand(longhands, "verticalAlign"));
    element.cellAlign = own.empty() ? inheritedAlign : own;
    if (parentLayout != nullptr && !parentLayout->columns.empty()) {
      defaultProp(
          props, "gridTemplateColumns", columnTemplate(parentLayout->columns));
    } else {
      defaultProp(props, "gridAutoFlow", "column");
      defaultProp(props, "gridAutoColumns", "minmax(0, 1fr)");
    }
    if (parentLayout != nullptr && parentLayout->inlineSpacing > 0) {
      defaultProp(props, "columnGap", parentLayout->inlineSpacing);
    }
    return;
  }
  if (tag == "td" || tag == "th" || tag == "col") {
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
    if (int span = columnSpanOf(element, "colspan"); span > 1) {
      defaultProp(props, "gridColumnEnd", "span " + std::to_string(span));
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
// The display an inline-level box takes as a flex or grid item
// (css-display-3 §2.7), or null when it is block-level already
static const char* blockifiedDisplay(const std::string& display) {
  if (display == "inline" || display == "inline-block") {
    return "block";
  }
  if (display == "inline-flex") {
    return "flex";
  }
  if (display == "inline-grid") {
    return "grid";
  }
  if (display == "inline-grid-lanes") {
    return "grid-lanes";
  }
  return nullptr;
}

// Whether an element of this display makes its children flex or grid items
static bool laysOutItems(const std::string& display) {
  return display == "flex" || display == "inline-flex" || display == "grid" ||
      display == "inline-grid" || display == "grid-lanes" ||
      display == "inline-grid-lanes";
}

// A `::before`, `::after` or `::backdrop` box (ElementStyleInputs::pseudo)
static bool isGeneratedBox(const ShadowNode& node) {
  const auto* provider =
      dynamic_cast<const ElementStyleInputsProvider*>(node.getProps().get());
  return provider != nullptr && provider->elementStyleInputs().pseudo != 0;
}

// The value React's `style` gives `property` in the element's props, the last
// one it declares; null when it declares none
static folly::dynamic reactInlineValue(
    const Props& props,
    std::string_view property) {
  const auto* provider = dynamic_cast<const ElementStyleInputsProvider*>(&props);
  if (provider == nullptr) {
    return nullptr;
  }
  const folly::dynamic& inlineStyle = provider->elementStyleInputs().inlineStyle;
  if (!inlineStyle.isArray()) {
    return nullptr;
  }
  folly::dynamic value = nullptr;
  for (const auto& pair : inlineStyle) {
    if (pair.isArray() && pair.size() == 2 && pair[0].isString() &&
        pair[0].getString() == property) {
      value = pair[1];
    }
  }
  return value;
}

// The value React gives the element's attribute `name` (lowercased); absent
// for none
static std::optional<std::string> reactAttributeValue(
    const Props& props,
    std::string_view name) {
  const auto* provider =
      dynamic_cast<const ElementStyleInputsProvider*>(&props);
  if (provider == nullptr) {
    return std::nullopt;
  }
  for (const auto& [key, value] : provider->elementStyleInputs().attributes) {
    if (key == name) {
      return value;
    }
  }
  return std::nullopt;
}

static bool isBackdropBox(const ShadowNode& node) {
  const auto* provider =
      dynamic_cast<const ElementStyleInputsProvider*>(node.getProps().get());
  return provider != nullptr && provider->elementStyleInputs().pseudo == 3;
}

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

  // A rule inside `@starting-style` applies to the starting style alone
  bool sawStarting = false;
  std::erase_if(matched, [&](const cssengine::MatchedRule& entry) {
    if (!entry->rule->starting) {
      return false;
    }
    sawStarting = true;
    return !inputs.starting;
  });

  ConditionState state;
  state.states = element.states;
  state.disabled = element.attribute("disabled") != nullptr;
  state.media = &media;
  state.element = &element;
  state.starting = inputs.starting;
  state.sawStarting = &sawStarting;

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
  if (inputs.scriptStyle != nullptr) {
    collectAuthorStyle(*inputs.scriptStyle, state, declared);
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

  static const EnvironmentValues unpublished;
  bool readsEnvironment = false;
  LengthBasis basis = basisFor(
      inputs.environment != nullptr ? *inputs.environment : unpublished,
      readsEnvironment);
  basis.viewportWidth = media.viewportWidth;
  basis.viewportHeight = media.viewportHeight;
  // A container unit with no query container to measure takes the viewport's
  // size (css-contain-3 §6.1).
  // DOM-CSS-DEVIATION(container-query-is-a-media-query): containers report no
  // size of their own yet, so every container unit is the viewport's
  basis.containerWidth = media.viewportWidth;
  basis.containerHeight = media.viewportHeight;
  basis.rootFontSize = element.isRoot ? 16 : snapshot.rootFontSize;
  basis.rootLineHeight = snapshot.rootLineHeight;

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

  // `line-height`, which `lh` resolves against. A number inherits as itself
  // and multiplies each element's own font size; a length or percentage
  // inherits as the length it computed to (css-inline-3 §2.4). An `lh` in
  // the declaration itself is the parent's, as an `em` in `font-size` is.
  std::optional<double> lineHeightFactor =
      parent != nullptr ? parent->lineHeightFactor : std::nullopt;
  std::optional<double> lineHeightLength =
      parent != nullptr ? parent->lineHeightLength : std::nullopt;
  basis.lineHeight =
      parent != nullptr ? computedLineHeight(*parent) : basis.lineHeight;
  if (const Declared* declaration = lastOf("lineHeight");
      declaration != nullptr) {
    std::optional<std::string> text;
    if (declaration->raw == nullptr) {
      text = valueOf(declaration->value);
    } else if (declaration->raw->isString()) {
      text = declaration->raw->getString();
    } else if (declaration->raw->isNumber()) {
      // A runtime's resolved value is React Native's, which is absolute
      lineHeightFactor = std::nullopt;
      lineHeightLength = declaration->raw->asDouble();
    }
    if (text) {
      std::string keyword = lowercase(cssengine::trimmed(*text));
      if (keyword == "normal" || keyword == "initial") {
        lineHeightFactor = std::nullopt;
        lineHeightLength = std::nullopt;
      } else if (auto number = cssengine::parseNumber(keyword)) {
        lineHeightFactor = *number;
        lineHeightLength = std::nullopt;
      } else if (!keyword.empty() && keyword.back() == '%') {
        if (auto percent = cssengine::parseNumber(
                std::string_view(keyword).substr(0, keyword.size() - 1))) {
          lineHeightFactor = std::nullopt;
          lineHeightLength = *percent / 100 * fontSize;
        }
      } else if (keyword != "inherit" && keyword != "unset") {
        auto evaluated = cssengine::substituteMath(keyword, basis);
        if (evaluated) {
          if (auto points = cssengine::resolveLength(*evaluated, basis)) {
            lineHeightFactor = std::nullopt;
            lineHeightLength = *points;
          }
        }
      }
    }
  }
  element.lineHeightFactor = lineHeightFactor;
  element.lineHeightLength = lineHeightLength;
  element.fontSize = fontSize;
  basis.lineHeight = computedLineHeight(element);
  if (element.isRoot) {
    basis.rootLineHeight = basis.lineHeight;
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
  } else if (declaration != nullptr && declaration->raw->isNumber()) {
    // A colour a runtime resolved before handing it over (a StyleX token's
    // value, as the renderer's packed number, signed as Android has it or
    // not) is what `currentColor` means here as much as one written as text:
    // an icon in a button paints with it
    color = cssengine::cssTextOfPackedColor(
        static_cast<uint32_t>(
            static_cast<int64_t>(declaration->raw->asDouble())));
  } else if (
      declaration != nullptr && declaration->raw->isString() &&
      cssengine::parseColor(declaration->raw->getString())) {
    color = cssengine::trimmed(declaration->raw->getString());
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
  cssengine::CustomPropertyReadsScope readsScope(&resolution.customReads);
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
  resolution.hasStartingStyle = sawStarting;
  if (inputs.starting) {
    // What a transition interpolates of a style the engine writes, as a
    // keyframe stop has it: opacity and background colour resolved, a
    // transform as CSS text. A border colour is written per edge, which no
    // transition reads.
    std::vector<Longhand> painted;
    folly::dynamic stop = folly::dynamic::object();
    for (const auto& longhand : longhands) {
      if (longhand.property == "transform") {
        stop["transform"] = longhand.value;
      } else if (
          longhand.property == "opacity" ||
          longhand.property == "backgroundColor") {
        painted.push_back(longhand);
      }
    }
    cssengine::convertLonghands(painted, context, stop);
    resolution.startingStyle = std::move(stop);
  }
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

  // `pointer-events` inherits: an element under `none` that declares nothing
  // is no target either (`box-none`, the element alone), and one that declares
  // a value is what it declares
  if (const auto* pointerEvents = resolution.props.get_ptr("pointerEvents");
      pointerEvents != nullptr && pointerEvents->isString()) {
    element.pointerEventsNone = pointerEvents->getString() == "box-none";
  } else if (parent != nullptr && parent->pointerEventsNone) {
    element.pointerEventsNone = true;
    resolution.props["pointerEvents"] = "box-none";
  }

  // An element that generates no box hides its subtree, which the pass then
  // leaves unstyled; the renderer does the rest of `display: none` (no
  // layout, no drawing, no animation). A column group is the exception: its
  // `<col>` elements are styled for the widths they give the table's columns,
  // though neither draws.
  if (const auto* display = resolution.props.get_ptr("display");
      display != nullptr && display->isString() &&
      display->getString() == "none" && element.tag != "colgroup") {
    element.hidden = true;
  }

  // A fixed element's, or a top-layer element's, which declares that it is
  // in the top layer for its subtree
  const bool inViewport =
      lowercase(lastLonghand(longhands, "position")) == "fixed" ||
      (scope != nullptr && scope != inherited &&
       scope->own().count(std::string(kInTopLayer)) != 0);
  if (inViewport) {
    resolvePercentagesInViewport(
        resolution.props, media.viewportWidth, media.viewportHeight);
  }

  applyTableRules(
      element, parent, longhands, basis, inputs.tableLayout, resolution);
  if (element.tag == "button") {
    applyButtonRules(longhands, resolution);
  }

  // A flex or grid container's children are its items, and an item's display
  // is blockified (css-display-3 §2.7): `inline` and `inline-block` compute
  // to `block`, `inline-flex` to `flex`, `inline-grid` to `grid`. A
  // box-backed `display: inline` element left inline lays its children out
  // as a row of flex items, so a chip at the start of a sentence (Astryx's
  // ChatTokenizedText) stood in a column of its own beside the words instead
  // of on their first line. Only a stated display is blockified here: the
  // user agent's default for the tag is the runtime's, and an element that
  // keeps it is text-backed, which the layout blockifies itself.
  if (auto* display = resolution.props.get_ptr("display");
      display != nullptr && display->isString()) {
    if (parent != nullptr && parent->laysOutItems) {
      if (const char* blockified = blockifiedDisplay(display->getString())) {
        *display = blockified;
      }
    }
    element.laysOutItems = laysOutItems(display->getString());
  } else {
    element.laysOutItems = false;
  }

  // A block container that clips its block axis cuts off what grows below
  // it; the runtime reads the same containers off `StyleHintClipBlock`
  const std::string overflowY = lowercase(lastLonghand(longhands, "overflowY"));
  const bool clippedAbove = parent != nullptr && parent->clipsBlockBelow;
  const bool containerTag = isScrollContainerTag(element.tag);
  element.clipsBlockBelow = clippedAbove ||
      (containerTag && (overflowY == "hidden" || overflowY == "clip"));
  if (containerTag) {
    bool inTopLayer =
        scope != nullptr && scope->find(std::string(kInTopLayer)) != nullptr;
    cssengine::recordCustomPropertyRead(std::string(kInTopLayer));
    // A region in the top layer, or below a box that clips its block axis,
    // has no page to grow into, and scrolls as on the web
    if (!inTopLayer && !clippedAbove &&
        (overflowY == "auto" || overflowY == "scroll")) {
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
  const bool anyExplicitInherits = (inputs.explicitInherits != nullptr &&
                                    !inputs.explicitInherits->empty()) ||
      (inputs.stylesExplicitInherits != nullptr &&
       !inputs.stylesExplicitInherits->empty());
  if (anyExplicitInherits) {
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
    // Only the props a descendant can ask for, so a change to any other (a
    // width, a colour) leaves the subtree's resolutions standing
    folly::dynamic kept = folly::dynamic::object();
    for (const auto* names :
         {inputs.explicitInherits, inputs.stylesExplicitInherits}) {
      if (names == nullptr) {
        continue;
      }
      for (const auto& name : *names) {
        if (const auto* value = resolution.props.get_ptr(name);
            value != nullptr) {
          kept[name] = *value;
        }
      }
    }
    element.computed = kept.empty()
        ? nullptr
        : std::make_shared<const folly::dynamic>(std::move(kept));
  }
  resolution.context = inputs.element;
  resolution.readsEnvironment = readsEnvironment;
  return resolution;
}

// -- The style pass --

class StyleEngine::Pass {
 public:
  Pass(
      StyleEngine& engine,
      std::shared_ptr<const Snapshot> snapshot,
      const ContextContainer& contextContainer,
      SurfaceId surfaceId,
      const EnvironmentValues& environment)
      : engine_(engine),
        snapshot_(std::move(snapshot)),
        stylesLock_(engine.stylesMutex_),
        parserContext_{surfaceId, contextContainer},
        environment_(environment),
        readsSiblings_(
            snapshot_->rules->readsSiblings() || engine.stylesReadSiblings_) {
    {
      std::scoped_lock lock(engine.nativeStatesMutex_);
      for (const auto& [tag, state] : engine.nativeStates_) {
        nativeStates_.emplace(tag, state.states);
      }
    }
    std::scoped_lock lock(engine.scriptWritesMutex_);
    scriptWrites_ = engine.scriptWrites_;
  }

  // Whether the element's resolution read an `env()` value the surface has
  // changed since
  bool environmentChanged(const CacheEntry& entry) const {
    return entry.readsEnvironment &&
        entry.resolvedEnvironment != environment_.generation;
  }

  /*
   * What script wrote to the element's inline style and its attributes and
   * still stands over React's props `base`. A property or an attribute React
   * gives a value other than the one it had when script wrote it was written
   * by React since, which takes it back, as the last write wins: the write is
   * dropped, for good.
   */
  std::shared_ptr<const ScriptWrites>
  scriptWritesOver(Tag tag, const Props& base, bool baseChanged) {
    if (scriptWrites_.empty()) {
      return nullptr;
    }
    auto found = scriptWrites_.find(tag);
    if (found == scriptWrites_.end()) {
      return nullptr;
    }
    const auto& written = found->second;
    if (!baseChanged) {
      return written;
    }
    std::vector<ScriptWrites::Declaration> standing;
    for (const auto& declaration : written->declarations) {
      if (reactInlineValue(base, declaration.property) ==
          declaration.reactValue) {
        standing.push_back(declaration);
      }
    }
    std::vector<ScriptWrites::Attribute> standingAttributes;
    for (const auto& attribute : written->attributes) {
      if (reactAttributeValue(base, attribute.name) == attribute.reactValue) {
        standingAttributes.push_back(attribute);
      }
    }
    if (standing.size() == written->declarations.size() &&
        standingAttributes.size() == written->attributes.size()) {
      return written;
    }
    auto replaced = ScriptWrites::make(
        std::move(standing),
        std::move(standingAttributes),
        written->surfaceId,
        written->family);
    {
      std::scoped_lock lock(engine_.scriptWritesMutex_);
      // Unless script wrote to the element again since the pass began
      auto current = engine_.scriptWrites_.find(tag);
      if (current != engine_.scriptWrites_.end() &&
          current->second == written) {
        if (replaced != nullptr) {
          current->second = replaced;
        } else {
          engine_.scriptWrites_.erase(current);
        }
      }
    }
    if (replaced != nullptr) {
      found->second = replaced;
    } else {
      scriptWrites_.erase(found);
    }
    return replaced;
  }

  /*
   * Whether an element whose parent context is a new object can keep its
   * resolution, and the context it then hands its children.
   *
   * A re-resolved ancestor gives every element below it a new parent context
   * object, which `sameUnder` reads as a change; re-resolving them all is the
   * cascade that made a table's two custom properties, rewritten on each
   * resize, cost a pass over its 1,800 cells. The element's resolution reads
   * of its ancestors only what the selectors read (`distinguishes`), the
   * inherited values, the scroll content and computed style of its parent,
   * and the custom properties it substituted (`customReads`): when none of
   * those differ between the old and the new ancestors, the resolution
   * stands. Null when it does not.
   */
  SharedStyleContext keptAcrossParent(
      const CacheEntry& entry,
      const SharedStyleContext& parent,
      const SharedStyleContext& previousSibling,
      uint32_t position,
      uint32_t siblingCount,
      const Props::Shared& base,
      uint32_t nativeStates,
      const std::shared_ptr<const ScriptWrites>& scriptWrites,
      bool isElement,
      const ElementStyleInputsProvider* inputsProvider) {
    if (!isElement || entry.context == nullptr || entry.parent == nullptr ||
        parent == nullptr || entry.parent == parent ||
        entry.generation != snapshot_->generation ||
        entry.position != position || entry.siblingCount != siblingCount ||
        !entry.element || base != entry.inputProps ||
        entry.nativeStates != nativeStates || entry.customReads == nullptr ||
        entry.scriptWrites != scriptWrites || environmentChanged(entry) ||
        inputsProvider->elementStyleInputs().scrollPart == 3) {
      return nullptr;
    }
    // A sibling whose context is a new object of the same content is the
    // same sibling to a selector
    if (entry.previousSibling != previousSibling &&
        (entry.previousSibling == nullptr || previousSibling == nullptr ||
         !sameSiblingForSelectors(*entry.previousSibling, *previousSibling))) {
      return nullptr;
    }
    const StyleContext& before = *entry.parent;
    const StyleContext& after = *parent;
    // What only the direct parent gives its children
    if (!(before.scrollContent == after.scrollContent ||
          (before.scrollContent != nullptr && after.scrollContent != nullptr &&
           *before.scrollContent == *after.scrollContent)) ||
        !sameTableLayout(before.tableLayout, after.tableLayout) ||
        !(before.computed == after.computed ||
          (before.computed != nullptr && after.computed != nullptr &&
           *before.computed == *after.computed))) {
      return nullptr;
    }
    // Up both chains to the first ancestor they share: the inherited values
    // and what any selector reads must agree at every step
    const StyleContext* a = &before;
    const StyleContext* b = &after;
    while (a != b) {
      if (a == nullptr || b == nullptr || !sameInheritedValues(*a, *b) ||
          snapshot_->rules->ancestorFeatures().distinguishes(*a, *b, true) ||
          engine_.stylesFeatures_->distinguishes(*a, *b, true)) {
        return nullptr;
      }
      a = a->parent.get();
      b = b->parent.get();
    }
    // The custom properties that differ between the two scopes, none of
    // which the element may have read
    if (!customPropertiesDifferOnlyOutside(
            before.customProperties,
            after.customProperties,
            *entry.customReads)) {
      return nullptr;
    }
    auto kept = std::make_shared<StyleContext>(*entry.context);
    kept->parent = parent;
    kept->previousSibling = previousSibling;
    if (entry.context->customProperties != before.customProperties &&
        entry.context->customProperties != nullptr) {
      // The element's own declarations, over the new parent's scope; their
      // values stand, since they read nothing that changed
      auto scope = std::make_shared<CustomProperties>(after.customProperties);
      for (const auto& [name, value] : entry.context->customProperties->own()) {
        scope->set(name, value);
      }
      kept->customProperties = scope;
    } else {
      kept->customProperties = after.customProperties;
    }
    return kept;
  }

  std::shared_ptr<const ShadowNode> visit(
      const std::shared_ptr<const ShadowNode>& node,
      const SharedStyleContext& parent,
      const SharedStyleContext& previousSibling,
      uint32_t position,
      uint32_t siblingCount,
      SharedStyleContext& elementContext) {
    const auto inheritedEnvironment = environment_;
    const auto restoreEnvironment =
        folly::makeGuard([&] { environment_ = inheritedEnvironment; });
    if (const auto* props = viewPropsOf(*node)) {
      environment_ = props->resolveEnvironment(inheritedEnvironment);
    }
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

    // The whole subtree as the last pass left it, unless an element in it
    // reads an `env()` value the surface has changed since
    if (sameUnder &&
        !(entry.subtreeReadsEnvironment &&
          entry.visitedEnvironment != environment_.generation)) {
      auto output = entry.output.lock();
      if (output != nullptr && (output == node || entry.input.lock() == node)) {
        add(counters_.subtreesKept, 1);
        elementContext = isElement ? entry.context : nullptr;
        subtreeReadsEnvironment_ |= entry.subtreeReadsEnvironment;
        return output;
      }
    }
    // Whether an element below reads an `env()` value, collected as the
    // children are visited
    bool outerReadsEnvironment = std::exchange(subtreeReadsEnvironment_, false);

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
      auto scriptWrites =
          scriptWritesOver(node->getTag(), *base, base != entry.inputProps);
      if (sameUnder && base == entry.inputProps && entry.context != nullptr &&
          entry.nativeStates == nativeStates &&
          entry.scriptWrites == scriptWrites && !environmentChanged(entry)) {
        add(counters_.elementsKept, 1);
        context = entry.context;
        childContext =
            entry.childContext != nullptr ? entry.childContext : entry.context;
        outputProps = entry.outputProps;
      } else if (
          auto kept = keptAcrossParent(
              entry,
              parent,
              previousSibling,
              position,
              siblingCount,
              base,
              nativeStates,
              scriptWrites,
              isElement,
              inputsProvider)) {
        // The parent's context is a new object, as it is for every element
        // under one that re-resolved, but nothing this element reads of it
        // changed: its resolution stands, over a context that hands its
        // children the new ancestors
        add(counters_.elementsKeptAcrossParent, 1);
        context = kept;
        childContext = kept;
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
          } else if (entry.scriptWrites != scriptWrites) {
            add(counters_.resolvedScriptWrites, 1);
          } else if (environmentChanged(entry)) {
            add(counters_.resolvedEnvironment, 1);
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
              scriptWrites.get(),
              parent,
              previousSibling,
              position,
              siblingCount,
              entry.context != nullptr ? entry.context->tableLayout : nullptr);
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
        entry.customReads =
            std::make_shared<const std::unordered_set<std::string>>(
                std::move(resolution.customReads));
        entry.readsEnvironment = resolution.readsEnvironment;
        entry.resolvedEnvironment = environment_.generation;
        entry.inputProps = base;
        entry.outputProps = outputProps;
        entry.nativeStates = nativeStates;
        entry.scriptWrites = scriptWrites;
      }
      elementContext = context;
    } else {
      elementContext = nullptr;
    }

    auto children = visitChildren(*node, isElement ? childContext : parent);
    // A table's columns come from its first row, which the visit has just
    // styled: when they differ from the ones its rows were given, the rows
    // are styled again under the corrected layout, and the table's own
    // minimum width follows. Only its row groups and rows read the layout, so
    // its cells and their content keep their resolutions.
    if (isElement && context != nullptr && context->tableLayout != nullptr &&
        context->tag == "table") {
      auto columns = tableColumnsOf(
          children != nullptr ? *children : node->getChildren());
      if (columns != context->tableLayout->columns) {
        auto layout =
            std::make_shared<cssengine::TableLayout>(*context->tableLayout);
        layout->columns = std::move(columns);
        auto corrected = std::make_shared<StyleContext>(*context);
        corrected->tableLayout = layout;
        context = corrected;
        childContext = corrected;
        elementContext = corrected;
        folly::dynamic overlay = entry.overlay.isObject()
            ? entry.overlay
            : folly::dynamic::object();
        applyTableLayout(*layout, entry.extras.get_ptr("minWidth"), overlay);
        if (overlay != entry.overlay) {
          outputProps = node->getComponentDescriptor().cloneProps(
              parserContext_, entry.inputProps, RawProps(overlay));
          add(counters_.propsParsed, 1);
          entry.overlay = std::move(overlay);
          entry.outputProps = outputProps;
        }
        children = visitChildren(*node, childContext);
      }
    }
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
    entry.subtreeReadsEnvironment =
        subtreeReadsEnvironment_ || (isElement && entry.readsEnvironment);
    entry.visitedEnvironment = environment_.generation;
    subtreeReadsEnvironment_ =
        outerReadsEnvironment || entry.subtreeReadsEnvironment;
    return output;
  }

  /*
   * A table's columns, from its children as the pass has just styled them:
   * its `<col>` elements' widths, then its first row's cells' (CSS 2.1
   * §17.5.2.1), the first row being the first in its row groups' order.
   */
  std::vector<cssengine::TableColumn> tableColumnsOf(
      const std::vector<std::shared_ptr<const ShadowNode>>& children) const {
    std::vector<cssengine::TableColumn> fromCols;
    std::vector<cssengine::TableColumn> fromRow;
    bool foundRow = false;
    auto styled = [&](const ShadowNode& node) -> const CacheEntry* {
      auto found = engine_.cache_.find(&node.getFamily());
      return found != engine_.cache_.end() && found->second->element &&
              found->second->context != nullptr
          ? found->second.get()
          : nullptr;
    };
    auto addColumn = [&](const CacheEntry& col) {
      appendColumnsOf(
          col.extras.get_ptr("width"),
          columnSpanOf(*col.context, "span"),
          fromCols);
    };
    for (const auto& child : children) {
      const CacheEntry* entry = styled(*child);
      if (entry == nullptr) {
        continue;
      }
      const std::string& tag = entry->context->tag;
      if (tag == "col") {
        addColumn(*entry);
      } else if (tag == "colgroup") {
        for (const auto& col : child->getChildren()) {
          if (const CacheEntry* colEntry = styled(*col);
              colEntry != nullptr && colEntry->context->tag == "col") {
            addColumn(*colEntry);
          }
        }
      } else if (foundRow) {
        continue;
      } else if (tag == "tr") {
        foundRow = true;
        fromRow = cellColumnsOf(*child);
      } else if (tag == "thead" || tag == "tbody" || tag == "tfoot") {
        for (const auto& row : child->getChildren()) {
          if (const CacheEntry* rowEntry = styled(*row);
              rowEntry != nullptr && rowEntry->context->tag == "tr") {
            foundRow = true;
            fromRow = cellColumnsOf(*row);
            break;
          }
        }
      }
    }
    // A `<col>`'s width comes before the first row's, column by column
    std::vector<cssengine::TableColumn> columns(
        std::max(fromCols.size(), fromRow.size()));
    for (size_t i = 0; i < columns.size(); i++) {
      if (i < fromCols.size() &&
          fromCols[i].kind != cssengine::TableColumn::Kind::Auto) {
        columns[i] = fromCols[i];
      } else if (i < fromRow.size()) {
        columns[i] = fromRow[i];
      }
    }
    return columns;
  }

  // The columns a row's cells size, each cell's width over the columns it
  // spans
  std::vector<cssengine::TableColumn> cellColumnsOf(const ShadowNode& row) const {
    std::vector<cssengine::TableColumn> columns;
    for (const auto& cell : row.getChildren()) {
      auto found = engine_.cache_.find(&cell->getFamily());
      if (found == engine_.cache_.end() || !found->second->element ||
          found->second->context == nullptr) {
        continue;
      }
      const CacheEntry& entry = *found->second;
      if (entry.context->tag == "td" || entry.context->tag == "th") {
        appendColumnsOf(
            entry.extras.get_ptr("width"),
            columnSpanOf(*entry.context, "colspan"),
            columns);
      }
    }
    return columns;
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
        if (provider != nullptr && provider->elementStyleInputs().styled &&
            provider->elementStyleInputs().pseudo == 0) {
          count++;
        }
      }
    }
    std::shared_ptr<std::vector<std::shared_ptr<const ShadowNode>>> result;
    SharedStyleContext previous;
    uint32_t position = 0;
    // Visits the child at `i` under `parent`, and returns its context
    auto visitChild = [&](size_t i, const SharedStyleContext& parent) {
      SharedStyleContext childContext;
      auto output = visit(
          children[i],
          parent,
          readsSiblings_ ? previous : nullptr,
          readsSiblings_ ? position + 1 : 0,
          readsSiblings_ ? count : 0,
          childContext);
      if (childContext != nullptr && readsSiblings_ &&
          !isGeneratedBox(*children[i])) {
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
      return childContext;
    };
    for (size_t i = 0; i < children.size(); i++) {
      if (isBackdropBox(*children[i]) && i + 1 < children.size()) {
        // Style a `::backdrop` box after the element it is drawn under, the
        // sibling after it: its originating element (css-position-4 §3.2),
        // which it inherits from, as browsers do since whatwg/fullscreen#124
        auto originating = visitChild(i + 1, context);
        visitChild(i, originating != nullptr ? originating : context);
        i++;
        continue;
      }
      visitChild(i, context);
    }
    return result;
  }

 private:
  Resolution resolve(
      const ShadowNode& /*node*/,
      const Props& props,
      const ElementStyleInputs& inputs,
      uint32_t nativeStates,
      const ScriptWrites* scriptWrites,
      const SharedStyleContext& parent,
      const SharedStyleContext& previousSibling,
      uint32_t position,
      uint32_t siblingCount,
      std::shared_ptr<const cssengine::TableLayout> tableLayout) {
    auto element = std::make_shared<StyleContext>();
    if (!inputs.tag.empty()) {
      element->tag = lowercase(inputs.tag);
    } else if (
        const auto* named = dynamic_cast<const NodeNameProvider*>(&props)) {
      element->tag = lowercase(named->domNodeName());
    }
    element->classes = inputs.classes;
    element->attributes = inputs.attributes;
    if (scriptWrites != nullptr) {
      scriptWrites->applyAttributes(element->attributes);
    }
    element->states = inputs.states;
    // The states the engine keeps, which a disabled element does not have
    if (nativeStates != 0 &&
        std::none_of(
            element->attributes.begin(),
            element->attributes.end(),
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
    resolveInputs.environment = &environment_;
    resolveInputs.tableLayout = std::move(tableLayout);
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
    if (scriptWrites != nullptr) {
      resolveInputs.scriptStyle = scriptWrites->style.get();
    }
    resolveInputs.scrollPart = inputs.scrollPart;
    resolveInputs.explicitInherits = &snapshot_->rules->explicitInherits();
    resolveInputs.stylesExplicitInherits = &engine_.stylesExplicitInherits_;
    resolveInputs.matchNanos = &counters_.matchNanos;
    // The element as selectors see it, before its resolution fills in its
    // computed values, kept where a starting style may bear on it
    std::optional<StyleContext> unresolved;
    if (snapshot_->rules->hasStartingRules() ||
        (styleX != nullptr && styleX->hasStartingStyle) ||
        inlineStyle.hasStartingStyle || presentationalStyle.hasStartingStyle ||
        (scriptWrites != nullptr && scriptWrites->style->hasStartingStyle)) {
      unresolved = *element;
    }
    auto start = std::chrono::steady_clock::now();
    auto resolution = resolveElement(resolveInputs, *snapshot_, parent);
    if (resolution.hasStartingStyle && unresolved) {
      // Its starting style (css-transitions-2 §3.3), which the props carry
      // for the transitions engine to run from as the element comes to be
      // rendered, as they carry its `transition`
      ResolveInputs startingInputs = resolveInputs;
      startingInputs.element =
          std::make_shared<StyleContext>(std::move(*unresolved));
      startingInputs.starting = true;
      auto starting = resolveElement(startingInputs, *snapshot_, parent);
      if (starting.startingStyle.isObject() &&
          !starting.startingStyle.empty()) {
        resolution.props["startingStyle"] =
            folly::toJson(starting.startingStyle);
      }
    }
    add(counters_.elementsResolved, 1);
    add(counters_.resolveNanos, nanosSince(start));
    return resolution;
  }

  StyleEngine& engine_;
  Counters& counters_{*engine_.counters_};
  std::shared_ptr<const Snapshot> snapshot_;
  std::shared_lock<std::shared_mutex> stylesLock_;
  PropsParserContext parserContext_;
  // The surface's `env()` values, as the root being committed has them
  EnvironmentValues environment_;
  bool readsSiblings_;
  // Whether an element under the node being visited reads an `env()` value
  bool subtreeReadsEnvironment_{false};
  // The states the engine keeps, as of the pass's start
  std::unordered_map<Tag, uint32_t> nativeStates_;
  // What script wrote to elements' inline styles and attributes, as of the
  // pass's start
  std::unordered_map<Tag, std::shared_ptr<const ScriptWrites>> scriptWrites_;
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
  next->rootLineHeight = computedLineHeight(*next->root);

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
             .source = ShadowTreeCommitSource::StyleEngine});
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
    restyleElements(surfaceId, changed, /*mountSynchronously*/ true);
  }
  return false;
}

void StyleEngine::restyleElements(
    SurfaceId surfaceId,
    const std::vector<std::shared_ptr<const ShadowNodeFamily>>& families,
    bool mountSynchronously) {
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
             .mountSynchronously = mountSynchronously,
             .source = ShadowTreeCommitSource::StyleEngine});
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
  collectExplicitInherits(style->declarations, {}, stylesExplicitInherits_);
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
      x.highDynamicRange == y.highDynamicRange;
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
  // What `env()` reads, as the surface published it with its layout
  // constraints
  const auto& environment =
      newRootShadowNode->getConcreteProps().layoutContext.environmentValues;
  Pass pass(
      *this,
      current,
      *contextContainer,
      shadowTree.getSurfaceId(),
      environment);
  auto children = pass.visitChildren(*newRootShadowNode, current->root);
  styledGeneration_[shadowTree.getSurfaceId()] = current->generation;
  surfaceEnvironments_[shadowTree.getSurfaceId()] = environment;
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

// An element the engine styles that holds a place among its siblings: a
// `::before` or `::after` box is styled but is not an element
bool isStyledElement(const ShadowNode& node) {
  const auto* provider =
      dynamic_cast<const ElementStyleInputsProvider*>(node.getProps().get());
  return provider != nullptr && provider->elementStyleInputs().styled &&
      provider->elementStyleInputs().pseudo == 0;
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

void StyleEngine::setScriptStyles(
    const std::vector<std::pair<std::shared_ptr<const ShadowNode>, folly::dynamic>>&
        writes) {
  std::unordered_map<SurfaceId, std::vector<std::shared_ptr<const ShadowNodeFamily>>>
      changed;
  {
    std::scoped_lock lock(scriptWritesMutex_);
    for (const auto& [node, entries] : writes) {
      if (node == nullptr) {
        continue;
      }
      Tag tag = node->getTag();
      auto found = scriptWrites_.find(tag);
      std::shared_ptr<const ScriptWrites> previous =
          found != scriptWrites_.end() ? found->second : nullptr;
      std::vector<ScriptWrites::Declaration> declarations;
      if (entries.isArray()) {
        for (const auto& pair : entries) {
          if (!pair.isArray() || pair.size() != 2 || !pair[0].isString()) {
            continue;
          }
          std::string property(pair[0].getString());
          // The React value the write overrides: the one it had when script
          // wrote this value, or React's value now for a new write
          const ScriptWrites::Declaration* before = nullptr;
          if (previous != nullptr) {
            for (const auto& declaration : previous->declarations) {
              if (declaration.property == property) {
                before = &declaration;
              }
            }
          }
          folly::dynamic reactValue = before != nullptr &&
                  before->value == pair[1]
              ? before->reactValue
              : reactInlineValue(*node->getProps(), property);
          declarations.push_back({property, pair[1], std::move(reactValue)});
        }
      }
      bool same = previous != nullptr &&
          previous->declarations.size() == declarations.size() &&
          std::equal(
              declarations.begin(),
              declarations.end(),
              previous->declarations.begin(),
              [](const auto& a, const auto& b) {
                return a.property == b.property && a.value == b.value;
              });
      if (same || (previous == nullptr && declarations.empty())) {
        continue;
      }
      auto next = ScriptWrites::make(
          std::move(declarations),
          previous != nullptr ? previous->attributes
                              : std::vector<ScriptWrites::Attribute>{},
          node->getSurfaceId(),
          node->getFamilyShared());
      if (next != nullptr) {
        scriptWrites_[tag] = std::move(next);
      } else {
        scriptWrites_.erase(tag);
      }
      changed[node->getSurfaceId()].push_back(node->getFamilyShared());
    }
  }
  // Mounted as React's commits are, not synchronously: a transition the
  // write starts (a bottom sheet released from a drag, sliding shut from the
  // finger) was drawn at its end for a frame before the transition's first
  // frame put it back where it starts
  for (const auto& [surfaceId, families] : changed) {
    restyleElements(surfaceId, families, /*mountSynchronously*/ false);
  }
}

void StyleEngine::setScriptAttributes(
    const std::vector<
        std::pair<std::shared_ptr<const ShadowNode>, folly::dynamic>>& writes) {
  std::unordered_map<
      SurfaceId,
      std::vector<std::shared_ptr<const ShadowNodeFamily>>>
      changed;
  {
    std::scoped_lock lock(scriptWritesMutex_);
    for (const auto& [node, entries] : writes) {
      if (node == nullptr) {
        continue;
      }
      Tag tag = node->getTag();
      auto found = scriptWrites_.find(tag);
      std::shared_ptr<const ScriptWrites> previous =
          found != scriptWrites_.end() ? found->second : nullptr;
      std::vector<ScriptWrites::Attribute> attributes;
      if (entries.isArray()) {
        for (const auto& pair : entries) {
          if (!pair.isArray() || pair.size() != 2 || !pair[0].isString() ||
              !(pair[1].isString() || pair[1].isNull())) {
            continue;
          }
          std::string name = lowercase(pair[0].getString());
          std::optional<std::string> value = pair[1].isString()
              ? std::optional<std::string>(pair[1].getString())
              : std::nullopt;
          // The React value the write overrides: the one it had when script
          // wrote this value, or React's value now for a new write
          const ScriptWrites::Attribute* before = nullptr;
          if (previous != nullptr) {
            for (const auto& attribute : previous->attributes) {
              if (attribute.name == name) {
                before = &attribute;
              }
            }
          }
          std::optional<std::string> reactValue =
              before != nullptr && before->value == value
              ? before->reactValue
              : reactAttributeValue(*node->getProps(), name);
          attributes.push_back(
              {std::move(name), std::move(value), std::move(reactValue)});
        }
      }
      bool same = previous != nullptr &&
          previous->attributes.size() == attributes.size() &&
          std::equal(attributes.begin(),
                     attributes.end(),
                     previous->attributes.begin(),
                     [](const auto& a, const auto& b) {
                       return a.name == b.name && a.value == b.value;
                     });
      if (same || (previous == nullptr && attributes.empty())) {
        continue;
      }
      auto next = ScriptWrites::make(
          previous != nullptr ? previous->declarations
                              : std::vector<ScriptWrites::Declaration>{},
          std::move(attributes),
          node->getSurfaceId(),
          node->getFamilyShared());
      if (next != nullptr) {
        scriptWrites_[tag] = std::move(next);
      } else {
        scriptWrites_.erase(tag);
      }
      changed[node->getSurfaceId()].push_back(node->getFamilyShared());
    }
  }
  // Mounted as React's commits are, as script's inline styles are
  for (const auto& [surfaceId, families] : changed) {
    restyleElements(surfaceId, families, /*mountSynchronously*/ false);
  }
}

folly::dynamic StyleEngine::scriptStyle(const ShadowNode& node) const {
  folly::dynamic declarations = folly::dynamic::array();
  std::scoped_lock lock(scriptWritesMutex_);
  auto found = scriptWrites_.find(node.getTag());
  if (found != scriptWrites_.end()) {
    for (const auto& declaration : found->second->declarations) {
      declarations.push_back(
          folly::dynamic::array(declaration.property, declaration.value));
    }
  }
  return declarations;
}

folly::dynamic StyleEngine::explain(const ShadowNode& node) const {
  std::shared_ptr<const CacheEntry> entry;
  EnvironmentValues environment;
  {
    std::scoped_lock lock(cacheMutex_);
    entry = entryFor(node);
    auto found = surfaceEnvironments_.find(node.getSurfaceId());
    if (found != surfaceEnvironments_.end()) {
      environment = found->second;
    }
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
  resolveInputs.environment = &environment;
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
  if (entry->scriptWrites != nullptr) {
    resolveInputs.scriptStyle = entry->scriptWrites->style.get();
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
    }
    if (keyword == "flex" || keyword == "inline-flex") {
      hints |= cssengine::StyleHintFlexRow;
    }
  } else if (
      property == "flexDirection" || property == "flexFlow" ||
      property == "flexWrap") {
    // `wrap` and `wrap-reverse`, not `nowrap`
    const bool wraps = keyword.find("wrap") != std::string::npos &&
        keyword.find("nowrap") == std::string::npos;
    if (keyword.find("column") != std::string::npos || wraps) {
      hints |= cssengine::StyleHintFlexColumn;
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
    // region that scrolls in the block axis, unless the element is a flex
    // row (`StyleHintFlexRow`), which the runtime reads with this
    if (keyword.find("auto") != std::string::npos ||
        keyword.find("scroll") != std::string::npos) {
      hints |= property == "overflowX" || property == "overflowInline"
          ? cssengine::StyleHintScroll
          : cssengine::StyleHintScrollBlock;
    }
    // The shorthand's block axis is its second value, or its only one
    if (property != "overflowX" && property != "overflowInline") {
      std::string_view block = keyword;
      if (property == "overflow") {
        if (auto space = block.find_last_of(" \t"); space != block.npos) {
          block = block.substr(space + 1);
        }
      }
      if (block == "hidden" || block == "clip") {
        hints |= cssengine::StyleHintClipBlock;
      }
    }
  }
  return hints;
}

uint32_t statesReadBy(const cssengine::CompoundSelector& compound);
uint32_t hintsOfStatesRead(uint32_t states);

uint32_t hintsOfEntries(
    const std::vector<AuthorEntry>& entries,
    std::string_view property) {
  uint32_t hints = 0;
  for (const auto& entry : entries) {
    if (entry.condition == AuthorEntry::Condition::PseudoClass) {
      hints |= hintsOfStatesRead(stateOfPseudoClass(entry.pseudoClass));
    }
    if (entry.condition == AuthorEntry::Condition::Selector &&
        entry.selector != nullptr) {
      // A condition on the element's own state; one on a marked ancestor's
      // is the ancestor's to report
      for (const auto& selector : *entry.selector) {
        if (selector.compounds.size() == 1) {
          hints |= hintsOfStatesRead(statesReadBy(selector.compounds.back()));
        }
      }
    }
    std::string_view name = entry.condition == AuthorEntry::Condition::None
        ? std::string_view(entry.key)
        : property;
    if (entry.kind == AuthorEntry::Kind::Nested) {
      hints |= hintsOfEntries(entry.entries, name);
    } else if (entry.kind == AuthorEntry::Kind::Value) {
      hints |= hintsOfDeclaration(name, entry.text);
    }
  }
  return hints;
}

// The interaction states a compound reads, as `ElementState` bits, in its
// pseudo-classes' arguments too
uint32_t statesReadBy(const cssengine::CompoundSelector& compound) {
  uint32_t states = 0;
  for (const auto& pseudo : compound.pseudoClasses) {
    switch (pseudo.kind) {
      case cssengine::PseudoClass::Hover:
        states |= cssengine::ElementStateHover;
        break;
      case cssengine::PseudoClass::Active:
        states |= cssengine::ElementStateActive;
        break;
      case cssengine::PseudoClass::Focus:
        states |= cssengine::ElementStateFocus;
        break;
      case cssengine::PseudoClass::FocusVisible:
        states |= cssengine::ElementStateFocusVisible;
        break;
      default:
        break;
    }
    if (pseudo.arguments != nullptr) {
      for (const auto& selector : *pseudo.arguments) {
        for (const auto& inner : selector.compounds) {
          states |= statesReadBy(inner);
        }
      }
    }
  }
  return states;
}

// What an element's styles reading its interaction states says of it: that
// it reports them, and whether its styles answer a press
uint32_t hintsOfStatesRead(uint32_t states) {
  uint32_t hints = 0;
  if (states != 0) {
    hints |= cssengine::StyleHintStates;
  }
  if ((states &
       (cssengine::ElementStateHover | cssengine::ElementStateActive)) != 0) {
    hints |= cssengine::StyleHintPressStates;
  }
  return hints;
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
          uint32_t states = statesReadBy(compound);
          if (states != 0 &&
              cssengine::compoundCouldMatch(compound, element)) {
            result |= hintsOfStatesRead(states);
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
  stats.resolvedEnvironment = load(c.resolvedEnvironment);
  stats.resolvedScriptWrites = load(c.resolvedScriptWrites);
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
  stats.elementsKeptAcrossParent = load(c.elementsKeptAcrossParent);
  return stats;
}

void StyleEngine::resetStats() {
  Counters& c = *counters_;
  for (auto* counter :
       {&c.passes,
        &c.passNanos,
        &c.nodesVisited,
        &c.subtreesKept,
        &c.elementsResolved,
        &c.resolvedNew,
        &c.resolvedProps,
        &c.resolvedParent,
        &c.resolvedSiblings,
        &c.resolvedGeneration,
        &c.resolveNanos,
        &c.matchNanos,
        &c.elementsKept,
        &c.childContextsKept,
        &c.propsParsed,
        &c.propsParseNanos,
        &c.nodesCloned,
        &c.restyles,
        &c.snapshots,
        &c.stylesRegistered,
        &c.registerNanos,
        &c.hintsAsked,
        &c.hintsNanos,
        &c.resolvedStates,
        &c.resolvedEnvironment,
        &c.resolvedScriptWrites,
        &c.stateEvents,
        &c.stateCommits,
        &c.elementsKeptAcrossParent}) {
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
      "setScriptStyles",
      1,
      [](jsi::Runtime& rt,
         StyleEngine& engine,
         const jsi::Value* args,
         size_t count) {
        if (count < 1 || !args[0].isObject() ||
            !args[0].asObject(rt).isArray(rt)) {
          return jsi::Value::undefined();
        }
        auto list = args[0].asObject(rt).asArray(rt);
        std::vector<std::pair<std::shared_ptr<const ShadowNode>, folly::dynamic>>
            writes;
        for (size_t i = 0; i < list.size(rt); i++) {
          auto item = list.getValueAtIndex(rt, i);
          if (!item.isObject() || !item.asObject(rt).isArray(rt)) {
            continue;
          }
          auto pair = item.asObject(rt).asArray(rt);
          if (pair.size(rt) != 2) {
            continue;
          }
          auto node = nodeFromValue(rt, pair.getValueAtIndex(rt, 0));
          if (node == nullptr) {
            continue;
          }
          writes.emplace_back(
              std::move(node),
              jsi::dynamicFromValue(rt, pair.getValueAtIndex(rt, 1)));
        }
        engine.setScriptStyles(writes);
        return jsi::Value::undefined();
      });
  define(
      "setScriptAttributes",
      1,
      [](jsi::Runtime& rt,
         StyleEngine& engine,
         const jsi::Value* args,
         size_t count) {
        if (count < 1 || !args[0].isObject() ||
            !args[0].asObject(rt).isArray(rt)) {
          return jsi::Value::undefined();
        }
        auto list = args[0].asObject(rt).asArray(rt);
        std::vector<
            std::pair<std::shared_ptr<const ShadowNode>, folly::dynamic>>
            writes;
        for (size_t i = 0; i < list.size(rt); i++) {
          auto item = list.getValueAtIndex(rt, i);
          if (!item.isObject() || !item.asObject(rt).isArray(rt)) {
            continue;
          }
          auto pair = item.asObject(rt).asArray(rt);
          if (pair.size(rt) != 2) {
            continue;
          }
          auto node = nodeFromValue(rt, pair.getValueAtIndex(rt, 0));
          if (node == nullptr) {
            continue;
          }
          writes.emplace_back(
              std::move(node),
              jsi::dynamicFromValue(rt, pair.getValueAtIndex(rt, 1)));
        }
        engine.setScriptAttributes(writes);
        return jsi::Value::undefined();
      });
  define(
      "scriptStyle",
      1,
      [](jsi::Runtime& rt,
         StyleEngine& engine,
         const jsi::Value* args,
         size_t count) {
        auto node = count < 1 ? nullptr : nodeFromValue(rt, args[0]);
        if (node == nullptr) {
          return jsi::Value::null();
        }
        return jsi::valueFromDynamic(rt, engine.scriptStyle(*node));
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
            rt,
            "resolvedEnvironment",
            static_cast<double>(stats.resolvedEnvironment));
        out.setProperty(
            rt,
            "resolvedScriptWrites",
            static_cast<double>(stats.resolvedScriptWrites));
        out.setProperty(
            rt, "stateEvents", static_cast<double>(stats.stateEvents));
        out.setProperty(
            rt, "stateCommits", static_cast<double>(stats.stateCommits));
        out.setProperty(
            rt,
            "elementsKeptAcrossParent",
            static_cast<double>(stats.elementsKeptAcrossParent));
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
