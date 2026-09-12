/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/AccessibilityProps.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>

namespace facebook::react {

/**
 * Fills accessibility props from their ARIA spellings. Called from each element
 * props class's constructor rather than from `AccessibilityProps`, because each
 * `convertRawProp` costs about a percent of a mount and only elements accept
 * these spellings. ARIA wins over the `accessibility*` spelling when both are
 * present, as React Native's `View.js` does. Not covered: `aria-modal`,
 * `aria-required` and the relationship attributes beyond `labelledby`, which
 * are not in the base view config's attribute list and never reach the node.
 */
void applyAriaAttributes(const PropsParserContext &context, const RawProps &rawProps, AccessibilityProps &props);

} // namespace facebook::react
