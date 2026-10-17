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
#include <unordered_map>
#include <utility>
#include <vector>

#include <folly/dynamic.h>

namespace facebook::react::cssengine {

/*
 * The custom properties in scope (css-variables-1): the ones an element
 * declares, over its parent's. Shared by every descendant until one declares
 * its own, so a declaration copies nothing it inherits.
 */
class CustomProperties {
 public:
  CustomProperties() = default;
  explicit CustomProperties(std::shared_ptr<const CustomProperties> parent) : parent_(std::move(parent)) {}

  // The value in scope, or null when nothing declared the name
  const std::string *find(const std::string &name) const
  {
    for (const CustomProperties *scope = this; scope != nullptr; scope = scope->parent_.get()) {
      auto found = scope->own_.find(name);
      if (found != scope->own_.end()) {
        return &found->second;
      }
    }
    return nullptr;
  }

  void set(std::string name, std::string value)
  {
    own_[std::move(name)] = std::move(value);
  }

  const std::unordered_map<std::string, std::string> &own() const
  {
    return own_;
  }

  const std::shared_ptr<const CustomProperties> &parent() const
  {
    return parent_;
  }

  // Every name in scope with its value, the nearest declaration winning
  std::unordered_map<std::string, std::string> flattened() const
  {
    std::unordered_map<std::string, std::string> all;
    for (const CustomProperties *scope = this; scope != nullptr; scope = scope->parent_.get()) {
      for (const auto &[name, value] : scope->own_) {
        all.emplace(name, value);
      }
    }
    return all;
  }

 private:
  std::unordered_map<std::string, std::string> own_;
  std::shared_ptr<const CustomProperties> parent_;
};

// The interaction and display states the pseudo-classes read
enum ElementState : uint32_t {
  ElementStateHover = 1u << 0,
  ElementStateActive = 1u << 1,
  ElementStateFocus = 1u << 2,
  ElementStateFocusVisible = 1u << 3,
  ElementStatePopoverOpen = 1u << 4,
  ElementStateChecked = 1u << 5,
};

/*
 * A table's column, as a cell of its first row or a `<col>` sizes it (CSS 2.1
 * §17.5.2.1): a length in points, a percentage of the table, or nothing.
 */
struct TableColumn {
  enum class Kind : uint8_t { Auto, Points, Percent };
  Kind kind{Kind::Auto};
  double value{0};

  bool operator==(const TableColumn &) const = default;
};

/*
 * What a table hands its row groups and rows: `border-spacing` in points,
 * between columns and between rows, and its columns, which the pass finds
 * after visiting the table's rows, since its first row sizes them.
 */
struct TableLayout {
  double inlineSpacing{0};
  double blockSpacing{0};
  std::vector<TableColumn> columns;

  bool operator==(const TableLayout &) const = default;
};

/*
 * One element as the style pass sees it: what selectors read of it, and what
 * it hands its descendants. An element's context points at its parent's, so
 * the chain is the ancestor list a selector walks; one whose content is
 * unchanged is the same object as before, which is how the pass knows a
 * subtree needs no restyle.
 */
struct StyleContext {
  // -- The element, as selectors read it --

  // Lowercased
  std::string tag;
  std::vector<std::string> classes;
  // Names lowercased
  std::vector<std::pair<std::string, std::string>> attributes;
  uint32_t states{0};
  // The document's root, which `:root` matches: a synthetic `html` element
  // above every surface's content
  bool isRoot{false};
  // 1-based position among the parent's element children and their number,
  // which `:first-child` and `:nth-child()` read; zero when no sheet does
  uint32_t position{0};
  uint32_t siblingCount{0};
  std::shared_ptr<const StyleContext> parent;
  // Only when a sheet reads siblings (`+`, `~`)
  std::shared_ptr<const StyleContext> previousSibling;
  // The later element siblings, nearest first: set for a query only, where
  // the whole tree is committed, so `:nth-last-child(… of S)` is answerable
  std::shared_ptr<const std::vector<std::shared_ptr<const StyleContext>>> followingSiblings;

  // -- What it hands its descendants --

  std::shared_ptr<const CustomProperties> customProperties;
  // The computed font size in points, which `em` lengths resolve against
  double fontSize{16};
  // The computed `line-height` (css-inline-3 §2.4), which `lh` lengths
  // resolve against: a number stays a multiplier of each element's own font
  // size as it inherits, a length or percentage is the length it computed to,
  // and neither is set for `normal`
  std::optional<double> lineHeightFactor;
  std::optional<double> lineHeightLength;
  // The computed `color` as a CSS colour, which `currentColor` means
  std::string color{"black"};
  bool rtl{false};
  // Whether the element's display is flex or grid, which makes its children
  // items whose display is blockified (css-display-3 §2.7)
  bool laysOutItems{false};
  // Whether the element or an ancestor clips its block axis (`overflow-y:
  // hidden | clip`), past which a region below that grows to its content
  // would be cut off rather than reach the page
  bool clipsBlockBelow{false};
  // The names this element is a query container under (css-contain-3 §2),
  // `""` for an unnamed one; empty when it is none
  std::vector<std::string> containerNames;
  // For a scroll container, the props of the element inside the platform's
  // scroll view, which lays out its children
  std::shared_ptr<const folly::dynamic> scrollContent;
  // The `vertical-align` a table row or row group gives the cells that state
  // none, as the user agent's `td, th { vertical-align: inherit }` does
  std::string cellAlign;
  // On a table and its row groups, the layout its rows take their columns
  // and spacing from; null on everything else
  std::shared_ptr<const TableLayout> tableLayout;
  // The element's props as the pass wrote them, which `inherit` on a
  // property that does not inherit copies from; kept only while a sheet or
  // style says `inherit` on one
  std::shared_ptr<const folly::dynamic> computed;
  // `color-scheme` as declared, which inherits, and the scheme it comes to
  // under the device's preference: what `light-dark()` picks by
  // (css-color-adjust-1 §2)
  std::string colorScheme{"normal"};
  bool darkScheme{false};
  // Whether the element generates no box (`display: none`, its own or an
  // ancestor's): nothing in it is drawn, so nothing in it is styled
  bool hidden{false};
  // Whether `pointer-events: none` is in force here (CSS inherits it): a
  // descendant that declares nothing is no target either, so it is written
  // `box-none`; one that declares `auto` is a target again
  bool pointerEventsNone{false};

  const std::string *attribute(std::string_view name) const
  {
    for (const auto &[key, value] : attributes) {
      if (key == name) {
        return &value;
      }
    }
    return nullptr;
  }

  bool hasClass(std::string_view name) const
  {
    for (const auto &value : classes) {
      if (value == name) {
        return true;
      }
    }
    return false;
  }
};

using SharedStyleContext = std::shared_ptr<const StyleContext>;

} // namespace facebook::react::cssengine
