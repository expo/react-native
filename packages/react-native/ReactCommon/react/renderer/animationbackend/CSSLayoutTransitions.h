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
 * Transitions of layout properties, run at the mounting layer. A `height` or
 * `padding-bottom` transition moves other views, so interpolating the property
 * would cost a commit (clone, Yoga pass, diff, transaction) per frame. Instead,
 * as both platforms do for their own layout animations, the tree is laid out
 * once at the destination and the mounted views glide between two real
 * layouts:
 *
 *   - the commit hook lets the author's commit through untouched (committed
 *     trees carry only author values) and lays out a scratch clone with the
 *     transitioned properties at their old values, which gives every node's
 *     metrics as they would be had the transition not happened;
 *   - when the commit's transaction is pulled, each view whose committed
 *     metrics differ from its scratch metrics is a flight from the scratch
 *     layout to the committed one and mounts at its starting metrics; a view
 *     whose two metrics agree was moved only by the commit's other changes
 *     and lands instantly;
 *   - each frame after, `pump` runs a mount pass with no commit behind it and
 *     `pullTransaction` injects `Update` mutations with interpolated metrics
 *     until each flight lands on its committed end.
 *
 * What is given up is mid-flight re-layout: a child whose text would rewrap
 * at an intermediate height keeps its endpoint geometry, the approximation
 * both platforms make; see DOM-CSS-LIMITATION(layout-transition-endpoints).
 * Because the metrics travel as ordinary mount instructions, a platform view
 * that derives from its metrics keeps working mid-flight, and both platforms
 * get the same curves and the same retarget, interrupt and unmount behavior
 * from one shared engine.
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
   * `scratchMetrics` is every node's metrics from the scratch layout. The
   * transaction that consumes this is the one carrying a declaring node's
   * metric change; transactions that mount in between pass by untouched. Any
   * other view the consuming transaction moves rides the longest clock, since
   * a knock-on has no declaration of its own; see
   * DOM-CSS-LIMITATION(layout-transition-endpoints).
   */
  void beginCapture(
      SurfaceId surfaceId,
      std::unordered_map<Tag, Timeline> timelines,
      std::unordered_map<Tag, LayoutMetrics> scratchMetrics);

  /*
   * The per-frame step, on the UI thread: a mount pass for every surface
   * still flying (`pullTransaction` injects the frame), dropping surfaces that
   * no longer exist and captures whose transaction never arrived
   */
  void pump(double nowMs, UIManager &uiManager);

  /* Whether anything is capturing or flying, the reason to keep ticking */
  bool hasWork() const;

#pragma mark - MountingOverrideDelegate

  bool shouldOverridePullTransaction() const override;
  std::optional<MountingTransaction> pullTransaction(
      SurfaceId surfaceId,
      MountingTransaction::Number number,
      const TransactionTelemetry &telemetry,
      ShadowViewMutationList mutations) const override;

 private:
  /* One view gliding between two real layouts */
  struct Flight {
    LayoutMetrics from{EmptyLayoutMetrics};
    LayoutMetrics to{EmptyLayoutMetrics};
    /*
     * The ShadowView as last emitted (interpolated metrics, current props),
     * the next emission's `oldChildShadowView`
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

  LayoutMetrics interpolatedMetrics(const Flight &flight, double nowMs) const;
  bool flightDone(const Flight &flight, double nowMs) const;

  std::shared_ptr<CSSTransitionsTrace> trace_;

  /*
   * Touched by the commit hook (whatever thread commits), the frame (UI
   * thread) and `pullTransaction` (whatever thread mounts); every access is
   * guarded. Mutable because `pullTransaction` is const on the interface and
   * is where flights advance.
   */
  mutable std::mutex mutex_;
  mutable std::unordered_map<SurfaceId, std::unordered_map<Tag, Flight>> flights_;
  mutable std::unordered_map<SurfaceId, Capture> capture_;
  /*
   * The frame clock, stamped by `pump`. A pull caused by a commit between
   * frames reads a clock up to one frame stale; the next frame corrects it.
   */
  mutable double lastFrameTime_{0.0};
};

} // namespace facebook::react
