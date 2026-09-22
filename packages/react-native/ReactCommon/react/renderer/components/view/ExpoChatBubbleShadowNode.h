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
 * How far below the body a tail hangs, in points: measured off the platform's
 * balloon (6.62 between the body's bottom edge and the tail's lowest ink), with
 * the fitted curve's own extreme at 6.649, which the reserve has to cover or the
 * mask clips the tip. The tail costs this height and no width. Stated next to
 * the layout that reserves it so the reserve and the drawing cannot disagree.
 */
inline constexpr Float kExpoChatBubbleTailDrop = 6.65f;

/**
 * The corner radius a balloon uses unless the author asks for another. Circular
 * rather than continuous, as the platform's balloon artwork is (control points
 * 9.665 from the endpoints of a 17.5 radius, the circle's kappa). Twenty is
 * what the platform's rule produces at the default text size,
 *     balloonCornerRadius = balloonPillMinHeight * 0.5
 * half the height of a one-line balloon; a caller whose text is not seventeen
 * points should pass its own, computed the same way.
 */
inline constexpr Float kExpoChatBubbleRadius = 20.0f;

class ExpoChatBubbleProps final : public ViewProps {
 public:
  ExpoChatBubbleProps() = default;
  ExpoChatBubbleProps(
      const PropsParserContext &context,
      const ExpoChatBubbleProps &sourceProps,
      const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps),
        tail(convertRawProp(context, rawProps, "tail", sourceProps.tail, std::string{})),
        bubbleRadius(
            convertRawProp(context, rawProps, "bubbleRadius", sourceProps.bubbleRadius, Float{kExpoChatBubbleRadius})),
        tailBasePadding(convertRawProp(context, rawProps, "tailBasePadding", sourceProps.tailBasePadding, Float{0}))
  {
  }

  /**
   * Which side the tail is on: `"leading"`, `"trailing"`, or empty for none.
   * Sides rather than left and right because the tail is on the side the message
   * came from; the view resolves it against its layout direction.
   */
  std::string tail{};

  /**
   * The corner radius, clamped by the renderer to half the body's shorter side.
   * Its own property rather than `border-radius` because the body and the tail
   * are one path and have to be described once.
   */
  Float bubbleRadius{kExpoChatBubbleRadius};

  /**
   * The element's own bottom padding, without the tail's reserve. A tailed balloon
   * reserves `kExpoChatBubbleTailDrop` of `padding-bottom`, which is what a tail's
   * arrival or departure animates, so the view reads the tail's size out of the
   * padding it currently has:
   *
   *     amount = (paddingBottom - tailBasePadding) / kExpoChatBubbleTailDrop
   *
   * One animated quantity, and a shape that is a function of the geometry. See
   * `EXPChatBubblePath`.
   */
  Float tailBasePadding{0};
};

/**
 * `<native:chatbubble>`: a chat balloon's surface, the shape and nothing else.
 * A balloon's text must not reflow while the balloon animates (the platform
 * animates a mask behind a label that never moves), so the box lays out the
 * text and this absolutely positioned sibling behind it carries the shape and
 * takes the animation. One path draws every balloon, tailed or not, so the
 * corners match. The tail costs height only, reserved as bottom padding on the
 * box, which `NativeChatBubble` owns together with this element; an app writes
 * the component rather than this element directly.
 */
using ExpoChatBubbleShadowNode =
    ConcreteViewShadowNode<ExpoChatBubbleComponentName, ExpoChatBubbleProps, ViewEventEmitter>;

using ExpoChatBubbleComponentDescriptor = ConcreteComponentDescriptor<ExpoChatBubbleShadowNode>;

} // namespace facebook::react
