/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "CSSTransitions.h"

#include <react/renderer/animationbackend/AnimatedPropsBuilder.h>
#include <react/renderer/animationbackend/AnimatedPropsSerializer.h>
#include <react/renderer/mounting/ShadowTree.h>

#include <algorithm>
#include <cmath>
#include <set>
#include <string>
#include <unordered_map>
#include <unordered_set>

namespace facebook::react {

namespace {

constexpr TransitionProperty kInterpolatedProperties[] = {
    TransitionProperty::Opacity,
    TransitionProperty::BackgroundColor,
    TransitionProperty::BorderColor,
    TransitionProperty::Transform,
    TransitionProperty::Height,
    TransitionProperty::PaddingBottom,
};

/*
 * Whether a frame of this property can be written straight to a mounted view.
 *
 * The first four properties change what a view PAINTS and nothing else, so a
 * frame of them is a prop write on the UI thread: no tree, no Yoga, no
 * mounting transaction. `height` changes where things ARE — its siblings move
 * and its ancestors resize — so a frame of it has to be a commit, and this is
 * the one question that decides which path a frame takes.
 */
bool isLayoutAffecting(TransitionProperty property) {
  return property == TransitionProperty::Height ||
      property == TransitionProperty::PaddingBottom;
}

/*
 * Whether two lengths can be interpolated at all.
 *
 * css-transitions-1 interpolates a <length-percentage> only between values of
 * the same type: `auto`, `max-content`, `stretch` and friends are keywords with
 * no number in them, and 10% is not on the way from 10px to 20px. Anything else
 * is a discrete change, which per spec means it applies at once — which is
 * exactly why Radix measures its accordion panel and publishes a pixel height
 * rather than animating to `auto`.
 */
bool lengthsInterpolable(
    const yoga::Style::SizeLength& from,
    const yoga::Style::SizeLength& to) {
  if (from.isPoints() && to.isPoints()) {
    return true;
  }
  return from.isPercent() && to.isPercent();
}

/*
 * The same rule for a padding length, which is a narrower Yoga type.
 *
 * `padding` has no `auto` and no intrinsic keywords, so in practice both ends
 * are points or both are percentages — but an UNDEFINED padding is a real
 * state (nothing declared), and interpolating from it would read as a zero the
 * author never wrote. Refused, which per css-transitions-1 makes it discrete.
 */
bool paddingLengthsInterpolable(
    const yoga::Style::Length& from,
    const yoga::Style::Length& to) {
  if (from.isPoints() && to.isPoints()) {
    return true;
  }
  return from.isPercent() && to.isPercent();
}

TransitionValue currentValue(
    const ViewProps& props,
    TransitionProperty property) {
  TransitionValue value;
  switch (property) {
    case TransitionProperty::Opacity:
      value.number = props.opacity;
      break;
    case TransitionProperty::BackgroundColor:
      value.color = props.backgroundColor;
      break;
    case TransitionProperty::BorderColor:
      // The `all` corner of the cascade, which is what an author setting
      // `borderColor` in one declaration produces.
      value.color = props.borderColors.all.value_or(SharedColor{});
      break;
    case TransitionProperty::Transform:
      value.transform = props.transform;
      break;
    case TransitionProperty::Height:
      value.length = props.yogaStyle.dimension(yoga::Dimension::Height);
      break;
    case TransitionProperty::PaddingBottom:
      value.paddingLength = props.yogaStyle.padding(yoga::Edge::Bottom);
      break;
    case TransitionProperty::All:
      break;
  }
  return value;
}

bool valuesEqual(
    const TransitionValue& a,
    const TransitionValue& b,
    TransitionProperty property) {
  switch (property) {
    case TransitionProperty::Opacity:
      return a.number == b.number;
    case TransitionProperty::BackgroundColor:
    case TransitionProperty::BorderColor:
      return a.color == b.color;
    case TransitionProperty::Transform:
      return a.transform == b.transform;
    case TransitionProperty::Height: {
      // With an EPSILON, unlike the paint properties: a measured height comes
      // back through `onLayout` as a Float, and the same box measures
      // 13.333328 one commit and 13.333344 the next. Exact equality read that
      // wobble as an author change and ran a whole transition to nowhere.
      const auto& av = a.length;
      const auto& bv = b.length;
      if (av.isDefined() && bv.isDefined() &&
          av.isPercent() == bv.isPercent()) {
        return std::abs(av.value().unwrap() - bv.value().unwrap()) < 0.01f;
      }
      return av == bv;
    }
    case TransitionProperty::PaddingBottom: {
      const auto& av = a.paddingLength;
      const auto& bv = b.paddingLength;
      if (av.isDefined() && bv.isDefined() &&
          av.isPercent() == bv.isPercent()) {
        return std::abs(av.value().unwrap() - bv.value().unwrap()) < 0.01f;
      }
      return av == bv;
    }
    case TransitionProperty::All:
      return true;
  }
  return true;
}

/*
 * Whether any op resolves against the element's own size. `translateX(-70%)`
 * is how the web positions a progress fill, and it means nothing without a
 * size to resolve against.
 */
bool hasPercentOps(const Transform& transform) {
  for (const auto& operation : transform.operations) {
    if (operation.x.unit == UnitType::Percent ||
        operation.y.unit == UnitType::Percent ||
        operation.z.unit == UnitType::Percent) {
      return true;
    }
  }
  return false;
}

SharedColor colorFromRGBA(int32_t color) {
  return colorFromComponents(colorComponentsFromColor(SharedColor(color)));
}

Float interpolateFloat(Float from, Float to, Float progress) {
  return from + (to - from) * progress;
}

/*
 * Colours interpolate channel-wise in premultiplied sRGB, which is what a
 * browser does for a plain `background-color` transition. Premultiplied so a
 * fade to transparent does not travel through the wrong hue.
 */
SharedColor interpolateColor(
    const SharedColor& from,
    const SharedColor& to,
    Float progress) {
  auto fromComponents = colorComponentsFromColor(from);
  auto toComponents = colorComponentsFromColor(to);

  const auto fromAlpha = fromComponents.alpha;
  const auto toAlpha = toComponents.alpha;
  const auto alpha = interpolateFloat(fromAlpha, toAlpha, progress);

  auto channel = [&](Float fromChannel, Float toChannel) {
    const auto premultiplied =
        interpolateFloat(fromChannel * fromAlpha, toChannel * toAlpha, progress);
    return alpha == 0.0f ? 0.0f : premultiplied / alpha;
  };

  return colorFromComponents(ColorComponents{
      static_cast<float>(channel(fromComponents.red, toComponents.red)),
      static_cast<float>(channel(fromComponents.green, toComponents.green)),
      static_cast<float>(channel(fromComponents.blue, toComponents.blue)),
      static_cast<float>(alpha)});
}

TransitionValue interpolateValue(
    const RunningTransition& transition,
    Float eased,
    const Size& size) {
  TransitionValue value;
  switch (transition.property) {
    case TransitionProperty::Opacity:
      value.number =
          interpolateFloat(transition.from.number, transition.to.number, eased);
      break;
    case TransitionProperty::BackgroundColor:
    case TransitionProperty::BorderColor:
      value.color =
          interpolateColor(transition.from.color, transition.to.color, eased);
      break;
    case TransitionProperty::Transform:
      value.transform = Transform::Interpolate(
          eased, transition.from.transform, transition.to.transform, size);
      break;
    case TransitionProperty::Height: {
      const auto& from = transition.from.length;
      const auto& to = transition.to.length;
      // Guarded again here rather than trusted: a mid-flight re-aim can change
      // the target's unit, and an unresolved endpoint would interpolate as a
      // zero. A pair that cannot be interpolated holds the target, which is the
      // discrete change the spec asks for.
      if (!lengthsInterpolable(from, to)) {
        value.length = to;
        break;
      }
      const auto interpolated = interpolateFloat(
          from.value().unwrap(), to.value().unwrap(), eased);
      value.length = to.isPercent()
          ? yoga::Style::SizeLength::percent(static_cast<float>(interpolated))
          : yoga::Style::SizeLength::points(static_cast<float>(interpolated));
      break;
    }
    case TransitionProperty::PaddingBottom: {
      const auto& from = transition.from.paddingLength;
      const auto& to = transition.to.paddingLength;
      if (!paddingLengthsInterpolable(from, to)) {
        value.paddingLength = to;
        break;
      }
      const auto interpolated = interpolateFloat(
          from.value().unwrap(), to.value().unwrap(), eased);
      value.paddingLength = to.isPercent()
          ? yoga::Style::Length::percent(static_cast<float>(interpolated))
          : yoga::Style::Length::points(static_cast<float>(interpolated));
      break;
    }
    case TransitionProperty::All:
      break;
  }
  return value;
}

void buildValue(
    AnimatedPropsBuilder& builder,
    TransitionProperty property,
    const TransitionValue& value) {
  switch (property) {
    case TransitionProperty::Opacity:
      builder.setOpacity(value.number);
      break;
    case TransitionProperty::BackgroundColor: {
      auto color = value.color;
      builder.setBackgroundColor(color);
      break;
    }
    case TransitionProperty::BorderColor: {
      CascadedBorderColors borderColors;
      borderColors.all = value.color;
      builder.setBorderColor(borderColors);
      break;
    }
    case TransitionProperty::Transform: {
      auto transform = value.transform;
      builder.setTransform(transform);
      break;
    }
    case TransitionProperty::Height:
      builder.setHeight(value.length);
      break;
    case TransitionProperty::PaddingBottom: {
      // Only the BOTTOM edge is carried. `AnimatedProps` applies whichever
      // edges are present, so a cascade with one edge set leaves the author's
      // other three where they were.
      CascadedRectangleEdges<yoga::StyleLength> paddings{};
      paddings.bottom = value.paddingLength;
      builder.setPadding(paddings);
      break;
    }
    case TransitionProperty::All:
      break;
  }
}

/*
 * A compact rendering of a value for the trace: enough to see WHICH value it
 * is, not to reconstruct it.
 */
std::string describeValue(
    const TransitionValue& value,
    TransitionProperty property) {
  switch (property) {
    case TransitionProperty::Opacity:
      return std::to_string(value.number).substr(0, 5);
    case TransitionProperty::BackgroundColor:
    case TransitionProperty::BorderColor:
      return std::to_string(static_cast<int32_t>(*value.color));
    case TransitionProperty::Transform: {
      // Matrix corners identify an interpolated transform; an authored one
      // keeps an identity matrix and lives in its operations, so those show
      // too.
      const auto& m = value.transform.matrix;
      auto out = std::to_string(m[0]).substr(0, 5) + "/" +
          std::to_string(m[12]).substr(0, 6) + " ops" +
          std::to_string(value.transform.operations.size());
      for (const auto& op : value.transform.operations) {
        out += "," + std::to_string(static_cast<int>(op.type)) + ":" +
            std::to_string(op.x.value).substr(0, 5);
      }
      return out;
    }
    case TransitionProperty::Height: {
      const auto& length = value.length;
      if (!length.isPoints() && !length.isPercent()) {
        return "auto";
      }
      return std::to_string(length.value().unwrap()).substr(0, 6) +
          (length.isPercent() ? "%" : "px");
    }
    case TransitionProperty::PaddingBottom: {
      const auto& length = value.paddingLength;
      if (!length.isPoints() && !length.isPercent()) {
        return "none";
      }
      return std::to_string(length.value().unwrap()).substr(0, 6) +
          (length.isPercent() ? "%" : "px");
    }
    case TransitionProperty::All:
      return "all";
  }
  return "?";
}

/*
 * The animating node's props with this frame's values written over them.
 *
 * `AnimationBackend` has a `cloneProps` that does the same thing and is not
 * shared with this one for a reason: it also has to fold in a `rawProps` blob,
 * which is how `Animated` hands values across the JS boundary. A transition
 * builds its values in C++ and never has one, so the whole `RawProps` parse —
 * the expensive half of that function — would run on every frame to merge
 * nothing.
 */
Props::Shared cloneAnimatedProps(
    AnimatedProps& animatedProps,
    const ShadowNode& shadowNode) {
  PropsParserContext propsParserContext{
      shadowNode.getSurfaceId(), *shadowNode.getContextContainer()};
  auto newProps = shadowNode.getComponentDescriptor().cloneProps(
      propsParserContext, shadowNode.getProps(), {});
  auto viewProps = std::const_pointer_cast<BaseViewProps>(
      std::static_pointer_cast<const BaseViewProps>(newProps));
  for (auto& animatedProp : animatedProps.props) {
    cloneProp(*viewProps, *animatedProp);
  }
  return newProps;
}

const char* propName(TransitionProperty property) {
  switch (property) {
    case TransitionProperty::Opacity:
      return "op";
    case TransitionProperty::BackgroundColor:
      return "bg";
    case TransitionProperty::BorderColor:
      return "bd";
    case TransitionProperty::Transform:
      return "tf";
    case TransitionProperty::Height:
      return "h";
    case TransitionProperty::PaddingBottom:
      return "pb";
    case TransitionProperty::All:
      return "all";
  }
  return "?";
}

} // namespace

CSSTransitions::CSSTransitions(UIManager& uiManager) : uiManager_(uiManager) {
  layout_ = std::make_shared<CSSLayoutTransitions>(trace_);
  uiManager_.registerCommitHook(*this);
}

CSSTransitions::~CSSTransitions() noexcept {
  if (scratchHook_ != nullptr) {
    uiManager_.unregisterCommitHook(*scratchHook_);
  }
  uiManager_.unregisterCommitHook(*this);
  if (started_) {
    if (auto backend = animationBackend_.lock()) {
      backend->stop(callbackId_);
    }
  }
}

void CSSTransitions::setAnimationBackend(
    std::weak_ptr<UIManagerAnimationBackend> animationBackend) {
  animationBackend_ = std::move(animationBackend);
  /*
   * Registered HERE, after the backend exists, because hooks run in
   * registration order and this one must run after the backend's — see
   * `buildScratch`.
   */
  if (scratchHook_ == nullptr) {
    scratchHook_ = std::make_unique<ScratchHook>(*this);
    uiManager_.registerCommitHook(*scratchHook_);
  }
}

/*
 * Lazily makes sure this commit's surface asks the layout engine at mount
 * time. Layout frames are mounted, not committed, so the mounting layer has
 * to know where to ask for them — and the commit hook is the one place that
 * reliably sees every surface: a root started through `startEmptySurface`,
 * which is how a test harness starts one, notifies no delegate and runs no
 * surface-start callback. First-commit is early enough by construction — a
 * transition needs a previous committed value before it can start.
 */
void CSSTransitions::installOnSurface(const ShadowTree& shadowTree) {
  auto coordinator = shadowTree.getMountingCoordinator();
  {
    std::scoped_lock lock(mutex_);
    auto it = installedCoordinators_.find(shadowTree.getSurfaceId());
    if (it != installedCoordinators_.end() &&
        it->second.lock() == coordinator) {
      return;
    }
    installedCoordinators_[shadowTree.getSurfaceId()] = coordinator;
  }
  trace_->log(
      "layout-install s=" + std::to_string(shadowTree.getSurfaceId()));
  coordinator->setMountingOverrideDelegate(
      std::weak_ptr<const MountingOverrideDelegate>(layout_));
}

RootShadowNode::Unshared CSSTransitions::shadowTreeWillCommit(
    const ShadowTree& shadowTree,
    const RootShadowNode::Shared& oldRootShadowNode,
    const RootShadowNode::Unshared& newRootShadowNode,
    const ShadowTreeCommitOptions& commitOptions) noexcept {
  /*
   * This class's OWN commit, from `applyLayoutFrames`. Nothing in it is an
   * author change — it is one frame of a transition already running — and
   * diffing it would find the interpolated height where the target used to be
   * and re-aim at it, so the transition would chase its own tail and never
   * end. Checked before the lock is taken: the commit is synchronous on this
   * thread and `mutex_` is not recursive.
   */
  if (applyingFrame_) {
    return newRootShadowNode;
  }
  if (oldRootShadowNode == nullptr || newRootShadowNode == nullptr) {
    return newRootShadowNode;
  }
  /*
   * Author changes arrive in React's own commits and nowhere else. This fork
   * branches commits, and the promotion that merges a react-branch commit
   * into the main revision runs the hooks AGAIN with the two trees swapped
   * around the change — a transition to 120 shows up a second time as
   * "120 -> 20", indistinguishable by values from a real reversal. Measured
   * on a device as every transition being chased by its own mirror. The
   * commit SOURCE is the discriminator: a merge is `ReactRevisionMerge`, a
   * state write is `Unknown`, Animated's flush is `AnimationEndSync`, and
   * none of them can carry an author's change.
   */
  if (commitOptions.source != ShadowTreeCommitSource::React) {
    return newRootShadowNode;
  }

  auto backend = animationBackend_.lock();
  if (!backend) {
    return newRootShadowNode;
  }

  installOnSurface(shadowTree);

  std::vector<LayoutStart> layoutStarts;
  diffNode(*oldRootShadowNode, *newRootShadowNode, layoutStarts);

  {
    // Animations whose node no longer exists in the committed tree are
    // cancelled; the next frame writes their base values once and drops them.
    // Entries are few (whatever is animating on screen), and an ancestor walk
    // is proportional to depth, so this stays cheap.
    std::scoped_lock lock(mutex_);
    for (auto& [tag, animation] : animations_) {
      if (!animation.cancelled &&
          animation.family->getAncestors(*newRootShadowNode).empty() &&
          newRootShadowNode->getFamilyShared() != animation.family) {
        animation.cancelled = true;
        trace_->log("anim-unmount t=" + std::to_string(tag));
      }
    }
  }

  {
    std::scoped_lock lock(mutex_);
    if ((!transitions_.empty() || !animations_.empty() ||
         sawTransitionableContent_) &&
        !started_) {
      started_ = true;
      trace_->log("backend-start");
      callbackId_ = backend->start([this](AnimationTimestamp timestamp) {
        frame(timestamp.count());
        // Frames apply themselves through UIManager; the backend gets nothing
        // to route, and — deliberately — nothing to remember. Its registry's
        // commit hook re-bakes remembered values into future trees, which is
        // how interpolated values once leaked back in as author targets.
        return AnimationMutations{};
      });
    }
  }

  if (layoutStarts.empty()) {
    return newRootShadowNode;
  }

  /*
   * Half a start: what changed and where it is headed. The scratch layout —
   * the other half — waits for `buildScratch`, which runs later in this same
   * commit's hook chain, after the animation backend has overlaid Animated's
   * mid-flight values onto the tree. The scratch has to be built from THAT
   * tree; built from this one, every flight starts from a world Animated's
   * values never reached.
   */
  {
    std::scoped_lock lock(mutex_);
    auto& pending =
        pendingScratch_[newRootShadowNode->getFamilyShared()->getSurfaceId()];
    for (auto& start : layoutStarts) {
      pending.families.insert(start.family);
      pending.scratchProps[start.tag] = start.scratchProps.get();
      pending.timelines[start.tag] = start.timeline;
    }
  }

  return newRootShadowNode;
}

RootShadowNode::Unshared CSSTransitions::buildScratch(
    const ShadowTree& shadowTree,
    const RootShadowNode::Unshared& newRootShadowNode) noexcept {
  if (newRootShadowNode == nullptr) {
    return newRootShadowNode;
  }
  PendingScratch pending;
  {
    std::scoped_lock lock(mutex_);
    auto it = pendingScratch_.find(shadowTree.getSurfaceId());
    if (it == pendingScratch_.end()) {
      return newRootShadowNode;
    }
    pending = std::move(it->second);
    pendingScratch_.erase(it);
  }

  /*
   * The ATTRIBUTION: lay out the world in which this commit happened but the
   * transition did not, and hand every node's metrics from it to the mounting
   * layer. The commit itself is returned untouched — the committed tree keeps
   * the author's values — and the scratch tree is discarded here; only its
   * numbers survive. One Yoga pass per transition start, in exchange for
   * per-node exactness: a view whose scratch and committed positions agree
   * was moved only by the commit's OTHER changes and will land instantly,
   * however much it shares the commit with a transition.
   *
   * With runtime shadow node reference updates DISABLED, and on the JS
   * thread, where author commits run, they are enabled — every clone would
   * otherwise silently become React's reference for its family, and React's
   * next render diffs its own props against whatever node the reference
   * points at. A scratch node carries the OLD value by design, so leaving
   * updates on handed React a base from the world before the transition: the
   * very next re-render of a transitioning node committed the old value back,
   * verbatim. Disabled around the scratch work exactly the way the animation
   * tick disables it around its own clones, and restored to whatever it was.
   */
  const bool referenceUpdates =
      ShadowNode::getUseRuntimeShadowNodeReferenceUpdateOnThread();
  ShadowNode::setUseRuntimeShadowNodeReferenceUpdateOnThread(false);
  auto scratchRoot =
      std::static_pointer_cast<RootShadowNode>(newRootShadowNode->cloneMultiple(
          pending.families,
          [&pending](
              const ShadowNode& shadowNode, const ShadowNodeFragment& fragment) {
            auto newProps = ShadowNodeFragment::propsPlaceholder();
            auto found = pending.scratchProps.find(shadowNode.getTag());
            if (found != pending.scratchProps.end()) {
              newProps = cloneAnimatedProps(found->second, shadowNode);
            }
            return shadowNode.clone(
                {.props = newProps,
                 .children = fragment.children,
                 .state = shadowNode.getState()});
          }));
  if (scratchRoot == nullptr) {
    // Should be unreachable — the families were just seen in this tree — but
    // a start that cannot be attributed must not block the commit; it will
    // simply mount at its destination.
    ShadowNode::setUseRuntimeShadowNodeReferenceUpdateOnThread(
        referenceUpdates);
    trace_->log("layout-scratch-missed");
    return newRootShadowNode;
  }

  std::vector<const LayoutableShadowNode*> affected;
  scratchRoot->layoutIfNeeded(&affected);
  ShadowNode::setUseRuntimeShadowNodeReferenceUpdateOnThread(referenceUpdates);

  std::unordered_map<Tag, LayoutMetrics> scratchMetrics;
  collectLayoutMetrics(*scratchRoot, scratchMetrics);
  layout_->beginCapture(
      shadowTree.getSurfaceId(),
      std::move(pending.timelines),
      std::move(scratchMetrics));

  return newRootShadowNode;
}

/*
 * Every node's layout metrics, relative to its parent — the same space a
 * mounting transaction's mutations use, which is what they are compared with.
 */
void CSSTransitions::collectLayoutMetrics(
    const ShadowNode& node,
    std::unordered_map<Tag, LayoutMetrics>& metrics) {
  const auto* layoutable = dynamic_cast<const LayoutableShadowNode*>(&node);
  if (layoutable != nullptr) {
    metrics[node.getTag()] = layoutable->getLayoutMetrics();
  }
  for (const auto& child : node.getChildren()) {
    collectLayoutMetrics(*child, metrics);
  }
}

void CSSTransitions::diffNode(
    const ShadowNode& oldNode,
    const ShadowNode& newNode,
    std::vector<LayoutStart>& layoutStarts) {
  // A persistent tree: an untouched subtree is literally the same node, so
  // the walk is proportional to what changed.
  if (&oldNode == &newNode) {
    return;
  }

  const auto* newViewProps =
      dynamic_cast<const ViewProps*>(newNode.getProps().get());
  const auto* oldViewProps =
      dynamic_cast<const ViewProps*>(oldNode.getProps().get());

  if (newViewProps != nullptr) {
    syncAnimation(newNode);
  }

  noteTransitionableContent(newViewProps);

  if (newViewProps != nullptr && oldViewProps != nullptr &&
      !newViewProps->transitions().empty()) {
    const auto tag = newNode.getTag();
    std::scoped_lock lock(mutex_);

    for (auto property : kInterpolatedProperties) {
      const auto* declared = findTransition(newViewProps->transitions(), property);
      if (declared == nullptr) {
        continue;
      }

      const auto target = currentValue(*newViewProps, property);

      auto entryIt = transitions_.find(tag);
      auto* existing = static_cast<RunningTransition*>(nullptr);
      if (entryIt != transitions_.end()) {
        auto found = std::find_if(
            entryIt->second.running.begin(),
            entryIt->second.running.end(),
            [&](const auto& running) { return running.property == property; });
        if (found != entryIt->second.running.end()) {
          existing = &*found;
        }
      }

      if (existing != nullptr) {
        // Mid-flight and the author changed the target: continue from the
        // CURRENT value (css-transitions-1 §3), never snap to an endpoint.
        if (valuesEqual(existing->to, target, property)) {
          continue;
        }
        const auto elapsed = lastFrameTime_ - existing->startTime;
        const auto progress =
            existing->awaitingFirstFrame || existing->duration <= 0.0
            ? static_cast<Float>(0)
            : std::clamp(
                  static_cast<Float>(elapsed / existing->duration),
                  static_cast<Float>(0),
                  static_cast<Float>(1));
        const auto eased = existing->timingFunction.evaluate(progress);
        if (property == TransitionProperty::Transform &&
            hasPercentOps(target.transform)) {
          entryIt->second.needsSize = true;
        }
        const auto current =
            interpolateValue(*existing, eased, sizeFor(entryIt->second));

        /*
         * A REVERSAL is not an ordinary retarget, and css-transitions-1 §3 says
         * how much time it gets.
         *
         * Going back to where this transition would have returned to — its
         * reversing-adjusted start value — is a reversal, and the spec gives it
         * only the fraction of the declared timing that was actually travelled:
         * reversing a quarter-done fade takes a quarter of the duration and a
         * quarter of the delay, not the whole of either. Running the full
         * declared timing (which is what happened before) makes every reversal
         * sluggish, and re-applies the whole delay so a delayed property holds
         * still before it moves.
         *
         * The factor composes through repeated reversals, which is why the spec
         * carries it on the transition rather than deriving it each time: it is
         * the eased output at the moment of the change scaled by the old factor,
         * plus what the old factor left over.
         */
        const bool reversal = valuesEqual(
            existing->reversingAdjustedStart, target, property);
        const auto previousFactor = existing->reversingShorteningFactor;
        const auto factor = reversal
            ? std::clamp(
                  std::abs(
                      static_cast<double>(eased) * previousFactor +
                      (1.0 - previousFactor)),
                  0.0,
                  1.0)
            : 1.0;

        trace_->log(
            "reaim t=" + std::to_string(tag) + " " + propName(property) +
            " ->" + describeValue(target, property) +
            (reversal ? " reversing f=" + std::to_string(factor) : ""));

        existing->reversingAdjustedStart = reversal ? existing->to : current;
        existing->reversingShorteningFactor = factor;
        existing->from = current;
        existing->to = target;
        existing->awaitingFirstFrame = true;
        /*
         * Scaled by the factor, per §3: a negative delay is measured against the
         * combined delay-plus-duration, which is the spec's own wording for a
         * transition that starts already part-way through.
         */
        existing->delay = declared->delay >= 0.0
            ? declared->delay * factor
            : (declared->delay + declared->duration) * factor;
        existing->duration = declared->duration * factor;
        existing->timingFunction = declared->timingFunction;
        continue;
      }

      // Not running: start only on an actual change. Both sides come from
      // committed trees, which carry only author values.
      const auto previous = currentValue(*oldViewProps, property);

      /*
       * A LAYOUT property does not run as a per-frame property interpolation:
       * its frames are mounted metrics, produced by `CSSLayoutTransitions`
       * from two real layouts. The commit goes through UNTOUCHED — committed
       * trees carry only author values, always — and the hook's part is the
       * ATTRIBUTION: a scratch layout of this same tree with the transitioned
       * properties at their old values, which tells the mounting layer where
       * every view would be if the transition had not happened.
       *
       * The hook only ever sees author commits (the source gate above), so
       * the committed old really is the value the author is leaving — the
       * merge that once presented every transition a second time, mirrored,
       * never gets this far.
       */
      if (property == TransitionProperty::Height ||
          property == TransitionProperty::PaddingBottom) {
        if (valuesEqual(previous, target, property)) {
          continue;
        }
        /*
         * Only an INTERPOLABLE pair transitions; anything else is discrete per
         * css-transitions-1 and applies at once, untouched.
         *
         * LOGGED, because a discrete change is invisible in every other record
         * and is exactly what a reported "jump" looks like: the author declared
         * a transition, the value moved, and nothing animated. A trace that only
         * records transitions which START cannot tell "nothing changed" from
         * "the change was refused", and both read as silence. `auto` -> `0` on a
         * height is the case that has already cost a round.
         */
        if (property == TransitionProperty::Height &&
            !lengthsInterpolable(previous.length, target.length)) {
          trace_->log(
              "skip t=" + std::to_string(tag) + " " + propName(property) + " " +
              describeValue(previous, property) + "->" +
              describeValue(target, property) + " not interpolable");
          continue;
        }
        if (property == TransitionProperty::PaddingBottom &&
            !paddingLengthsInterpolable(
                previous.paddingLength, target.paddingLength)) {
          trace_->log(
              "skip t=" + std::to_string(tag) + " " + propName(property) + " " +
              describeValue(previous, property) + "->" +
              describeValue(target, property) + " not interpolable");
          continue;
        }

        trace_->log(
            "start t=" + std::to_string(tag) + " " + propName(property) + " " +
            describeValue(previous, property) + "->" +
            describeValue(target, property));

        auto startIt = std::find_if(
            layoutStarts.begin(), layoutStarts.end(), [tag](const auto& s) {
              return s.tag == tag;
            });
        if (startIt == layoutStarts.end()) {
          layoutStarts.push_back(LayoutStart{
              .tag = tag, .family = newNode.getFamilyShared()});
          startIt = std::prev(layoutStarts.end());
        }
        buildValue(startIt->scratchProps, property, previous);

        /*
         * Two layout properties on one node with two different clocks would
         * need two flights of one box; the longer clock wins. See
         * DOM-CSS-LIMITATION(layout-transition-endpoints).
         */
        if (declared->delay + declared->duration >
            startIt->timeline.delay + startIt->timeline.duration) {
          startIt->timeline = CSSLayoutTransitions::Timeline{
              .delay = declared->delay,
              .duration = declared->duration,
              .curve = declared->timingFunction};
        }
        continue;
      }

      if (valuesEqual(previous, target, property)) {
        continue;
      }

      trace_->log(
          "start t=" + std::to_string(tag) + " " + propName(property) + " " +
          describeValue(previous, property) + "->" +
          describeValue(target, property));

      auto& entry = transitions_[tag];
      entry.tag = tag;
      entry.family = newNode.getFamilyShared();
      if (property == TransitionProperty::Transform &&
          (hasPercentOps(previous.transform) || hasPercentOps(target.transform))) {
        entry.needsSize = true;
      }

      RunningTransition transition;
      transition.property = property;
      transition.from = previous;
      transition.to = target;
      transition.delay = declared->delay;
      transition.duration = declared->duration;
      transition.timingFunction = declared->timingFunction;
      /*
       * A fresh transition would return to where it started, and is entitled to
       * the whole declared timing — css-transitions-1 §3's starting values for
       * the two reversing quantities. Without seeding this, a later change back
       * to `previous` could never be RECOGNISED as a reversal, and the shortening
       * above would never apply.
       */
      transition.reversingAdjustedStart = previous;
      transition.reversingShorteningFactor = 1.0;
      entry.running.push_back(transition);
    }
  }

  // Recurse over pairs that are THE SAME VIEW — the same family — never
  // merely the same position: index-pairing across a shifted list once
  // manufactured a transition on one view from another view's values.
  const auto& oldChildren = oldNode.getChildren();
  const auto& newChildren = newNode.getChildren();
  for (size_t i = 0; i < newChildren.size(); i++) {
    const auto& newChild = newChildren[i];
    if (i < oldChildren.size() &&
        &oldChildren[i]->getFamily() == &newChild->getFamily()) {
      diffNode(*oldChildren[i], *newChild, layoutStarts);
      continue;
    }
    bool matched = false;
    for (const auto& oldChild : oldChildren) {
      if (&oldChild->getFamily() == &newChild->getFamily()) {
        diffNode(*oldChild, *newChild, layoutStarts);
        matched = true;
        break;
      }
    }
    if (!matched) {
      visitFreshNode(*newChild);
    }
  }
}

void CSSTransitions::noteTransitionableContent(const ViewProps* viewProps) {
  if (viewProps == nullptr || viewProps->transitions().empty()) {
    return;
  }
  std::scoped_lock lock(mutex_);
  sawTransitionableContent_ = true;
}

void CSSTransitions::visitFreshNode(const ShadowNode& node) {
  const auto* viewProps = dynamic_cast<const ViewProps*>(node.getProps().get());
  if (viewProps != nullptr) {
    syncAnimation(node);
  }
  noteTransitionableContent(viewProps);
  for (const auto& child : node.getChildren()) {
    visitFreshNode(*child);
  }
}

void CSSTransitions::syncAnimation(const ShadowNode& node) {
  const auto* viewProps =
      dynamic_cast<const ViewProps*>(node.getProps().get());
  const auto tag = node.getTag();

  std::scoped_lock lock(mutex_);
  auto it = animations_.find(tag);

  if (viewProps == nullptr || !viewProps->animation().has_value()) {
    if (it != animations_.end() && !it->second.cancelled) {
      it->second.cancelled = true;
      trace_->log("anim-cancel t=" + std::to_string(tag));
    }
    // The node no longer carries one, so getting it back is a fresh list and
    // has to be allowed to run.
    finished_.erase(tag);
    return;
  }

  const auto& spec = *viewProps->animation();
  if (it != animations_.end()) {
    if (it->second.spec == spec) {
      // Same animation, still running (or filling): nothing to do. This is
      // the common case for every commit that merely re-renders the node.
      it->second.cancelled = false;
      return;
    }
    // The animation itself changed: css-animations restarts it.
    animations_.erase(it);
  }

  // Already run, and the list has not changed since. See `FinishedAnimation`.
  auto doneIt = finished_.find(tag);
  if (doneIt != finished_.end()) {
    if (doneIt->second.spec == spec) {
      return;
    }
    finished_.erase(doneIt);
  }

  RunningAnimation animation;
  animation.tag = tag;
  animation.family = node.getFamilyShared();
  animation.spec = spec;
  // What the committed props say WITHOUT the animation, per animated
  // property: `fill-mode: none` ends by reverting to these, and so does
  // cancellation.
  bool touchesOpacity = false, touchesBg = false, touchesBd = false,
       touchesTf = false;
  for (const auto& keyframe : spec.keyframes) {
    touchesOpacity |= keyframe.opacity.has_value();
    touchesBg |= keyframe.backgroundColor.has_value();
    touchesBd |= keyframe.borderColor.has_value();
    touchesTf |= keyframe.transform.has_value();
  }
  if (touchesOpacity) {
    animation.baseValues.emplace_back(
        TransitionProperty::Opacity,
        currentValue(*viewProps, TransitionProperty::Opacity));
  }
  if (touchesBg) {
    animation.baseValues.emplace_back(
        TransitionProperty::BackgroundColor,
        currentValue(*viewProps, TransitionProperty::BackgroundColor));
  }
  if (touchesBd) {
    animation.baseValues.emplace_back(
        TransitionProperty::BorderColor,
        currentValue(*viewProps, TransitionProperty::BorderColor));
  }
  if (touchesTf) {
    animation.baseValues.emplace_back(
        TransitionProperty::Transform,
        currentValue(*viewProps, TransitionProperty::Transform));
  }
  for (const auto& keyframe : spec.keyframes) {
    if (keyframe.transform.has_value()) {
      for (const auto& operation : keyframe.transform->operations) {
        if (operation.x.unit == UnitType::Percent ||
            operation.y.unit == UnitType::Percent ||
            operation.z.unit == UnitType::Percent) {
          animation.needsSize = true;
        }
      }
    }
  }
  trace_->log(
      "anim-start t=" + std::to_string(tag) + " stops=" +
      std::to_string(spec.keyframes.size()) +
      " dur=" + std::to_string(static_cast<int>(spec.duration)) +
      (spec.iterations < 0 ? " inf" : ""));
  animations_.emplace(tag, std::move(animation));
}

/*
 * The view's laid-out size, read from the committed tree. Percent-valued
 * transform ops (`translateX(-70%)`) resolve against it, and resolving them
 * against zero — which is what an empty Size does — collapses every one of
 * them to no movement at all: a progress bar positioned that way reads 100%
 * and stays there, because even the final frame lands on zero.
 *
 * Only transitions and animations that actually use percent units pay for
 * the lookup, and only until layout has produced a size.
 */
Size CSSTransitions::sizeFor(ViewTransitions& entry) {
  if (entry.needsSize && entry.size.width == 0 && entry.size.height == 0 &&
      entry.family != nullptr) {
    entry.size = resolveViewSize(*entry.family);
  }
  return entry.size;
}

Size CSSTransitions::resolveViewSize(const ShadowNodeFamily& family) {
  Size size{};
  uiManager_.getShadowTreeRegistry().visit(
      family.getSurfaceId(), [&](const ShadowTree& shadowTree) {
        auto root = shadowTree.getCurrentRevision().rootShadowNode;
        if (root == nullptr) {
          return;
        }
        auto ancestors = family.getAncestors(*root);
        if (ancestors.empty()) {
          return;
        }
        const auto& [parent, index] = ancestors.back();
        const auto& node = *parent.get().getChildren().at(index);
        if (const auto* layoutable =
                dynamic_cast<const LayoutableShadowNode*>(&node)) {
          size = layoutable->getLayoutMetrics().frame.size;
        }
      });
  return size;
}

void CSSTransitions::frame(double nowMs) {
  /*
   * Collected under the lock and applied without it.
   *
   * A layout frame is a commit, a commit runs this class's own hook, and
   * `mutex_` is not recursive — so committing while holding it deadlocks
   * rather than recursing. See `applyingFrame_`.
   */
  std::vector<LayoutFrame> layoutFrames;

  {
  std::scoped_lock lock(mutex_);
  lastFrameTime_ = nowMs;

  for (auto it = transitions_.begin(); it != transitions_.end();) {
    auto& entry = it->second;
    AnimatedPropsBuilder builder;
    bool touchesLayout = false;

    for (auto running = entry.running.begin();
         running != entry.running.end();) {
      if (running->awaitingFirstFrame) {
        running->awaitingFirstFrame = false;
        running->startTime = nowMs + running->delay;
      }
      /*
       * A pair of endpoints that cannot be interpolated is a DISCRETE change:
       * the target applies and the transition is over. Ended here rather than
       * refused at the start, because a mid-flight re-aim can produce the pair
       * — and a transition left running on it would commit the same value
       * every frame for its whole duration.
       */
      const bool discrete =
          (running->property == TransitionProperty::Height &&
           !lengthsInterpolable(running->from.length, running->to.length)) ||
          (running->property == TransitionProperty::PaddingBottom &&
           !paddingLengthsInterpolable(
               running->from.paddingLength, running->to.paddingLength));
      const auto rawProgress = (running->duration <= 0.0 || discrete)
          ? static_cast<Float>(1)
          : static_cast<Float>(
                (nowMs - running->startTime) / running->duration);
      const auto progress =
          std::clamp(rawProgress, static_cast<Float>(0), static_cast<Float>(1));
      const auto eased = running->timingFunction.evaluate(progress);

      touchesLayout |= isLayoutAffecting(running->property);
      buildValue(
          builder,
          running->property,
          interpolateValue(*running, eased, sizeFor(entry)));

      if (rawProgress >= 1.0f) {
        // The value just written IS the target (progress clamps to 1 and
        // every curve ends at 1), which is also what the committed tree
        // holds: nothing needs remembering, so nothing is.
        trace_->log(
            "done t=" + std::to_string(entry.tag) + " " +
            propName(running->property) + " =" +
            describeValue(running->to, running->property));
        running = entry.running.erase(running);
      } else {
        ++running;
      }
    }

    if (!builder.props.empty()) {
      auto props = builder.get();
      if (touchesLayout) {
        /*
         * ALL of this node's properties go through the commit, not only the
         * layout-affecting one. A node transitioning `height` and `opacity`
         * together would otherwise have the two written by two mechanisms on
         * the same frame, and the commit — which rebuilds the node's props
         * from the committed tree — would land last and undo the direct write.
         */
        layoutFrames.push_back(
            {.tag = entry.tag,
             .family = entry.family,
             .props = std::move(props)});
      } else {
        auto dyn = animationbackend::packAnimatedProps(props);
        uiManager_.synchronouslyUpdateViewOnUIThread(entry.tag, dyn);
      }
    }

    if (entry.running.empty()) {
      it = transitions_.erase(it);
    } else {
      ++it;
    }
  }

  for (auto it = animations_.begin(); it != animations_.end();) {
    auto& animation = it->second;
    if (animation.cancelled) {
      // Revert to the committed values and drop.
      AnimatedPropsBuilder builder;
      for (const auto& [property, value] : animation.baseValues) {
        buildValue(builder, property, value);
      }
      if (!builder.props.empty()) {
        auto props = builder.get();
        auto dyn = animationbackend::packAnimatedProps(props);
        uiManager_.synchronouslyUpdateViewOnUIThread(animation.tag, dyn);
      }
      it = animations_.erase(it);
      continue;
    }
    if (animation.awaitingFirstFrame) {
      animation.awaitingFirstFrame = false;
      animation.startTime = nowMs + animation.spec.delay;
    }
    writeAnimationFrame(animation, nowMs);
    // writeAnimationFrame flags completion through `cancelled` reuse is NOT
    // done — it erases via this check instead:
    if (animation.spec.iterations >= 0 &&
        nowMs - animation.startTime >=
            animation.spec.duration * animation.spec.iterations) {
      trace_->log("anim-done t=" + std::to_string(animation.tag));
      // Recorded, and the records of nodes that have since gone are dropped
      // while we are here — see `FinishedAnimation`.
      std::erase_if(finished_, [](const auto& entry) {
        return entry.second.family.expired();
      });
      finished_[animation.tag] =
          FinishedAnimation{animation.family, animation.spec};
      it = animations_.erase(it);
    } else {
      ++it;
    }
  }
  }

  if (!layoutFrames.empty()) {
    applyLayoutFrames(layoutFrames);
  }

  // And the flights advance: a mount pass per flying surface, whose pull asks
  // `CSSLayoutTransitions` for this frame's metrics.
  layout_->pump(nowMs, uiManager_);
}

/*
 * A frame of layout-affecting properties, through a commit.
 *
 * ONE commit per surface per frame, whatever is animating: the cost of a
 * layout frame is a clone of the path down to each animating node, one Yoga
 * pass, and one mounting transaction — and none of that gets cheaper by being
 * done twice. Everything paint-only has already been written directly and is
 * not here at all, so a screen with a `height` transition and twenty `opacity`
 * ones pays for the height and nothing else.
 *
 * Yoga is what makes this affordable rather than merely correct. A pass in
 * which one node's height changed re-measures that node and its ancestors and
 * skips every subtree whose inputs are unchanged, so the work is proportional
 * to the depth of what is animating rather than to the size of the screen.
 */
void CSSTransitions::applyLayoutFrames(std::vector<LayoutFrame>& frames) {
  struct SurfaceBatch {
    std::unordered_set<std::shared_ptr<const ShadowNodeFamily>> families;
    std::unordered_map<Tag, AnimatedProps*> updates;
  };
  std::unordered_map<SurfaceId, SurfaceBatch> batches;
  for (auto& frame : frames) {
    if (frame.family == nullptr) {
      continue;
    }
    auto& batch = batches[frame.family->getSurfaceId()];
    batch.families.insert(frame.family);
    batch.updates[frame.tag] = &frame.props;
  }

  /*
   * Set for the whole commit, and read by `shadowTreeWillCommit` before it
   * takes the lock. The commit below is synchronous and its hooks run on this
   * thread, so without this the hook would diff a tree written by this
   * function and re-aim every running transition at its own last frame.
   */
  applyingFrame_ = true;
  for (auto& [surfaceId, batch] : batches) {
    uiManager_.getShadowTreeRegistry().visit(
        surfaceId, [&batch](const ShadowTree& shadowTree) {
          shadowTree.commit(
              [&batch](const RootShadowNode& oldRootShadowNode) {
                return std::static_pointer_cast<RootShadowNode>(
                    oldRootShadowNode.cloneMultiple(
                        batch.families,
                        [&batch](
                            const ShadowNode& shadowNode,
                            const ShadowNodeFragment& fragment) {
                          auto newProps = ShadowNodeFragment::propsPlaceholder();
                          auto found = batch.updates.find(shadowNode.getTag());
                          if (found != batch.updates.end()) {
                            newProps = cloneAnimatedProps(
                                *found->second, shadowNode);
                          }
                          return shadowNode.clone(
                              {.props = newProps,
                               .children = fragment.children,
                               .state = shadowNode.getState()});
                        }));
              },
              // Mounted on this frame rather than the next: the whole point of
              // running on the choreographer is that the frame lands now.
              {.mountSynchronously = true});
        });
  }
  applyingFrame_ = false;
}

void CSSTransitions::writeAnimationFrame(
    RunningAnimation& animation,
    double nowMs) {
  const auto& spec = animation.spec;
  const auto elapsed = nowMs - animation.startTime;

  AnimatedPropsBuilder builder;

  if (animation.needsSize &&
      (animation.size.width == 0 && animation.size.height == 0)) {
    animation.size = resolveViewSize(*animation.family);
  }

  // Before the delay has elapsed: `backwards`/`both` fill from the first
  // keyframe; otherwise the committed values stand and nothing is written.
  if (elapsed < 0) {
    if (spec.fillMode == AnimationFillMode::Backwards ||
        spec.fillMode == AnimationFillMode::Both) {
      const auto& first = spec.keyframes.front();
      if (first.opacity.has_value()) {
        builder.setOpacity(*first.opacity);
      }
      if (first.backgroundColor.has_value()) {
        auto color = colorFromRGBA(*first.backgroundColor);
        builder.setBackgroundColor(color);
      }
      if (first.borderColor.has_value()) {
        CascadedBorderColors borderColors;
        borderColors.all = colorFromRGBA(*first.borderColor);
        builder.setBorderColor(borderColors);
      }
      if (first.transform.has_value()) {
        // Interpolating the keyframe with itself resolves any percent units
        // against the view's size, same as the running case below.
        builder.setTransform(Transform::Interpolate(
            0.0f, *first.transform, *first.transform, animation.size));
      }
    }
    if (!builder.props.empty()) {
      auto props = builder.get();
      auto dyn = animationbackend::packAnimatedProps(props);
      uiManager_.synchronouslyUpdateViewOnUIThread(animation.tag, dyn);
    }
    return;
  }

  // Which iteration, and where inside it. The final frame of a finite
  // animation clamps to its very end so the last write is exact.
  auto totalProgress = elapsed / spec.duration;
  const bool finite = spec.iterations >= 0;
  bool atEnd = false;
  if (finite && totalProgress >= spec.iterations) {
    totalProgress = spec.iterations;
    atEnd = true;
  }
  auto iteration = std::floor(totalProgress);
  auto local = static_cast<Float>(totalProgress - iteration);
  if (atEnd) {
    // e.g. 3 iterations: totalProgress 3.0 is the END of iteration 2.
    iteration -= 1;
    local = 1.0f;
  }

  // Direction (css-animations-1 §4.4): which way this iteration plays.
  bool reversed = false;
  switch (spec.direction) {
    case AnimationDirection::Normal:
      break;
    case AnimationDirection::Reverse:
      reversed = true;
      break;
    case AnimationDirection::Alternate:
      reversed = std::fmod(iteration, 2.0) >= 1.0;
      break;
    case AnimationDirection::AlternateReverse:
      reversed = std::fmod(iteration, 2.0) < 1.0;
      break;
  }
  if (reversed) {
    local = 1.0f - local;
  }

  // The end state of a finished animation: `forwards`/`both` hold the final
  // keyframe; `none`/`backwards` revert to the committed values.
  if (atEnd &&
      spec.fillMode != AnimationFillMode::Forwards &&
      spec.fillMode != AnimationFillMode::Both) {
    for (const auto& [property, value] : animation.baseValues) {
      buildValue(builder, property, value);
    }
    if (!builder.props.empty()) {
      auto props = builder.get();
      auto dyn = animationbackend::packAnimatedProps(props);
      uiManager_.synchronouslyUpdateViewOnUIThread(animation.tag, dyn);
    }
    return;
  }

  // Interpolate each property between the stops that DECLARE it, with the
  // timing function applied per segment (css-animations-1 §4.1: easing runs
  // between keyframes, not across the whole animation).
  auto interpolateProperty = [&](auto getter, auto emit) {
    const AnimationKeyframe* before = nullptr;
    const AnimationKeyframe* after = nullptr;
    for (const auto& keyframe : spec.keyframes) {
      if (!getter(keyframe)) {
        continue;
      }
      if (keyframe.offset <= local) {
        before = &keyframe;
      }
      if (keyframe.offset >= local && after == nullptr) {
        after = &keyframe;
      }
    }
    if (before == nullptr && after == nullptr) {
      return;
    }
    if (before == nullptr) {
      before = after;
    }
    if (after == nullptr) {
      after = before;
    }
    Float eased = 0.0f;
    if (after->offset > before->offset) {
      const auto segment =
          (local - before->offset) / (after->offset - before->offset);
      eased = spec.timingFunction.evaluate(segment);
    }
    emit(*before, *after, eased);
  };

  interpolateProperty(
      [](const AnimationKeyframe& k) { return k.opacity.has_value(); },
      [&](const AnimationKeyframe& a, const AnimationKeyframe& b, Float t) {
        builder.setOpacity(interpolateFloat(*a.opacity, *b.opacity, t));
      });
  interpolateProperty(
      [](const AnimationKeyframe& k) { return k.backgroundColor.has_value(); },
      [&](const AnimationKeyframe& a, const AnimationKeyframe& b, Float t) {
        auto color = interpolateColor(
            colorFromRGBA(*a.backgroundColor),
            colorFromRGBA(*b.backgroundColor),
            t);
        builder.setBackgroundColor(color);
      });
  interpolateProperty(
      [](const AnimationKeyframe& k) { return k.borderColor.has_value(); },
      [&](const AnimationKeyframe& a, const AnimationKeyframe& b, Float t) {
        CascadedBorderColors borderColors;
        borderColors.all = interpolateColor(
            colorFromRGBA(*a.borderColor), colorFromRGBA(*b.borderColor), t);
        builder.setBorderColor(borderColors);
      });
  interpolateProperty(
      [](const AnimationKeyframe& k) { return k.transform.has_value(); },
      [&](const AnimationKeyframe& a, const AnimationKeyframe& b, Float t) {
        auto transform = Transform::Interpolate(
            t, *a.transform, *b.transform, animation.size);
        builder.setTransform(transform);
      });

  if (!builder.props.empty()) {
    auto props = builder.get();
    auto dyn = animationbackend::packAnimatedProps(props);
    uiManager_.synchronouslyUpdateViewOnUIThread(animation.tag, dyn);
  }
}

} // namespace facebook::react
