/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/TransitionPrimitives.h>
#include <react/renderer/core/LayoutMetrics.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ShadowNodeFamily.h>
#include <react/renderer/graphics/Color.h>
#include <react/renderer/graphics/Transform.h>
#include <react/renderer/mounting/MountingCoordinator.h>
#include <react/renderer/uimanager/UIManager.h>
#include <react/renderer/uimanager/UIManagerCommitHook.h>

#include <yoga/style/Style.h>

#include <atomic>
#include <memory>
#include <mutex>
#include <unordered_map>
#include <vector>

#include "AnimatedPropsBuilder.h"
#include "AnimationBackend.h"
#include "CSSLayoutTransitions.h"
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
  // A length, for `height`. Carries its UNIT as well as its number, because
  // `50%` and `50` are different targets and only endpoints that agree on the
  // unit can be interpolated at all.
  yoga::Style::SizeLength length{};
  /*
   * A length for `padding-bottom`, which is a DIFFERENT Yoga type from a
   * dimension: padding cannot be `auto` or `max-content`, so it is
   * `Style::Length` where `height` is `Style::SizeLength`. Kept as its own field
   * rather than converted, because a conversion would have to invent a meaning
   * for the keywords the narrower type cannot hold.
   */
  yoga::Style::Length paddingLength{};
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
  /*
   * The two quantities css-transitions-1 §3 needs to reverse a transition
   * correctly.
   *
   * `reversingAdjustedStart` is where this transition would return TO if it were
   * reversed — the value the spec compares an incoming target against to decide
   * whether a change is a reversal rather than an ordinary retarget.
   *
   * `reversingShorteningFactor` is how much of the declared timing a reversal is
   * entitled to. Reversing a transition that is a quarter done should take a
   * quarter of the time, not all of it, and the factor carries that through
   * repeated reversals (a reversal of a reversal composes). One means "the full
   * declared timing", which is every transition that has not been reversed.
   */
  TransitionValue reversingAdjustedStart{};
  double reversingShorteningFactor{1.0};
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

/**
 * An animation that has already run, kept so it is not run a second time.
 *
 * An animation starts because a node CARRIES it, so a finished one that is
 * simply forgotten starts again on the next commit that touches the node — and
 * every commit touching a node clones it, so any change to a child is enough.
 * Seen as a receipt under a sent message fading in a second time when its text
 * went from "Delivered" to "Read": the line was already on screen, dropped to
 * nothing, and faded back up.
 *
 * That is not what an animation does. css-animations-1 §4 restarts one when the
 * ELEMENT'S ANIMATION LIST changes — a different `animation-name`, or the
 * element being removed and re-added — and not when some unrelated property
 * does. So a finished animation is remembered against the spec that ran, and
 * runs again only when that spec changes or the node goes away.
 *
 * WEAKLY held, and that is the whole of the bookkeeping. A record cannot be
 * consulted by the wrong node — a component that unmounts and comes back is a
 * new element with a new family and therefore a new tag, so a record for a dead
 * tag is unreachable rather than wrong — which leaves only its memory, and an
 * expired family says when that is free to drop. The alternative is what the
 * running animations do, an ancestor walk per entry per commit, and that is
 * priced for "whatever is animating on screen" rather than for everything that
 * has ever animated and is still mounted.
 */
struct FinishedAnimation {
  std::weak_ptr<const ShadowNodeFamily> family;
  CSSAnimation spec{};
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
   * The second half of a layout-transition start, run by `scratchHook_` AFTER
   * the animation backend's commit hook: builds the scratch layout and hands
   * the capture to the mounting engine. Split from the diff deliberately —
   * the diff has to see author values (before the backend overlays Animated's
   * mid-flight values), but the scratch has to see the world as it will
   * actually MOUNT, overlays included. The first build took the pre-overlay
   * tree and every flight inherited a phantom sixteen-point offset: the rows'
   * Animated-managed width was missing from the scratch world, so everything
   * right-aligned started its glide from the wrong x.
   */
  RootShadowNode::Unshared buildScratch(
      const ShadowTree& shadowTree,
      const RootShadowNode::Unshared& newRootShadowNode) noexcept;

  /*
   * The per-frame step: interpolate, write, erase what finished. Public so a
   * test can drive it with its own clock.
   */
  void frame(double nowMs);

  std::shared_ptr<CSSTransitionsTrace> trace() const {
    return trace_;
  }

 private:
  /*
   * A node whose transitioned LAYOUT property changed in this commit.
   *
   * Layout properties do not run as per-frame property interpolations — their
   * frames are mounted metrics, produced by `CSSLayoutTransitions` from two
   * real layouts. The commit itself carries the target (committed trees hold
   * only author values, always); `scratchProps` holds the transitioned
   * properties at their OLD values, for the scratch layout that answers
   * "where would every view be if this transition had not happened" — the
   * per-node attribution the mounting layer animates against.
   */
  struct LayoutStart {
    Tag tag{};
    std::shared_ptr<const ShadowNodeFamily> family;
    AnimatedPropsBuilder scratchProps;
    CSSLayoutTransitions::Timeline timeline{};
  };

  void installOnSurface(const ShadowTree& shadowTree);

  static void collectLayoutMetrics(
      const ShadowNode& node,
      std::unordered_map<Tag, LayoutMetrics>& metrics);

  void diffNode(
      const ShadowNode& oldNode,
      const ShadowNode& newNode,
      std::vector<LayoutStart>& layoutStarts);
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

  /*
   * One node's worth of a frame that has to go through a commit.
   *
   * Only layout-affecting properties produce these; a frame of paint-only
   * properties is still written straight to the mounted view and never gets
   * this far. See `applyLayoutFrames`.
   */
  struct LayoutFrame {
    Tag tag{};
    std::shared_ptr<const ShadowNodeFamily> family;
    AnimatedProps props;
  };
  void applyLayoutFrames(std::vector<LayoutFrame>& frames);

  UIManager& uiManager_;
  std::weak_ptr<UIManagerAnimationBackend> animationBackend_;

  /*
   * The mounting-layer half of the engine — shared because every surface's
   * `MountingCoordinator` holds it weakly as an override delegate.
   */
  std::shared_ptr<CSSLayoutTransitions> layout_;

  /* Registered after the animation backend's hook; see `buildScratch`. */
  class ScratchHook : public UIManagerCommitHook {
   public:
    explicit ScratchHook(CSSTransitions& owner) : owner_(owner) {}
    void commitHookWasRegistered(const UIManager&) noexcept override {}
    void commitHookWasUnregistered(const UIManager&) noexcept override {}
    RootShadowNode::Unshared shadowTreeWillCommit(
        const ShadowTree& shadowTree,
        const RootShadowNode::Shared& /*oldRootShadowNode*/,
        const RootShadowNode::Unshared& newRootShadowNode,
        const ShadowTreeCommitOptions& /*commitOptions*/) noexcept override {
      return owner_.buildScratch(shadowTree, newRootShadowNode);
    }

   private:
    CSSTransitions& owner_;
  };
  std::unique_ptr<ScratchHook> scratchHook_;

  /*
   * Starts the diff found, waiting for `buildScratch` later in the same
   * commit's hook chain. Keyed by surface because two surfaces can be
   * committing concurrently; within one surface the chain is sequential.
   */
  struct PendingScratch {
    std::unordered_set<std::shared_ptr<const ShadowNodeFamily>> families;
    std::unordered_map<Tag, AnimatedProps> scratchProps;
    std::unordered_map<Tag, CSSLayoutTransitions::Timeline> timelines;
  };
  std::unordered_map<SurfaceId, PendingScratch> pendingScratch_;

  /*
   * Which surface already holds `layout_` as a mounting override delegate,
   * by coordinator IDENTITY, not merely by id: a surface restarted under the
   * same id has a new coordinator with an empty delegate list, and a record
   * keyed by id alone would skip it forever. Installed lazily from the commit
   * hook, the one place that reliably sees every surface — a root started
   * through `startEmptySurface` notifies no delegate and runs no
   * surface-start callback. First-commit is early enough by construction: a
   * transition needs a previous committed value before it can start.
   */
  std::unordered_map<SurfaceId, std::weak_ptr<const MountingCoordinator>>
      installedCoordinators_;



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
  /** Animations that have run to completion. See `FinishedAnimation`. */
  std::unordered_map<Tag, FinishedAnimation> finished_;
  double lastFrameTime_{0.0};

  /*
   * Set while this class is committing a frame of its own.
   *
   * A layout frame IS a commit, and every commit runs the hooks — including
   * this one. Without the guard the hook would diff a tree it wrote itself,
   * see the interpolated height where the author's target used to be, and
   * re-aim the running transition at the value it had just produced: a
   * transition that never reaches its target and never ends.
   *
   * Read BEFORE `mutex_` is taken, and that is not an optimisation. The commit
   * is synchronous and re-enters on this same thread, and `mutex_` is not
   * recursive, so a hook that locked first would deadlock rather than return.
   */
  std::atomic<bool> applyingFrame_{false};
};

} // namespace facebook::react
