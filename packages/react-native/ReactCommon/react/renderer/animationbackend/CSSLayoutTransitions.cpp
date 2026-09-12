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
// `std::abs` on a Float, which this file does in `metricsDiffer` and in the
// unanimated-movement check. The floating-point overloads live in <cmath>; with
// only <cstdlib>'s integer ones visible a compiler is free to pick `abs(int)`
// and silently truncate, which would make a sub-point layout difference compare
// equal to zero. It builds on Apple because libc++ includes <cmath> along the
// way — that is luck, not a guarantee, and this file is shared with Android.
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

namespace facebook::react {

namespace {

Float lerp(Float from, Float to, Float amount) {
  return from + (to - from) * amount;
}

EdgeInsets lerpInsets(
    const EdgeInsets& from,
    const EdgeInsets& to,
    Float amount) {
  return EdgeInsets{
      .left = lerp(from.left, to.left, amount),
      .top = lerp(from.top, to.top, amount),
      .right = lerp(from.right, to.right, amount),
      .bottom = lerp(from.bottom, to.bottom, amount),
  };
}

/*
 * The numeric fields interpolate; everything else — display type, layout
 * direction, the scale factors — is not a quantity, so it jumps to the
 * destination on the first frame, which is where the flight got it from.
 */
LayoutMetrics lerpMetrics(
    const LayoutMetrics& from,
    const LayoutMetrics& to,
    Float amount) {
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
  result.contentInsets = lerpInsets(from.contentInsets, to.contentInsets, amount);
  result.borderWidth = lerpInsets(from.borderWidth, to.borderWidth, amount);
  result.overflowInset = lerpInsets(from.overflowInset, to.overflowInset, amount);
  return result;
}

/*
 * Whether two layouts differ by more than float wobble. A measured height
 * round-trips through `onLayout` as a Float and comes back a few 1e-5 off,
 * and Yoga's rounding wobbles at the same scale; a "flight" between two such
 * layouts is 250ms of mutations nobody can see. A fiftieth of a point is
 * below anything a screen can draw.
 */
bool metricsDiffer(const LayoutMetrics& a, const LayoutMetrics& b) {
  constexpr Float kEpsilon = 0.02f;
  auto differs = [](Float x, Float y) {
    return std::abs(x - y) > kEpsilon;
  };
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
   * MERGED into whatever is already waiting, not replaced: two commits can
   * start transitions back to back before either one's transaction mounts —
   * a react-branch commit and its promotion arrive as separate pulls — and
   * the second capture must not orphan the first's flights-to-be.
   */
  auto& capture = capture_[surfaceId];
  capture.startTime = lastFrameTime_;
  for (auto& [tag, timeline] : timelines) {
    /*
     * The governing timeline — what every KNOCK-ON node glides on — is the
     * one that ends last, and among those, the one that STARTS FIRST. The
     * tie-break is not pedantry: a receipt handover declares a 0+250ms leave
     * and a 150+100ms delayed tail, which end together — and iteration order
     * of a map was deciding which one the knock-ons rode. On the delayed
     * one, every row below held still for 150ms while the scroll's follow
     * (deliberately curve-matched to the ZERO-delay quarter second) glided —
     * so the newest bubble visibly dropped and snapped back. Reported from a
     * device as "the bubble below shifts down for a frame", and it
     * reproduced on the simulator only on the runs that lost the coin toss.
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
     * A capture whose transaction never arrived belongs to a commit that was
     * cancelled or a surface that stopped. By the end of its own timeline it
     * could not have produced a visible frame anyway; kept longer, it would
     * hold `shouldOverridePullTransaction` true for the life of the app.
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
           * A mount pass with no commit behind it: the pull below reaches
           * `pullTransaction`, which injects this frame's metrics. The same
           * call a committing tree makes, so the platforms treat the frame
           * exactly like any other mount.
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
    // The clamp and every curve end at 1, so this is `to` — spelled as the
    // exact struct rather than an interpolation that lands on it, because the
    // final frame must agree with the committed tree to the bit.
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
  const bool flying =
      flightsIt != flights_.end() && !flightsIt->second.empty();

  /*
   * A waiting capture is consumed only by the transaction that carries its
   * transition: the one with a metric change on a DECLARING node. Anything
   * that mounts in between — a scroll position reaching the state, an
   * unrelated prop — passes by and leaves the capture waiting, or the frame
   * of a transition could be burnt by a transaction that had nothing to do
   * with it.
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
    // or this transaction is not the one the capture is waiting for; either
    // way there is nothing to rewrite.
    return MountingTransaction{
        surfaceId, number, std::move(mutations), telemetry};
  }

  auto& flights = flights_[surfaceId];
  const double nowMs = lastFrameTime_;

  ShadowViewMutationList out;
  out.reserve(mutations.size() + flights.size());

  /*
   * Flights this pull already carried a mutation for — their frame came with
   * the adoption below, so the pump loop at the bottom must not emit a second
   * Update for them in the same transaction.
   */
  std::unordered_set<Tag> touched;
  /*
   * Tags a `Remove` detached in this transaction. An Update injected after a
   * Remove addresses a view that is not in the tree, which a strict mounting
   * layer rejects; their frames wait for the next pull, by which point a
   * reorder's matching `Insert` has put them back.
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
            // Props or state moved, geometry did not — nothing to animate,
            // and the change must land now (a scroll view's content size
            // rides through here as state). A flight this passes over keeps
            // gliding, but adopts the fresher props so its later frames do
            // not carry stale ones.
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
           * Where would this view be if the transition had not happened? The
           * scratch layout answers per node. A view whose scratch metrics
           * MATCH its committed ones was moved only by the commit's other
           * changes — it lands instantly, exactly as it would with no
           * transition declared next to it. That per-node split is the whole
           * reason the scratch layout exists: an insertion sharing a commit
           * with a transition must not start gliding by association.
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
             * Already mid-air and re-aimed: css-transitions-1 §3 — continue
             * from the CURRENT value on the new clock, never snap to either
             * endpoint.
             */
            flight.from = interpolatedMetrics(flightIt->second, nowMs);
          } else {
            /*
             * The scratch is a CLASSIFIER, never a value source. It answered
             * the gate above — is this node's movement the transition's or
             * the commit's other changes' — and that is all it can be trusted
             * with: the scratch relayout re-measures text the fork's inline
             * pass laid out, and its absolute numbers carry real errors. A
             * balloon took its start height from one and drew as half a
             * balloon for the first frames of a handover ("flickering and
             * layout jitter of the read indicator and bubble", from a
             * device); a start X from one slid a row sixteen points left.
             * The world the flight departs from is the one that was actually
             * on screen — the previous committed metrics. A node the gate
             * misclassifies then glides between two REAL layouts, which at
             * worst animates a change that could have landed instantly;
             * departing from a wrong layout put shapes on screen that never
             * existed in any.
             */
            flight.from = mutation.oldChildShadowView.layoutMetrics;
          }
          flight.to = mutation.newChildShadowView.layoutMetrics;
          /*
           * Only the VERTICAL axis glides. Every property this engine
           * diverts — height, padding-bottom — is vertical, so a flight's
           * legitimate travel is vertical too; whatever the horizontal
           * components of the attribution say is noise, and it is not
           * hypothetical noise: a receipt handover's scratch layout placed a
           * row's right-aligned content sixteen points left of where every
           * committed layout ever put it, and the balloon visibly slid left
           * and back over the morph. Reported from a device as "the bubble
           * oddly shifts left when its tail disappears". A horizontal change
           * that shares a commit with a transition lands instantly instead,
           * which is also what css-transitions-1 says happens to properties
           * nobody declared.
           */
          flight.from.frame.origin.x = flight.to.frame.origin.x;
          flight.from.frame.size.width = flight.to.frame.size.width;
          flight.from.contentInsets.left = flight.to.contentInsets.left;
          flight.from.contentInsets.right = flight.to.contentInsets.right;
          /*
           * TEXT never glides in SIZE, only in position. A paragraph redraws
           * its glyphs into whatever frame it is mounted with, so a text box
           * passing through intermediate heights draws glyphs that exist at
           * no real layout: a reveal-column "2:08 PM" caught mid-glide
           * measured 119px wide — its final width — at 13px tall against its
           * siblings' 22, vertically squashed ink. Reported from a device as
           * "the timestamps get distorted when the bubbles hide or show
           * their read indicators". A box lands at its final size at once;
           * where it SITS still animates, which is the part a reader tracks.
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
              "flight t=" + std::to_string(tag) + " from=" +
              std::to_string(flight.from.frame.origin.x) + "," +
              std::to_string(flight.from.frame.origin.y) + " " +
              std::to_string(flight.from.frame.size.width) + "x" +
              std::to_string(flight.from.frame.size.height) + " to=" +
              std::to_string(flight.to.frame.origin.x) + "," +
              std::to_string(flight.to.frame.origin.y) + " " +
              std::to_string(flight.to.frame.size.width) + "x" +
              std::to_string(flight.to.frame.size.height) +
              (flightIt != flights.end()       ? " (reaim)"
                   : scratch != nullptr        ? " (scratch)"
                                               : " (fallback)"));
          auto held = mutation.newChildShadowView;
          held.layoutMetrics = interpolatedMetrics(flight, nowMs);
          flight.prev = held;
          touched.insert(tag);

          out.push_back(ShadowViewMutation::UpdateMutation(
              mutation.oldChildShadowView, std::move(held), mutation.parentTag));
          flights[tag] = std::move(flight);
          break;
        }

        if (flightIt != flights.end()) {
          /*
           * An ordinary commit passing by mid-flight. Its metrics are the END
           * state (the committed tree holds it throughout), and mounting them
           * would snap the glide — so the frame's interpolated metrics ride
           * along instead, while the rest of the update (props, state) lands
           * as committed. If the commit moved the destination itself — rows
           * shifted under the animation — the flight re-aims from where it is
           * and keeps its clock: the movement the reader is watching carries
           * on to somewhere slightly different rather than starting again.
           */
          auto& flight = flightIt->second;
          if (metricsDiffer(
                  mutation.newChildShadowView.layoutMetrics, flight.to)) {
            flight.from = interpolatedMetrics(flight, nowMs);
            flight.to = mutation.newChildShadowView.layoutMetrics;
          }
          auto rewritten = mutation.newChildShadowView;
          rewritten.layoutMetrics = interpolatedMetrics(flight, nowMs);
          out.push_back(ShadowViewMutation::UpdateMutation(
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
          // A reorder's re-attach: the inserted view must appear where the
          // flight currently has it, not at the destination.
          auto& flight = flightIt->second;
          flight.parentTag = mutation.parentTag;
          auto rewritten = mutation.newChildShadowView;
          rewritten.layoutMetrics = interpolatedMetrics(flight, nowMs);
          flight.prev = rewritten;
          touched.insert(tag);
          detached.erase(tag);
          out.push_back(ShadowViewMutation::InsertMutation(
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
     * exact end and leave; the committed tree has held that value all along,
     * so the mount and the tree agree by construction.
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
        out.push_back(ShadowViewMutation::UpdateMutation(
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
   * Rows that MOVED without animating — the shape of a reported jump.
   *
   * The trace records transitions that start, and those refused as
   * non-interpolable. Neither covers the third case: a layout change with no
   * transition covering it at all, which produces no line anywhere and looks
   * exactly like "the bubbles jump down".
   *
   * AFTER the flights for this transaction exist, not before. A first version
   * tested `flights` while the loop above was still filling it, so every newly
   * flighted node read as unanimated — it reported two per send, and both had a
   * `flight` line with the identical from/to a few lines later. An instrument
   * that flags the thing it is meant to exonerate is worse than none.
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
