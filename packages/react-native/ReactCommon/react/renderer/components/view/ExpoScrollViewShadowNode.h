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
  /* The keyboard stays until something else dismisses it. */
  None,
  /* Dismissed as soon as a drag begins. */
  OnDrag,
  /* Dragged down with the finger, and draggable back up. */
  Interactive,
};

/*
 * Which end of the content the scroll view holds on to.
 *
 * `Top` is the DEFAULT and is the ordinary list: it starts at the beginning and
 * stays there when content is added below. `Bottom` is a chat: it starts at the
 * newest message and stays there when one arrives, unless the reader has
 * scrolled up to look at something, in which case moving under them would be the
 * bug.
 *
 * Top by default because that is what the PLATFORMS do, and this element's whole
 * argument is that typing the element gets you the platform's behaviour. Neither
 * `UIScrollView` nor Android's `ScrollView` has an anchor at all — both simply
 * begin at offset zero — and where the equivalent does exist it is off: SwiftUI's
 * `defaultScrollAnchor` is unset unless you ask, `LinearLayoutManager`'s
 * `stackFromEnd` is false, and Compose's `reverseLayout` is false. A `Bottom`
 * default would open a list that says nothing at its end, which no scroll view
 * on either platform does.
 *
 * ## What the platforms mean by an anchor, and where this deliberately differs
 *
 * The three platform features are usually described as the same thing and are
 * three different mechanisms. Measured and decompiled rather than assumed:
 *
 *   SwiftUI anchors a FRACTION OF THE SCROLLABLE RANGE. `target = (content −
 *   viewport) × anchor`, re-satisfied on a geometry change only while the
 *   offset already IS the target. It knows nothing about items, so prepending
 *   above a reader who has scrolled away carries them down by exactly what was
 *   inserted.
 *
 *   `LinearLayoutManager` anchors A CHILD VIEW AND ITS SCREEN COORDINATE, on
 *   every layout pass, unconditionally. `stackFromEnd` only chooses which
 *   visible child that is (and where an EMPTY list starts). Prepending never
 *   moves the reader, because that is the layout algorithm rather than a
 *   feature.
 *
 *   Compose anchors THE KEY of the first visible item — the strongest of the
 *   three, and silently no better than SwiftUI's if the author leaves the keys
 *   defaulted to the index.
 *
 * So: NEITHER anchor here moves the reader when the content changes ABOVE them,
 * and that is not part of this choice — see `-[EXPScrollViewComponentView
 * mountingTransactionWillMount:]`, which applies to both. That follows Android,
 * not SwiftUI, on purpose. A transcript loading older messages must not jump,
 * and SwiftUI's inability to hold the reader there is a gap in SwiftUI.
 *
 * SHORT CONTENT is deliberately NOT part of this either. SwiftUI's `.bottom`
 * pushes three messages to the bottom of the screen, using a top `contentInset`
 * of `(viewport − insetBottom − content) × anchor`; Android does the same thing
 * by stretching the content box to the viewport (`ScrollView.fillViewport`,
 * `offsetChildren` in `fixLayoutEndGap`) and aligning inside it. Both are
 * `justify-content: flex-end` on a box with `min-height: 100%`, which the
 * content container already spells, and neither is what a transcript wants: a
 * conversation with three messages reads from the TOP, as it does natively.
 * See `-[EXPScrollViewComponentView _maxOffsetY]`, where that falls out of the
 * clamp rather than being special-cased.
 *
 * Taken from SwiftUI's `defaultScrollAnchor`, which Expo UI already exposes as a
 * modifier, rather than from React Native's `maintainVisibleContentPosition` —
 * the same requirement, but one declarative word instead of an object of
 * indices. Implemented on both platforms rather than only where SwiftUI is.
 */
enum class ExpoScrollContentAnchor { Top, Bottom };

inline void fromRawValue(
    const PropsParserContext& /*context*/,
    const RawValue& value,
    ExpoScrollContentAnchor& result)
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

/*
 * Which edges get room made for them automatically.
 *
 * Not a boolean, because "the safe area" is not one decision: a list inside a
 * card wants nothing, a full-bleed list wants both, and a list under a
 * translucent header wants the top only. Naming the edges says exactly what
 * will happen, where `contentInsetAdjustmentBehavior`'s four opaque modes do
 * not.
 */
struct ExpoScrollAutomaticInsets {
  bool top{true};
  bool bottom{true};
  bool left{true};
  bool right{true};

  bool operator==(const ExpoScrollAutomaticInsets& other) const = default;
};

inline void fromRawValue(
    const PropsParserContext& /*context*/,
    const RawValue& value,
    ExpoScrollKeyboardDismissMode& result)
{
  auto string = (std::string)value;
  if (string == "none") {
    result = ExpoScrollKeyboardDismissMode::None;
  } else if (string == "on-drag") {
    result = ExpoScrollKeyboardDismissMode::OnDrag;
  } else if (string == "interactive") {
    result = ExpoScrollKeyboardDismissMode::Interactive;
  } else {
    // Falls back to the default rather than throwing: a typo should cost the
    // author the behaviour they asked for, not the screen.
    LOG(ERROR) << "Unsupported ExpoScrollView keyboardDismissMode: " << string;
    result = ExpoScrollKeyboardDismissMode::Interactive;
  }
}

/*
 * Accepts either a boolean for all four edges or a map naming them, so
 * `automaticInsets={false}` and `automaticInsets={{top: false}}` both read the
 * way they look.
 */
inline void fromRawValue(
    const PropsParserContext& /*context*/,
    const RawValue& value,
    ExpoScrollAutomaticInsets& result)
{
  if (value.hasType<bool>()) {
    auto enabled = (bool)value;
    result = ExpoScrollAutomaticInsets{.top = enabled, .bottom = enabled, .left = enabled, .right = enabled};
    return;
  }

  if (value.hasType<std::unordered_map<std::string, bool>>()) {
    auto map = (std::unordered_map<std::string, bool>)value;
    // An edge left out keeps the default, which is on. Naming one edge is how
    // an author says "not that one", not "only that one".
    for (const auto& [edge, enabled] : map) {
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

/*
 * The prop surface, chosen rather than inherited.
 *
 * Every default here is the behaviour a well-built native app has, which is not
 * what `ScrollView`'s defaults are: content moves out of the keyboard's way, a
 * drag dismisses the keyboard with the finger, and the safe area is respected on
 * every edge the view runs past. An author reaches for a prop to say something
 * UNUSUAL, not to get the ordinary thing.
 */
/**
 * How content is treated where it scrolls under an edge: faded out softly, cut
 * with a hard line, or left alone. `UIScrollEdgeEffect`'s styles, plus hidden.
 */
enum class ExpoScrollEdgeEffect { Automatic, Hard, Soft, Hidden };

struct ExpoScrollEdgeEffects {
  ExpoScrollEdgeEffect top{ExpoScrollEdgeEffect::Automatic};
  ExpoScrollEdgeEffect bottom{ExpoScrollEdgeEffect::Automatic};
  ExpoScrollEdgeEffect left{ExpoScrollEdgeEffect::Automatic};
  ExpoScrollEdgeEffect right{ExpoScrollEdgeEffect::Automatic};
  bool operator==(const ExpoScrollEdgeEffects& other) const = default;
};

inline void fromRawValue(
    const PropsParserContext& /*context*/,
    const RawValue& value,
    ExpoScrollEdgeEffect& result)
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

/** `edgeEffects={{top: 'soft'}}` states one edge; the others keep the platform's choice. */
inline void fromRawValue(
    const PropsParserContext& context,
    const RawValue& value,
    ExpoScrollEdgeEffects& result)
{
  if (!value.hasType<std::unordered_map<std::string, RawValue>>()) {
    LOG(ERROR) << "ExpoScrollView edgeEffects must be a map of edges.";
    return;
  }
  auto map = (std::unordered_map<std::string, RawValue>)value;
  for (const auto& [edge, style] : map) {
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

class ExpoScrollViewProps final : public ViewProps {
 public:
  ExpoScrollViewProps() = default;
  ExpoScrollViewProps(
      const PropsParserContext& context,
      const ExpoScrollViewProps& sourceProps,
      const RawProps& rawProps)
      : ViewProps(context, sourceProps, rawProps),
        scrollEnabled(convertRawProp(context, rawProps, "scrollEnabled", sourceProps.scrollEnabled, true)),
        showsScrollIndicator(
            convertRawProp(context, rawProps, "showsScrollIndicator", sourceProps.showsScrollIndicator, true)),
        bounces(convertRawProp(context, rawProps, "bounces", sourceProps.bounces, true)),
        /*
         * The author's own inset, on top of whatever is reserved automatically.
         * Added to the automatic reservation rather than replacing it: an author
         * asking for 8pt of breathing room at the bottom means 8pt more than the
         * keyboard needs, not 8pt instead of it.
         */
        contentInset(convertRawProp(context, rawProps, "contentInset", sourceProps.contentInset, EdgeInsets{})),
        automaticInsets(
            convertRawProp(context, rawProps, "automaticInsets", sourceProps.automaticInsets, ExpoScrollAutomaticInsets{})),
        edgeEffects(convertRawProp(context, rawProps, "edgeEffects", sourceProps.edgeEffects, ExpoScrollEdgeEffects{})),
        avoidsKeyboard(convertRawProp(context, rawProps, "avoidsKeyboard", sourceProps.avoidsKeyboard, true)),
        keyboardDismissMode(convertRawProp(
            context,
            rawProps,
            "keyboardDismissMode",
            sourceProps.keyboardDismissMode,
            ExpoScrollKeyboardDismissMode::Interactive)),
        contentAnchor(convertRawProp(
            context,
            rawProps,
            "contentAnchor",
            sourceProps.contentAnchor,
            ExpoScrollContentAnchor::Top))
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

  /*
   * Deliberately absent, rather than declared and ignored: `horizontal`,
   * `pagingEnabled` and `contentOffset`. (`maintainVisibleContentPosition` is
   * absent for a different reason: `contentAnchor` above is the same
   * requirement, said better.)
   *
   * Each would have been a prop an author could set that changed nothing on at
   * least one platform — a horizontal scroll needs a different container on
   * Android, paging has no equivalent there, and the other two are real features
   * rather than flags. A prop that silently does nothing is worse than an absent
   * one: the absent one fails loudly at the type level, and the silent one
   * fails on a user's device.
   */
};

/*
 * Lays the content out and tells the platform how big it came out.
 *
 * Nothing about insets appears here; see [ExpoScrollViewState] for why they are
 * deliberately not a layout input.
 */
class ExpoScrollViewShadowNode final : public ConcreteViewShadowNode<
                                           ExpoScrollViewComponentName,
                                           ExpoScrollViewProps,
                                           ExpoScrollViewEventEmitter,
                                           ExpoScrollViewState> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  void layout(LayoutContext layoutContext) override;

  /*
   * Where the content sits relative to the view, for hit testing and for
   * anything measuring a descendant's position on screen.
   */
  Point getContentOriginOffset(bool includeTransform) const override;

 private:
  void updateStateIfNeeded();
};

using ExpoScrollViewComponentDescriptor = ConcreteComponentDescriptor<ExpoScrollViewShadowNode>;

} // namespace facebook::react
