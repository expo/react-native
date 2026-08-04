/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <cstdint>

namespace facebook::react {

/*
 * A stamp for catching an app built against STALE React Native headers.
 *
 * On Android an app's own C++ compiles against headers copied into
 * `ReactAndroid/build/prefab-headers` and links the prebuilt renderer library.
 * An incremental build can leave those copies behind the library. Nothing
 * fails to build — the app simply uses the old layout of a shared type, which
 * corrupts memory the first time the two disagree. That is a miserable thing
 * to debug: it surfaced here as a `SIGSEGV` destroying a `TextEffectInfo` on
 * the JS thread, on screens unrelated to the change that caused it.
 *
 * No `static_assert` can catch this, because a stale header is entirely
 * self-consistent. The check has to compare something the APP compiled with
 * against something the LIBRARY compiled with, which is what this does.
 *
 * BUMP THIS when changing the layout of anything an app's own C++ compiles
 * against: adding, removing or reordering a virtual method, or changing the
 * fields of a struct that crosses the boundary.
 */
constexpr uint32_t kRendererAbiVersion = 1;

/*
 * Returns the value the renderer LIBRARY was compiled with, as opposed to the
 * `kRendererAbiVersion` above, which is whatever the caller's headers say.
 */
uint32_t rendererAbiVersionOfLibrary();

/*
 * True when the caller's headers match the library it is linked against.
 *
 * Call it once from an app's own C++ — `JNI_OnLoad` is the natural place — so
 * a mismatch is reported at load, in one line, instead of as corruption later.
 */
bool rendererAbiMatchesHeaders();

/*
 * Reports a mismatch and says what to do about it: logs, then asserts in a
 * build with assertions on. Safe to call unconditionally.
 */
void assertRendererAbiMatchesHeaders();

} // namespace facebook::react
