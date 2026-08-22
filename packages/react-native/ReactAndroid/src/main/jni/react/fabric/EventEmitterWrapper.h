/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <fbjni/fbjni.h>
#include <react/jni/ReadableNativeMap.h>
#include <react/renderer/core/EventEmitter.h>

namespace facebook::react {

class Instance;

class EventEmitterWrapper : public jni::HybridClass<EventEmitterWrapper> {
 public:
  constexpr static const char *const kJavaDescriptor = "Lcom/facebook/react/fabric/events/EventEmitterWrapper;";

  static void registerNatives();

  EventEmitterWrapper(SharedEventEmitter eventEmitter) : eventEmitter(std::move(eventEmitter)) {};

  SharedEventEmitter eventEmitter;

  void dispatchEvent(std::string eventName, NativeMap *payload, int category, jlong eventTimestamp);
  void dispatchEventSynchronously(std::string eventName, NativeMap *params, jlong eventTimestamp);

  /*
   * Dispatches an event that JavaScript may refuse or answer, and does not
   * return until it has.
   *
   * The payload gains `preventDefault()` and `setValue(text)`; the decision
   * comes back encoded in the returned string because JNI makes returning a
   * small struct more trouble than it is worth:
   *
   *   null            the default action may proceed unchanged
   *   "\x01"          the default action is refused
   *   anything else   the default action proceeds with this value instead
   *
   * The marker is a control character precisely because no substitution would
   * ever legitimately be one, so the encoding cannot collide with real text.
   */
  jni::local_ref<jstring> dispatchCancelableEventSynchronously(
      std::string eventName,
      NativeMap *params,
      jlong eventTimestamp);
  void dispatchUniqueEvent(std::string eventName, NativeMap *payload, jlong eventTimestamp);
};

} // namespace facebook::react
