/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include <react/renderer/cssengine/AncestorFeatures.h>
#include <react/renderer/cssengine/StyleContext.h>
#include <react/renderer/cssengine/StyleSheet.h>

namespace facebook::react::cssengine {

// One selector of one rule, as the cascade orders it
struct IndexedSelector {
  const StyleRule *rule{nullptr};
  const ComplexSelector *selector{nullptr};
  // cascade-5 §6.4: a later layer beats an earlier one, unlayered beats both
  uint32_t layerRank{0};
  uint32_t specificity{0};
  // Source order across every sheet
  uint64_t order{0};
};

// One rule that matched an element, and for an `@scope` rule how many
// generations up its scoping root is (css-cascade-6 §2.5.3)
struct MatchedRule {
  const IndexedSelector *selector{nullptr};
  uint32_t proximity{0};

  const IndexedSelector *operator->() const
  {
    return selector;
  }
};

/*
 * The installed sheets, compiled for matching. Immutable once built: a sheet
 * change builds a new one, so a style pass on any thread reads one set.
 */
class RuleSet {
 public:
  explicit RuleSet(std::vector<std::shared_ptr<const StyleSheet>> sheets);

  /*
   * The rules that match `element`, weakest first: by layer, then
   * specificity, then scope proximity, then source order (css-cascade-5 §6,
   * css-cascade-6 §2.5.3).
   */
  void match(const StyleContext &element, const MediaEnvironment &environment, std::vector<MatchedRule> &out) const;

  // The rank of the layer StyleX's rules are in on the web, `astryx-base`;
  // -1 when no sheet orders that layer, which leaves StyleX above every rule.
  // DOM-CSS-DEVIATION(stylex-is-a-layer)
  int styleXLayerRank() const
  {
    return styleXLayerRank_;
  }

  bool readsSiblings() const
  {
    return readsSiblings_;
  }

  // Whether a rule is inside `@starting-style`
  bool hasStartingRules() const
  {
    return hasStartingRules_;
  }

  // Whether a declaration says `inherit` on a property that does not inherit,
  // which then needs each element's parent's props
  bool usesExplicitInheritance() const
  {
    return !explicitInherits_.empty();
  }

  // The properties that do not inherit on which some declaration says
  // `inherit`: the only props a descendant can read from its parent's
  // computed style, so the only ones an element has to keep for it
  const std::unordered_set<std::string> &explicitInherits() const
  {
    return explicitInherits_;
  }

  const KeyframesRule *keyframes(std::string_view name) const;

  // What the sheets' selectors read of an element from below it
  const AncestorFeatures &ancestorFeatures() const
  {
    return ancestorFeatures_;
  }

 private:
  bool containersMatch(const StyleRule &rule, const StyleContext &element, const MediaEnvironment &environment) const;

  std::vector<std::shared_ptr<const StyleSheet>> sheets_;
  std::vector<IndexedSelector> entries_;
  std::unordered_map<std::string, std::vector<uint32_t>> byId_;
  std::unordered_map<std::string, std::vector<uint32_t>> byClass_;
  std::unordered_map<std::string, std::vector<uint32_t>> byTag_;
  std::vector<uint32_t> universal_;
  int styleXLayerRank_{-1};
  bool readsSiblings_{false};
  bool hasStartingRules_{false};
  std::unordered_set<std::string> explicitInherits_;
  std::unordered_map<std::string, const KeyframesRule *> keyframes_;
  AncestorFeatures ancestorFeatures_;
};

} // namespace facebook::react::cssengine
