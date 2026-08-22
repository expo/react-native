/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "ElementControlMetrics.h"

#include <atomic>

namespace facebook::react {

namespace {

/*
 * A whole struct behind one atomic pointer rather than an atomic per field.
 *
 * The fields are read together and have to agree with each other — a width
 * taken from one probe and a font size from another describes no control that
 * exists. Published once as a unit, so a reader either sees every platform
 * number or every default, never a seam between the two.
 *
 * Leaked deliberately: it outlives every reader by construction, and a
 * destructor running at exit while a shadow thread is mid-layout is a crash
 * for no benefit.
 */
std::atomic<const ElementControlMetrics*>& publishedMetrics() {
  static std::atomic<const ElementControlMetrics*> metrics{nullptr};
  return metrics;
}

} // namespace

const std::string& elementSelectProbeTitle() {
  // Ordinary, and long enough that the chrome is not a rounding error beside
  // it. Its own width never reaches the answer — it is subtracted back out.
  static const std::string title = "Apple";
  return title;
}

const std::string& elementFileInputDefaultTitle() {
  // The web's wording for an empty file input, which is what this element is.
  static const std::string title = "Choose File";
  return title;
}

void setElementControlMetrics(const ElementControlMetrics& metrics) {
  publishedMetrics().store(
      new ElementControlMetrics(metrics), std::memory_order_release);
}

ElementControlMetrics elementControlMetrics() {
  const auto* published = publishedMetrics().load(std::memory_order_acquire);
  return published != nullptr ? *published : ElementControlMetrics{};
}

} // namespace facebook::react
