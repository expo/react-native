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
 * What a mounted control says it wants to be.
 *
 * Several form controls are sized by something only the CONTROL knows, and in
 * each case the shadow tree was given a fixed number instead:
 *
 *   `<input type=file>`  reads "Choose File" until a file is picked and then
 *                        the name or a count — and that count arrives from the
 *                        picker, on the platform, never through props.
 *   `<input type=date>`  a compact `UIDatePicker` is as wide as the value it
 *                        is showing, in the mode it is in.
 *   `<input type=text>`  a text field's height is the platform's, not a number
 *                        anyone here should be choosing.
 *
 * None of those is answerable from props, so each was papered over with a
 * constant: wide enough for the longest case anyone expected, and a lie about
 * every other one.
 *
 * The control answers instead. It knows its content and its own chrome, so it
 * is asked for its intrinsic size and reports it here — which is the same
 * question a browser answers by shrink-to-fitting a control to its contents.
 * Nothing is re-derived from a font: no text engine, no chrome constant, no
 * allowance for the two disagreeing.
 */
class ElementControlSizeState final {
 public:
#ifdef ANDROID
  ElementControlSizeState() = default;

  ElementControlSizeState(const ElementControlSizeState& /*previousState*/, folly::dynamic data)
      : width((Float)data["width"].getDouble()), height((Float)data["height"].getDouble()) {};

  folly::dynamic getDynamic() const
  {
    return folly::dynamic::object("width", (double)width)("height", (double)height);
  }
#endif

  /*
   * Zero means the control has not reported yet — no view is mounted on the
   * very first layout, which happens before mounting by construction. Layout
   * falls back to what a real button measured at startup for the default
   * title, so the first frame is the platform's answer too rather than a
   * placeholder that then jumps.
   */
  Float width{0};
  Float height{0};
};

/*
 * The control's own answer once it has one, and what a real control measured
 * at startup until then.
 *
 * The first layout runs before any view exists — mounting follows it — so
 * without a startup fallback the control would appear at one size and resize
 * on its first frame. Shared so that "has the control answered yet" is decided
 * once rather than per element, which is exactly the kind of rule that drifts
 * when it is written out four times.
 */
inline Size elementControlMeasuredSize(
    const ElementControlSizeState& reported,
    Size startupFallback,
    const LayoutConstraints& layoutConstraints)
{
  const auto size = reported.width > 0 && reported.height > 0
      ? Size{reported.width, reported.height}
      : startupFallback;
  return layoutConstraints.clamp(size);
}

} // namespace facebook::react
