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

// The value a transition moves between; the property says which member
struct TransitionValue {
  Float number{0.0f};
  SharedColor color{};
  Transform transform{};
};

/*
 * One property of one view, mid-flight: created when a commit changes a
 * declared property, erased on the frame that writes the final value.
 * Nothing outlives the flight: tags are reused across reloads, so a
 * remembered value would be a wrong `from` for whatever next holds the tag.
 */
struct RunningTransition {
  TransitionProperty property{TransitionProperty::Opacity};
  TransitionValue from{};
  TransitionValue to{};
  // Stamped by the first frame: a commit's clock and the frame clock don't
  // share an epoch
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
  // Percent transform ops resolve against the view's laid-out size, looked up
  // lazily from the tree
  bool needsSize{false};
  Size size{};
};

/*
 * CSS transitions (css-transitions-1) in the renderer, off the JavaScript
 * thread: a commit hook diffs each view's old props against its new ones and
 * starts or re-aims transitions; the shared animation backend's frame
 * callback interpolates and writes straight to the mounted views through
 * UIManager. Committed trees carry only author values, so the old tree is the
 * `from` and the new tree the target, and the completion frame writes the
 * exact target the tree holds.
 */
class CSSTransitions final : public UIManagerCommitHook {
 public:
  explicit CSSTransitions(UIManager &uiManager);
  ~CSSTransitions() noexcept override;

  // Set after construction: this hook must register before the backend's,
  // which rewrites trees for the views Animated owns, and hooks run in order
  void setAnimationBackend(std::weak_ptr<UIManagerAnimationBackend> animationBackend);

  void commitHookWasRegistered(const UIManager &uiManager) noexcept override {}
  void commitHookWasUnregistered(const UIManager &uiManager) noexcept override {}

  RootShadowNode::Unshared shadowTreeWillCommit(
      const ShadowTree &shadowTree,
      const RootShadowNode::Shared &oldRootShadowNode,
      const RootShadowNode::Unshared &newRootShadowNode,
      const ShadowTreeCommitOptions &commitOptions) noexcept override;

  // The per-frame step: interpolate, write, erase what finished
  void frame(double nowMs);

  std::shared_ptr<CSSTransitionsTrace> trace() const
  {
    return trace_;
  }

 private:
  void diffNode(const ShadowNode &oldNode, const ShadowNode &newNode);
  // A freshly mounted subtree: no transition starts, since there is no
  // previous value
  void visitFreshNode(const ShadowNode &node);
  void noteTransitionableContent(const ViewProps *viewProps);
  // The laid-out size of a view, for percent transforms
  Size resolveViewSize(const ShadowNodeFamily &family);
  Size sizeFor(ViewTransitions &entry);

  UIManager &uiManager_;
  std::weak_ptr<UIManagerAnimationBackend> animationBackend_;
  CallbackId callbackId_{0};
  bool started_{false};
  // Whether a committed tree has carried a `transition-*` declaration. The
  // frame callback is registered then, not when the first transition starts:
  // registering resumes the display link, which delivers only from the next
  // vsync, and a transition started on that commit would lose its first frame
  // to the mounted target.
  bool sawTransitionableContent_{false};

  std::shared_ptr<CSSTransitionsTrace> trace_{CSSTransitionsTrace::shared()};

  // Touched by the commit hook and the frame callback, on different threads
  std::mutex mutex_;
  std::unordered_map<Tag, ViewTransitions> transitions_;

  double lastFrameTime_{0.0};
};

} // namespace facebook::react
