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
    std::scoped_lock lock(mutex_);
    if ((!transitions_.empty() || sawTransitionableContent_) &&
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
  noteTransitionableContent(viewProps);
  for (const auto& child : node.getChildren()) {
    visitFreshNode(*child);
  }
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

}

} // namespace facebook::react
