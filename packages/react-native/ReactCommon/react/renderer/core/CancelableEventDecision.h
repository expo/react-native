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
 * The DOM's `preventDefault` shape: state the dispatcher inspects once the
 * handler has run, meaningful only for a synchronous dispatch
 * (`EventEmitter::experimental_dispatchSyncNow`). `setValue` is the addition
 * a native control needs: its pre-commit callback asks one question, "may
 * this edit be applied, and as what?", so substitution is part of the answer
 * and nothing intermediate is drawn.
 */
struct CancelableEventDecision {
  /* The default action is refused. */
  bool defaultPrevented{false};
  /* The default action happens, but with this value instead. */
  bool hasReplacement{false};
  std::string replacement{};
};

// The decision is held by `shared_ptr` so the functions stay valid as long
// as JavaScript can reach them, which outlives the dispatch if a handler keeps
// the event
inline void decorateCancelablePayload(
    jsi::Runtime &runtime,
    jsi::Object &payload,
    const std::shared_ptr<CancelableEventDecision> &decision)
{
  payload.setProperty(
      runtime,
      "preventDefault",
      jsi::Function::createFromHostFunction(
          runtime,
          jsi::PropNameID::forAscii(runtime, "preventDefault"),
          0,
          [decision](jsi::Runtime &, const jsi::Value &, const jsi::Value *, size_t) {
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
          [decision](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
            if (count > 0 && args[0].isString()) {
              decision->hasReplacement = true;
              decision->replacement = args[0].asString(rt).utf8(rt);
            }
            return jsi::Value::undefined();
          }));
}

} // namespace facebook::react
