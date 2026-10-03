/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <string>

namespace facebook::react {

/*
 * Generic seam for a component to override the DOM `nodeName`/`tagName` it
 * reports through the DOM APIs. A Props type implements this when its rendered
 * tag differs from its registered component name — e.g. HTMLUnknownElement,
 * where many authored lowercase tags share one "unknown" component but each must
 * report its own authored name.
 *
 * `DOM::getTagName` consults this via a cross-cast, so RN core reports the right
 * name without knowing about any specific intrinsic element; the implementation
 * lives in the intrinsic-component module (e.g. expo-intrinsics).
 */
struct NodeNameProvider {
  virtual ~NodeNameProvider() = default;

  /*
   * The DOM node name to report, without the "RN:" prefix core adds. Return an
   * empty string to defer to the component name.
   */
  virtual std::string domNodeName() const = 0;
};

} // namespace facebook::react
