/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "SelectorMatching.h"

#include <cctype>

namespace facebook::react::cssengine {

namespace {

bool equalsIgnoringCase(std::string_view a, std::string_view b) {
  if (a.size() != b.size()) {
    return false;
  }
  for (size_t i = 0; i < a.size(); i++) {
    if (std::tolower(static_cast<unsigned char>(a[i])) !=
        std::tolower(static_cast<unsigned char>(b[i]))) {
      return false;
    }
  }
  return true;
}

bool startsWith(std::string_view text, std::string_view prefix, bool fold) {
  if (prefix.size() > text.size()) {
    return false;
  }
  return fold ? equalsIgnoringCase(text.substr(0, prefix.size()), prefix)
              : text.substr(0, prefix.size()) == prefix;
}

bool endsWith(std::string_view text, std::string_view suffix, bool fold) {
  if (suffix.size() > text.size()) {
    return false;
  }
  auto tail = text.substr(text.size() - suffix.size());
  return fold ? equalsIgnoringCase(tail, suffix) : tail == suffix;
}

bool contains(std::string_view text, std::string_view part, bool fold) {
  if (!fold) {
    return text.find(part) != std::string_view::npos;
  }
  for (size_t i = 0; i + part.size() <= text.size(); i++) {
    if (equalsIgnoringCase(text.substr(i, part.size()), part)) {
      return true;
    }
  }
  return false;
}

// selectors-4 §6.3
bool matchesAttribute(
    const AttributeSelector& selector,
    const StyleContext& element) {
  const std::string* value = element.attribute(selector.name);
  if (value == nullptr) {
    return false;
  }
  bool fold = selector.caseInsensitive;
  const std::string& expected = selector.value;
  switch (selector.op) {
    case AttributeSelector::Operator::Exists:
      return true;
    case AttributeSelector::Operator::Equals:
      return fold ? equalsIgnoringCase(*value, expected) : *value == expected;
    case AttributeSelector::Operator::Includes: {
      if (expected.empty() ||
          expected.find_first_of(" \t\n\r\f") != std::string::npos) {
        return false;
      }
      std::string_view rest = *value;
      while (!rest.empty()) {
        size_t start = rest.find_first_not_of(" \t\n\r\f");
        if (start == std::string_view::npos) {
          break;
        }
        rest.remove_prefix(start);
        size_t end = rest.find_first_of(" \t\n\r\f");
        std::string_view word = rest.substr(0, end);
        if (fold ? equalsIgnoringCase(word, expected) : word == expected) {
          return true;
        }
        if (end == std::string_view::npos) {
          break;
        }
        rest.remove_prefix(end);
      }
      return false;
    }
    case AttributeSelector::Operator::DashMatch:
      return (fold ? equalsIgnoringCase(*value, expected)
                   : *value == expected) ||
          startsWith(*value, expected + "-", fold);
    case AttributeSelector::Operator::Prefix:
      return !expected.empty() && startsWith(*value, expected, fold);
    case AttributeSelector::Operator::Suffix:
      return !expected.empty() && endsWith(*value, expected, fold);
    case AttributeSelector::Operator::Substring:
      return !expected.empty() && contains(*value, expected, fold);
  }
  return false;
}

// HTML §4.10: the elements `disabled` applies to
bool isFormControl(std::string_view tag) {
  return tag == "button" || tag == "input" || tag == "select" ||
      tag == "textarea" || tag == "fieldset" || tag == "optgroup" ||
      tag == "option";
}

// An+B (css-syntax-3 §6): whether some n ≥ 0 gives `position`
bool matchesNth(int a, int b, int position) {
  if (a == 0) {
    return position == b;
  }
  int difference = position - b;
  return difference % a == 0 && difference / a >= 0;
}

bool matchesPseudoClass(
    const PseudoClassSelector& pseudo,
    const StyleContext& element) {
  switch (pseudo.kind) {
    case PseudoClass::Hover:
      return (element.states & ElementStateHover) != 0;
    case PseudoClass::Active:
      return (element.states & ElementStateActive) != 0;
    case PseudoClass::Focus:
      return (element.states &
              (ElementStateFocus | ElementStateFocusVisible)) != 0;
    case PseudoClass::FocusVisible:
      return (element.states & ElementStateFocusVisible) != 0;
    case PseudoClass::Disabled:
      return isFormControl(element.tag) &&
          element.attribute("disabled") != nullptr;
    case PseudoClass::Enabled:
      return isFormControl(element.tag) &&
          element.attribute("disabled") == nullptr;
    case PseudoClass::Checked:
      return (element.states & ElementStateChecked) != 0 ||
          element.attribute("checked") != nullptr;
    case PseudoClass::PopoverOpen:
      return (element.states & ElementStatePopoverOpen) != 0;
    case PseudoClass::Root:
    case PseudoClass::Scope:
      return element.isRoot;
    case PseudoClass::FirstChild:
      return element.position == 1;
    case PseudoClass::LastChild:
      return element.position != 0 && element.position == element.siblingCount;
    case PseudoClass::OnlyChild:
      return element.position == 1 && element.siblingCount == 1;
    case PseudoClass::NthChild: {
      if (element.position == 0) {
        return false;
      }
      if (pseudo.arguments == nullptr) {
        return matchesNth(
            pseudo.a, pseudo.b, static_cast<int>(element.position));
      }
      // `of S`: the position among the siblings that match S
      if (!matchesSelectorList(*pseudo.arguments, element)) {
        return false;
      }
      int position = 1;
      for (const StyleContext* sibling = element.previousSibling.get();
           sibling != nullptr;
           sibling = sibling->previousSibling.get()) {
        if (matchesSelectorList(*pseudo.arguments, *sibling)) {
          position++;
        }
      }
      return matchesNth(pseudo.a, pseudo.b, position);
    }
    case PseudoClass::NthLastChild: {
      if (element.position == 0) {
        return false;
      }
      if (pseudo.arguments == nullptr) {
        return matchesNth(
            pseudo.a,
            pseudo.b,
            static_cast<int>(element.siblingCount - element.position + 1));
      }
      // `of S` counts the later siblings that match S, which only a query
      // over the committed tree has.
      // DOM-CSS-LIMITATION(nth-last-of-selector-in-sheets): in a sheet's
      // rule it never matches
      if (element.followingSiblings == nullptr ||
          !matchesSelectorList(*pseudo.arguments, element)) {
        return false;
      }
      int position = 1;
      for (const auto& sibling : *element.followingSiblings) {
        if (matchesSelectorList(*pseudo.arguments, *sibling)) {
          position++;
        }
      }
      return matchesNth(pseudo.a, pseudo.b, position);
    }
    case PseudoClass::AnyLink:
      return (element.tag == "a" || element.tag == "area") &&
          element.attribute("href") != nullptr;
    case PseudoClass::Is:
    case PseudoClass::Where:
      return matchesSelectorList(*pseudo.arguments, element);
    case PseudoClass::Not:
      return !matchesSelectorList(*pseudo.arguments, element);
    case PseudoClass::Unsupported:
      return false;
  }
  return false;
}

// Right to left from `index`, backtracking over descendant and subsequent
// sibling combinators
bool matchesFrom(
    const ComplexSelector& selector,
    size_t index,
    const StyleContext& element) {
  if (!matchesCompound(selector.compounds[index], element)) {
    return false;
  }
  if (index == 0) {
    return true;
  }
  switch (selector.combinators[index - 1]) {
    case Combinator::Child:
      return element.parent != nullptr &&
          matchesFrom(selector, index - 1, *element.parent);
    case Combinator::Descendant:
      for (const StyleContext* ancestor = element.parent.get();
           ancestor != nullptr;
           ancestor = ancestor->parent.get()) {
        if (matchesFrom(selector, index - 1, *ancestor)) {
          return true;
        }
      }
      return false;
    case Combinator::NextSibling:
      return element.previousSibling != nullptr &&
          matchesFrom(selector, index - 1, *element.previousSibling);
    case Combinator::SubsequentSibling:
      for (const StyleContext* sibling = element.previousSibling.get();
           sibling != nullptr;
           sibling = sibling->previousSibling.get()) {
        if (matchesFrom(selector, index - 1, *sibling)) {
          return true;
        }
      }
      return false;
  }
  return false;
}

} // namespace

bool matchesCompound(
    const CompoundSelector& compound,
    const StyleContext& element) {
  if (!compoundCouldMatch(compound, element)) {
    return false;
  }
  for (const auto& pseudo : compound.pseudoClasses) {
    if (!matchesPseudoClass(pseudo, element)) {
      return false;
    }
  }
  return true;
}

bool compoundCouldMatch(
    const CompoundSelector& compound,
    const StyleContext& element) {
  if (compound.pseudoElement) {
    return false;
  }
  if (!compound.tag.empty() && compound.tag != element.tag) {
    return false;
  }
  for (const auto& id : compound.ids) {
    const std::string* value = element.attribute("id");
    if (value == nullptr || *value != id) {
      return false;
    }
  }
  for (const auto& name : compound.classes) {
    if (!element.hasClass(name)) {
      return false;
    }
  }
  for (const auto& attribute : compound.attributes) {
    if (!matchesAttribute(attribute, element)) {
      return false;
    }
  }
  return true;
}

bool matchesSelector(
    const ComplexSelector& selector,
    const StyleContext& element) {
  if (!selector.matchable || selector.compounds.empty()) {
    return false;
  }
  return matchesFrom(selector, selector.compounds.size() - 1, element);
}

bool matchesSelectorList(
    const SelectorList& list,
    const StyleContext& element) {
  for (const auto& selector : list) {
    if (matchesSelector(selector, element)) {
      return true;
    }
  }
  return false;
}

} // namespace facebook::react::cssengine
