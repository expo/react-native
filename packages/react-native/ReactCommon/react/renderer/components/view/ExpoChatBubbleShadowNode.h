/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once


#include <string>

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>

namespace facebook::react {

extern const char ExpoChatBubbleComponentName[];

/**
 * How far below the body a tail hangs, in points.
 *
 * Measured off a real balloon: the body's bottom edge is at 405.95 and the
 * tail's lowest ink at 412.57, so 6.62 — and the same balloon without a tail is
 * 40.1 tall where the one with a tail is 46.7. The difference IS this number,
 * and it is the only thing a tail costs. It costs no width at all.
 *
 * The value here is 6.65 rather than that 6.62, and the three hundredths are not
 * slop: the curve fitted to those samples has its own extreme at 6.649, a little
 * past the lowest place the tracing could resolve at 3x. The reserve has to
 * cover what is DRAWN, or the mask clips the tip — which is how the difference
 * was found, by a test on a balloon small enough for a hundredth to matter.
 *
 * Stated here, next to the layout that reserves it, rather than in the renderer
 * that draws it: the reserve and the drawing have to agree, and a constant in
 * two places is a constant that will not.
 */
inline constexpr Float kExpoChatBubbleTailDrop = 6.65f;

/**
 * The corner radius a balloon uses unless the author asks for another.
 *
 * CIRCULAR rather than continuous, which the platform's own balloon artwork
 * settles: its corner is drawn with control points 9.665 from the endpoints of
 * a 17.5 radius, and 9.665/17.5 = 0.55228, the circle's kappa to five places.
 *
 * Twenty is not a constant the platform states — it is what its RULE produces
 * at the default text size, and the rule is:
 *
 *     balloonCornerRadius = balloonPillMinHeight * 0.5
 *
 * where `balloonPillMinHeight` is the height of a ONE-LINE balloon in the
 * balloon font. So the radius is half the smallest balloon there can be, which
 * makes that balloon exactly a capsule and gives every taller one the same
 * corner — and it follows the font rather than staying put. A caller whose text
 * is not seventeen points should pass its own, computed the same way: half of
 * one line plus the balloon's vertical padding.
 */
inline constexpr Float kExpoChatBubbleRadius = 20.0f;

class ExpoChatBubbleProps final : public ViewProps {
 public:
  ExpoChatBubbleProps() = default;
  ExpoChatBubbleProps(
      const PropsParserContext& context,
      const ExpoChatBubbleProps& sourceProps,
      const RawProps& rawProps)
      : ViewProps(context, sourceProps, rawProps),
        tail(convertRawProp(context, rawProps, "tail", sourceProps.tail, std::string{})),
        bubbleRadius(convertRawProp(
            context,
            rawProps,
            "bubbleRadius",
            sourceProps.bubbleRadius,
            Float{kExpoChatBubbleRadius})),
        tailBasePadding(convertRawProp(
            context,
            rawProps,
            "tailBasePadding",
            sourceProps.tailBasePadding,
            Float{0}))
  {
  }

  /**
   * Which side the tail is on: `"leading"`, `"trailing"`, or empty for none.
   *
   * Sides rather than left and right because a balloon's tail is on the side the
   * message came from, and which side that is depends on the writing direction.
   * The view resolves it against the layout direction it is given.
   */
  std::string tail{};

  /**
   * The corner radius, clamped by the renderer to half the BODY's shorter side.
   *
   * Its own property rather than `border-radius` because the body and the tail
   * are one path: a tail drawn for one radius against a body drawn for another
   * meets it at a visible step, so the shape has to be described once. An
   * element that asks for a tail is asking for this shape.
   */
  Float bubbleRadius{kExpoChatBubbleRadius};

  /**
   * The element's OWN bottom padding, without the tail's reserve.
   *
   * The tail hangs below the body, so a tailed balloon reserves
   * `kExpoChatBubbleTailDrop` of `padding-bottom` for it — and that reserve is
   * what a tail's arrival or departure animates, because `padding-bottom` is a
   * transitionable property. Given the base, the view can read the reserve out
   * of the padding it currently has:
   *
   *     amount = (paddingBottom - tailBasePadding) / kExpoChatBubbleTailDrop
   *
   * and draw a tail of exactly that size. One animated quantity, and a shape
   * that is a function of the geometry rather than a second animation kept in
   * step with it. See `EXPChatBubblePath`.
   */
  Float tailBasePadding{0};

};

/**
 * `<native:chatbubble>` — a chat balloon's SURFACE: the shape, and nothing else.
 *
 * The surface, not the box, and that division is deliberate. A balloon's text
 * must not reflow while the balloon is animating — the native balloon animates a mask
 * behind a label that never moves, and a spring that undershoots turned a
 * four-character message into a one-character-per-line sliver when the box
 * itself was the thing being animated. So the box lays out the text and this
 * absolutely-positioned sibling behind it carries the shape and takes the
 * animation.
 *
 * One path draws every balloon, tailed or not. While only the tailed case
 * reached a mask and the tailless one fell through to `border-radius`, the two
 * had visibly different corners in the same conversation.
 *
 * The tail costs HEIGHT and nothing else: it hangs `kExpoChatBubbleTailDrop`
 * below the body, inside the same width. The reserve for it is bottom padding on
 * the BOX, which this element cannot take because it is not the box — the
 * `NativeChatBubble` component owns both and takes it there, which is why an app
 * writes the component rather than this element directly.
 */
using ExpoChatBubbleShadowNode =
    ConcreteViewShadowNode<ExpoChatBubbleComponentName, ExpoChatBubbleProps, ViewEventEmitter>;

using ExpoChatBubbleComponentDescriptor = ConcreteComponentDescriptor<ExpoChatBubbleShadowNode>;

} // namespace facebook::react
