/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/cxxstableapi/UmbrellaGuard.h>

#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ShadowNodeTraits.h>

namespace facebook::react::HostPlatformViewTraitsInitializer {

inline bool formsStackingContext(const ViewProps &props)
{
  return false;
}

inline bool formsView(const ViewProps &props)
{
  return false;
}

inline bool isKeyboardFocusable(const ViewProps & /*props*/)
{
  return false;
}

/**
 * The padding a row holding an `<input type="radio">` takes by default, so its
 * content sits where a platform list row's content sits: the leading inset
 * lines every row's text up with the separator and the trailing one holds the
 * checkmark accessory. Stated here because the box that needs it is the row,
 * which no selector reaches from the element, and Yoga has positioned the row's
 * children before the mounting layer could inset them.
 *
 * None here: tvOS drives selection with focus, so there is no accessory to
 * leave room for.
 */
/**
 * Whether this platform presents a run of `<input type="radio">` as its own
 * list and so treats each row as a list row: the row survives flattening
 * because something hosts it, and takes the platform's row padding for the same
 * reason. A platform with a real radio control pays for neither, nor for the
 * scan that decides it, which runs for every view on every commit.
 */
inline bool treatsRadioRowsAsListRows()
{
  return false;
}

struct RadioRowPadding {
  float start;
  float end;
};

inline RadioRowPadding radioRowPadding()
{
  // tvOS selects with focus, so a radio row is an ordinary row
  return {0, 0};
}

} // namespace facebook::react::HostPlatformViewTraitsInitializer
