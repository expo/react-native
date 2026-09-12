/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "CSSLayoutTransitions.h"

#include <react/renderer/mounting/ShadowTree.h>
#include <react/renderer/mounting/ShadowTreeRegistry.h>
#include <react/renderer/uimanager/UIManager.h>

#include <algorithm>
// <cmath> for `std::abs` on a Float: with only <cstdlib>'s integer overloads
// visible a compiler may pick `abs(int)` and truncate a sub-point difference
// to zero
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

namespace facebook::react {

namespace {

Float lerp(Float from, Float to, Float amount) {
  return from + (to - from) * amount;
}

EdgeInsets
lerpInsets(const EdgeInsets& from, const EdgeInsets& to, Float amount) {
  return EdgeInsets{
      .left = lerp(from.left, to.left, amount),
      .top = lerp(from.top, to.top, amount),
      .right = lerp(from.right, to.right, amount),
      .bottom = lerp(from.bottom, to.bottom, amount),
  };
}

/*
 * The numeric fields interpolate; display type, layout direction and the scale
 * factors are not quantities and take the destination's value from the first
 * frame
 */
LayoutMetrics
lerpMetrics(const LayoutMetrics& from, const LayoutMetrics& to, Float amount) {
  auto result = to;
  result.frame = Rect{
      .origin =
          Point{
              .x = lerp(from.frame.origin.x, to.frame.origin.x, amount),
              .y = lerp(from.frame.origin.y, to.frame.origin.y, amount)},
      .size = Size{
          .width = lerp(from.frame.size.width, to.frame.size.width, amount),
          .height =
              lerp(from.frame.size.height, to.frame.size.height, amount)}};
  result.contentInsets =
      lerpInsets(from.contentInsets, to.contentInsets, amount);
  result.borderWidth = lerpInsets(from.borderWidth, to.borderWidth, amount);
  result.overflowInset =
      lerpInsets(from.overflowInset, to.overflowInset, amount);
  return result;
}

/*
 * Whether two layouts differ by more than float wobble: a measured height
 * round-trips through `onLayout` as a Float a few 1e-5 off, and a fiftieth of
 * a point is below anything a screen draws
 */
bool metricsDiffer(const LayoutMetrics& a, const LayoutMetrics& b) {
  constexpr Float kEpsilon = 0.02f;
  auto differs = [](Float x, Float y) { return std::abs(x - y) > kEpsilon; };
  auto insetsDiffer = [&](const EdgeInsets& x, const EdgeInsets& y) {
    return differs(x.left, y.left) || differs(x.top, y.top) ||
        differs(x.right, y.right) || differs(x.bottom, y.bottom);
  };
  return differs(a.frame.origin.x, b.frame.origin.x) ||
      differs(a.frame.origin.y, b.frame.origin.y) ||
      differs(a.frame.size.width, b.frame.size.width) ||
      differs(a.frame.size.height, b.frame.size.height) ||
      insetsDiffer(a.contentInsets, b.contentInsets) ||
      insetsDiffer(a.borderWidth, b.borderWidth);
}

} // namespace

CSSLayoutTransitions::CSSLayoutTransitions(
    std::shared_ptr<CSSTransitionsTrace> trace)
    : trace_(std::move(trace)) {}

void CSSLayoutTransitions::beginCapture(
    SurfaceId surfaceId,
    std::unordered_map<Tag, Timeline> timelines,
    std::unordered_map<Tag, LayoutMetrics> scratchMetrics) {
  std::scoped_lock lock(mutex_);
  /*
   * Merged into whatever is already waiting, not replaced: two commits can
   * start transitions before either one's transaction mounts
   */
  auto& capture = capture_[surfaceId];
  capture.startTime = lastFrameTime_;
  for (auto& [tag, timeline] : timelines) {
    /*
     * The governing timeline, which every knock-on node glides on, is the one
     * that ends last and, among those, the one that starts first; two clocks
     * that end together must not leave the choice to map iteration order
     */
    const auto total = timeline.delay + timeline.duration;
    const auto governingTotal =
        capture.governing.delay + capture.governing.duration;
    if (total > governingTotal ||
        (total == governingTotal && timeline.delay < capture.governing.delay)) {
      capture.governing = timeline;
    }
    capture.timelines[tag] = timeline;
  }
  for (auto& [tag, metrics] : scratchMetrics) {
    capture.scratchMetrics[tag] = metrics;
  }
}

void CSSLayoutTransitions::pump(double nowMs, UIManager& uiManager) {
  std::vector<SurfaceId> flying;
  {
    std::scoped_lock lock(mutex_);
    lastFrameTime_ = nowMs;
    /*
     * A capture whose transaction never arrived belongs to a cancelled commit
     * or a stopped surface; kept past its own timeline it would hold
     * `shouldOverridePullTransaction` true for the life of the app
     */
    std::erase_if(capture_, [nowMs](const auto& entry) {
      const auto& governing = entry.second.governing;
      return nowMs >
          entry.second.startTime + governing.delay + governing.duration;
    });
    flying.reserve(flights_.size());
    for (const auto& [surfaceId, surfaceFlights] : flights_) {
      if (!surfaceFlights.empty()) {
        flying.push_back(surfaceId);
      }
    }
  }
  for (auto surfaceId : flying) {
    bool found = false;
    uiManager.getShadowTreeRegistry().visit(
        surfaceId, [&found](const ShadowTree& shadowTree) {
          found = true;
          /*
           * A mount pass with no commit behind it: the pull reaches
           * `pullTransaction`, which injects this frame's metrics through the
           * same call a committing tree makes
           */
          shadowTree.notifyDelegatesOfUpdates();
        });
    if (!found) {
      std::scoped_lock lock(mutex_);
      flights_.erase(surfaceId);
      capture_.erase(surfaceId);
    }
  }
}

bool CSSLayoutTransitions::hasWork() const {
  std::scoped_lock lock(mutex_);
  return !flights_.empty() || !capture_.empty();
}

bool CSSLayoutTransitions::shouldOverridePullTransaction() const {
  return hasWork();
}

LayoutMetrics CSSLayoutTransitions::interpolatedMetrics(
    const Flight& flight,
    double nowMs) const {
  const auto& timeline = flight.timeline;
  if (timeline.duration <= 0.0) {
    return flight.to;
  }
  const auto elapsed = nowMs - flight.startTime - timeline.delay;
  const auto linear = std::clamp(
      static_cast<Float>(elapsed / timeline.duration),
      static_cast<Float>(0),
      static_cast<Float>(1));
  if (linear >= 1.0f) {
    // The exact `to` rather than an interpolation that lands on it, so the
    // final frame agrees with the committed tree to the bit
    return flight.to;
  }
  const auto eased = timeline.curve.evaluate(linear);
  return lerpMetrics(flight.from, flight.to, eased);
}

bool CSSLayoutTransitions::flightDone(const Flight& flight, double nowMs)
    const {
  const auto& timeline = flight.timeline;
  return nowMs - flight.startTime >= timeline.delay + timeline.duration;
}

std::optional<MountingTransaction> CSSLayoutTransitions::pullTransaction(
    SurfaceId surfaceId,
    MountingTransaction::Number number,
    const TransactionTelemetry& telemetry,
    ShadowViewMutationList mutations) const {
  std::scoped_lock lock(mutex_);

  auto captureIt = capture_.find(surfaceId);
  auto flightsIt = flights_.find(surfaceId);
  const bool flying = flightsIt != flights_.end() && !flightsIt->second.empty();

  /*
   * A waiting capture is consumed only by the transaction that carries a
   * metric change on a declaring node; anything that mounts in between passes
   * by and leaves the capture waiting
   */
  bool capturing = false;
  if (captureIt != capture_.end()) {
    for (const auto& mutation : mutations) {
      if (mutation.type != ShadowViewMutation::Update) {
        continue;
      }
      auto timelineIt =
          captureIt->second.timelines.find(mutation.newChildShadowView.tag);
      if (timelineIt != captureIt->second.timelines.end() &&
          metricsDiffer(
              mutation.oldChildShadowView.layoutMetrics,
              mutation.newChildShadowView.layoutMetrics)) {
        capturing = true;
        break;
      }
    }
  }

  if (!capturing && !flying) {
    // Another surface's animation made `shouldOverridePullTransaction` true,
    // or this transaction is not the one the capture is waiting for
    return MountingTransaction{
        surfaceId, number, std::move(mutations), telemetry};
  }

  auto& flights = flights_[surfaceId];
  const double nowMs = lastFrameTime_;

  ShadowViewMutationList out;
  out.reserve(mutations.size() + flights.size());

  /*
   * Flights this pull already carried a mutation for, so the pump loop at the
   * bottom does not emit a second Update for them
   */
  std::unordered_set<Tag> touched;
  /*
   * Tags a `Remove` detached in this transaction: an Update after a Remove
   * addresses a view not in the tree, so their frames wait for the next pull
   */
  std::unordered_set<Tag> detached;

  for (auto& mutation : mutations) {
    switch (mutation.type) {
      case ShadowViewMutation::Update: {
        const auto tag = mutation.newChildShadowView.tag;
        auto flightIt = flights.find(tag);

        if (capturing) {
          const auto& capture = captureIt->second;
          if (!metricsDiffer(
                  mutation.oldChildShadowView.layoutMetrics,
                  mutation.newChildShadowView.layoutMetrics)) {
            // Props or state moved, geometry did not: the change lands now
            // (a scroll view's content size rides through here as state), and
            // a flight this passes over keeps gliding with the fresher props
            if (flightIt != flights.end()) {
              auto& flight = flightIt->second;
              auto adopted = mutation.newChildShadowView;
              adopted.layoutMetrics = flight.prev.layoutMetrics;
              flight.prev = std::move(adopted);
              touched.insert(tag);
            }
            out.push_back(std::move(mutation));
            break;
          }

          /*
           * The scratch layout says where this view would be had the
           * transition not happened. A view whose scratch metrics match its
           * committed ones was moved only by the commit's other changes and
           * lands instantly; an insertion sharing a commit with a transition
           * must not glide by association.
           */
          const LayoutMetrics* scratch = nullptr;
          auto scratchIt = capture.scratchMetrics.find(tag);
          if (scratchIt != capture.scratchMetrics.end()) {
            scratch = &scratchIt->second;
          }
          if (scratch != nullptr &&
              !metricsDiffer(
                  *scratch, mutation.newChildShadowView.layoutMetrics) &&
              flightIt == flights.end()) {
            out.push_back(std::move(mutation));
            break;
          }

          auto timelineIt = capture.timelines.find(tag);
          const auto& timeline = timelineIt != capture.timelines.end()
              ? timelineIt->second
              : capture.governing;

          Flight flight;
          if (flightIt != flights.end()) {
            /*
             * Already mid-air and re-aimed: css-transitions-1 §3 continues
             * from the current value on the new clock
             */
            flight.from = interpolatedMetrics(flightIt->second, nowMs);
          } else {
            /*
             * The scratch is a classifier, never a value source: its relayout
             * re-measures text the inline pass laid out, so its absolute
             * numbers carry errors. The flight departs from the previous
             * committed metrics, the layout that was on screen; a node the
             * gate misclassifies then glides between two real layouts.
             */
            flight.from = mutation.oldChildShadowView.layoutMetrics;
          }
          flight.to = mutation.newChildShadowView.layoutMetrics;
          /*
           * Only the vertical axis glides: every property this engine diverts
           * (height, padding-bottom) is vertical, so the horizontal components
           * of the attribution are noise. A horizontal change sharing a commit
           * with a transition lands instantly, as css-transitions-1 says of
           * undeclared properties.
           */
          flight.from.frame.origin.x = flight.to.frame.origin.x;
          flight.from.frame.size.width = flight.to.frame.size.width;
          flight.from.contentInsets.left = flight.to.contentInsets.left;
          flight.from.contentInsets.right = flight.to.contentInsets.right;
          /*
           * Text never glides in size, only in position: a paragraph redraws
           * its glyphs into whatever frame it is mounted with, so intermediate
           * heights would squash the ink. The box lands at its final size at
           * once; where it sits still animates.
           */
          if (mutation.newChildShadowView.componentName != nullptr &&
              strcmp(mutation.newChildShadowView.componentName, "Paragraph") ==
                  0) {
            flight.from.frame.size = flight.to.frame.size;
            flight.from.contentInsets = flight.to.contentInsets;
          }
          flight.parentTag = mutation.parentTag;
          flight.timeline = timeline;
          flight.startTime = capture.startTime;

          trace_->log(
              "flight t=" + std::to_string(tag) +
              " from=" + std::to_string(flight.from.frame.origin.x) + "," +
              std::to_string(flight.from.frame.origin.y) + " " +
              std::to_string(flight.from.frame.size.width) + "x" +
              std::to_string(flight.from.frame.size.height) +
              " to=" + std::to_string(flight.to.frame.origin.x) + "," +
              std::to_string(flight.to.frame.origin.y) + " " +
              std::to_string(flight.to.frame.size.width) + "x" +
              std::to_string(flight.to.frame.size.height) +
              (flightIt != flights.end() ? " (reaim)"
                   : scratch != nullptr  ? " (scratch)"
                                         : " (fallback)"));
          auto held = mutation.newChildShadowView;
          held.layoutMetrics = interpolatedMetrics(flight, nowMs);
          flight.prev = held;
          touched.insert(tag);

          out.push_back(
              ShadowViewMutation::UpdateMutation(
                  mutation.oldChildShadowView,
                  std::move(held),
                  mutation.parentTag));
          flights[tag] = std::move(flight);
          break;
        }

        if (flightIt != flights.end()) {
          /*
           * An ordinary commit passing by mid-flight: its metrics are the end
           * state, so the frame's interpolated metrics ride along while the
           * rest of the update lands as committed. If the commit moved the
           * destination, the flight re-aims from where it is and keeps its
           * clock.
           */
          auto& flight = flightIt->second;
          if (metricsDiffer(
                  mutation.newChildShadowView.layoutMetrics, flight.to)) {
            flight.from = interpolatedMetrics(flight, nowMs);
            flight.to = mutation.newChildShadowView.layoutMetrics;
          }
          auto rewritten = mutation.newChildShadowView;
          rewritten.layoutMetrics = interpolatedMetrics(flight, nowMs);
          out.push_back(
              ShadowViewMutation::UpdateMutation(
                  flight.prev, rewritten, mutation.parentTag));
          flight.prev = std::move(rewritten);
          touched.insert(tag);
          break;
        }

        out.push_back(std::move(mutation));
        break;
      }
      case ShadowViewMutation::Delete: {
        const auto tag = mutation.oldChildShadowView.tag;
        if (flights.erase(tag) > 0) {
          trace_->log("layout-unmount t=" + std::to_string(tag));
        }
        out.push_back(std::move(mutation));
        break;
      }
      case ShadowViewMutation::Remove: {
        detached.insert(mutation.oldChildShadowView.tag);
        out.push_back(std::move(mutation));
        break;
      }
      case ShadowViewMutation::Insert: {
        const auto tag = mutation.newChildShadowView.tag;
        auto flightIt = flights.find(tag);
        if (flightIt != flights.end()) {
          // A reorder's re-attach: the inserted view appears where the
          // flight currently has it, not at the destination
          auto& flight = flightIt->second;
          flight.parentTag = mutation.parentTag;
          auto rewritten = mutation.newChildShadowView;
          rewritten.layoutMetrics = interpolatedMetrics(flight, nowMs);
          flight.prev = rewritten;
          touched.insert(tag);
          detached.erase(tag);
          out.push_back(
              ShadowViewMutation::InsertMutation(
                  mutation.parentTag, std::move(rewritten), mutation.index));
          break;
        }
        out.push_back(std::move(mutation));
        break;
      }
      default:
        out.push_back(std::move(mutation));
        break;
    }
  }

  if (capturing) {
    capture_.erase(captureIt);
  } else {
    /*
     * The frame itself: every flight this pull's mutations did not already
     * carry gets its interpolated metrics appended. Landed flights emit their
     * exact end, which the committed tree has held all along, and leave.
     */
    for (auto it = flights.begin(); it != flights.end();) {
      auto& [tag, flight] = *it;
      if (touched.contains(tag) || detached.contains(tag)) {
        ++it;
        continue;
      }
      const auto done = flightDone(flight, nowMs);
      auto metrics = interpolatedMetrics(flight, nowMs);
      if (metrics != flight.prev.layoutMetrics) {
        auto next = flight.prev;
        next.layoutMetrics = metrics;
        out.push_back(
            ShadowViewMutation::UpdateMutation(
                flight.prev, next, flight.parentTag));
        flight.prev = std::move(next);
      }
      if (done) {
        trace_->log("layout-done t=" + std::to_string(tag));
        it = flights.erase(it);
      } else {
        ++it;
      }
    }
  }
  if (flights.empty()) {
    flights_.erase(surfaceId);
  }

  /*
   * Rows that moved without animating: a layout change no transition covers,
   * which the start and refusal lines of the trace cannot show. Checked after
   * the flights for this transaction exist, or every newly flighted node would
   * read as unanimated.
   */
  for (const auto& mutation : mutations) {
    if (mutation.type != ShadowViewMutation::Update) {
      continue;
    }
    const auto oldY = mutation.oldChildShadowView.layoutMetrics.frame.origin.y;
    const auto newY = mutation.newChildShadowView.layoutMetrics.frame.origin.y;
    if (std::abs(newY - oldY) <= 6) {
      continue;
    }
    const auto tag = mutation.newChildShadowView.tag;
    if (flights.find(tag) == flights.end()) {
      trace_->log(
          "unanimated t=" + std::to_string(tag) + " y " + std::to_string(oldY) +
          "->" + std::to_string(newY));
    }
  }

  return MountingTransaction{surfaceId, number, std::move(out), telemetry};
}

} // namespace facebook::react
