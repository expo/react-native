/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/components/view/TransitionPrimitives.h>
#include <react/renderer/core/LayoutMetrics.h>
#include <react/renderer/core/ReactPrimitives.h>
#include <react/renderer/mounting/MountingOverrideDelegate.h>
#include <react/renderer/mounting/MountingTransaction.h>
#include <react/renderer/mounting/ShadowView.h>
#include <react/renderer/mounting/ShadowViewMutation.h>

#include <memory>
#include <mutex>
#include <optional>
#include <unordered_map>
#include <unordered_set>

#include "CSSTransitionsTrace.h"

namespace facebook::react {

class UIManager;

/*
 * Transitions of LAYOUT properties, run at the mounting layer.
 *
 * A `height` or `padding-bottom` transition moves other views: the reserve a
 * balloon gives back is space its whole column slides into. Interpolating the
 * PROPERTY therefore meant a commit per frame — a tree clone, a Yoga pass, a
 * diff and a mounting transaction, fifteen times over to move a box thirteen
 * points — and every one of those commits dragged the app's own transaction
 * observers behind it. That is the cost this class exists to delete.
 *
 * The shape instead is the one both platforms use for their own layout
 * animations (`UIView animateWithDuration:` and Android's ChangeBounds alike):
 * lay out ONCE at the destination, and glide the mounted views between two
 * real layouts. Concretely:
 *
 *   - the commit hook lets the author's commit through UNTOUCHED — committed
 *     trees carry only author values, always. For attribution it lays out a
 *     SCRATCH clone of the same tree with the transitioned properties still
 *     at their old values, and hands this class every node's metrics from it:
 *     the world as it would be if everything else in the commit had happened
 *     and the transition had not;
 *   - when the commit's transaction is pulled, each view whose committed
 *     metrics differ from its scratch metrics is a flight — from the scratch
 *     world, to the committed one — and mounts at its starting metrics, so
 *     nothing on screen jumps. A view whose scratch and committed metrics
 *     agree was moved only by the commit's other changes, and lands
 *     instantly, exactly as it would with no transition declared next to it;
 *   - each frame after, `pump` runs a mount pass with no commit behind it and
 *     `pullTransaction` injects `Update` mutations carrying interpolated
 *     metrics, until each flight lands exactly on its committed end.
 *
 * So a transition costs the author's own commit, one scratch Yoga pass at
 * start, and mounted metrics per frame — no additional commits at all. The
 * committed tree is always a REAL, author-true layout. What is given up is
 * mid-flight re-layout: a child whose text would rewrap at an intermediate
 * height keeps its endpoint geometry throughout, the same approximation both
 * platforms make. Registered as a divergence from css-transitions-1, which
 * re-lays-out every frame; see DOM-CSS-LIMITATION(layout-transition-endpoints).
 *
 * Because the interpolated metrics travel as ordinary mount instructions, a
 * platform view that DERIVES from its metrics keeps working mid-flight — the
 * chat balloon reads each frame's padding out of its layout metrics and draws
 * its tail from it, which a Core Animation implementation would starve (the
 * presentation layer is a frame behind; measured). And because the engine is
 * this one class in shared C++, both platforms get the same curves from the
 * same solver and the same answers in the edge cases — retarget, interrupt,
 * unmount — rather than two animation systems' approximations of each other.
 */
class CSSLayoutTransitions : public MountingOverrideDelegate {
 public:
  /* One transition's clock: shared by the declaring node's flight and by
     every knock-on movement attributed to it. */
  struct Timeline {
    double delay{0.0};
    double duration{0.0};
    TransitionTimingFunction curve{};
  };

  explicit CSSLayoutTransitions(std::shared_ptr<CSSTransitionsTrace> trace);

  /*
   * From the commit hook, for a commit that starts or re-aims layout
   * transitions. `timelines` carries each declaring node's own clock;
   * `scratchMetrics` is every node's metrics from the scratch layout — the
   * world without the transition. The transaction that consumes this is the
   * one that carries a declaring node's metric change; transactions that
   * mount in between (a state write, an unrelated update) pass by untouched.
   * Any OTHER view moved by the consuming transaction rides the longest of
   * the clocks, because a knock-on has no declaration of its own to read one
   * from. (Distinct clocks in one commit therefore share their knock-ons'
   * pacing with the longest; see
   * DOM-CSS-LIMITATION(layout-transition-endpoints).)
   */
  void beginCapture(
      SurfaceId surfaceId,
      std::unordered_map<Tag, Timeline> timelines,
      std::unordered_map<Tag, LayoutMetrics> scratchMetrics);

  /*
   * The per-frame step, on the UI thread: run a mount pass for every surface
   * still flying — `pullTransaction` injects the frame — drop surfaces that
   * no longer exist, and expire captures whose transaction never arrived.
   */
  void pump(double nowMs, UIManager& uiManager);

  /* Whether anything is capturing or flying — the reason to keep ticking. */
  bool hasWork() const;

#pragma mark - MountingOverrideDelegate

  bool shouldOverridePullTransaction() const override;
  std::optional<MountingTransaction> pullTransaction(
      SurfaceId surfaceId,
      MountingTransaction::Number number,
      const TransactionTelemetry& telemetry,
      ShadowViewMutationList mutations) const override;

 private:
  /* One view gliding between two real layouts. */
  struct Flight {
    LayoutMetrics from{EmptyLayoutMetrics};
    LayoutMetrics to{EmptyLayoutMetrics};
    /*
     * The ShadowView as last emitted: interpolated metrics, current props.
     * The next emission's `oldChildShadowView`, so the mutation stream stays
     * coherent for a mounting layer that diffs old against new.
     */
    ShadowView prev{};
    Tag parentTag{};
    Timeline timeline{};
    double startTime{0.0};
  };

  struct Capture {
    std::unordered_map<Tag, Timeline> timelines;
    Timeline governing{};
    std::unordered_map<Tag, LayoutMetrics> scratchMetrics;
    double startTime{0.0};
  };

  LayoutMetrics interpolatedMetrics(const Flight& flight, double nowMs) const;
  bool flightDone(const Flight& flight, double nowMs) const;

  std::shared_ptr<CSSTransitionsTrace> trace_;

  /*
   * Touched by the commit hook (whatever thread commits), the frame (UI
   * thread) and `pullTransaction` (whatever thread mounts); every access is
   * guarded. Mutable because `pullTransaction` is const on the interface and
   * is exactly where flights advance.
   */
  mutable std::mutex mutex_;
  mutable std::unordered_map<SurfaceId, std::unordered_map<Tag, Flight>>
      flights_;
  mutable std::unordered_map<SurfaceId, Capture> capture_;
  /*
   * The frame clock, stamped by `pump`. A pull caused by a commit between
   * frames reads a clock up to one frame stale, which mislocates a passing
   * rewrite by at most 17ms — and the next frame corrects it.
   */
  mutable double lastFrameTime_{0.0};
};

} // namespace facebook::react
