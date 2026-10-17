/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <react/renderer/cssengine/MediaQueries.h>

namespace facebook::react::cssengine {

struct ComplexSelector;
using SelectorList = std::vector<ComplexSelector>;

// selectors-4 §6.3
struct AttributeSelector {
  enum class Operator : uint8_t {
    Exists, // [name]
    Equals, // [name=value]
    Includes, // [name~=value]
    DashMatch, // [name|=value]
    Prefix, // [name^=value]
    Suffix, // [name$=value]
    Substring, // [name*=value]
  };
  // Lowercased: the attribute names an element carries are its props', which
  // HTML matches case-insensitively
  std::string name;
  Operator op{Operator::Exists};
  std::string value;
  bool caseInsensitive{false};
};

enum class PseudoClass : uint8_t {
  Hover,
  Active,
  Focus,
  FocusVisible,
  Disabled,
  Enabled,
  Checked,
  PopoverOpen,
  Root,
  Scope,
  FirstChild,
  LastChild,
  OnlyChild,
  NthChild,
  NthLastChild,
  AnyLink,
  Is,
  Where,
  Not,
  // A pseudo-class the engine cannot answer (`:has()`, `:focus-within`,
  // `:empty`, a name it does not know): the selector never matches
  Unsupported,
};

struct PseudoClassSelector {
  PseudoClass kind{PseudoClass::Unsupported};
  // An+B, for :nth-child() and :nth-last-child()
  int a{0};
  int b{0};
  // The selector list of :is(), :where() and :not(), and the `of S` of the
  // :nth-*() ones
  std::shared_ptr<const SelectorList> arguments;
};

struct CompoundSelector {
  // Lowercased; empty for none or `*`
  std::string tag;
  std::vector<std::string> ids;
  std::vector<std::string> classes;
  std::vector<AttributeSelector> attributes;
  std::vector<PseudoClassSelector> pseudoClasses;
  // A pseudo-element (`::before`): the engine generates no such boxes, so a
  // selector naming one matches no element
  bool pseudoElement{false};
};

// selectors-4 §15
enum class Combinator : uint8_t {
  Descendant,
  Child,
  NextSibling,
  SubsequentSibling,
};

// What an `@scope` rule's selector is scoped to (css-cascade-6 §2.5): its
// scoping roots and the limits under them that end the scope
struct ScopeInfo {
  SelectorList roots;
  SelectorList limits;
};

struct ComplexSelector {
  // Document order, the subject last
  std::vector<CompoundSelector> compounds;
  // `combinators[i]` joins `compounds[i]` to `compounds[i + 1]`
  std::vector<Combinator> combinators;
  // (a << 20) | (b << 10) | c, so one comparison orders two of them
  uint32_t specificity{0};
  // False when it uses syntax that can never match here
  bool matchable{true};
  // Set for a selector in an `@scope` block, which is written out against
  // its roots and also checked against them
  std::shared_ptr<const ScopeInfo> scope;
};

struct Declaration {
  // camelCase (`background-color` is `backgroundColor`), the spelling React
  // Native's props and StyleX's keys share; a custom property keeps its name
  std::string property;
  // As written, comments dropped and whitespace collapsed
  std::string value;
  bool important{false};
};

// css-contain-3 §2.3: `@container <name>? <condition>`
struct ContainerQuery {
  std::string name;
  std::shared_ptr<const MediaQueryList> condition;
};

struct StyleRule {
  SelectorList selectors;
  std::vector<Declaration> declarations;
  // Every enclosing @media's query list, outermost first
  std::vector<std::shared_ptr<const MediaQueryList>> media;
  // Every enclosing @container, outermost first
  std::vector<ContainerQuery> containers;
  // The enclosing @layer names joined with `.`; empty and `layered` false
  // when the rule is in no layer
  std::string layer;
  bool layered{false};
  // Source order within the sheet
  uint32_t order{0};
};

struct KeyframesRule {
  std::string name;
  // Sorted by offset, 0 to 1
  std::vector<std::pair<double, std::vector<Declaration>>> stops;
};

struct StyleSheet {
  std::vector<StyleRule> rules;
  std::vector<KeyframesRule> keyframes;
  // Every @layer name in first-seen order, statement and block forms alike
  std::vector<std::string> layerOrder;
  // Whether any selector reads an element's siblings or its position among
  // them, which the style pass then has to supply
  bool readsSiblings{false};
};

// selectors-4 §17, as (a << 20) | (b << 10) | c
uint32_t specificityOf(const ComplexSelector &selector);

/*
 * Parses a stylesheet (css-syntax-3 §5) leniently, as the spec demands: an
 * invalid declaration is dropped, a selector that cannot match is kept and
 * never matches, an unknown at-rule is skipped whole. Nothing throws.
 */
std::shared_ptr<const StyleSheet> parseStyleSheet(std::string_view source);

/*
 * A selector list on its own, as `matches()` and `querySelector()` take one.
 */
SelectorList parseSelectorList(std::string_view source);

/*
 * `background-color` → `backgroundColor`; a custom property is unchanged.
 */
std::string camelCasePropertyName(std::string_view name);

} // namespace facebook::react::cssengine
