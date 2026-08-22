/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/debug/react_native_assert.h>
#include <react/renderer/components/view/BaseViewProps.h>
#include <react/renderer/core/ShadowNode.h>

namespace facebook::react {

/*
 * The view-like props a node carries, or null when it is not a view.
 *
 * Answered from the node's `ViewKind` trait rather than with a `dynamic_cast`:
 * the cascade asks on every clone and on every layout-configure pass, and RTTI
 * casts are measurable at that rate. `ConcreteViewShadowNode` is the one place
 * that sets the trait and the one place that fixes the props type, so the two
 * cannot disagree — and the assertion below says so out loud, because a future
 * node that sets the trait by hand would otherwise get a bad `static_cast`
 * instead of a null.
 *
 * This lives in `components/view` because that is where `BaseViewProps` lives.
 * Asking `Props` itself would have `core` naming a component's type.
 */
inline const BaseViewProps* viewPropsOf(const ShadowNode& node) {
  const auto isView = node.getTraits().check(ShadowNodeTraits::Trait::ViewKind);
  react_native_assert(
      (!isView ||
       dynamic_cast<const BaseViewProps*>(node.getProps().get()) != nullptr) &&
      "ViewKind must imply the props are BaseViewProps");
  return isView ? static_cast<const BaseViewProps*>(node.getProps().get())
                : dynamic_cast<const BaseViewProps*>(node.getProps().get());
}

} // namespace facebook::react
