/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
  id("com.facebook.react")
  alias(libs.plugins.android.application)
}

val reactNativeDirPath = "$rootDir/packages/react-native"
val isNewArchEnabled = project.property("newArchEnabled") == "true"

react {
  // This package's directory, where package.json is.
  root = file("../../")
  reactNativeDir = file(reactNativeDirPath)
  codegenDir = file("$rootDir/node_modules/@react-native/codegen")
  cliFile = file("$reactNativeDirPath/cli.js")

  // Must match `BUNDLE_ASSET_NAME` in `defaultConfig` below.
  bundleAssetName = "index.android.bundle"
  entryFile = file("../../index.js")

  hermesCommand =
      if (
          project.findProperty("react.internal.useHermesStable")?.toString()?.toBoolean() == true ||
              project.findProperty("react.internal.useHermesNightly")?.toString()?.toBoolean() ==
                  true
      )
          "$rootDir/node_modules/hermes-compiler/hermesc/%OS-BIN%/hermesc"
      else "$reactNativeDirPath/ReactAndroid/hermes-engine/build/hermes/bin/hermesc"

  autolinkLibrariesWithApp()
}

val enableProguardInReleaseBuilds = true

val cmakeVersion =
    project(":packages:react-native:ReactAndroid").properties["cmake_version"].toString()

fun reactNativeArchitectures(): List<String> {
  val value = project.properties["reactNativeArchitectures"]
  return value?.toString()?.split(",") ?: listOf("armeabi-v7a", "x86", "x86_64", "arm64-v8a")
}

android {
  compileSdk = libs.versions.compileSdk.get().toInt()
  buildToolsVersion = libs.versions.buildTools.get()
  namespace = "dev.expo.frontierdemo"

  if (rootProject.hasProperty("ndkPath") && rootProject.properties["ndkPath"] != null) {
    ndkPath = rootProject.properties["ndkPath"].toString()
  }
  if (rootProject.hasProperty("ndkVersion") && rootProject.properties["ndkVersion"] != null) {
    ndkVersion = rootProject.properties["ndkVersion"].toString()
  }

  defaultConfig {
    applicationId = "dev.expo.frontierdemo"
    minSdk = libs.versions.minSdk.get().toInt()
    targetSdk = libs.versions.targetSdk.get().toInt()
    versionCode = 1
    versionName = "1.0"
    testBuildType =
        System.getProperty(
            "testBuildType",
            "debug",
        )
    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    buildConfigField("String", "JS_MAIN_MODULE_NAME", "\"index\"")
    buildConfigField("String", "BUNDLE_ASSET_NAME", "\"index.android.bundle\"")
    buildConfigField("Boolean", "IS_INTERNAL_BUILD", "false")
  }
  externalNativeBuild { cmake { version = cmakeVersion } }
  splits {
    abi {
      isEnable = true
      isUniversalApk = false
      reset()
      include(*reactNativeArchitectures().toTypedArray())
    }
  }
  buildTypes {
    release {
      isMinifyEnabled = enableProguardInReleaseBuilds
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
      signingConfig = signingConfigs.getByName("debug")
    }
  }
  sourceSets.named("main") {
    kotlin.directories.add(
        "$reactNativeDirPath/ReactCommon/react/nativemodule/samples/platform/android"
    )
    res.directories.apply {
      clear()
      addAll(
          listOf(
              "src/main/res",
              "src/main/public_res",
          )
      )
    }
  }
}

dependencies {
  implementation(project(":packages:react-native:ReactAndroid"))

  implementation(project(":packages:react-native:ReactAndroid:hermes-engine"))

  testImplementation(libs.junit)
  implementation(libs.androidx.profileinstaller)
  // Material 3, for the app theme and the toolbar in res/layout/main.xml. The HTML elements look up
  // Material theme attributes such as `colorPrimary` by name, and those exist only under a
  // Material theme.
  implementation("com.google.android.material:material:1.13.0")
}

tasks.withType<KotlinCompile>().configureEach {
  compilerOptions {
    allWarningsAsErrors =
        project.properties["enableWarningsAsErrors"]?.toString()?.toBoolean() ?: false
  }
}

afterEvaluate {
  if (
      (project.findProperty("react.internal.useHermesNightly") == null ||
          project.findProperty("react.internal.useHermesNightly").toString() == "false") &&
          (project.findProperty("react.internal.useHermesStable") == null ||
              project.findProperty("react.internal.useHermesStable").toString() == "false")
  ) {
    // The bundle task runs `hermesc`, which is built from source.
    tasks
        .getByName("createBundleReleaseJsAndAssets")
        .dependsOn(":packages:react-native:ReactAndroid:hermes-engine:buildHermesC")
  }

  // These tasks run the codegen CLI, which `buildCodegenCLI` builds from source.
  tasks
      .getByName("generateCodegenSchemaFromJavaScript")
      .dependsOn(":packages:react-native:ReactAndroid:buildCodegenCLI")
  tasks
      .getByName("createBundleReleaseJsAndAssets")
      .dependsOn(":packages:react-native:ReactAndroid:buildCodegenCLI")
}
