/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include <yoga/numeric/FloatOptional.h>

namespace facebook::yoga {

/*
 * One step of a CSS math function over lengths and percentages (`calc()`,
 * `min()`, `max()`, `clamp()`; css-values-4 §10) whose percentages only
 * layout can resolve, as it resolves a percentage length: against the size
 * the property's percentages are of. An expression is its steps in postfix
 * order. A style holds the id `CalcRegistry` gives the expression, so a length
 * keeps the size it has for every other unit.
 */
struct CalcStep {
  enum class Kind : uint8_t {
    // Pushes `value` points
    Points,
    // Pushes `value` percent of the reference length
    Percent,
    // Pushes `value`, a factor for `Multiply` and a divisor for `Divide`
    Number,
    Add,
    Subtract,
    Multiply,
    Divide,
    // Pops `count` values
    Min,
    Max,
    // Pops the minimum, the preferred value and the maximum
    Clamp,
  };

  Kind kind{Kind::Points};
  uint8_t count{0};
  float value{0};

  bool operator==(const CalcStep& other) const = default;
};

using CalcExpression = std::vector<CalcStep>;

/*
 * `steps` against `referenceLength`: undefined where a percentage meets an
 * undefined reference length, as a percentage length is, and where the steps
 * are malformed or the result is not finite.
 */
inline FloatOptional evaluateCalc(
    const CalcExpression& steps,
    float referenceLength) {
  std::array<float, 16> stack{};
  size_t depth = 0;
  for (const auto& step : steps) {
    switch (step.kind) {
      case CalcStep::Kind::Points:
      case CalcStep::Kind::Number:
      case CalcStep::Kind::Percent: {
        if (depth == stack.size()) {
          return FloatOptional{};
        }
        stack[depth++] = step.kind == CalcStep::Kind::Percent
            ? step.value * referenceLength * 0.01f
            : step.value;
        break;
      }
      case CalcStep::Kind::Add:
      case CalcStep::Kind::Subtract:
      case CalcStep::Kind::Multiply:
      case CalcStep::Kind::Divide: {
        if (depth < 2) {
          return FloatOptional{};
        }
        const float right = stack[--depth];
        float& left = stack[depth - 1];
        switch (step.kind) {
          case CalcStep::Kind::Add:
            left += right;
            break;
          case CalcStep::Kind::Subtract:
            left -= right;
            break;
          case CalcStep::Kind::Multiply:
            left *= right;
            break;
          default:
            left /= right;
            break;
        }
        break;
      }
      case CalcStep::Kind::Min:
      case CalcStep::Kind::Max: {
        if (step.count == 0 || depth < step.count) {
          return FloatOptional{};
        }
        float result = stack[depth - step.count];
        for (size_t i = depth - step.count + 1; i < depth; i++) {
          // NaN, a percentage of an undefined length, makes the whole
          // function undefined rather than losing to the other arguments
          if (std::isnan(result) || std::isnan(stack[i])) {
            result = std::numeric_limits<float>::quiet_NaN();
          } else if (step.kind == CalcStep::Kind::Min) {
            result = std::min(result, stack[i]);
          } else {
            result = std::max(result, stack[i]);
          }
        }
        depth -= step.count;
        stack[depth++] = result;
        break;
      }
      case CalcStep::Kind::Clamp: {
        if (depth < 3) {
          return FloatOptional{};
        }
        const float maximum = stack[--depth];
        const float preferred = stack[--depth];
        float& minimum = stack[depth - 1];
        // css-values-4 §10.4: the minimum wins over the maximum
        minimum = std::isnan(minimum) || std::isnan(preferred) ||
                std::isnan(maximum)
            ? std::numeric_limits<float>::quiet_NaN()
            : std::max(minimum, std::min(preferred, maximum));
        break;
      }
    }
  }
  if (depth != 1 || !std::isfinite(stack[0])) {
    return FloatOptional{};
  }
  return FloatOptional{stack[0]};
}

/*
 * The expressions styles name by id. Interned, so a style that is parsed again
 * names the same expression, and never freed, so an id stays valid for every
 * style that holds it. Reads take no lock: layout resolves lengths on any
 * thread while props are parsed on another.
 */
class CalcRegistry {
 public:
  // No expression has this id; it evaluates to undefined
  static constexpr uint32_t kInvalidId = std::numeric_limits<uint32_t>::max();

  static uint32_t intern(const CalcExpression& steps) {
    auto& storage = instance();
    std::string key = keyOf(steps);
    std::lock_guard<std::mutex> lock(storage.mutex);
    if (const auto found = storage.ids.find(key); found != storage.ids.end()) {
      return found->second;
    }
    const uint32_t id = storage.count.load(std::memory_order_relaxed);
    const size_t chunkIndex = id / kChunkSize;
    if (chunkIndex >= kChunkCount) {
      return kInvalidId;
    }
    auto* chunk = storage.chunks[chunkIndex].load(std::memory_order_relaxed);
    if (chunk == nullptr) {
      chunk = new Chunk{};
      storage.chunks[chunkIndex].store(chunk, std::memory_order_release);
    }
    (*chunk)[id % kChunkSize] = new CalcExpression(steps);
    storage.ids.emplace(std::move(key), id);
    storage.count.store(id + 1, std::memory_order_release);
    return id;
  }

  static const CalcExpression* get(uint32_t id) {
    const auto& storage = instance();
    if (id >= storage.count.load(std::memory_order_acquire)) {
      return nullptr;
    }
    const auto* chunk =
        storage.chunks[id / kChunkSize].load(std::memory_order_acquire);
    return (*chunk)[id % kChunkSize];
  }

  static FloatOptional evaluate(uint32_t id, float referenceLength) {
    const auto* steps = get(id);
    return steps != nullptr ? evaluateCalc(*steps, referenceLength)
                            : FloatOptional{};
  }

 private:
  static constexpr size_t kChunkSize = 256;
  static constexpr size_t kChunkCount = 4096;
  using Chunk = std::array<const CalcExpression*, kChunkSize>;

  struct Storage {
    std::mutex mutex;
    std::unordered_map<std::string, uint32_t> ids;
    std::array<std::atomic<Chunk*>, kChunkCount> chunks{};
    std::atomic<uint32_t> count{0};
  };

  // Never destroyed, so a layout still running at exit finds it
  static Storage& instance() {
    static auto* storage = new Storage();
    return *storage;
  }

  // The steps' bytes without the padding between their fields
  static std::string keyOf(const CalcExpression& steps) {
    std::string key;
    key.reserve(steps.size() * (2 + sizeof(float)));
    for (const auto& step : steps) {
      key.push_back(static_cast<char>(step.kind));
      key.push_back(static_cast<char>(step.count));
      char bits[sizeof(float)];
      std::memcpy(bits, &step.value, sizeof(float));
      key.append(bits, sizeof(float));
    }
    return key;
  }
};

} // namespace facebook::yoga
