/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "AncestorFeatures.h"

#include <algorithm>

namespace facebook::react::cssengine {

namespace {

void addComplex(AncestorFeatures& features, const ComplexSelector& selector);

// A compound that may match an ancestor: everything it names
void addAncestorCompound(
    AncestorFeatures& features,
    const CompoundSelector& compound) {
  for (const auto& name : compound.classes) {
    features.classes.insert(name);
  }
  if (!compound.ids.empty()) {
    features.attributes.insert("id");
  }
  for (const auto& attribute : compound.attributes) {
    features.attributes.insert(attribute.name);
  }
  for (const auto& pseudo : compound.pseudoClasses) {
    switch (pseudo.kind) {
      case PseudoClass::Hover:
        features.states |= ElementStateHover;
        break;
      case PseudoClass::Active:
        features.states |= ElementStateActive;
        break;
      case PseudoClass::Focus:
        features.states |= ElementStateFocus;
        break;
      case PseudoClass::FocusVisible:
        features.states |= ElementStateFocusVisible;
        break;
      case PseudoClass::PopoverOpen:
        features.states |= ElementStatePopoverOpen;
        break;
      case PseudoClass::Checked:
        features.states |= ElementStateChecked;
        features.attributes.insert("checked");
        break;
      case PseudoClass::Disabled:
      case PseudoClass::Enabled:
        features.attributes.insert("disabled");
        break;
      case PseudoClass::AnyLink:
        features.attributes.insert("href");
        break;
      case PseudoClass::FirstChild:
      case PseudoClass::LastChild:
      case PseudoClass::OnlyChild:
      case PseudoClass::NthChild:
      case PseudoClass::NthLastChild:
        features.positional = true;
        break;
      default:
        break;
    }
    if (pseudo.arguments != nullptr) {
      // Everything in an ancestor's argument is about the ancestor
      for (const auto& inner : *pseudo.arguments) {
        for (const auto& innerCompound : inner.compounds) {
          addAncestorCompound(features, innerCompound);
        }
        if (inner.compounds.size() > 1) {
          features.positional = features.positional ||
              std::any_of(inner.combinators.begin(),
                          inner.combinators.end(),
                          [](Combinator combinator) {
                            return combinator == Combinator::NextSibling ||
                                combinator == Combinator::SubsequentSibling;
                          });
        }
      }
    }
  }
}

void addComplex(AncestorFeatures& features, const ComplexSelector& selector) {
  size_t count = selector.compounds.size();
  for (size_t i = 0; i + 1 < count; i++) {
    addAncestorCompound(features, selector.compounds[i]);
  }
  for (size_t i = 0; i + 1 < count; i++) {
    // An ancestor's earlier sibling is read through the ancestor's own
    // sibling chain
    Combinator combinator = selector.combinators[i];
    if ((combinator == Combinator::NextSibling ||
         combinator == Combinator::SubsequentSibling) &&
        i + 1 < count - 1) {
      features.positional = true;
    }
  }
  if (count == 0) {
    return;
  }
  // The subject's arguments can reach ancestors too (`:is(.a .b)`)
  for (const auto& pseudo : selector.compounds.back().pseudoClasses) {
    if (pseudo.arguments != nullptr) {
      for (const auto& inner : *pseudo.arguments) {
        addComplex(features, inner);
      }
    }
  }
}

bool attributeChanged(
    const StyleContext& before,
    const StyleContext& after,
    const std::unordered_set<std::string>& names) {
  for (const auto& [name, value] : before.attributes) {
    if (names.count(name) == 0) {
      continue;
    }
    const std::string* other = after.attribute(name);
    if (other == nullptr || *other != value) {
      return true;
    }
  }
  for (const auto& [name, value] : after.attributes) {
    if (names.count(name) != 0 && before.attribute(name) == nullptr) {
      return true;
    }
  }
  return false;
}

bool classChanged(
    const StyleContext& before,
    const StyleContext& after,
    const std::unordered_set<std::string>& names) {
  for (const auto& name : before.classes) {
    if (names.count(name) != 0 && !after.hasClass(name)) {
      return true;
    }
  }
  for (const auto& name : after.classes) {
    if (names.count(name) != 0 && !before.hasClass(name)) {
      return true;
    }
  }
  return false;
}

} // namespace

void AncestorFeatures::addSelectorList(const SelectorList& list) {
  for (const auto& selector : list) {
    addComplex(*this, selector);
  }
}

void AncestorFeatures::merge(const AncestorFeatures& other) {
  classes.insert(other.classes.begin(), other.classes.end());
  attributes.insert(other.attributes.begin(), other.attributes.end());
  states |= other.states;
  positional = positional || other.positional;
}

// Whether two previous siblings are the same one to a selector
static bool sameSibling(const StyleContext* a, const StyleContext* b) {
  if (a == b) {
    return true;
  }
  if (a == nullptr || b == nullptr) {
    return false;
  }
  return a->tag == b->tag && a->classes == b->classes &&
      a->attributes == b->attributes && a->states == b->states &&
      a->position == b->position && a->siblingCount == b->siblingCount;
}

bool AncestorFeatures::distinguishes(
    const StyleContext& before,
    const StyleContext& after,
    bool siblingsByContent) const {
  if (((before.states ^ after.states) & states) != 0) {
    return true;
  }
  if (positional &&
      (before.position != after.position ||
       before.siblingCount != after.siblingCount ||
       (siblingsByContent
            ? !sameSibling(
                  before.previousSibling.get(), after.previousSibling.get())
            : before.previousSibling != after.previousSibling))) {
    return true;
  }
  return classChanged(before, after, classes) ||
      attributeChanged(before, after, attributes);
}

} // namespace facebook::react::cssengine
