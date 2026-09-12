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
 * Fills accessibility props from their ARIA spellings.
 *
 * `aria-label` is what a web author writes, and on an element that claims to be
 * HTML it has to work. It did not: nothing anywhere translated it, so every
 * `aria-*` attribute was silently dropped and a row whose visible content was
 * `≡ Add fifty messages` announced itself with the glyph in its name.
 *
 * FOR ELEMENTS, not for every view. The obvious place is `AccessibilityProps`
 * itself — one edit, every component — and it is the wrong one: each
 * `convertRawProp` costs about a percent of a mount, and there are a dozen here,
 * so putting them in the base would tax every `<View>` in every app for a
 * spelling only these elements accept. An element props class calls this from
 * its constructor body instead, and pays for it where the feature is.
 *
 * ARIA WINS over the `accessibility*` spelling when both are present. That is
 * what React Native's own `View.js` does, and it barely comes up: an author
 * writing these elements is writing HTML, where the other spelling does not
 * exist.
 *
 * Not covered: `aria-modal`, `aria-required` and the relationship attributes
 * beyond `labelledby`. They are not in the base view config's attribute list, so
 * they never reach the shadow node at all — adding them is a change in two
 * places, and none of them has come up.
 */
void applyAriaAttributes(const PropsParserContext &context, const RawProps &rawProps, AccessibilityProps &props);

} // namespace facebook::react
