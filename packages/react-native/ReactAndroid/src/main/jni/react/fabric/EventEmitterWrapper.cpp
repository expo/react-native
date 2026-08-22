/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "EventEmitterWrapper.h"
#include <fbjni/fbjni.h>
#include <jsi/JSIDynamic.h>
#include <react/renderer/core/CancelableEventDecision.h>
#include <react/timing/primitives.h>

#include <utility>

using namespace facebook::jni;

namespace facebook::react {

namespace {

/*
 * Converts a Java timestamp (milliseconds since boot from
 * SystemClock.uptimeMillis()) to a HighResTimeStamp.
 */
HighResTimeStamp highResTimeStampFromMillis(jlong millis) {
  return HighResTimeStamp::fromChronoSteadyClockTimePoint(
      std::chrono::steady_clock::time_point(std::chrono::milliseconds(millis)));
}

} // namespace

void EventEmitterWrapper::dispatchEvent(
    std::string eventName,
    NativeMap* payload,
    int category,
    jlong eventTimestamp) {
  // It is marginal, but possible for this to be constructed without a valid
  // EventEmitter. In those cases, make sure we noop/blackhole events instead of
  // crashing.
  if (eventEmitter != nullptr) {
    eventEmitter->dispatchEvent(
        std::move(eventName),
        (payload != nullptr) ? payload->consume() : folly::dynamic::object(),
        static_cast<RawEvent::Category>(category),
        highResTimeStampFromMillis(eventTimestamp));
  }
}

void EventEmitterWrapper::dispatchEventSynchronously(
    std::string eventName,
    NativeMap* params,
    jlong eventTimestamp) {
  // It is marginal, but possible for this to be constructed without a valid
  // EventEmitter. In those cases, make sure we noop/blackhole events instead of
  // crashing.
  if (eventEmitter != nullptr) {
    eventEmitter->experimental_flushSync([&]() {
      eventEmitter->dispatchEvent(
          std::move(eventName),
          (params != nullptr) ? params->consume() : folly::dynamic::object(),
          RawEvent::Category::Discrete,
          highResTimeStampFromMillis(eventTimestamp));
    });
  }
}

jni::local_ref<jstring> EventEmitterWrapper::dispatchCancelableEventSynchronously(
    std::string eventName,
    NativeMap* params,
    jlong eventTimestamp) {
  if (eventEmitter == nullptr) {
    return nullptr;
  }

  auto decision = std::make_shared<CancelableEventDecision>();
  auto payload = (params != nullptr) ? params->consume() : folly::dynamic::object();
  auto timestamp = highResTimeStampFromMillis(eventTimestamp);

  // `experimental_dispatchSyncNow` rather than the older flush: the older one
  // only marks the *next* beat as synchronous, so this would read the decision
  // before any handler had run.
  const bool ran = eventEmitter->experimental_dispatchSyncNow([&]() {
    eventEmitter->dispatchEvent(
        std::move(eventName),
        [payload, decision](jsi::Runtime& runtime) {
          auto object = jsi::valueFromDynamic(runtime, payload).asObject(runtime);
          decorateCancelablePayload(runtime, object, decision);
          return object;
        },
        RawEvent::Category::Discrete,
        timestamp);
  });

  if (!ran || (!decision->defaultPrevented && !decision->hasReplacement)) {
    return nullptr;
  }
  if (decision->defaultPrevented) {
    return jni::make_jstring(std::string(1, '\x01'));
  }
  return jni::make_jstring(decision->replacement);
}

void EventEmitterWrapper::dispatchUniqueEvent(
    std::string eventName,
    NativeMap* payload,
    jlong eventTimestamp) {
  // It is marginal, but possible for this to be constructed without a valid
  // EventEmitter. In those cases, make sure we noop/blackhole events instead of
  // crashing.
  if (eventEmitter != nullptr) {
    eventEmitter->dispatchUniqueEvent(
        std::move(eventName),
        (payload != nullptr) ? payload->consume() : folly::dynamic::object(),
        highResTimeStampFromMillis(eventTimestamp));
  }
}

void EventEmitterWrapper::registerNatives() {
  registerHybrid({
      makeNativeMethod("dispatchEvent", EventEmitterWrapper::dispatchEvent),
      makeNativeMethod(
          "dispatchUniqueEvent", EventEmitterWrapper::dispatchUniqueEvent),
      makeNativeMethod(
          "dispatchEventSynchronously",
          EventEmitterWrapper::dispatchEventSynchronously),
      makeNativeMethod(
          "dispatchCancelableEventSynchronously",
          EventEmitterWrapper::dispatchCancelableEventSynchronously),
  });
}

} // namespace facebook::react
