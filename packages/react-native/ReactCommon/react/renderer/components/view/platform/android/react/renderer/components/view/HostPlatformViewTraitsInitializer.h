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

inline bool formsStackingContext(const ViewProps &viewProps)
{
  return viewProps.elevation != 0;
}

inline bool formsView(const ViewProps &viewProps)
{
  return viewProps.nativeBackground.has_value() || viewProps.nativeForeground.has_value() || viewProps.focusable ||
      viewProps.needsOffscreenAlphaCompositing || viewProps.renderToHardwareTextureAndroid ||
      viewProps.screenReaderFocusable;
}

inline bool isKeyboardFocusable(const ViewProps &viewProps)
{
  return viewProps.focusable;
}

/**
 * The padding a row holding an `<input type="radio">` takes by default, so its
 * content sits where a platform list row's content sits: the leading inset
 * lines every row's text up with the separator and the trailing one holds the
 * checkmark accessory. Stated here because the box that needs it is the row,
 * which no selector reaches from the element, and Yoga has positioned the row's
 * children before the mounting layer could inset them.
 *
 * None here: Android has a real `RadioButton` and draws no list.
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
  return {0, 0};
}

} // namespace facebook::react::HostPlatformViewTraitsInitializer
