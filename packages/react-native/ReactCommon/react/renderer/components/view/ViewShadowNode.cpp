/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "ViewShadowNode.h"

#include <react/renderer/animationbackend/CSSTransitionsTrace.h>
#include <functional>
#include <limits>
#include <string_view>
#include <vector>
#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/renderer/components/view/DivShadowNode.h>
#include <react/renderer/components/view/ElementBoxShadowNode.h>
#include <react/renderer/components/view/HostPlatformViewTraitsInitializer.h>
#include <react/renderer/components/view/InlineTextContentAccessor.h>
#include <react/renderer/components/view/primitives.h>
#include <react/renderer/core/ConcreteState.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/core/LayoutableShadowNode.h>

namespace facebook::react {

// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
const char ViewComponentName[] = "View";

// The intrinsic `<div>` tag (text-children-plan.md §3.C); see DivShadowNode.h.
// NOLINTNEXTLINE(facebook-hte-CArray,modernize-avoid-c-arrays)
const char DivComponentName[] = "div";
// Not JSX-addressable: the renderer swaps an element onto this component when
// its display generates a box (ElementBoxShadowNode.h).
const char ElementBoxComponentName[] = "element-box";

template <const char* concreteComponentName, typename ViewPropsT>
void AbstractViewShadowNode<concreteComponentName, ViewPropsT>::
    initialize() noexcept {
  auto& viewProps = static_cast<const ViewProps&>(*this->props_);

  auto hasBorder = [&]() {
    for (auto edge : yoga::ordinals<yoga::Edge>()) {
      if (viewProps.yogaStyle.border(edge).isDefined()) {
        return true;
      }
    }
    return false;
  };

  bool formsStackingContext = !viewProps.collapsable ||
      viewProps.pointerEvents == PointerEventsMode::BoxOnly ||
      viewProps.pointerEvents == PointerEventsMode::None ||
      !viewProps.nativeId.empty() || viewProps.accessible ||
      viewProps.opacity != 1.0 || viewProps.transform != Transform{} ||
      (viewProps.zIndex.has_value() &&
       viewProps.yogaStyle.positionType() != yoga::PositionType::Static) ||
      viewProps.yogaStyle.display() == yoga::Display::None ||
      viewProps.getClipsContentToBounds() || viewProps.events.bits.any() ||
      isColorMeaningful(viewProps.shadowColor) ||
      viewProps.accessibilityElementsHidden ||
      viewProps.accessibilityViewIsModal ||
      viewProps.importantForAccessibility != ImportantForAccessibility::Auto ||
      viewProps.removeClippedSubviews || viewProps.cursor != Cursor::Auto ||
      !viewProps.filter.empty() ||
      viewProps.mixBlendMode != BlendMode::Normal ||
      viewProps.isolation == Isolation::Isolate ||
      HostPlatformViewTraitsInitializer::formsStackingContext(viewProps) ||
      !viewProps.accessibilityOrder.empty();

  bool formsView = formsStackingContext ||
      isColorMeaningful(viewProps.backgroundColor) || hasBorder() ||
      !viewProps.testId.empty() || !viewProps.boxShadow.empty() ||
      !viewProps.backgroundImage.empty() ||
      HostPlatformViewTraitsInitializer::formsView(viewProps) ||
      viewProps.outlineWidth > 0;

  if (!this->getAnonymousTextContentChildren().empty()) {
    // Text-bearing Views paint their runs and must not be flattened away
    // (text-children-plan.md §3.B).
    formsView = true;
    formsStackingContext = true;
  }

  if (ReactNativeFeatureFlags::enableStringChildren() &&
      viewProps.displayInline) {
    // Atomic `display:'inline'` boxes are positioned by their container's
    // inline-attachment layout (stamped layout metrics); flattening one away
    // would hoist its children out of the stamped frame, so it must own a
    // host view.
    formsView = true;
    formsStackingContext = true;
  }

  if (formsView) {
    this->traits_.set(ShadowNodeTraits::Trait::FormsView);
  } else {
    this->traits_.unset(ShadowNodeTraits::Trait::FormsView);
  }

  if (formsStackingContext) {
    this->traits_.set(ShadowNodeTraits::Trait::FormsStackingContext);
  } else {
    this->traits_.unset(ShadowNodeTraits::Trait::FormsStackingContext);
  }

  if (!viewProps.collapsableChildren) {
    this->traits_.set(ShadowNodeTraits::Trait::ChildrenFormStackingContext);
  } else {
    this->traits_.unset(ShadowNodeTraits::Trait::ChildrenFormStackingContext);
  }
}

template <const char* concreteComponentName, typename ViewPropsT>
void AbstractViewShadowNode<concreteComponentName, ViewPropsT>::layout(
    LayoutContext layoutContext) {
  YogaLayoutableShadowNode::layout(layoutContext);
  layoutInlineAttachments(layoutContext);
  updateTextRunStateIfNeeded();
}

template <const char* concreteComponentName, typename ViewPropsT>
void AbstractViewShadowNode<concreteComponentName, ViewPropsT>::
    layoutInlineAttachments(LayoutContext layoutContext) {
  if (!ReactNativeFeatureFlags::enableStringChildren()) {
    return;
  }
  const auto& boxes = this->getAnonymousTextContentChildren();
  if (boxes.empty()) {
    return;
  }

  // Clone-and-position each inline attachment — the replaced `<img>` and
  // atomic `display:'inline'` elements (non-Yoga children) — at its exact
  // inline offset within the run. The run box resolves each attachment's frame
  // via the text layout; the attachment is placed at the box origin plus that
  // frame, so it sits between the surrounding glyphs and follows wrapping —
  // like a replaced element in a web line box (text-children-plan.md §3.C).
  auto* current = this;
  auto owning = std::shared_ptr<ShadowNode>{};

  for (const auto& box : boxes) {
    const auto boxFrame = box->getLayoutMetrics().frame;
    const auto* accessor =
        dynamic_cast<const InlineTextContentAccessor*>(box.get());

    // Give the run's inline elements (<b>, <span>, …) a real box to report
    // from getBoundingClientRect(). Purely additive — no effect on layout or
    // paint; routed through the accessor seam so this module keeps no text
    // dependency.
    if (accessor != nullptr) {
      accessor->stampInlineElementMetrics(
          layoutContext, boxFrame.origin, this->getLayoutMetrics());
    }

    const auto placements = accessor != nullptr
        ? accessor->getInlineAttachmentPlacements(layoutContext)
        : std::vector<InlineAttachmentPlacement>{};

    // Attachment candidates are the run's direct children plus descendants
    // reached through span-like inline boxes (whose contents flow into this
    // run rather than forming their own).
    std::vector<std::shared_ptr<const ShadowNode>> attachmentCandidates;
    const std::function<void(const ShadowNode&)> collectCandidates =
        [&](const ShadowNode& parent) {
          for (const auto& child : parent.getChildren()) {
            if (YogaLayoutableShadowNode::isInlineFlowContent(*child)) {
              collectCandidates(*child);
            } else {
              attachmentCandidates.push_back(child);
            }
          }
        };
    collectCandidates(*box);

    for (const auto& runChild : attachmentCandidates) {
      if (std::string_view{runChild->getComponentName()} != "img" &&
          !YogaLayoutableShadowNode::isAtomicInline(*runChild)) {
        continue;
      }
      const auto* layoutable =
          dynamic_cast<const LayoutableShadowNode*>(runChild.get());
      if (layoutable == nullptr) {
        continue;
      }

      // The text layout's frame for this attachment is authoritative for both
      // offset and size; fall back to the box origin and a fresh measure only
      // if the platform layout manager reported no attachment frame (e.g. the
      // deterministic test manager).
      const Rect* attachmentFrame = nullptr;
      for (const auto& placement : placements) {
        if (placement.family == &runChild->getFamily()) {
          attachmentFrame = &placement.frame;
          break;
        }
      }

      auto attachmentSize = attachmentFrame != nullptr &&
              (attachmentFrame->size.width != 0 ||
               attachmentFrame->size.height != 0)
          ? attachmentFrame->size
          : layoutable->getLayoutMetrics().frame.size;
      if (attachmentSize.width == 0 && attachmentSize.height == 0) {
        attachmentSize = layoutable->measure(
            layoutContext,
            LayoutConstraints{
                .minimumSize = {0, 0},
                .maximumSize = {
                    std::numeric_limits<Float>::infinity(),
                    std::numeric_limits<Float>::infinity()}});
      }

      auto attachmentOrigin = boxFrame.origin;
      if (attachmentFrame != nullptr) {
        attachmentOrigin.x += attachmentFrame->origin.x;
        attachmentOrigin.y += attachmentFrame->origin.y;
      }

      owning = current->cloneTree(
          runChild->getFamily(), [&](const ShadowNode& oldShadowNode) {
            auto cloned = oldShadowNode.clone({});
            auto& clonedLayoutable =
                dynamic_cast<LayoutableShadowNode&>(*cloned);
            clonedLayoutable.layoutTree(
                layoutContext,
                LayoutConstraints{
                    .minimumSize = attachmentSize,
                    .maximumSize = attachmentSize});
            auto metrics = clonedLayoutable.getLayoutMetrics();
            metrics.frame.origin = attachmentOrigin;
            clonedLayoutable.setLayoutMetrics(metrics);
            return cloned;
          });
      if (owning != nullptr) {
        current = static_cast<AbstractViewShadowNode*>(owning.get());
      }
    }
  }

  if (current != this) {
    this->children_ = current->children_;
  }
}

template <const char* concreteComponentName, typename ViewPropsT>
Float AbstractViewShadowNode<concreteComponentName, ViewPropsT>::baseline(
    const LayoutContext& layoutContext,
    Size size) const {
  // CSS2 §10.8.1: an inline-block's baseline is the baseline of its last
  // in-flow line box; with no line boxes it is the bottom margin edge. The
  // line boxes live in the anonymous IFC box this View wraps its inline
  // content in, so the baseline is that box's own baseline plus wherever the
  // box sits inside this one (padding, borders, preceding blocks).
  //
  // The same rule has a second escape hatch: a box whose `overflow` is not
  // `visible` also aligns by its bottom edge, whatever its content. Clipping
  // makes the last line box a meaningless thing to align to — it can be
  // scrolled or cropped out of sight entirely, which would drag the whole line
  // with it. `getClipsContentToBounds()` is exactly `overflow != visible`.
  //
  // The spec says bottom *margin* edge; this returns the bottom border edge,
  // which is the same thing here because an atomic inline is measured and
  // mounted as its border box — margin sits outside the frame the attachment
  // uses, so adding it would offset the baseline from the box actually drawn.
  // The no-line-boxes fallback below returns the same edge for the same reason.
  const auto& viewProps =
      static_cast<const ViewPropsT&>(*this->getProps().get());
  if (viewProps.getClipsContentToBounds()) {
    return size.height;
  }
  //
  // Laid out on a clone at the given size first, exactly as
  // `ParagraphShadowNode::baseline` does. This is asked DURING the parent's
  // measure pass, when this node's own children still carry stale metrics —
  // reading them directly returned a baseline of zero, which pushed the box a
  // full descent below the line instead of onto it.
  auto clonedShadowNode = this->clone({});
  auto& laidOut = static_cast<YogaLayoutableShadowNode&>(*clonedShadowNode);
  auto localLayoutContext = layoutContext;
  localLayoutContext.affectedNodes = nullptr;
  laidOut.layoutTree(
      localLayoutContext,
      LayoutConstraints{
          .minimumSize = size,
          .maximumSize = size,
          .layoutDirection = this->getLayoutMetrics().layoutDirection});

  const auto& children = laidOut.getYogaLayoutableChildren();
  for (auto it = children.rbegin(); it != children.rend(); ++it) {
    const auto& child = *it;
    if (!child->getTraits().check(ShadowNodeTraits::Trait::AnonymousBox)) {
      continue;
    }
    const auto* layoutableChild =
        dynamic_cast<const LayoutableShadowNode*>(child.get());
    if (layoutableChild == nullptr) {
      continue;
    }
    const auto childFrame = layoutableChild->getLayoutMetrics().frame;
    return childFrame.origin.y +
        layoutableChild->baseline(layoutContext, childFrame.size);
  }
  return size.height;
}

template <const char* concreteComponentName, typename ViewPropsT>
void AbstractViewShadowNode<concreteComponentName, ViewPropsT>::
    updateTextRunStateIfNeeded() {
  if (!ReactNativeFeatureFlags::enableStringChildren()) {
    return;
  }

  const auto& anonymousBoxes = this->getAnonymousTextContentChildren();

  // Zero-cost hot path (text-children-plan.md §4.2 / next-steps T3): a View that
  // has never carried anonymous text runs keeps a null `ViewState`, exactly like
  // a plain pre-text-children View. State is allocated lazily on the first runs
  // (the null -> non-null transition below); once allocated it persists —
  // possibly emptied when text is removed — for the node's life.
  if (anonymousBoxes.empty() &&
      (this->state_ == nullptr || this->getStateData().textRuns.empty())) {
    return;
  }

  this->ensureUnsealed();

  auto textRuns = std::vector<ViewState::TextRun>{};
  auto layoutManager = std::weak_ptr<const TextLayoutManager>{};
  const auto& childIndices = this->getAnonymousTextContentChildIndices();
  textRuns.reserve(anonymousBoxes.size());
  for (size_t i = 0; i < anonymousBoxes.size(); i++) {
    const auto& box = anonymousBoxes[i];
    const auto* contentAccessor =
        dynamic_cast<const InlineTextContentAccessor*>(box.get());
    if (contentAccessor == nullptr) {
      continue;
    }
    if (layoutManager.expired()) {
      layoutManager = contentAccessor->getContentTextLayoutManager();
    }
    const auto documentOrder =
        i < childIndices.size() ? childIndices[i] : static_cast<int>(i);
    const auto contentFrame = box->getLayoutMetrics().frame;
    auto contentString = contentAccessor->getContentAttributedString();

    // An `outside` list marker (css-lists-3 §3.2) is painted rather than
    // measured with the content, which is what lets the content hang past it:
    // it sits in the gutter the list's `padding-inline-start` reserves, to the
    // inline-start side of the content box, so every line of the item —
    // continuations included — starts at the content edge.
    const auto marker = contentAccessor->getOutsideMarker();
    if (marker.present) {
      textRuns.push_back(
          ViewState::TextRun{
              .attributedString = marker.attributedString,
              .frame =
                  Rect{
                      .origin =
                          {contentFrame.origin.x - marker.size.width,
                           contentFrame.origin.y},
                      .size = marker.size},
              .documentOrder = documentOrder});
    }

    // Publication tripwire: a run built from DEFAULT text attributes while
    // its box sits under a styled cascade is the "text lost its styling" bug
    // being born. Log enough state to name the reachability gap.
    if (!contentString.getFragments().empty()) {
      const auto& firstAttrs = contentString.getFragments()[0].textAttributes;
      // The DEFAULT attributes carry fontSize 14 (not NaN), black, no
      // family, no weight — match that signature, since it is exactly what
      // unstyled paints report.
      const bool looksDefault = firstAttrs.fontSize == 14.0 &&
          !firstAttrs.fontWeight.has_value() && firstAttrs.fontFamily.empty();
      if (looksDefault && contentString.getString().size() > 2) {
        const auto* yogaBox =
            dynamic_cast<const YogaLayoutableShadowNode*>(box.get());
        CSSTransitionsTrace::shared()->log(
            "unstyled-pub t=" + std::to_string(this->getTag()) +
            " cfg=" + std::to_string(this->debugYogaTreeConfigured() ? 1 : 0) +
            " boxCfg=" +
            (yogaBox != nullptr
                 ? std::to_string(yogaBox->debugYogaTreeConfigured() ? 1 : 0)
                 : std::string("?")) +
            " '" + contentString.getString().substr(0, 10) + "'");
      }
    }
    textRuns.push_back(
        ViewState::TextRun{
            .attributedString = std::move(contentString),
            .frame = contentFrame,
            .documentOrder = documentOrder});
  }

  if (this->state_ == nullptr) {
    // First runs on a previously-stateless View: allocate the state on demand,
    // seeded from the family like `createInitialState` would (there is no prior
    // state to chain from).
    this->state_ = std::make_shared<const ConcreteState<ViewState>>(
        std::make_shared<const ViewState>(
            ViewState(std::move(textRuns), std::move(layoutManager))),
        this->getFamilyShared());
  } else if (this->getStateData().textRuns != textRuns) {
    this->setStateData(
        ViewState(std::move(textRuns), std::move(layoutManager)));
  }
}

// Explicitly instantiate the two concrete specializations so their member
// definitions above are emitted here (and linkable from other translation
// units): `<View>` and the intrinsic `<div>`.
template class AbstractViewShadowNode<ViewComponentName, ViewProps>;
template class AbstractViewShadowNode<DivComponentName, DivProps>;
template class AbstractViewShadowNode<ElementBoxComponentName, ElementBoxProps>;

} // namespace facebook::react
