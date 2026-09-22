/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ExpoScrollViewEventEmitter.h>
#include <react/renderer/components/view/ExpoScrollViewState.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/graphics/RectangleEdges.h>

namespace facebook::react {

extern const char ExpoScrollViewComponentName[];

enum class ExpoScrollKeyboardDismissMode {
  // The keyboard stays until something else dismisses it
  None,
  // Dismissed as soon as a drag begins
  OnDrag,
  // Dragged down with the finger, and draggable back up
  Interactive,
};

/*
 * Which end of the content the scroll view holds on to. `Top` is the default,
 * as on both platforms, whose scroll views begin at offset zero and whose anchor
 * equivalents (SwiftUI's `defaultScrollAnchor`, `stackFromEnd`, `reverseLayout`)
 * are off. `Bottom` is a chat: it starts at the newest message and stays there
 * when one arrives unless the reader has scrolled up.
 *
 * Either anchor holds the reader still when content changes above them, see
 * `-[EXPScrollViewComponentView mountingTransactionWillMount:]`, which follows
 * Android rather than SwiftUI, whose fraction-of-range anchor carries the reader
 * down by what was prepended. Short content is not pushed to the bottom the way
 * SwiftUI's `.bottom` and Android's `fillViewport` do; that is
 * `justify-content: flex-end` on a `min-height: 100%` box, which the content
 * container can spell, and a three-message conversation reads from the top.
 * Named after SwiftUI's `defaultScrollAnchor`: one word instead of
 * `maintainVisibleContentPosition`'s object of indices.
 */
enum class ExpoScrollContentAnchor { Top, Bottom };

inline void fromRawValue(const PropsParserContext & /*context*/, const RawValue &value, ExpoScrollContentAnchor &result)
{
  auto string = (std::string)value;
  if (string == "top") {
    result = ExpoScrollContentAnchor::Top;
  } else if (string == "bottom") {
    result = ExpoScrollContentAnchor::Bottom;
  } else {
    LOG(ERROR) << "Unsupported ExpoScrollView contentAnchor: " << string;
    result = ExpoScrollContentAnchor::Top;
  }
}

// Which edges get room made for them automatically; per edge, since a list
// under a translucent header wants the top only, where
// `contentInsetAdjustmentBehavior`'s modes cannot say so
struct ExpoScrollAutomaticInsets {
  bool top{true};
  bool bottom{true};
  bool left{true};
  bool right{true};

  bool operator==(const ExpoScrollAutomaticInsets &other) const = default;
};

inline void
fromRawValue(const PropsParserContext & /*context*/, const RawValue &value, ExpoScrollKeyboardDismissMode &result)
{
  auto string = (std::string)value;
  if (string == "none") {
    result = ExpoScrollKeyboardDismissMode::None;
  } else if (string == "on-drag") {
    result = ExpoScrollKeyboardDismissMode::OnDrag;
  } else if (string == "interactive") {
    result = ExpoScrollKeyboardDismissMode::Interactive;
  } else {
    // The default rather than a throw: a typo costs the author the behaviour, not the screen
    LOG(ERROR) << "Unsupported ExpoScrollView keyboardDismissMode: " << string;
    result = ExpoScrollKeyboardDismissMode::Interactive;
  }
}

// A boolean for all four edges, or a map naming them
inline void
fromRawValue(const PropsParserContext & /*context*/, const RawValue &value, ExpoScrollAutomaticInsets &result)
{
  if (value.hasType<bool>()) {
    auto enabled = (bool)value;
    result = ExpoScrollAutomaticInsets{.top = enabled, .bottom = enabled, .left = enabled, .right = enabled};
    return;
  }

  if (value.hasType<std::unordered_map<std::string, bool>>()) {
    auto map = (std::unordered_map<std::string, bool>)value;
    // An edge left out keeps the default, which is on
    for (const auto &[edge, enabled] : map) {
      if (edge == "top") {
        result.top = enabled;
      } else if (edge == "bottom") {
        result.bottom = enabled;
      } else if (edge == "left") {
        result.left = enabled;
      } else if (edge == "right") {
        result.right = enabled;
      } else {
        LOG(ERROR) << "Unsupported ExpoScrollView automaticInsets edge: " << edge;
      }
    }
    return;
  }

  LOG(ERROR) << "ExpoScrollView automaticInsets must be a boolean or a map of edges.";
}

// How content is treated where it scrolls under an edge: `UIScrollEdgeEffect`'s
// styles, plus hidden
enum class ExpoScrollEdgeEffect { Automatic, Hard, Soft, Hidden };

struct ExpoScrollEdgeEffects {
  ExpoScrollEdgeEffect top{ExpoScrollEdgeEffect::Automatic};
  ExpoScrollEdgeEffect bottom{ExpoScrollEdgeEffect::Automatic};
  ExpoScrollEdgeEffect left{ExpoScrollEdgeEffect::Automatic};
  ExpoScrollEdgeEffect right{ExpoScrollEdgeEffect::Automatic};
  bool operator==(const ExpoScrollEdgeEffects &other) const = default;
};

inline void fromRawValue(const PropsParserContext & /*context*/, const RawValue &value, ExpoScrollEdgeEffect &result)
{
  auto string = (std::string)value;
  if (string == "automatic") {
    result = ExpoScrollEdgeEffect::Automatic;
  } else if (string == "hard") {
    result = ExpoScrollEdgeEffect::Hard;
  } else if (string == "soft") {
    result = ExpoScrollEdgeEffect::Soft;
  } else if (string == "hidden") {
    result = ExpoScrollEdgeEffect::Hidden;
  } else {
    LOG(ERROR) << "Unsupported ExpoScrollView edge effect: " << string;
    result = ExpoScrollEdgeEffect::Automatic;
  }
}

// `edgeEffects={{top: 'soft'}}` states one edge; the others keep the platform's choice
inline void fromRawValue(const PropsParserContext &context, const RawValue &value, ExpoScrollEdgeEffects &result)
{
  if (!value.hasType<std::unordered_map<std::string, RawValue>>()) {
    LOG(ERROR) << "ExpoScrollView edgeEffects must be a map of edges.";
    return;
  }
  auto map = (std::unordered_map<std::string, RawValue>)value;
  for (const auto &[edge, style] : map) {
    ExpoScrollEdgeEffect effect{};
    fromRawValue(context, style, effect);
    if (edge == "top") {
      result.top = effect;
    } else if (edge == "bottom") {
      result.bottom = effect;
    } else if (edge == "left") {
      result.left = effect;
    } else if (edge == "right") {
      result.right = effect;
    } else {
      LOG(ERROR) << "Unsupported ExpoScrollView edgeEffects edge: " << edge;
    }
  }
}

/*
 * Every default here is what a well-built native app does rather than what
 * `ScrollView` defaults to: content moves out of the keyboard's way, a drag
 * dismisses the keyboard with the finger, and the safe area is respected on
 * every edge the view runs past.
 */
class ExpoScrollViewProps final : public ViewProps {
 public:
  ExpoScrollViewProps() = default;
  ExpoScrollViewProps(
      const PropsParserContext &context,
      const ExpoScrollViewProps &sourceProps,
      const RawProps &rawProps)
      : ViewProps(context, sourceProps, rawProps),
        scrollEnabled(convertRawProp(context, rawProps, "scrollEnabled", sourceProps.scrollEnabled, true)),
        showsScrollIndicator(
            convertRawProp(context, rawProps, "showsScrollIndicator", sourceProps.showsScrollIndicator, true)),
        bounces(convertRawProp(context, rawProps, "bounces", sourceProps.bounces, true)),
        // The author's inset, added to the automatic reservation rather than replacing it
        contentInset(convertRawProp(context, rawProps, "contentInset", sourceProps.contentInset, EdgeInsets{})),
        automaticInsets(convertRawProp(
            context,
            rawProps,
            "automaticInsets",
            sourceProps.automaticInsets,
            ExpoScrollAutomaticInsets{})),
        edgeEffects(convertRawProp(context, rawProps, "edgeEffects", sourceProps.edgeEffects, ExpoScrollEdgeEffects{})),
        avoidsKeyboard(convertRawProp(context, rawProps, "avoidsKeyboard", sourceProps.avoidsKeyboard, true)),
        keyboardDismissMode(convertRawProp(
            context,
            rawProps,
            "keyboardDismissMode",
            sourceProps.keyboardDismissMode,
            ExpoScrollKeyboardDismissMode::Interactive)),
        contentAnchor(
            convertRawProp(context, rawProps, "contentAnchor", sourceProps.contentAnchor, ExpoScrollContentAnchor::Top))
  {
  }

  bool scrollEnabled{true};
  bool showsScrollIndicator{true};
  bool bounces{true};
  EdgeInsets contentInset{};
  ExpoScrollAutomaticInsets automaticInsets{};
  ExpoScrollEdgeEffects edgeEffects{};
  bool avoidsKeyboard{true};
  ExpoScrollKeyboardDismissMode keyboardDismissMode{ExpoScrollKeyboardDismissMode::Interactive};
  ExpoScrollContentAnchor contentAnchor{ExpoScrollContentAnchor::Top};

  // Deliberately absent: `horizontal`, `pagingEnabled` and `contentOffset`, each
  // of which would change nothing on at least one platform, and
  // `maintainVisibleContentPosition`, which `contentAnchor` covers
};

// Lays the content out and tells the platform how big it came out; insets are
// not a layout input, see ExpoScrollViewState
class ExpoScrollViewShadowNode final : public ConcreteViewShadowNode<
                                           ExpoScrollViewComponentName,
                                           ExpoScrollViewProps,
                                           ExpoScrollViewEventEmitter,
                                           ExpoScrollViewState> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  void layout(LayoutContext layoutContext) override;

  // Where the content sits relative to the view, for hit testing and measurement
  Point getContentOriginOffset(bool includeTransform) const override;

 private:
  void updateStateIfNeeded();
};

using ExpoScrollViewComponentDescriptor = ConcreteComponentDescriptor<ExpoScrollViewShadowNode>;

} // namespace facebook::react
