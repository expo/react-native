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
 * `InlineContentShadowNode`s. Idempotent; called from the paragraph component
 * descriptor's constructor, which every app registers, so the factory is
 * present whenever a tree can contain a block container.
 */
void ensureAnonymousTextContentFactoryInstalled(const ComponentDescriptorParameters &parameters);

} // namespace facebook::react
