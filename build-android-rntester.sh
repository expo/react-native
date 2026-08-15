#!/bin/bash
# Build and install RNTester on a running Android emulator or device.
#
# Exists because two things about this build are easy to get wrong and both
# fail far from the cause:
#
#  1. `libappmodules.so` compiles against ReactAndroid/build/prefab-headers/,
#     a COPY of the C++ headers, while libreactnative.so builds from the live
#     sources. The task that produces that copy reports success while doing
#     nothing when it believes it is up to date, so a NEW header — or a
#     changed layout in an existing one — can leave the two halves of the app
#     disagreeing about a struct. The symptom is a startup crash inside
#     ComponentDescriptorRegistry (`std::length_error: vector`), nowhere near
#     the edit. Deleting the directory first is the only reliable fix.
#
#  2. A dev-server host persisted by an earlier run survives reinstalls and
#     presents as "Unable to load script" while Metro is perfectly healthy.
#     iOS has the same trap under a different name — the app stores
#     RCT_jsLocation in NSUserDefaults, and a stale port there produces a
#     "Packager status check returned unexpected result" warning on every
#     launch. Clear it with:
#       xcrun simctl spawn booted defaults delete dev.expo.rntester RCT_jsLocation
#
#  3. gradle.properties sets useHermesNightly, which fails the build with
#     "Trying to use Hermes Nightly but hermes-compiler version is not
#     specified" unless it is overridden.
#
# Usage: ./build-android-rntester.sh [--skip-prefab]
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
ADB="$ANDROID_HOME/platform-tools/adb"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ "${1:-}" != "--skip-prefab" ]]; then
  echo "==> refreshing prefab headers (deleting first; the task no-ops otherwise)"
  rm -rf packages/react-native/ReactAndroid/build/prefab-headers
  ./gradlew :packages:react-native:ReactAndroid:preparePrefab \
    -Preact.internal.useHermesNightly=false
fi

echo "==> building and installing"
./gradlew :packages:rn-tester:android:app:installDebug \
  -Preact.internal.useHermesNightly=false \
  -PreactNativeArchitectures=arm64-v8a

echo "==> pointing the app at Metro"
"$ADB" reverse tcp:8081 tcp:8081

# A dev-server host persisted by an earlier run survives reinstalls and shows
# up as "Unable to load script" even when Metro is healthy.
echo "==> clearing app data (drops any stale dev-server setting)"
"$ADB" shell pm clear com.facebook.react.uiapp

echo "==> launching"
"$ADB" shell am start -n com.facebook.react.uiapp/.RNTesterActivity \
  --es route "${ROUTE:-Grid}" > /dev/null

echo "done. If the screen shows 'Unable to load script', Metro is cold —"
echo "the first bundle takes a while; relaunch once it has finished."
