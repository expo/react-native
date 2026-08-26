/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ShadowNodeTraits.h>

namespace facebook::react::HostPlatformViewTraitsInitializer {

inline bool formsStackingContext(const ViewProps & /*props*/)
{
  return false;
}

inline bool formsView(const ViewProps & /*props*/)
{
  return false;
}

inline bool isKeyboardFocusable(const ViewProps & /*props*/)
{
  return false;
}

/**
 * The padding a row holding an `<input type="radio">` takes by default, so its
 * content sits where a platform list row's content sits.
 *
 * A user-agent default in the only place it can be stated. A run of radios is
 * drawn as the platform's grouped list, and a list row insets its content: the
 * leading inset is what lines every row's text up with every other row's and
 * with the separator, and the trailing one is the space the checkmark accessory
 * occupies. Without them the author's content sits flush against the card's
 * edges and runs underneath the mark.
 *
 * It cannot come from the element's own stylesheet, because the box that needs
 * it is the ROW — whatever the author wrapped around the control — and no
 * selector reaches a parent. It cannot come from the mounting layer either: the
 * row's children are positioned by Yoga and cannot be re-flowed afterwards.
 *
 * MEASURED, not chosen. On iOS a list cell reserves 40 pt for an accessory at
 * the standard dimension and lays its content out inside margins of 16 and 8;
 * `EXPRadioRunList` reserves the accessory at that same width, so the two
 * cannot drift. Android has a real `RadioButton` and no list, so it takes
 * none.
 */
/**
 * Whether this platform presents a run of `<input type="radio">` as its own
 * list, and therefore treats each row as a list row.
 *
 * One predicate for the whole rule, because the parts only make sense
 * together: a row must survive flattening BECAUSE something hosts it, and it
 * takes the platform's row padding for the same reason. A platform with a real
 * radio control has an ordinary row and should pay for neither — nor for the
 * scan that decides it, which runs for every view on every commit.
 */
inline bool treatsRadioRowsAsListRows()
{
  return true;
}

struct RadioRowPadding {
  float start;
  float end;
};

inline RadioRowPadding radioRowPadding()
{
  return {16, 48};
}

} // namespace facebook::react::HostPlatformViewTraitsInitializer
