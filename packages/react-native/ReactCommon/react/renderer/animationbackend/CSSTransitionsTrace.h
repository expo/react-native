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
 * A ring buffer of transition-engine events, drained from JavaScript through
 * `globalThis.__cssTransitionsTrace()` so the engine can be observed on a
 * device. Compiled in: a mutex and some strings, touched only while
 * transitions run.
 */
class CSSTransitionsTrace {
 public:
  /*
   * Each line is stamped with `steady_clock` milliseconds modulo an hour, so
   * the numbers stay short. A reader re-stamping the lines against another
   * clock takes each age modulo the same hour.
   */
  static constexpr long long kHourMs = 3600000;

  /*
   * The process-wide instance: one timeline, so a paint-side event can be
   * read against the commit that caused it.
   */
  static std::shared_ptr<CSSTransitionsTrace> &shared()
  {
    static auto instance = std::make_shared<CSSTransitionsTrace>();
    return instance;
  }

  void log(std::string line)
  {
    /*
     * `EXP_CSS_TRACE_ECHO=1` in the environment mirrors every line to stderr,
     * for the simulator's `log stream` when no JS side drains the buffer
     */
    static const bool echo = [] {
      const char *value = std::getenv("EXP_CSS_TRACE_ECHO");
      return value != nullptr && value[0] == '1';
    }();
    if (echo) {
      fprintf(stderr, "css-trace %s\n", line.c_str());
    }
    std::scoped_lock lock(mutex_);
    const auto nowMs =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch())
            .count() %
        kHourMs;
    lines_.push_back(std::to_string(nowMs) + " " + std::move(line));
    while (lines_.size() > kCapacity) {
      lines_.pop_front();
    }
  }

  // Everything logged since the last drain, oldest first
  std::vector<std::string> drain()
  {
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
