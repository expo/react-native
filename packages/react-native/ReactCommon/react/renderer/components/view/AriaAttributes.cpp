/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "AriaAttributes.h"

#include <react/renderer/components/view/accessibilityPropsConversions.h>
#include <react/renderer/core/propsConversions.h>

namespace facebook::react {

// Whether an ARIA attribute was written at all: `convertRawProp` returns the
// source value for an absent prop, so it cannot tell `aria-selected="false"`
// from no `aria-selected`
static bool has(const RawProps& rawProps, const char* name) {
  const auto* value = rawProps.at(name);
  return value != nullptr && value->hasValue();
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
  if (has(rawProps, "aria-hidden")) {
    const bool hidden =
        convertRawProp(context, rawProps, "aria-hidden", false, false);
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
    state.busy =
        convertRawProp(context, rawProps, "aria-busy", state.busy, state.busy);
    state.disabled = convertRawProp(
        context, rawProps, "aria-disabled", state.disabled, state.disabled);
    state.selected = convertRawProp(
        context, rawProps, "aria-selected", state.selected, state.selected);
    if (has(rawProps, "aria-expanded")) {
      state.expanded =
          convertRawProp(context, rawProps, "aria-expanded", false, false);
    }
    if (has(rawProps, "aria-checked")) {
      const auto* raw = rawProps.at("aria-checked");
      // `mixed` is ARIA's third value, a string among booleans
      if (raw->hasType<std::string>() && (std::string)*raw == "mixed") {
        state.checked = AccessibilityState::Mixed;
      } else if (raw->hasType<bool>()) {
        state.checked = (bool)*raw ? AccessibilityState::Checked
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
    value.min = convertRawProp(
        context, rawProps, "aria-valuemin", value.min, value.min);
    value.max = convertRawProp(
        context, rawProps, "aria-valuemax", value.max, value.max);
    value.now = convertRawProp(
        context, rawProps, "aria-valuenow", value.now, value.now);
    value.text = convertRawProp(
        context, rawProps, "aria-valuetext", value.text, value.text);
    props.accessibilityValue = value;
  }
}

} // namespace facebook::react
