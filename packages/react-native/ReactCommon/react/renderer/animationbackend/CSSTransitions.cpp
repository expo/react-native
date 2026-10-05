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
#include <string>

namespace facebook::react {

namespace {

constexpr TransitionProperty kInterpolatedProperties[] = {
    TransitionProperty::Opacity,
    TransitionProperty::BackgroundColor,
    TransitionProperty::BorderColor,
    TransitionProperty::Transform,
};

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
      value.color = props.borderColors.all.value_or(SharedColor{});
      break;
    case TransitionProperty::Transform:
      value.transform = props.transform;
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
    case TransitionProperty::All:
      return true;
  }
  return true;
}

// Whether any op resolves against the element's own size
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

// Premultiplied sRGB, so a fade to transparent keeps its hue
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
    const auto premultiplied = interpolateFloat(
        fromChannel * fromAlpha, toChannel * toAlpha, progress);
    return alpha == 0.0f ? 0.0f : premultiplied / alpha;
  };

  return colorFromComponents(
      ColorComponents{
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
    case TransitionProperty::All:
      break;
  }
}

// A value for the trace: enough to tell which it is
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
    case TransitionProperty::All:
      return "all";
  }
  return "?";
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
    case TransitionProperty::All:
      return "all";
  }
  return "?";
}

} // namespace

CSSTransitions::CSSTransitions(UIManager& uiManager) : uiManager_(uiManager) {
  uiManager_.registerCommitHook(*this);
}

CSSTransitions::~CSSTransitions() noexcept {
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
}

RootShadowNode::Unshared CSSTransitions::shadowTreeWillCommit(
    const ShadowTree& /*shadowTree*/,
    const RootShadowNode::Shared& oldRootShadowNode,
    const RootShadowNode::Unshared& newRootShadowNode,
    const ShadowTreeCommitOptions& /*commitOptions*/) noexcept {
  if (oldRootShadowNode == nullptr || newRootShadowNode == nullptr) {
    return newRootShadowNode;
  }

  auto backend = animationBackend_.lock();
  if (!backend) {
    return newRootShadowNode;
  }

  diffNode(*oldRootShadowNode, *newRootShadowNode);

  {
    // An animation whose node left the committed tree is cancelled; the next
    // frame writes its base values once and drops it
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
        // Frames are written through UIManager; the backend must remember
        // nothing, or its commit hook re-bakes interpolated values into trees
        return AnimationMutations{};
      });
    }
  }

  return newRootShadowNode;
}

void CSSTransitions::diffNode(
    const ShadowNode& oldNode,
    const ShadowNode& newNode) {
  // An untouched subtree is the same node
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
      const auto* declared =
          findTransition(newViewProps->transitions(), property);
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
        // A new target mid-flight continues from the current value
        // (css-transitions-1 §3)
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
        trace_->log(
            "reaim t=" + std::to_string(tag) + " " + propName(property) +
            " ->" + describeValue(target, property));
        if (property == TransitionProperty::Transform &&
            hasPercentOps(target.transform)) {
          entryIt->second.needsSize = true;
        }
        existing->from =
            interpolateValue(*existing, eased, sizeFor(entryIt->second));
        existing->to = target;
        existing->awaitingFirstFrame = true;
        existing->delay = declared->delay;
        existing->duration = declared->duration;
        existing->timingFunction = declared->timingFunction;
        continue;
      }

      const auto previous = currentValue(*oldViewProps, property);
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
          (hasPercentOps(previous.transform) ||
           hasPercentOps(target.transform))) {
        entry.needsSize = true;
      }

      RunningTransition transition;
      transition.property = property;
      transition.from = previous;
      transition.to = target;
      transition.delay = declared->delay;
      transition.duration = declared->duration;
      transition.timingFunction = declared->timingFunction;
      entry.running.push_back(transition);
    }
  }

  // Children pair by family, not by index: a shifted list must not hand one
  // view another's values
  const auto& oldChildren = oldNode.getChildren();
  const auto& newChildren = newNode.getChildren();
  for (size_t i = 0; i < newChildren.size(); i++) {
    const auto& newChild = newChildren[i];
    if (i < oldChildren.size() &&
        &oldChildren[i]->getFamily() == &newChild->getFamily()) {
      diffNode(*oldChildren[i], *newChild);
      continue;
    }
    bool matched = false;
    for (const auto& oldChild : oldChildren) {
      if (&oldChild->getFamily() == &newChild->getFamily()) {
        diffNode(*oldChild, *newChild);
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
  const auto* viewProps = dynamic_cast<const ViewProps*>(node.getProps().get());
  const auto tag = node.getTag();

  std::scoped_lock lock(mutex_);
  auto it = animations_.find(tag);

  if (viewProps == nullptr || !viewProps->animation().has_value()) {
    if (it != animations_.end() && !it->second.cancelled) {
      it->second.cancelled = true;
      trace_->log("anim-cancel t=" + std::to_string(tag));
    }
    return;
  }

  const auto& spec = *viewProps->animation();
  if (it != animations_.end()) {
    if (it->second.spec == spec) {
      it->second.cancelled = false;
      return;
    }
    // A changed animation restarts (css-animations-1 §3)
    animations_.erase(it);
  }

  RunningAnimation animation;
  animation.tag = tag;
  animation.family = node.getFamilyShared();
  animation.spec = spec;
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
      "anim-start t=" + std::to_string(tag) +
      " stops=" + std::to_string(spec.keyframes.size()) +
      " dur=" + std::to_string(static_cast<int>(spec.duration)) +
      (spec.iterations < 0 ? " inf" : ""));
  animations_.emplace(tag, std::move(animation));
}

// The view's laid-out size, read from the committed tree once something
// with a percent transform asks; against an empty size every percent op
// collapses to no movement
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
  std::scoped_lock lock(mutex_);
  lastFrameTime_ = nowMs;

  for (auto it = transitions_.begin(); it != transitions_.end();) {
    auto& entry = it->second;
    AnimatedPropsBuilder builder;

    for (auto running = entry.running.begin();
         running != entry.running.end();) {
      if (running->awaitingFirstFrame) {
        running->awaitingFirstFrame = false;
        running->startTime = nowMs + running->delay;
      }
      const auto rawProgress = running->duration <= 0.0
          ? static_cast<Float>(1)
          : static_cast<Float>(
                (nowMs - running->startTime) / running->duration);
      const auto progress =
          std::clamp(rawProgress, static_cast<Float>(0), static_cast<Float>(1));
      const auto eased = running->timingFunction.evaluate(progress);

      buildValue(
          builder,
          running->property,
          interpolateValue(*running, eased, sizeFor(entry)));

      if (rawProgress >= 1.0f) {
        // The value just written is the target, which the committed tree
        // holds too
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
      auto dyn = animationbackend::packAnimatedProps(props);
      uiManager_.synchronouslyUpdateViewOnUIThread(entry.tag, dyn);
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
    if (animation.spec.iterations >= 0 &&
        nowMs - animation.startTime >=
            animation.spec.duration * animation.spec.iterations) {
      trace_->log("anim-done t=" + std::to_string(animation.tag));
      it = animations_.erase(it);
    } else {
      ++it;
    }
  }
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

  // Before the delay: `backwards`/`both` fill from the first keyframe
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
        // Interpolating with itself resolves percent units against the size
        builder.setTransform(
            Transform::Interpolate(
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

  // Which iteration, and where inside it; the final frame clamps to the end
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
    iteration -= 1;
    local = 1.0f;
  }

  // css-animations-1 §4.4
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

  // Finished: `forwards`/`both` hold the last keyframe, the rest revert
  if (atEnd && spec.fillMode != AnimationFillMode::Forwards &&
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

  // Each property between the keyframes that declare it, eased per segment
  // (css-animations-1 §4.1)
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
