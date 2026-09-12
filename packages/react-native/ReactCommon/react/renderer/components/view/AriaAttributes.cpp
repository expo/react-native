/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "AriaAttributes.h"

#include <react/renderer/components/view/accessibilityPropsConversions.h>
#include <react/renderer/core/propsConversions.h>

#include <cstdlib>
#include <optional>
#include <string>

namespace facebook::react {

// Whether an ARIA attribute was written at all: `convertRawProp` returns the
// source value for an absent prop, so it cannot tell `aria-selected="false"`
// from no `aria-selected`
static bool has(const RawProps& rawProps, const char* name) {
  const auto* value = rawProps.at(name);
  return value != nullptr && value->hasValue();
}

// An ARIA true/false state as markup writes it, a boolean or the attribute's
// own `"true"` or `"false"` (wai-aria-1.2 §6.2); `undefined` or anything else
// states nothing
static std::optional<bool> ariaBoolean(
    const RawProps& rawProps,
    const char* name) {
  const auto* value = rawProps.at(name);
  if (value == nullptr || !value->hasValue()) {
    return std::nullopt;
  }
  if (value->hasType<bool>()) {
    return (bool)*value;
  }
  if (value->hasType<std::string>()) {
    const auto text = (std::string)*value;
    if (text == "true") {
      return true;
    }
    if (text == "false") {
      return false;
    }
  }
  return std::nullopt;
}

// An ARIA number as markup writes it, a number or its digits
static std::optional<int> ariaInteger(
    const RawProps& rawProps,
    const char* name) {
  const auto* value = rawProps.at(name);
  if (value == nullptr || !value->hasValue()) {
    return std::nullopt;
  }
  if (value->hasType<double>()) {
    return static_cast<int>((double)*value);
  }
  if (value->hasType<std::string>()) {
    const auto text = (std::string)*value;
    char* end = nullptr;
    const double number = std::strtod(text.c_str(), &end);
    if (end != text.c_str() && *end == '\0') {
      return static_cast<int>(number);
    }
  }
  return std::nullopt;
}

void applyAriaAttributes(
    const PropsParserContext& context,
    const RawProps& rawProps,
    AccessibilityProps& props) {
  // An absent `aria-label` leaves what the `accessibility*` spelling produced
  props.accessibilityLabel = convertRawProp(
      context,
      rawProps,
      "aria-label",
      props.accessibilityLabel,
      props.accessibilityLabel);

  if (has(rawProps, "aria-labelledby")) {
    props.accessibilityLabelledBy = convertRawProp(
        context,
        rawProps,
        "aria-labelledby",
        props.accessibilityLabelledBy,
        props.accessibilityLabelledBy);
  }

  // `aria-hidden` is three props: `accessibilityElementsHidden` on iOS,
  // `importantForAccessibility` on Android, and `accessible` false as well on
  // iOS, or the view stays an element with a hidden subtree
  if (auto ariaHidden = ariaBoolean(rawProps, "aria-hidden")) {
    const bool hidden = *ariaHidden;
    props.accessibilityElementsHidden = hidden;
    if (hidden) {
      props.accessible = false;
      props.importantForAccessibility =
          ImportantForAccessibility::NoHideDescendants;
    }
  }

  // Read individually: an element can say `aria-disabled` and nothing else, and
  // the rest must keep whatever `accessibilityState` gave them
  if (has(rawProps, "aria-busy") || has(rawProps, "aria-checked") ||
      has(rawProps, "aria-disabled") || has(rawProps, "aria-expanded") ||
      has(rawProps, "aria-selected")) {
    AccessibilityState state =
        props.accessibilityState.value_or(AccessibilityState{});
    state.busy = ariaBoolean(rawProps, "aria-busy").value_or(state.busy);
    state.disabled =
        ariaBoolean(rawProps, "aria-disabled").value_or(state.disabled);
    if (auto selected = ariaBoolean(rawProps, "aria-selected")) {
      state.selected = *selected;
    }
    if (has(rawProps, "aria-expanded")) {
      state.expanded = ariaBoolean(rawProps, "aria-expanded").value_or(false);
    }
    if (has(rawProps, "aria-checked")) {
      const auto* raw = rawProps.at("aria-checked");
      // `mixed` is ARIA's third value, a string among booleans
      if (raw->hasType<std::string>() && (std::string)*raw == "mixed") {
        state.checked = AccessibilityState::Mixed;
      } else if (auto checked = ariaBoolean(rawProps, "aria-checked")) {
        state.checked = *checked ? AccessibilityState::Checked
                                 : AccessibilityState::Unchecked;
      } else {
        state.checked = AccessibilityState::None;
      }
    }
    props.accessibilityState = state;
  }

  if (has(rawProps, "aria-live")) {
    props.accessibilityLiveRegion = convertRawProp(
        context,
        rawProps,
        "aria-live",
        props.accessibilityLiveRegion,
        AccessibilityLiveRegion::None);
  }

  // One struct here, four attributes in ARIA
  if (has(rawProps, "aria-valuemin") || has(rawProps, "aria-valuemax") ||
      has(rawProps, "aria-valuenow") || has(rawProps, "aria-valuetext")) {
    AccessibilityValue value = props.accessibilityValue;
    if (auto min = ariaInteger(rawProps, "aria-valuemin")) {
      value.min = min;
    }
    if (auto max = ariaInteger(rawProps, "aria-valuemax")) {
      value.max = max;
    }
    if (auto now = ariaInteger(rawProps, "aria-valuenow")) {
      value.now = now;
    }
    value.text = convertRawProp(
        context, rawProps, "aria-valuetext", value.text, value.text);
    props.accessibilityValue = value;
  }
}

} // namespace facebook::react
