/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <cstdint>
#include <string>
#include <unordered_set>

#include <react/renderer/cssengine/StyleContext.h>
#include <react/renderer/cssengine/StyleSheet.h>

namespace facebook::react::cssengine {

/*
 * What any selector can read of an element from below it: the classes,
 * attributes, states and positions its compounds that match an ancestor
 * (or an ancestor's earlier sibling) name. When an element's context changes
 * only in what no such compound names, nothing under it can match
 * differently, and its descendants keep what they resolved: the invalidation
 * sets browsers keep, in their simplest form.
 */
struct AncestorFeatures {
  std::unordered_set<std::string> classes;
  // Lowercased; `id` for an id selector
  std::unordered_set<std::string> attributes;
  // `ElementState` bits
  uint32_t states{0};
  // A position among siblings, or a sibling itself
  bool positional{false};

  // Every compound of `list` that is not its subject, and the ones nested in
  // pseudo-class arguments that can be
  void addSelectorList(const SelectorList &list);
  void merge(const AncestorFeatures &other);

  /*
   * Whether any selector can tell, from below the element, its context
   * `before` from its context `after`.
   */
  bool distinguishes(const StyleContext &before, const StyleContext &after) const;
};

} // namespace facebook::react::cssengine
