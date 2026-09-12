/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <chrono>
#include <cstdio>
#include <cstdlib>
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
  /*
   * The process-wide instance. The engine logs through it, and so can any
   * other layer under investigation — the point of the trace is one timeline,
   * and a paint-side event is only useful when it can be read against the
   * commit that caused it.
   */
  static std::shared_ptr<CSSTransitionsTrace>& shared() {
    static auto instance = std::make_shared<CSSTransitionsTrace>();
    return instance;
  }

  void log(std::string line) {
    /*
     * `EXP_CSS_TRACE_ECHO=1` in the environment mirrors every line to stderr,
     * for the simulator's `log stream` when there is no JS side to drain the
     * buffer — a Release build launched by `simctl` has neither Metro nor a
     * debugger. Checked once; the trace is for investigations, not steady
     * state.
     */
    static const bool echo = [] {
      const char* value = std::getenv("EXP_CSS_TRACE_ECHO");
      return value != nullptr && value[0] == '1';
    }();
    if (echo) {
      fprintf(stderr, "css-trace %s\n", line.c_str());
    }
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
