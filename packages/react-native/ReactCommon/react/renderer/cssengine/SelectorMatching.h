/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/cssengine/StyleContext.h>
#include <react/renderer/cssengine/StyleSheet.h>

namespace facebook::react::cssengine {

/*
 * Whether `element` matches the selector as its subject (selectors-4 §3),
 * reading its ancestors and earlier siblings through the context chain.
 */
bool matchesSelector(const ComplexSelector &selector, const StyleContext &element);

bool matchesSelectorList(const SelectorList &list, const StyleContext &element);

/*
 * Whether `element` satisfies one compound on its own, as a StyleX
 * conditional key such as `:is(:disabled, [aria-disabled="true"])` asks.
 */
bool matchesCompound(const CompoundSelector &compound, const StyleContext &element);

/*
 * Whether `element` could match one compound in some state: its tag, ids,
 * classes and attributes, its pseudo-classes not asked.
 */
bool compoundCouldMatch(const CompoundSelector &compound, const StyleContext &element);

} // namespace facebook::react::cssengine
