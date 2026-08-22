/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <memory>
#include <string>

#include <jsi/jsi.h>

namespace facebook::react {

/*
 * What JavaScript decided about something that has not happened yet.
 *
 * The DOM's `preventDefault` shape: a method on the event that writes state the
 * dispatcher inspects once the handler has run. It only means anything for an
 * event dispatched *synchronously* — see
 * `EventEmitter::experimental_dispatchSyncNow` — because an asynchronous
 * dispatch has already let the default happen by the time anyone could answer.
 *
 * `setValue` is the addition the DOM does not have and a native control needs.
 * On the web, cancelling an edit and substituting a different one are two steps:
 * `preventDefault()` and then write to the element. A platform control asks a
 * single question — "may this edit be applied, and as what?" — inside a callback
 * that wants one answer, so substitution is part of the answer rather than a
 * follow-up mutation. It is also what keeps a transform invisible: the control
 * applies the substituted text directly, so nothing intermediate is ever drawn.
 */
struct CancelableEventDecision {
  /* The default action is refused. */
  bool defaultPrevented{false};
  /* The default action happens, but with this value instead. */
  bool hasReplacement{false};
  std::string replacement{};
};

/*
 * Adds `preventDefault()` and `setValue(string)` to an event payload, backed by
 * `decision`.
 *
 * The decision is held by `shared_ptr` so the functions stay valid for as long
 * as JavaScript can reach them, which outlives the dispatch call itself if a
 * handler squirrels the event away.
 */
inline void decorateCancelablePayload(
    jsi::Runtime& runtime,
    jsi::Object& payload,
    const std::shared_ptr<CancelableEventDecision>& decision) {
  payload.setProperty(
      runtime,
      "preventDefault",
      jsi::Function::createFromHostFunction(
          runtime,
          jsi::PropNameID::forAscii(runtime, "preventDefault"),
          0,
          [decision](jsi::Runtime&, const jsi::Value&, const jsi::Value*, size_t) {
            decision->defaultPrevented = true;
            return jsi::Value::undefined();
          }));

  payload.setProperty(
      runtime,
      "setValue",
      jsi::Function::createFromHostFunction(
          runtime,
          jsi::PropNameID::forAscii(runtime, "setValue"),
          1,
          [decision](
              jsi::Runtime& rt,
              const jsi::Value&,
              const jsi::Value* args,
              size_t count) {
            if (count > 0 && args[0].isString()) {
              decision->hasReplacement = true;
              decision->replacement = args[0].asString(rt).utf8(rt);
            }
            return jsi::Value::undefined();
          }));
}

} // namespace facebook::react
