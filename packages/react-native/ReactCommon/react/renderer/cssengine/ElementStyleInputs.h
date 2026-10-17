/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include <folly/dynamic.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>

namespace facebook::react {

/*
 * What an HTML element hands the style engine: everything selectors and the
 * cascade read, and nothing resolved. Parsed with the element's props, so a
 * style pass reads it without touching JavaScript.
 */
struct ElementStyleInputs {
  ElementStyleInputs() = default;
  ElementStyleInputs(const PropsParserContext &context, const ElementStyleInputs &source, const RawProps &rawProps);

  // Whether the engine styles this element at all
  bool styled{false};
  // The tag selectors see, for an element whose component reports none of
  // its own (a text field is `input`); empty to take the component's
  std::string tag;
  // The class attribute, split
  std::vector<std::string> classes;
  // The attributes selectors can name, names lowercased
  std::vector<std::pair<std::string, std::string>> attributes;
  // A registered StyleX style, 0 for none
  int64_t styleId{0};
  // An inline style, as ordered `[property, value]` entries
  folly::dynamic inlineStyle{nullptr};
  // `ElementState` bits: hover, active, focus, popover-open, …
  uint32_t states{0};
  // Whether the engine keeps the element's hover, active and focus states
  // from its pointer and focus events, for styles that read them; the
  // element listens for those events
  bool stateful{false};
  // SVG's presentation attributes (`width`, `height`) as ordered entries,
  // which sit under every rule (SVG 2 §6.6)
  folly::dynamic presentationalStyle{nullptr};
  // The element's part in a scroll container the runtime builds around it:
  // the box that scrolls sideways (1) or in the block axis (2), whose
  // children's layout moves to its content (3), the element just inside the
  // platform's scroll view
  uint8_t scrollPart{0};
};

namespace elementstyleinputs_detail {

inline std::vector<std::string> splitClasses(const std::string &value)
{
  std::vector<std::string> classes;
  size_t i = 0;
  while (i < value.size()) {
    while (i < value.size() && std::isspace(static_cast<unsigned char>(value[i]))) {
      i++;
    }
    size_t start = i;
    while (i < value.size() && !std::isspace(static_cast<unsigned char>(value[i]))) {
      i++;
    }
    if (i > start) {
      std::string name = value.substr(start, i - start);
      if (std::find(classes.begin(), classes.end(), name) == classes.end()) {
        classes.push_back(std::move(name));
      }
    }
  }
  return classes;
}

// An attribute's value as the DOM reads it: a string; `true` for a boolean
// attribute that is present, which reads as empty; `false` and null for one
// that is absent
inline std::vector<std::pair<std::string, std::string>> parseAttributes(const folly::dynamic &object)
{
  std::vector<std::pair<std::string, std::string>> attributes;
  if (!object.isObject()) {
    return attributes;
  }
  for (const auto &[key, value] : object.items()) {
    if (!key.isString() || value.isNull() || (value.isBool() && !value.asBool())) {
      continue;
    }
    std::string name = key.asString();
    for (char &c : name) {
      c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    std::string text;
    if (value.isString()) {
      text = value.asString();
    } else if (value.isBool()) {
      text = "";
    } else if (value.isNumber()) {
      text = value.asString();
    } else {
      continue;
    }
    attributes.emplace_back(std::move(name), std::move(text));
  }
  return attributes;
}

} // namespace elementstyleinputs_detail

inline ElementStyleInputs::ElementStyleInputs(
    const PropsParserContext & /*context*/,
    const ElementStyleInputs &source,
    const RawProps &rawProps)
    : ElementStyleInputs(source)
{
  if (const RawValue *value = rawProps.at("cssEngine", nullptr, nullptr)) {
    styled = value->hasType<bool>() && static_cast<bool>(*value);
  }
  if (const RawValue *value = rawProps.at("cssTag", nullptr, nullptr)) {
    tag = value->hasType<std::string>() ? static_cast<std::string>(*value) : std::string();
  }
  if (const RawValue *value = rawProps.at("cssClass", nullptr, nullptr)) {
    classes = value->hasType<std::string>() ? elementstyleinputs_detail::splitClasses(static_cast<std::string>(*value))
                                            : std::vector<std::string>{};
  }
  if (const RawValue *value = rawProps.at("cssAttributes", nullptr, nullptr)) {
    attributes = elementstyleinputs_detail::parseAttributes(static_cast<folly::dynamic>(*value));
  }
  if (const RawValue *value = rawProps.at("cssStyle", nullptr, nullptr)) {
    styleId = value->hasType<int64_t>() ? static_cast<int64_t>(*value) : int64_t{0};
  }
  if (const RawValue *value = rawProps.at("cssInline", nullptr, nullptr)) {
    inlineStyle = static_cast<folly::dynamic>(*value);
  }
  if (const RawValue *value = rawProps.at("cssStates", nullptr, nullptr)) {
    states = value->hasType<int>() ? static_cast<uint32_t>(static_cast<int>(*value)) : 0u;
  }
  if (const RawValue *value = rawProps.at("cssStateful", nullptr, nullptr)) {
    stateful = value->hasType<bool>() && static_cast<bool>(*value);
  }
  if (const RawValue *value = rawProps.at("cssPresentational", nullptr, nullptr)) {
    presentationalStyle = static_cast<folly::dynamic>(*value);
  }
  if (const RawValue *value = rawProps.at("cssScroll", nullptr, nullptr)) {
    scrollPart = value->hasType<int>() ? static_cast<uint8_t>(static_cast<int>(*value)) : uint8_t{0};
  }
}

/*
 * Implemented by the props of every element the engine styles.
 */
struct ElementStyleInputsProvider {
  virtual ~ElementStyleInputsProvider() = default;
  virtual const ElementStyleInputs &elementStyleInputs() const = 0;
};

} // namespace facebook::react
