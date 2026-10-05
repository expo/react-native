/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/graphics/Float.h>

#ifdef ANDROID
#include <folly/dynamic.h>
#endif

namespace facebook::react {

/*
 * What a mounted control says it wants to be, for the controls sized by
 * something only the control knows: a file input's picked title, a compact
 * `UIDatePicker`'s value, a text field's platform height.
 */
class ElementControlSizeState final {
 public:
#ifdef ANDROID
  ElementControlSizeState() = default;

  ElementControlSizeState(const ElementControlSizeState & /*previousState*/, folly::dynamic data)
      : width((Float)data["width"].getDouble()), height((Float)data["height"].getDouble()) {};

  folly::dynamic getDynamic() const
  {
    return folly::dynamic::object("width", (double)width)("height", (double)height);
  }
#endif

  // Zero until the control reports; the first layout runs before any view is
  // mounted
  Float width{0};
  Float height{0};
};

// The control's answer once it has one, and the startup probe's until then,
// so the first frame does not resize
inline Size elementControlMeasuredSize(
    const ElementControlSizeState &reported,
    Size startupFallback,
    const LayoutConstraints &layoutConstraints)
{
  const auto size = reported.width > 0 && reported.height > 0 ? Size{reported.width, reported.height} : startupFallback;
  return layoutConstraints.clamp(size);
}

} // namespace facebook::react
