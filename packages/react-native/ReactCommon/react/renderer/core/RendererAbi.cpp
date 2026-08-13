/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "RendererAbi.h"

#include <glog/logging.h>
#include <react/debug/react_native_assert.h>

namespace facebook::react {

uint32_t rendererAbiVersionOfLibrary() {
  // Compiled into the library, so it reports the library's own value even when
  // the caller's headers are older.
  return kRendererAbiVersion;
}

bool rendererAbiMatchesHeaders() {
  return rendererAbiVersionOfLibrary() == kRendererAbiVersion;
}

void assertRendererAbiMatchesHeaders() {
  if (rendererAbiMatchesHeaders()) {
    return;
  }

  // Deliberately spells out the fix. Someone hitting this is looking at a
  // crash with no obvious connection to what they changed, and the useful
  // information is not "versions differ" but "delete these two directories".
  LOG(ERROR)
      << "React Native headers are STALE: this code was compiled against ABI "
      << kRendererAbiVersion << " but links a library built as ABI "
      << rendererAbiVersionOfLibrary()
      << ". Types that cross the boundary now have different layouts in the "
         "two halves, which corrupts memory at runtime rather than failing to "
         "build. Fix it by deleting the copied headers and the app's native "
         "intermediates, then rebuilding:\n"
         "  rm -rf packages/react-native/ReactAndroid/build/prefab-headers\n"
         "  rm -rf <your-app>/android/app/build/intermediates/cxx";

  // The instructions live in the assertion string because that is what
  // actually reaches Android's log; the glog line above goes to stderr, which
  // Android discards. Verified by simulating a mismatch and reading logcat.
  react_native_assert(
      false &&
      "STALE React Native headers: this app's C++ was built against a different "
      "ABI than the library it links, so shared types have different layouts and "
      "memory WILL be corrupted at runtime. Fix: rm -rf "
      "packages/react-native/ReactAndroid/build/prefab-headers and "
      "<app>/android/app/build/intermediates/cxx, then rebuild.");
}

} // namespace facebook::react
