/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "RuleSet.h"
#include "SelectorMatching.h"
#include "StyleProperties.h"
#include "StyleValues.h"

#include <algorithm>

namespace facebook::react::cssengine {

namespace {

constexpr std::string_view kStyleXLayer = "astryx-base";

} // namespace

namespace {

// The layers as a tree, each one's sublayers in the order they were first
// named
struct LayerNode {
  std::string name;
  std::vector<std::unique_ptr<LayerNode>> children;
};

void addLayer(LayerNode& root, const std::string& fullName) {
  LayerNode* node = &root;
  size_t start = 0;
  while (start <= fullName.size()) {
    size_t dot = fullName.find('.', start);
    size_t end = dot == std::string::npos ? fullName.size() : dot;
    std::string name = fullName.substr(0, end);
    auto found = std::find_if(
        node->children.begin(), node->children.end(), [&](const auto& child) {
          return child->name == name;
        });
    if (found == node->children.end()) {
      node->children.push_back(std::make_unique<LayerNode>());
      node->children.back()->name = name;
      node = node->children.back().get();
    } else {
      node = found->get();
    }
    if (dot == std::string::npos) {
      break;
    }
    start = dot + 1;
  }
}

// A layer's sublayers come before its own rules (css-cascade-5 §6.4.2): the
// tree in post-order
void rankLayers(
    const LayerNode& node,
    std::unordered_map<std::string, uint32_t>& ranks) {
  for (const auto& child : node.children) {
    rankLayers(*child, ranks);
  }
  if (!node.name.empty()) {
    ranks.emplace(node.name, static_cast<uint32_t>(ranks.size()));
  }
}

} // namespace

RuleSet::RuleSet(std::vector<std::shared_ptr<const StyleSheet>> sheets)
    : sheets_(std::move(sheets)) {
  // A layer's place among its siblings is fixed by its first declaration
  // across the sheets
  LayerNode tree;
  for (const auto& sheet : sheets_) {
    for (const auto& name : sheet->layerOrder) {
      addLayer(tree, name);
    }
  }
  std::unordered_map<std::string, uint32_t> ranks;
  rankLayers(tree, ranks);
  auto unlayeredRank = static_cast<uint32_t>(ranks.size());
  auto styleX = ranks.find(std::string(kStyleXLayer));
  styleXLayerRank_ =
      styleX == ranks.end() ? -1 : static_cast<int>(styleX->second);

  uint64_t sheetIndex = 0;
  for (const auto& sheet : sheets_) {
    readsSiblings_ = readsSiblings_ || sheet->readsSiblings;
    for (const auto& keyframes : sheet->keyframes) {
      keyframes_[keyframes.name] = &keyframes;
    }
    for (const auto& rule : sheet->rules) {
      hasStartingRules_ = hasStartingRules_ || rule.starting;
      ancestorFeatures_.addSelectorList(rule.selectors);
      for (const auto& declaration : rule.declarations) {
        if (trimmed(declaration.value) == "inherit" &&
            !isInheritedProperty(declaration.property)) {
          // The longhands, under both directions, since that is what a
          // descendant looks up in its parent's computed style
          for (bool rtl : {false, true}) {
            std::vector<Longhand> longhands;
            expandDeclaration(declaration.property, "inherit", rtl, longhands);
            for (const auto& longhand : longhands) {
              explicitInherits_.insert(std::string(longhand.property));
            }
          }
        }
      }
      uint32_t layerRank = unlayeredRank;
      if (rule.layered) {
        auto found = ranks.find(rule.layer);
        layerRank = found != ranks.end() ? found->second : unlayeredRank;
      }
      for (const auto& selector : rule.selectors) {
        if (!selector.matchable || selector.compounds.empty()) {
          continue;
        }
        auto index = static_cast<uint32_t>(entries_.size());
        entries_.push_back(
            {&rule,
             &selector,
             layerRank,
             selector.specificity,
             (sheetIndex << 32) | rule.order});
        // Indexed under one key of its subject; matching checks the rest
        const CompoundSelector& subject = selector.compounds.back();
        if (!subject.ids.empty()) {
          byId_[subject.ids.front()].push_back(index);
        } else if (!subject.classes.empty()) {
          byClass_[subject.classes.front()].push_back(index);
        } else if (!subject.tag.empty()) {
          byTag_[subject.tag].push_back(index);
        } else {
          universal_.push_back(index);
        }
      }
    }
    sheetIndex++;
  }
}

bool RuleSet::containersMatch(
    const StyleRule& rule,
    const StyleContext& element,
    const MediaEnvironment& environment) const {
  // A container query asks the nearest ancestor that is a container of the
  // name it gives (css-contain-3 §5.1).
  // DOM-CSS-DEVIATION(container-query-is-a-media-query): the condition is
  // answered over the viewport, the containers reporting no size.
  for (const auto& query : rule.containers) {
    bool found = false;
    for (const StyleContext* ancestor = element.parent.get();
         ancestor != nullptr;
         ancestor = ancestor->parent.get()) {
      const auto& names = ancestor->containerNames;
      if (names.empty()) {
        continue;
      }
      if (query.name.empty() ||
          std::find(names.begin(), names.end(), query.name) != names.end()) {
        found = true;
        break;
      }
    }
    if (!found || !query.condition->matches(environment)) {
      return false;
    }
  }
  return true;
}

namespace {

/*
 * Whether `element` is in the scope a selector was written in, and how many
 * generations up its nearest scoping root is: a limit between the two (the
 * element itself included) ends the scope (css-cascade-6 §2.5).
 */
bool inScope(
    const ScopeInfo& scope,
    const StyleContext& element,
    uint32_t& proximity) {
  bool crossedLimit = false;
  uint32_t hops = 0;
  for (const StyleContext* node = &element; node != nullptr;
       node = node->parent.get(), hops++) {
    if (matchesSelectorList(scope.roots, *node)) {
      proximity = hops;
      return !crossedLimit;
    }
    if (!scope.limits.empty() && matchesSelectorList(scope.limits, *node)) {
      crossedLimit = true;
    }
  }
  return false;
}

} // namespace

void RuleSet::match(
    const StyleContext& element,
    const MediaEnvironment& environment,
    std::vector<MatchedRule>& out) const {
  out.clear();
  auto consider = [&](const std::vector<uint32_t>& candidates) {
    for (uint32_t index : candidates) {
      const IndexedSelector& entry = entries_[index];
      const StyleRule& rule = *entry.rule;
      bool mediaMatches = true;
      for (const auto& media : rule.media) {
        if (!media->matches(environment)) {
          mediaMatches = false;
          break;
        }
      }
      if (!mediaMatches) {
        continue;
      }
      if (!rule.containers.empty() &&
          !containersMatch(rule, element, environment)) {
        continue;
      }
      if (!matchesSelector(*entry.selector, element)) {
        continue;
      }
      uint32_t proximity = 0;
      if (entry.selector->scope != nullptr &&
          !inScope(*entry.selector->scope, element, proximity)) {
        continue;
      }
      out.push_back({&entry, proximity});
    }
  };
  if (const std::string* id = element.attribute("id")) {
    auto found = byId_.find(*id);
    if (found != byId_.end()) {
      consider(found->second);
    }
  }
  for (const auto& name : element.classes) {
    auto found = byClass_.find(name);
    if (found != byClass_.end()) {
      consider(found->second);
    }
  }
  if (!element.tag.empty()) {
    auto found = byTag_.find(element.tag);
    if (found != byTag_.end()) {
      consider(found->second);
    }
  }
  consider(universal_);
  std::sort(
      out.begin(), out.end(), [](const MatchedRule& a, const MatchedRule& b) {
        if (a->layerRank != b->layerRank) {
          return a->layerRank < b->layerRank;
        }
        if (a->specificity != b->specificity) {
          return a->specificity < b->specificity;
        }
        // The nearer scoping root wins, so the farther one is weaker
        if (a.proximity != b.proximity) {
          return a.proximity > b.proximity;
        }
        return a->order < b->order;
      });
}

const KeyframesRule* RuleSet::keyframes(std::string_view name) const {
  auto found = keyframes_.find(std::string(name));
  return found == keyframes_.end() ? nullptr : found->second;
}

} // namespace facebook::react::cssengine
