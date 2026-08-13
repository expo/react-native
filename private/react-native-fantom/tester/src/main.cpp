/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include <glog/logging.h>
#include <react/debug/flags.h>
#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/featureflags/ReactNativeFeatureFlagsDynamicProvider.h>
#include <chrono>
#include <cstdio>
#include <memory>
#include <stdexcept>
#include <thread>
#include "AppSettings.h"
#include "TesterAppDelegate.h"

using namespace facebook::react;

static void setUpLogging() {
  google::InitGoogleLogging("react-native-fantom");
  FLAGS_logtostderr = true;
  FLAGS_minloglevel = AppSettings::minLogLevel;
}

static void setUpFeatureFlags() {
  folly::dynamic dynamicFeatureFlags = folly::dynamic::object();

  dynamicFeatureFlags["enableBridgelessArchitecture"] = true;
  dynamicFeatureFlags["cxxNativeAnimatedEnabled"] = true;

  if (AppSettings::dynamicFeatureFlags.has_value()) {
    dynamicFeatureFlags.update(AppSettings::dynamicFeatureFlags.value());
  }

  ReactNativeFeatureFlags::override(
      std::make_unique<ReactNativeFeatureFlagsDynamicProvider>(
          dynamicFeatureFlags));
}

// The body of `main`, so that a failure anywhere in it is reported as a
// message and a non-zero exit code. Without this an exception escapes to
// `std::terminate`, which the runner sees only as a signal.
static int runTester() {
  setUpFeatureFlags();

  auto config = ReactInstanceConfig{
      .appId = "com.meta.reactnative.fantom",
      .deviceName = "RN Fantom",
  };

  if (AppSettings::inspectorPort.has_value()) {
    config.enableInspector = true;
    config.devServerPort = AppSettings::inspectorPort.value();
  }

  auto appDelegate = TesterAppDelegate(config);

  if (AppSettings::inspectorPort.has_value()) {
    // FIXME(T234306362): Replace this logic with a call to
    // `appDelegate.waitForDebugger()` that handles orchestration properly.

    // Wait for inspector websocket to connect.
    std::this_thread::sleep_for(std::chrono::seconds(2));

    appDelegate.openDebugger();

    // Wait for debugger UI to open and start a debugging session.
    std::this_thread::sleep_for(std::chrono::seconds(2));
  }

  if (AppSettings::interactive) {
    appDelegate.loadScript(AppSettings::defaultBundlePath, "");
    appDelegate.runInteractiveLoop();
    return 0;
  }

  appDelegate.loadScriptAndRunTests(AppSettings::defaultBundlePath, "");

  return 0;
}

int main(int argc, char* argv[]) {
  AppSettings::init(argc, argv);

  setUpLogging();

  try {
    return runTester();
  } catch (const std::exception& e) {
    // Say it on stderr as well as through glog: the runner surfaces the
    // process's output verbatim, and a bare signal with empty output is the
    // hardest possible thing to act on.
    fprintf(stderr, "fantom_tester failed: %s\n", e.what());
    LOG(ERROR) << "fantom_tester failed: " << e.what();
    return 1;
  } catch (...) {
    fprintf(stderr, "fantom_tester failed with an unknown exception\n");
    LOG(ERROR) << "fantom_tester failed with an unknown exception";
    return 1;
  }
}
