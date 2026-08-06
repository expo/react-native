/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "CSSTransitions.h"

#include <react/renderer/animationbackend/AnimatedPropsBuilder.h>
#include <react/renderer/mounting/ShadowTree.h>

#include <algorithm>

namespace facebook::react {

namespace {

/*
 * The current value of a transitionable property, read off a view's props.
 */
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

Float interpolateFloat(Float from, Float to, Float progress) {
  return from + (to - from) * progress;
}

/*
 * Colours interpolate channel-wise in premultiplied sRGB, which is what a
 * browser does for a plain `background-color` transition. Premultiplied so a
 * fade to transparent does not travel through the wrong hue: a straight
 * interpolation of a transparent colour's RGB drags the visible channels
 * toward whatever the invisible endpoint happened to store.
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
    const auto premultiplied = interpolateFloat(
        fromChannel * fromAlpha, toChannel * toAlpha, progress);
    // Back to straight alpha. At zero there is nothing visible to divide out.
    return alpha == 0.0f ? 0.0f : premultiplied / alpha;
  };

  // `Float` is double on iOS and float on Android, while ColorComponents is
  // always float — so these are narrowed explicitly rather than relying on an
  // implicit conversion that only compiles on one platform.
  return colorFromComponents(ColorComponents{
      static_cast<float>(channel(fromComponents.red, toComponents.red)),
      static_cast<float>(channel(fromComponents.green, toComponents.green)),
      static_cast<float>(channel(fromComponents.blue, toComponents.blue)),
      static_cast<float>(alpha)});
}

} // namespace

CSSTransitions::CSSTransitions(UIManager& uiManager) : uiManager_(uiManager) {
  uiManager_.registerCommitHook(*this);
}

void CSSTransitions::setAnimationBackend(
    std::weak_ptr<UIManagerAnimationBackend> animationBackend) {
  animationBackend_ = std::move(animationBackend);
}

CSSTransitions::~CSSTransitions() noexcept {
  uiManager_.unregisterCommitHook(*this);
  if (started_) {
    if (auto backend = animationBackend_.lock()) {
      backend->stop(callbackId_);
    }
  }
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

  // The most recent frame timestamp, which is the only clock this class ever
  // measures in. Zero until the first frame, which simply means nothing is
  // part-way through yet.
  double nowMs;
  {
    std::scoped_lock lock(mutex_);
    nowMs = lastFrameTime_;
  }

  diffNode(*oldRootShadowNode, *newRootShadowNode, nowMs);

  {
    std::scoped_lock lock(mutex_);
    if (!transitions_.empty() && !started_) {
      started_ = true;
      callbackId_ = backend->start([this](AnimationTimestamp timestamp) {
        return mutationsForFrame(timestamp.count());
      });
    }
  }

  return newRootShadowNode;
}

void CSSTransitions::diffNode(
    const ShadowNode& oldNode,
    const ShadowNode& newNode,
    double nowMs) {
  // React's tree is persistent, so an untouched subtree is literally the same
  // node. That makes this walk proportional to what CHANGED rather than to the
  // size of the tree — without it, every commit would pay for the whole app.
  if (&oldNode == &newNode) {
    return;
  }

  const auto* newViewProps =
      dynamic_cast<const ViewProps*>(newNode.getProps().get());
  const auto* oldViewProps =
      dynamic_cast<const ViewProps*>(oldNode.getProps().get());

  if (newViewProps != nullptr && oldViewProps != nullptr &&
      !newViewProps->transitions.empty()) {
    const auto tag = newNode.getTag();
    std::scoped_lock lock(mutex_);
    auto& entry = transitions_[tag];
    entry.tag = tag;
    entry.family = newNode.getFamilyShared();

    for (auto property :
         {TransitionProperty::Opacity,
          TransitionProperty::BackgroundColor,
          TransitionProperty::BorderColor,
          TransitionProperty::Transform}) {
      const auto* declared =
          findTransition(newViewProps->transitions, property);
      if (declared == nullptr) {
        continue;
      }

      const auto target = currentValue(*newViewProps, property);
      auto existing = std::find_if(
          entry.running.begin(), entry.running.end(), [&](const auto& running) {
            return running.property == property;
          });

      if (existing != entry.running.end() && existing->settling) {
        // Settling means the value has arrived. A new target re-aims from the
        // settled final value exactly like a fresh start.
        if (!valuesEqual(existing->to, target, property)) {
          existing->from = existing->to;
          existing->to = target;
          existing->settling = false;
          existing->settleFramesLeft = 0;
          existing->awaitingFirstFrame = true;
          existing->delay = declared->delay;
          existing->duration = declared->duration;
          existing->timingFunction = declared->timingFunction;
        }
        continue;
      }
      if (existing != entry.running.end()) {
        // Already animating this property. If it is heading somewhere new,
        // re-aim it FROM WHERE IT IS — a transition interrupted mid-flight
        // continues from its current value rather than snapping back to where
        // the last one started (css-transitions-1 §3).
        if (!valuesEqual(existing->to, target, property)) {
          const auto elapsed = nowMs - existing->startTime;
          const auto progress = existing->duration <= 0.0
              ? 1.0f
              : std::clamp(
                    static_cast<Float>(elapsed / existing->duration),
                    static_cast<Float>(0),
                    static_cast<Float>(1));
          const auto eased = existing->timingFunction.evaluate(progress);
          TransitionValue current;
          switch (property) {
            case TransitionProperty::Opacity:
              current.number = interpolateFloat(
                  existing->from.number, existing->to.number, eased);
              break;
            case TransitionProperty::BackgroundColor:
            case TransitionProperty::BorderColor:
              current.color = interpolateColor(
                  existing->from.color, existing->to.color, eased);
              break;
            case TransitionProperty::Transform:
              current.transform = Transform::Interpolate(
                  eased, existing->from.transform, existing->to.transform, {});
              break;
            case TransitionProperty::All:
              break;
          }
          existing->from = current;
          existing->to = target;
          existing->awaitingFirstFrame = true;
          existing->duration = declared->duration;
          existing->timingFunction = declared->timingFunction;
        }
        continue;
      }

      // Not running: a transition starts only when the value actually
      // changes. "Changes" is judged against what is ON SCREEN — the value
      // this class last wrote if it has ever animated this property — rather
      // than against the old shadow tree, which the backend's overlay hook
      // rewrites with stale registry values (see ViewTransitions).
      const auto lastWritten = entry.lastWritten.find(property);
      const auto previous = lastWritten != entry.lastWritten.end()
          ? lastWritten->second
          : currentValue(*oldViewProps, property);
      if (valuesEqual(previous, target, property)) {
        continue;
      }

      RunningTransition transition;
      transition.property = property;
      transition.from = previous;
      transition.to = target;
      transition.awaitingFirstFrame = true;
      transition.delay = declared->delay;
      transition.duration = declared->duration;
      transition.timingFunction = declared->timingFunction;
      entry.running.push_back(transition);
    }


  }

  // Recurse over pairs that are THE SAME VIEW — the same ShadowNodeFamily —
  // never merely the same position. Pairing by index looks right until a
  // re-render shifts a list, at which point old[i] and new[i] are different
  // views and the diff manufactures a transition on one view FROM another
  // view's values: pressing one element visibly re-colored an unrelated
  // sibling that also declared transitions. The common case is still cheap —
  // same index, same family, one pointer comparison — and only a structural
  // change pays for a lookup. A node with no old counterpart is newly
  // mounted, and CSS runs no transition on first render (that is what
  // `@starting-style` is for).
  const auto& oldChildren = oldNode.getChildren();
  const auto& newChildren = newNode.getChildren();
  for (size_t i = 0; i < newChildren.size(); i++) {
    const auto& newChild = newChildren[i];
    if (i < oldChildren.size() &&
        &oldChildren[i]->getFamily() == &newChild->getFamily()) {
      diffNode(*oldChildren[i], *newChild, nowMs);
      continue;
    }
    for (const auto& oldChild : oldChildren) {
      if (&oldChild->getFamily() == &newChild->getFamily()) {
        diffNode(*oldChild, *newChild, nowMs);
        break;
      }
    }
  }
}

AnimationMutations CSSTransitions::mutationsForFrame(double nowMs) {
  AnimationMutations mutations;

  std::scoped_lock lock(mutex_);
  lastFrameTime_ = nowMs;
  for (auto it = transitions_.begin(); it != transitions_.end();) {
    auto& entry = it->second;
    AnimatedPropsBuilder builder;
    bool wroteAnything = false;

    for (auto running = entry.running.begin();
         running != entry.running.end();) {
      if (running->settling) {
        // Re-assert the final value (see RunningTransition::settling).
        TransitionValue finalValue = running->to;
        switch (running->property) {
          case TransitionProperty::Opacity:
            builder.setOpacity(finalValue.number);
            break;
          case TransitionProperty::BackgroundColor:
            builder.setBackgroundColor(finalValue.color);
            break;
          case TransitionProperty::BorderColor: {
            CascadedBorderColors borderColors;
            borderColors.all = finalValue.color;
            builder.setBorderColor(borderColors);
            break;
          }
          case TransitionProperty::Transform:
            builder.setTransform(finalValue.transform);
            break;
          case TransitionProperty::All:
            break;
        }
        entry.lastWritten[running->property] = finalValue;
        wroteAnything = true;
        if (--running->settleFramesLeft <= 0) {
          running = entry.running.erase(running);
        } else {
          ++running;
        }
        continue;
      }
      if (running->awaitingFirstFrame) {
        running->awaitingFirstFrame = false;
        running->startTime = nowMs + running->delay;
      }
      const auto elapsed = nowMs - running->startTime;
      // Still inside its `transition-delay`: the property holds its old value
      // rather than jumping, so write the start value and wait.
      const auto rawProgress = running->duration <= 0.0
          ? 1.0f
          : static_cast<Float>(elapsed / running->duration);
      const auto progress =
          std::clamp(rawProgress, static_cast<Float>(0), static_cast<Float>(1));
      const auto eased = running->timingFunction.evaluate(progress);

      TransitionValue written;
      switch (running->property) {
        case TransitionProperty::Opacity:
          written.number =
              interpolateFloat(running->from.number, running->to.number, eased);
          builder.setOpacity(written.number);
          break;
        case TransitionProperty::BackgroundColor: {
          written.color = interpolateColor(
              running->from.color, running->to.color, eased);
          builder.setBackgroundColor(written.color);
          break;
        }
        case TransitionProperty::BorderColor: {
          written.color = interpolateColor(
              running->from.color, running->to.color, eased);
          CascadedBorderColors borderColors;
          borderColors.all = written.color;
          builder.setBorderColor(borderColors);
          break;
        }
        case TransitionProperty::Transform: {
          written.transform = Transform::Interpolate(
              eased, running->from.transform, running->to.transform, {});
          builder.setTransform(written.transform);
          break;
        }
        case TransitionProperty::All:
          break;
      }
      // On the final frame the value written is exactly the target: progress
      // clamps to 1 and every easing curve ends at 1, so the record equals
      // what React committed and the next diff sees no phantom change.
      // For a completed TRANSFORM the record is the AUTHORED target rather
      // than the interpolation's reconstruction of it: the two describe the
      // same geometry but do not compare equal, and the record exists
      // precisely to make that comparison honest.
      if (rawProgress >= 1.0f &&
          running->property == TransitionProperty::Transform) {
        written.transform = running->to.transform;
      }
      entry.lastWritten[running->property] = written;
      wroteAnything = true;

      if (rawProgress >= 1.0f) {
        // ~250ms at 60fps: longer than any commit→mount latency, bounded so a
        // finished transition does not write forever.
        running->settling = true;
        running->settleFramesLeft = 16;
      }
      ++running;
    }

    if (wroteAnything) {
      AnimationMutation mutation;
      mutation.tag = entry.tag;
      mutation.family = entry.family;
      mutation.props = builder.get();
      // None of the four properties affect layout, so these take the backend's
      // synchronous path instead of forcing a commit each frame.
      mutation.hasLayoutUpdates = false;
      mutations.batch.push_back(std::move(mutation));
    }

    // The entry survives with an empty `running`: `lastWritten` is the record
    // the next commit diffs against, and erasing it would resurrect the stale
    // old-tree problem on the very next toggle.
    ++it;
  }

  return mutations;
}

} // namespace facebook::react
