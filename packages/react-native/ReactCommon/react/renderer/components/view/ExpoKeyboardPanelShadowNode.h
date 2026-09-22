/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>

namespace facebook::react {

extern const char ExpoKeyboardPanelComponentName[];

/*
 * Its own props type rather than `ViewProps`, for the same reason the accessory
 * has one: `RCTViewComponentView` asserts that a subclass's props are not
 * literally `ViewProps`, and reusing them mounts and then dies on launch.
 */
class ExpoKeyboardPanelProps final : public ViewProps {
 public:
  ExpoKeyboardPanelProps() = default;
  ExpoKeyboardPanelProps(
      const PropsParserContext& context,
      const ExpoKeyboardPanelProps& sourceProps,
      const RawProps& rawProps)
      : ViewProps(context, sourceProps, rawProps),
        visible(convertRawProp(context, rawProps, "visible", sourceProps.visible, false)),
        presentation(
            convertRawProp(context, rawProps, "presentation", sourceProps.presentation, std::string{})),
        anchorX(convertRawProp(context, rawProps, "anchorX", sourceProps.anchorX, Float{0})),
        anchorY(convertRawProp(context, rawProps, "anchorY", sourceProps.anchorY, Float{0})),
        anchorWidth(convertRawProp(context, rawProps, "anchorWidth", sourceProps.anchorWidth, Float{0})),
        anchorHeight(convertRawProp(context, rawProps, "anchorHeight", sourceProps.anchorHeight, Float{0}))
  {
  }

  /**
   * Whether the panel is TAKING THE KEYBOARD'S PLACE.
   *
   * Not "is it on screen": the panel is the responder's `inputView`, so raising
   * it is the same act as raising a keyboard and the system runs the same
   * transition. Which is the whole reason to do it this way — a panel drawn
   * over the keyboard would have to imitate that transition, and imitating it
   * is what makes a panel feel bolted on.
   */
  bool visible{false};

  /**
   * How the panel is put on screen. Empty — the default — is `inputView`.
   *
   * `inputView` REPLACES the keyboard, as above. `overlay` puts the panel over
   * the app's own content, anchored to a button and growing out of it.
   *
   * `overlay` does NOT cover the keys, and nothing does. An app's `windowLevel`
   * is clamped to 10000000 and the keyboard's window sits at 10000001 — asked
   * for 10000002, a window comes back at 10000000 and draws underneath them.
   * (Measured with `~/Developer/probes/windowprobe`, which puts a band in a
   * window at each level and photographs the result. An earlier note here said
   * a window at level 100000000 was "still behind them, so no level exists";
   * the level it actually got was 10000000, so what it had measured was the
   * clamp rather than the compositing.) With the keyboard up, an overlay panel
   * has only the space above the keys to live in.
   *
   * So the choice is about how much room the panel needs. A panel that wants
   * the keyboard's space — an alternative input, or any card taller than what
   * is left above the keys — has to be an `inputView`, which is not limited to
   * a keyboard's height: the composer demo's 452-point card is one, against the
   * 336 a keyboard gets. `overlay` is for a panel small enough to sit in the
   * remaining space, which is where the platform puts a menu too.
   */
  std::string presentation{};

  /**
   * The rectangle an `overlay` panel grows out of, in window coordinates.
   *
   * Supplied by the app, because the button that opens a panel is the app's and
   * nothing native can find it. Zero means "no anchor": the panel is then
   * centred in the space above the keyboard rather than pointed at anything.
   */
  Float anchorX{0};
  Float anchorY{0};
  Float anchorWidth{0};
  Float anchorHeight{0};
};

/**
 * `onClose` — the panel dismissed ITSELF.
 *
 * An overlay panel is dismissed by tapping outside it, and the app has to hear
 * about it: `visible` is the app's state, so a panel that vanished without
 * saying so would leave that state saying it is still open, and the button
 * would then need pressing twice.
 */
class ExpoKeyboardPanelEventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  void onClose() const
  {
    dispatchEvent("close");
  }
};

/*
 * `<native:keyboardpanel>` — a panel that REPLACES the keyboard.
 *
 * The native chat's `+` opens one: the keys go away, a panel takes their place,
 * and the composer stays where it is. UIKit has a primitive for exactly that —
 * `UIResponder.inputView` — and using it means the system owns the animation,
 * the height, the safe area and the dismissal, none of which have to be
 * reproduced.
 *
 * It is a sibling of the accessory rather than a child of it: the accessory is
 * what rides ABOVE the keyboard and the panel is what stands IN for it. Two
 * different slots on the same responder.
 */
using ExpoKeyboardPanelShadowNode = ConcreteViewShadowNode<
    ExpoKeyboardPanelComponentName,
    ExpoKeyboardPanelProps,
    ExpoKeyboardPanelEventEmitter>;

using ExpoKeyboardPanelComponentDescriptor = ConcreteComponentDescriptor<ExpoKeyboardPanelShadowNode>;

} // namespace facebook::react
