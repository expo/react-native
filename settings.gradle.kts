/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

pluginManagement {
  repositories {
    mavenCentral()
    google()
    gradlePluginPortal()
  }
  includeBuild("packages/gradle-plugin/")
}

include(
    ":packages:react-native:ReactAndroid",
    ":packages:react-native:ReactAndroid:hermes-engine",
    ":packages:react-native:ReactAndroid:external-artifacts",
    ":packages:rn-tester:android:app",
    ":packages:rn-tester:android:app:benchmark",
    ":private:react-native-fantom",
    ":packages:chat-demo:android:app",
)

includeBuild("packages/gradle-plugin/")

dependencyResolutionManagement {
  versionCatalogs {
    create("libs") { from(files("packages/react-native/gradle/libs.versions.toml")) }
  }
}

rootProject.name = "react-native-github"

plugins {
  id("org.gradle.toolchains.foojay-resolver-convention").version("1.0.0")
  id("com.facebook.react.settings")
}

/*
 * Autolinking is computed for ONE app per build: the settings plugin writes a single
 * `autolinking.json` for the whole repository, so the working directory has to be the app that
 * is being built. rn-tester is the default and a `:packages:chat-demo:` task switches it —
 * without which the chat demo builds against rn-tester's dependency list and its own native
 * libraries are simply absent, which is how `react-native-screens` came to have no view manager
 * on Android while resolving perfectly well in JavaScript.
 *
 * The app's own manifests join the cache key. It is keyed on the lock files alone otherwise, and
 * `yarn.lock` does not change when the app does, so switching between the two would serve
 * whichever list was generated first.
 */
val autolinkApp =
    if (gradle.startParameter.taskNames.any { it.contains(":chat-demo:") }) "packages/chat-demo"
    else "packages/rn-tester"

configure<com.facebook.react.ReactSettingsExtension> {
  autolinkLibrariesFromCommand(
      workingDirectory = file(autolinkApp),
      lockFiles =
          files("yarn.lock", "$autolinkApp/package.json", "$autolinkApp/react-native.config.js"),
  )
}
