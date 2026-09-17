/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "TransactionTelemetry.h"

#include <react/debug/react_native_assert.h>

#include <utility>

namespace facebook::react {

thread_local TransactionTelemetry* threadLocalTransactionTelemetry = nullptr;

TransactionTelemetry::TransactionTelemetry()
    : TransactionTelemetry(telemetryTimePointNow) {}

TransactionTelemetry::TransactionTelemetry(
    std::function<TelemetryTimePoint()> now)
    : now_{std::move(now)} {}

TransactionTelemetry* TransactionTelemetry::threadLocalTelemetry() {
  return threadLocalTransactionTelemetry;
}

void TransactionTelemetry::setAsThreadLocal() {
  threadLocalTransactionTelemetry = this;
}

void TransactionTelemetry::unsetAsThreadLocal() {
  threadLocalTransactionTelemetry = nullptr;
}

void TransactionTelemetry::willCommit() {
  react_native_assert(commitStartTime_ == kTelemetryUndefinedTimePoint);
  react_native_assert(commitEndTime_ == kTelemetryUndefinedTimePoint);
  commitStartTime_ = now_();
}

void TransactionTelemetry::didCommit() {
  react_native_assert(commitStartTime_ != kTelemetryUndefinedTimePoint);
  react_native_assert(commitEndTime_ == kTelemetryUndefinedTimePoint);
  commitEndTime_ = now_();
}

void TransactionTelemetry::willDiff() {
  react_native_assert(diffStartTime_ == kTelemetryUndefinedTimePoint);
  react_native_assert(diffEndTime_ == kTelemetryUndefinedTimePoint);
  diffStartTime_ = now_();
}

void TransactionTelemetry::didDiff() {
  react_native_assert(diffStartTime_ != kTelemetryUndefinedTimePoint);
  react_native_assert(diffEndTime_ == kTelemetryUndefinedTimePoint);
  diffEndTime_ = now_();
}

void TransactionTelemetry::willLayout() {
  react_native_assert(layoutStartTime_ == kTelemetryUndefinedTimePoint);
  react_native_assert(layoutEndTime_ == kTelemetryUndefinedTimePoint);
  layoutStartTime_ = now_();
}

void TransactionTelemetry::willMeasureText() {
  react_native_assert(
      lastTextMeasureStartTime_ == kTelemetryUndefinedTimePoint);
  lastTextMeasureStartTime_ = now_();
}

void TransactionTelemetry::didMeasureText() {
  numberOfTextMeasurements_++;
  react_native_assert(
      lastTextMeasureStartTime_ != kTelemetryUndefinedTimePoint);
  textMeasureTime_ += now_() - lastTextMeasureStartTime_;
  lastTextMeasureStartTime_ = kTelemetryUndefinedTimePoint;
}

void TransactionTelemetry::didLayout() {
  react_native_assert(layoutStartTime_ != kTelemetryUndefinedTimePoint);
  react_native_assert(layoutEndTime_ == kTelemetryUndefinedTimePoint);
  layoutEndTime_ = now_();
}

void TransactionTelemetry::didLayout(int affectedLayoutNodesCount) {
  didLayout();
  /*
   * ACCUMULATED, not assigned.
   *
   * A commit can lay out more than once, and this was the last one's count
   * while `unchangedLayoutNodesCount_` was the sum of all of them — so the two
   * were not comparable and the unchanged count could exceed the total, which
   * is what gave it away: ×269637 unmoved out of ×240322.
   */
  affectedLayoutNodesCount_ += affectedLayoutNodesCount;
}

/*
 * The three pre-layout spans. No asserts about being entered once: a commit may
 * run its hooks more than once (a hook that returns a new tree is asked again),
 * and what is wanted is the sum, not a bracket.
 */
void TransactionTelemetry::willTransaction() {
  lastTransactionStartTime_ = now_();
}

void TransactionTelemetry::didTransaction() {
  if (lastTransactionStartTime_ == kTelemetryUndefinedTimePoint) {
    return;
  }
  transactionTime_ += now_() - lastTransactionStartTime_;
  lastTransactionStartTime_ = kTelemetryUndefinedTimePoint;
}

void TransactionTelemetry::willProgressState() {
  lastProgressStateStartTime_ = now_();
}

void TransactionTelemetry::didProgressState() {
  if (lastProgressStateStartTime_ == kTelemetryUndefinedTimePoint) {
    return;
  }
  progressStateTime_ += now_() - lastProgressStateStartTime_;
  lastProgressStateStartTime_ = kTelemetryUndefinedTimePoint;
}

void TransactionTelemetry::willCommitHooks() {
  lastCommitHooksStartTime_ = now_();
}

void TransactionTelemetry::didCommitHooks() {
  if (lastCommitHooksStartTime_ == kTelemetryUndefinedTimePoint) {
    return;
  }
  commitHooksTime_ += now_() - lastCommitHooksStartTime_;
  lastCommitHooksStartTime_ = kTelemetryUndefinedTimePoint;
}

void TransactionTelemetry::didLayoutUnchangedNode() {
  unchangedLayoutNodesCount_++;
}

void TransactionTelemetry::didShareStateSubtree() {
  sharedStateSubtreesCount_++;
}

void TransactionTelemetry::didWalkStateSubtree() {
  walkedStateSubtreesCount_++;
}

void TransactionTelemetry::didFindObsoleteState() {
  obsoleteStateCount_++;
}

void TransactionTelemetry::willMount() {
  react_native_assert(mountStartTime_ == kTelemetryUndefinedTimePoint);
  react_native_assert(mountEndTime_ == kTelemetryUndefinedTimePoint);
  mountStartTime_ = now_();
}

void TransactionTelemetry::didMount() {
  react_native_assert(mountStartTime_ != kTelemetryUndefinedTimePoint);
  react_native_assert(mountEndTime_ == kTelemetryUndefinedTimePoint);
  mountEndTime_ = now_();
}

void TransactionTelemetry::setRevisionNumber(int revisionNumber) {
  revisionNumber_ = revisionNumber;
}

TelemetryTimePoint TransactionTelemetry::getDiffStartTime() const {
  react_native_assert(diffStartTime_ != kTelemetryUndefinedTimePoint);
  react_native_assert(diffEndTime_ != kTelemetryUndefinedTimePoint);
  return diffStartTime_;
}

TelemetryTimePoint TransactionTelemetry::getDiffEndTime() const {
  react_native_assert(diffStartTime_ != kTelemetryUndefinedTimePoint);
  react_native_assert(diffEndTime_ != kTelemetryUndefinedTimePoint);
  return diffEndTime_;
}

TelemetryTimePoint TransactionTelemetry::getCommitStartTime() const {
  react_native_assert(commitStartTime_ != kTelemetryUndefinedTimePoint);
  react_native_assert(commitEndTime_ != kTelemetryUndefinedTimePoint);
  return commitStartTime_;
}

TelemetryTimePoint TransactionTelemetry::getCommitEndTime() const {
  react_native_assert(commitStartTime_ != kTelemetryUndefinedTimePoint);
  react_native_assert(commitEndTime_ != kTelemetryUndefinedTimePoint);
  return commitEndTime_;
}

TelemetryTimePoint TransactionTelemetry::getLayoutStartTime() const {
  react_native_assert(layoutStartTime_ != kTelemetryUndefinedTimePoint);
  react_native_assert(layoutEndTime_ != kTelemetryUndefinedTimePoint);
  return layoutStartTime_;
}

TelemetryTimePoint TransactionTelemetry::getLayoutEndTime() const {
  react_native_assert(layoutStartTime_ != kTelemetryUndefinedTimePoint);
  react_native_assert(layoutEndTime_ != kTelemetryUndefinedTimePoint);
  return layoutEndTime_;
}

TelemetryTimePoint TransactionTelemetry::getMountStartTime() const {
  react_native_assert(mountStartTime_ != kTelemetryUndefinedTimePoint);
  react_native_assert(mountEndTime_ != kTelemetryUndefinedTimePoint);
  return mountStartTime_;
}

TelemetryTimePoint TransactionTelemetry::getMountEndTime() const {
  react_native_assert(mountStartTime_ != kTelemetryUndefinedTimePoint);
  react_native_assert(mountEndTime_ != kTelemetryUndefinedTimePoint);
  return mountEndTime_;
}

TelemetryDuration TransactionTelemetry::getTextMeasureTime() const {
  return textMeasureTime_;
}

int TransactionTelemetry::getNumberOfTextMeasurements() const {
  return numberOfTextMeasurements_;
}

int TransactionTelemetry::getRevisionNumber() const {
  return revisionNumber_;
}

int TransactionTelemetry::getAffectedLayoutNodesCount() const {
  return affectedLayoutNodesCount_;
}

int TransactionTelemetry::getUnchangedLayoutNodesCount() const {
  return unchangedLayoutNodesCount_;
}

int TransactionTelemetry::getSharedStateSubtreesCount() const {
  return sharedStateSubtreesCount_;
}

int TransactionTelemetry::getWalkedStateSubtreesCount() const {
  return walkedStateSubtreesCount_;
}

int TransactionTelemetry::getObsoleteStateCount() const {
  return obsoleteStateCount_;
}

TelemetryDuration TransactionTelemetry::getTransactionTime() const {
  return transactionTime_;
}

TelemetryDuration TransactionTelemetry::getProgressStateTime() const {
  return progressStateTime_;
}

TelemetryDuration TransactionTelemetry::getCommitHooksTime() const {
  return commitHooksTime_;
}

} // namespace facebook::react
