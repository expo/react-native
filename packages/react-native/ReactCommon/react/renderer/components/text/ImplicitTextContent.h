/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/core/ComponentDescriptor.h>

namespace facebook::react {

/*
 * Installs the anonymous-box factory used by `YogaLayoutableShadowNode` to
 * wrap runs of inline-level children of block containers in
 * `InlineContentShadowNode`s (implicit-text-plan.md §3.A). Idempotent; called
 * from text component descriptor constructors so the factory is guaranteed to
 * be present whenever text nodes exist in a tree.
 */
void ensureImplicitTextContentFactoryInstalled(const ComponentDescriptorParameters &parameters);

} // namespace facebook::react
