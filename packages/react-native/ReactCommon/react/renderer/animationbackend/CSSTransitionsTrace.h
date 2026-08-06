/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <chrono>
#include <deque>
#include <mutex>
#include <string>
#include <vector>

namespace facebook::react {

/*
 * A ring buffer of transition-engine events, readable from JavaScript.
 *
 * This exists to debug the engine ON A DEVICE, where there is no console to
 * read and no debugger to attach: the demo screen polls the buffer through a
 * JSI global (`globalThis.__cssTransitionsTrace`) and can render it or stream
 * it off the phone. Cheap enough to leave compiled in — a mutex and some
 * strings, touched only when transitions actually run — and worth leaving in:
 * the bug that motivated it only ever reproduced on a physical device.
 */
class CSSTransitionsTrace {
 public:
  void log(std::string line) {
    std::scoped_lock lock(mutex_);
    // Milliseconds, monotonic, truncated to the hour so the numbers stay
    // short: correlating ORDER and spacing is what matters.
    const auto nowMs =
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now().time_since_epoch())
            .count() %
        3600000;
    lines_.push_back(std::to_string(nowMs) + " " + std::move(line));
    while (lines_.size() > kCapacity) {
      lines_.pop_front();
    }
  }

  /*
   * Returns everything logged since the last drain, oldest first.
   */
  std::vector<std::string> drain() {
    std::scoped_lock lock(mutex_);
    std::vector<std::string> out{lines_.begin(), lines_.end()};
    lines_.clear();
    return out;
  }

 private:
  static constexpr size_t kCapacity = 512;
  std::mutex mutex_;
  std::deque<std::string> lines_;
};

} // namespace facebook::react
