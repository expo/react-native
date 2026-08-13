/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/TransitionPrimitives.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ShadowNodeFamily.h>
#include <react/renderer/graphics/Color.h>
#include <react/renderer/graphics/Transform.h>
#include <react/renderer/uimanager/UIManager.h>
#include <react/renderer/uimanager/UIManagerCommitHook.h>

#include <memory>
#include <mutex>
#include <unordered_map>
#include <vector>

#include "AnimationBackend.h"
#include "CSSTransitionsTrace.h"

namespace facebook::react {

/*
 * The value a transition moves between: exactly one of these is meaningful,
 * chosen by the property.
 */
struct TransitionValue {
  Float number{0.0f};
  SharedColor color{};
  Transform transform{};
};

/*
 * One property of one view, mid-flight. Exists only while animating: created
 * when a commit changes a declared property, erased on the frame that writes
 * the final value. There is deliberately NO memory beyond the flight itself —
 * every past defense that remembered values across transitions (a last-written
 * record, settle frames re-asserting finals, echo detection) existed to
 * survive interpolated values leaking into committed trees, and since frames
 * stopped going through the animated-props registry no such values exist
 * outside this struct. State that outlives its need does not just cost memory:
 * the map is keyed by tag, tags are reused across reloads, and a remembered
 * value from a dead view is a wrong `from` for whatever unrelated element
 * inherits its tag.
 */
struct RunningTransition {
  TransitionProperty property{TransitionProperty::Opacity};
  TransitionValue from{};
  TransitionValue to{};
  // Stamped by the first frame that sees it: a commit's clock and the frame
  // clock do not share an epoch.
  bool awaitingFirstFrame{true};
  double startTime{0.0};
  double delay{0.0};
  double duration{0.0};
  TransitionTimingFunction timingFunction{};
};

struct ViewTransitions {
  Tag tag{};
  std::shared_ptr<const ShadowNodeFamily> family;
  std::vector<RunningTransition> running;
  // Percent-valued transform ops resolve against the view's own laid-out
  // size, which only the tree knows. Looked up lazily, and only by the
  // transitions that actually use percents.
  bool needsSize{false};
  Size size{};
};

/*
 * One CSS animation on one view (css-animations-1). Unlike a transition, an
 * animation is not a diff: it starts when a committed node carries it and
 * stops when the node stops carrying it (or its iterations run out). The only
 * state beyond the parsed spec is the base values — what the committed props
 * say without the animation's influence — because `animation-fill-mode: none`
 * ends by reverting to them, and cancellation does the same.
 */
struct RunningAnimation {
  Tag tag{};
  std::shared_ptr<const ShadowNodeFamily> family;
  CSSAnimation spec{};
  // Committed values for every property the keyframes touch.
  std::vector<std::pair<TransitionProperty, TransitionValue>> baseValues{};
  bool awaitingFirstFrame{true};
  double startTime{0.0};
  // Percent-valued transform ops (`translateX(-100%)`) resolve against the
  // view's own size, which is only known once layout has run — looked up
  // lazily from the committed tree and cached.
  bool needsSize{false};
  Size size{};
  // Set when the node stopped carrying the animation: the next frame writes
  // the base values once and erases the entry.
  bool cancelled{false};
};

/*
 * CSS transitions (css-transitions-1), run in the renderer.
 *
 * The frames come from the shared animation backend's tick — a display link
 * on iOS, the Choreographer on Android — so a transition keeps running while
 * the JavaScript thread is busy, which is the reason the property exists.
 *
 * Two halves, and no more than two:
 *
 *   - a commit hook diffs each transitioning view's old props against its new
 *     ones, starting or re-aiming transitions. Committed trees carry ONLY
 *     author values (frames are applied straight to mounted views and touch
 *     no tree), so the old tree is a trustworthy `from` and the new tree is a
 *     trustworthy target.
 *   - a frame callback interpolates every running transition and writes the
 *     results directly through UIManager. The completion frame writes the
 *     exact target — the same value the committed tree already holds, so a
 *     racing mount and the final write agree by construction.
 */
class CSSTransitions final : public UIManagerCommitHook {
 public:
  explicit CSSTransitions(UIManager& uiManager);
  ~CSSTransitions() noexcept override;

  /*
   * Set after construction: this class must register its commit hook BEFORE
   * the AnimationBackend registers its own, because hooks run in registration
   * order and the backend's hook rewrites trees for the views Animated owns.
   */
  void setAnimationBackend(
      std::weak_ptr<UIManagerAnimationBackend> animationBackend);

  void commitHookWasRegistered(const UIManager& uiManager) noexcept override {}
  void commitHookWasUnregistered(
      const UIManager& uiManager) noexcept override {}

  RootShadowNode::Unshared shadowTreeWillCommit(
      const ShadowTree& shadowTree,
      const RootShadowNode::Shared& oldRootShadowNode,
      const RootShadowNode::Unshared& newRootShadowNode,
      const ShadowTreeCommitOptions& commitOptions) noexcept override;

  /*
   * The per-frame step: interpolate, write, erase what finished. Public so a
   * test can drive it with its own clock.
   */
  void frame(double nowMs);

  std::shared_ptr<CSSTransitionsTrace> trace() const {
    return trace_;
  }

 private:
  void diffNode(const ShadowNode& oldNode, const ShadowNode& newNode);
  // A subtree with no old counterpart: freshly mounted. Transitions do not
  // start here (no previous value exists — that is what @starting-style is
  // for) but ANIMATIONS do: an animation runs because the node carries it.
  void visitFreshNode(const ShadowNode& node);
  // Latches sawTransitionableContent_ when props declare a transition.
  void noteTransitionableContent(const ViewProps* viewProps);
  void syncAnimation(const ShadowNode& node);
  void writeAnimationFrame(RunningAnimation& animation, double nowMs);
  // The laid-out size of a view, for resolving percent transforms.
  Size resolveViewSize(const ShadowNodeFamily& family);
  // The entry's size, resolved from the tree the first time something asks.
  Size sizeFor(ViewTransitions& entry);

  UIManager& uiManager_;
  std::weak_ptr<UIManagerAnimationBackend> animationBackend_;
  CallbackId callbackId_{0};
  bool started_{false};
  // Whether a committed tree has ever carried a `transition-*` declaration.
  // Registering the frame callback resumes the choreographer, and a paused
  // display link does not deliver until the next vsync — so a callback
  // registered at the moment the FIRST transition starts arrives one frame
  // after the commit that started it, and the mounting layer has already put
  // the committed target on screen. That frame is the difference between a
  // switch that slides and one that snaps on, snaps back, and then slides.
  // Registering as soon as transitionable content exists pays the resume
  // before anything is waiting on it.
  bool sawTransitionableContent_{false};

  std::shared_ptr<CSSTransitionsTrace> trace_{CSSTransitionsTrace::shared()};

  // Touched by the commit hook (whatever thread commits) and the frame
  // callback (the UI thread); every access is guarded.
  std::mutex mutex_;
  std::unordered_map<Tag, ViewTransitions> transitions_;
  std::unordered_map<Tag, RunningAnimation> animations_;
  double lastFrameTime_{0.0};
};

} // namespace facebook::react
