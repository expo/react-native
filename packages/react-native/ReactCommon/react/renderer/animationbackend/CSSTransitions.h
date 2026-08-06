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

#include "AnimatedProps.h"
#include "AnimationBackend.h"

namespace facebook::react {

/*
 * The value a transition moves between. A variant over exactly the property
 * types that can be interpolated, so a running transition does not have to
 * re-derive what it is animating on every frame.
 */
struct TransitionValue {
  Float number{0.0f};
  SharedColor color{};
  Transform transform{};
};

/*
 * One property of one view, mid-flight.
 */
struct RunningTransition {
  TransitionProperty property{TransitionProperty::Opacity};
  TransitionValue from{};
  TransitionValue to{};
  // Milliseconds on the ANIMATION clock — the one the frame callback is handed
  // — not on any clock read at commit time. A commit and a display link do not
  // necessarily share an epoch, and assuming they do makes every transition
  // pin at its first frame. So a new transition is stamped by the first frame
  // that sees it rather than by the commit that created it.
  bool awaitingFirstFrame{true};
  double startTime{0.0};
  double delay{0.0};
  double duration{0.0};
  TransitionTimingFunction timingFunction{};
  /*
   * A completed transition SETTLES before it is dropped: it keeps writing its
   * final value for a bounded run of frames. The value is done animating, but
   * a React commit that was in flight while the last real frames ran has the
   * animated-props overlay BAKED IN from hook time — values that are a frame
   * or two stale — and its mount can land after the final write, silently
   * reverting the view to a mid-flight value. Nothing corrects that revert:
   * the transition is finished, and the overlay re-bakes the same stale
   * snapshot into every later commit, which is exactly the "stuck mid-fade
   * until some unrelated press repaints it" symptom. Settle frames make the
   * final value the last word for longer than any commit→mount latency.
   */
  bool settling{false};
  int settleFramesLeft{0};
};

/*
 * Everything known about a single view's transitions: what is mid-flight, and
 * the value this class last put on screen for each property.
 *
 * `lastWritten` is the ground truth for where a new transition starts, NOT the
 * old shadow tree. The old tree cannot be trusted for that: the backend's
 * commit hook rewrites committed trees with whatever the animated-props
 * registry held at commit time, which is both stale (a frame or a whole leg
 * behind the screen) and representationally different (an interpolated
 * transform does not compare equal to the authored one even at the same
 * geometry). Diffing against it makes a transition start from — or spuriously
 * re-aim at — a value nothing is showing. What this class last wrote IS what
 * the screen shows, which is also exactly the value css-transitions-1 §3 says
 * an interrupted transition continues from.
 */
struct ViewTransitions {
  Tag tag{};
  std::shared_ptr<const ShadowNodeFamily> family;
  std::vector<RunningTransition> running;
  std::unordered_map<TransitionProperty, TransitionValue> lastWritten;
};

/*
 * CSS transitions (css-transitions-1), run in the renderer.
 *
 * The point of putting this here rather than in a JavaScript hook is that the
 * frames come from the shared animation backend, which is driven by a display
 * link on iOS and the Choreographer on Android. A transition therefore keeps
 * running while the JavaScript thread is busy — which is the behaviour CSS
 * describes and the reason the property exists.
 *
 * Two halves:
 *
 *   - a commit hook, which sees every React commit and compares the properties
 *     each view declares as transitionable against their previous values. That
 *     is where a transition is born, and where an in-flight one is re-aimed.
 *   - a backend callback, which is handed a timestamp each frame and returns
 *     the interpolated props for everything still running.
 */
class CSSTransitions final : public UIManagerCommitHook {
 public:
  explicit CSSTransitions(UIManager& uiManager);
  ~CSSTransitions() noexcept override;

  /*
   * Set after construction. The construction order is deliberate: this class
   * has to REGISTER ITS COMMIT HOOK BEFORE the AnimationBackend registers its
   * own, because hooks run in registration order and the backend's hook
   * overlays mid-flight animated values onto every committed tree. A diff that
   * runs after the overlay reads those as the author's targets — and then a
   * transition re-aims at its own previous frame on every commit and never
   * converges. Diffing before the overlay sees only what React committed.
   */
  void setAnimationBackend(
      std::weak_ptr<UIManagerAnimationBackend> animationBackend);

  void commitHookWasRegistered(const UIManager& uiManager) noexcept override {}
  void commitHookWasUnregistered(const UIManager& uiManager) noexcept override {}

  RootShadowNode::Unshared shadowTreeWillCommit(
      const ShadowTree& shadowTree,
      const RootShadowNode::Shared& oldRootShadowNode,
      const RootShadowNode::Unshared& newRootShadowNode,
      const ShadowTreeCommitOptions& commitOptions) noexcept override;

  /*
   * The per-frame step. Public so it can be driven by a test clock rather than
   * only by a display link.
   */
  AnimationMutations mutationsForFrame(double nowMs);

 private:
  void diffNode(
      const ShadowNode& oldNode,
      const ShadowNode& newNode,
      double nowMs);

  UIManager& uiManager_;
  std::weak_ptr<UIManagerAnimationBackend> animationBackend_;
  CallbackId callbackId_{0};
  bool started_{false};

  // Touched by the commit hook (any thread that commits) and by the frame
  // callback (the UI thread), so every access is guarded.
  std::mutex mutex_;
  std::unordered_map<Tag, ViewTransitions> transitions_;
  // The last timestamp the frame callback was given, so the commit hook can
  // ask "how far along is this?" in the animation clock's own units.
  double lastFrameTime_{0.0};
};

} // namespace facebook::react
