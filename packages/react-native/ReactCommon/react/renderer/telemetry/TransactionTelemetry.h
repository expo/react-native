/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <chrono>
#include <cstdint>
#include <functional>

#include <react/utils/Telemetry.h>

namespace facebook::react {

/*
 * Represents telemetry data associated with a particular revision of
 * `ShadowTree`.
 */
class TransactionTelemetry final {
 public:
  /*
   * Thread-local Telemetry instance
   */
  static TransactionTelemetry *threadLocalTelemetry();

  TransactionTelemetry();
  TransactionTelemetry(std::function<TelemetryTimePoint()> now);

  void setAsThreadLocal();
  void unsetAsThreadLocal();

  /*
   * Signaling
   */
  void willDiff();
  void didDiff();
  void willCommit();
  void didCommit();
  void willLayout();
  void willMeasureText();
  void didMeasureText();
  void didLayout();
  void didLayout(int affectedLayoutNodesCount);
  /*
   * The three things a commit does BEFORE it lays anything out, timed
   * separately because at thirty thousand rows they are most of it and the
   * total cannot say which.
   *
   *   transaction — React handing over the new tree
   *   state       — `progressState`, reconciling state across the two trees
   *   hooks       — `shadowTreeWillCommit`, which is where the transition
   *                 engine and anything else the platform installed runs
   *
   * Spans rather than start/end pairs, because each can be entered more than
   * once in a commit and what is wanted is the sum.
   */
  void willTransaction();
  void didTransaction();
  void willProgressState();
  void didProgressState();
  void willCommitHooks();
  void didCommitHooks();
  /*
   * Of the affected layout nodes, how many came out with the SAME frame they
   * already had.
   *
   * The count that says what a "skip the unchanged subtree" optimisation is
   * worth: a node whose frame did not move is one the walk could have left
   * alone. Counted rather than acted on — the decision needs the cascade to
   * agree too, and this is the measurement that says whether it is worth
   * asking.
   */
  void didLayoutUnchangedNode();
  /*
   * State reconciliation's own two outcomes, per child it looks at.
   *
   * `progressState` skips a child when the two trees hold the SAME object, and
   * walks it otherwise. Which of those happens decides whether a commit is O(1)
   * or O(rows) — and nothing said which, so a second and a half at thirty
   * thousand rows had no explanation. Counted per child rather than timed: the
   * ratio is the fact, and a ratio survives being subtracted.
   */
  void didShareStateSubtree();
  void didWalkStateSubtree();
  /*
   * And how many of the nodes it walked actually had state to carry forward.
   *
   * The walk is the cost; obsolete state is the reason for it. If the two
   * numbers are close, the tree is full of nodes whose state moved natively and
   * React's fibers never heard — which is a property of the renderer and not of
   * anything an app can key differently.
   */
  void didFindObsoleteState();
  void willMount();
  void didMount();

  void setRevisionNumber(int revisionNumber);

  /*
   * Reading
   */
  TelemetryTimePoint getDiffStartTime() const;
  TelemetryTimePoint getDiffEndTime() const;
  TelemetryTimePoint getLayoutStartTime() const;
  TelemetryTimePoint getLayoutEndTime() const;
  TelemetryTimePoint getCommitStartTime() const;
  TelemetryTimePoint getCommitEndTime() const;
  TelemetryTimePoint getMountStartTime() const;
  TelemetryTimePoint getMountEndTime() const;

  TelemetryDuration getTextMeasureTime() const;
  int getNumberOfTextMeasurements() const;
  int getRevisionNumber() const;

  int getAffectedLayoutNodesCount() const;
  int getUnchangedLayoutNodesCount() const;
  int getSharedStateSubtreesCount() const;
  int getWalkedStateSubtreesCount() const;
  int getObsoleteStateCount() const;
  TelemetryDuration getTransactionTime() const;
  TelemetryDuration getProgressStateTime() const;
  TelemetryDuration getCommitHooksTime() const;

 private:
  TelemetryTimePoint diffStartTime_{kTelemetryUndefinedTimePoint};
  TelemetryTimePoint diffEndTime_{kTelemetryUndefinedTimePoint};
  TelemetryTimePoint commitStartTime_{kTelemetryUndefinedTimePoint};
  TelemetryTimePoint commitEndTime_{kTelemetryUndefinedTimePoint};
  TelemetryTimePoint layoutStartTime_{kTelemetryUndefinedTimePoint};
  TelemetryTimePoint layoutEndTime_{kTelemetryUndefinedTimePoint};
  TelemetryTimePoint mountStartTime_{kTelemetryUndefinedTimePoint};
  TelemetryTimePoint mountEndTime_{kTelemetryUndefinedTimePoint};

  TelemetryTimePoint lastTextMeasureStartTime_{kTelemetryUndefinedTimePoint};
  TelemetryDuration textMeasureTime_{0};

  int numberOfTextMeasurements_{0};
  int revisionNumber_{0};
  std::function<TelemetryTimePoint()> now_;

  int affectedLayoutNodesCount_{0};
  int unchangedLayoutNodesCount_{0};
  int sharedStateSubtreesCount_{0};
  int walkedStateSubtreesCount_{0};
  int obsoleteStateCount_{0};

  TelemetryTimePoint lastTransactionStartTime_{kTelemetryUndefinedTimePoint};
  TelemetryDuration transactionTime_{0};
  TelemetryTimePoint lastProgressStateStartTime_{kTelemetryUndefinedTimePoint};
  TelemetryDuration progressStateTime_{0};
  TelemetryTimePoint lastCommitHooksStartTime_{kTelemetryUndefinedTimePoint};
  TelemetryDuration commitHooksTime_{0};
};

} // namespace facebook::react
