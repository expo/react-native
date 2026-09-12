/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/*
 * The React Native Gradle plugin on the buildscript classpath, which every project in the build
 * then inherits.
 *
 * `packages/react-native` and `private/helloworld` already do this for themselves; the root needs
 * it for the projects nobody writes a build file for. An autolinked third-party library applies
 * the plugin the old way — `apply plugin: "com.facebook.react"` — and that resolves from the
 * classpath rather than from `pluginManagement`, so without this a library such as
 * react-native-screens fails during configuration with "Plugin with id 'com.facebook.react' not
 * found", taking the whole build with it.
 *
 * The coordinate is substituted by the included build in settings.gradle.kts, so this is the
 * plugin in this repository rather than a published one.
 */
buildscript { dependencies { classpath("com.facebook.react:react-native-gradle-plugin") } }

plugins {
  alias(libs.plugins.nexus.publish)
  alias(libs.plugins.android.library) apply false
  alias(libs.plugins.android.application) apply false
  alias(libs.plugins.download) apply false
  alias(libs.plugins.kotlin.android) apply false
  alias(libs.plugins.binary.compatibility.validator) apply true
  alias(libs.plugins.android.test) apply false
  alias(libs.plugins.ktfmt) apply true
}

val reactAndroidProperties = java.util.Properties()

File("$rootDir/packages/react-native/ReactAndroid/gradle.properties").inputStream().use {
  reactAndroidProperties.load(it)
}

fun getListReactAndroidProperty(name: String) = reactAndroidProperties.getProperty(name).split(",")

apiValidation {
  ignoredPackages.addAll(
      getListReactAndroidProperty("binaryCompatibilityValidator.ignoredPackages")
  )
  ignoredClasses.addAll(getListReactAndroidProperty("binaryCompatibilityValidator.ignoredClasses"))
  nonPublicMarkers.addAll(
      getListReactAndroidProperty("binaryCompatibilityValidator.nonPublicMarkers")
  )
  validationDisabled =
      reactAndroidProperties
          .getProperty("binaryCompatibilityValidator.validationDisabled")
          ?.toBoolean() == true
}

version =
    if (
        project.hasProperty("isSnapshot") && (project.property("isSnapshot") as? String).toBoolean()
    ) {
      "${reactAndroidProperties.getProperty("VERSION_NAME")}-SNAPSHOT"
    } else {
      reactAndroidProperties.getProperty("VERSION_NAME")
    }

group = "com.facebook.react"

val ndkPath by extra(System.getenv("ANDROID_NDK"))
val ndkVersion by extra(System.getenv("ANDROID_NDK_VERSION") ?: libs.versions.ndkVersion.get())
val sonatypeUsername = findProperty("SONATYPE_USERNAME")?.toString()
val sonatypePassword = findProperty("SONATYPE_PASSWORD")?.toString()

nexusPublishing {
  repositories {
    sonatype {
      username.set(sonatypeUsername)
      password.set(sonatypePassword)
      nexusUrl.set(uri("https://ossrh-staging-api.central.sonatype.com/service/local/"))
      snapshotRepositoryUrl.set(uri("https://central.sonatype.com/repository/maven-snapshots/"))
    }
  }
}

tasks.register("clean", Delete::class.java) {
  description = "Remove all the build files and intermediate build outputs"
  dependsOn(gradle.includedBuild("gradle-plugin").task(":clean"))
  subprojects.forEach {
    if (
        it.project.plugins.hasPlugin("com.android.library") ||
            it.project.plugins.hasPlugin("com.android.application")
    ) {
      dependsOn(it.tasks.named("clean"))
    }
  }
  delete(allprojects.map { it.layout.buildDirectory.asFile })
  delete(rootProject.file("./packages/react-native/ReactAndroid/.cxx"))
  delete(rootProject.file("./packages/react-native/ReactAndroid/hermes-engine/.cxx"))
  delete(rootProject.file("./packages/react-native/sdks/download/"))
  delete(rootProject.file("./packages/react-native/sdks/hermes/"))
  delete(
      rootProject.file("./packages/react-native/ReactAndroid/src/main/jni/prebuilt/lib/arm64-v8a/")
  )
  delete(
      rootProject.file(
          "./packages/react-native/ReactAndroid/src/main/jni/prebuilt/lib/armeabi-v7a/"
      )
  )
  delete(rootProject.file("./packages/react-native/ReactAndroid/src/main/jni/prebuilt/lib/x86/"))
  delete(rootProject.file("./packages/react-native/ReactAndroid/src/main/jni/prebuilt/lib/x86_64/"))
  delete(rootProject.file("./packages/react-native-codegen/lib"))
  delete(rootProject.file("./node_modules/@react-native/codegen/lib"))
  delete(rootProject.file("./packages/rn-tester/android/app/.cxx"))
}

tasks.register("build") {
  description = "Build and test all the React Native relevant projects."
  dependsOn(gradle.includedBuild("gradle-plugin").task(":build"))
}

tasks.register("publishAllToMavenTempLocal") {
  description = "Publish all the artifacts to be available inside a Maven Local repository on /tmp."
  dependsOn(":packages:react-native:ReactAndroid:publishAllPublicationsToMavenTempLocalRepository")
}

tasks.register("publishAndroidToSonatype") {
  description = "Publish the Android artifacts to Sonatype (Maven Central or Snapshot repository)"
  dependsOn(":packages:react-native:ReactAndroid:publishToSonatype")
}

var hermesSubstitution: Pair<String, String>? = null

if (project.findProperty("react.internal.useHermesStable")?.toString()?.toBoolean() == true) {
  val hermesVersions = java.util.Properties()
  val hermesVersionPropertiesFile =
      rootProject.file("./packages/react-native/sdks/hermes-engine/version.properties")
  hermesVersionPropertiesFile.inputStream().use { hermesVersions.load(it) }
  val selectedHermesVersion = hermesVersions["HERMES_VERSION_NAME"] as String

  hermesSubstitution = selectedHermesVersion to "Users opted to use stable hermes release"
} else if (
    project.findProperty("react.internal.useHermesNightly")?.toString()?.toBoolean() == true
) {
  val reactNativePackageJson = rootProject.file("./packages/react-native/package.json")
  val reactNativePackageJsonContent = reactNativePackageJson.readText()
  val packageJson = groovy.json.JsonSlurper().parseText(reactNativePackageJsonContent) as Map<*, *>

  val hermesCompilerVersion =
      (packageJson["dependencies"] as Map<*, *>)["hermes-compiler"] as String

  if (hermesCompilerVersion == "0.0.0") {
    throw RuntimeException(
        "Trying to use Hermes Nightly but hermes-compiler version is not specified"
    )
  }

  hermesSubstitution = hermesCompilerVersion to "Users opted to use Hermes V1 prebuilt"
} else {
  logger.warn(
      """
      ********************************************************************************
      INFO: You're building Hermes from source as you set

      react.internal.useHermesStable=false
      react.internal.useHermesNightly=false

      in the ./gradle.properties file.

      That's fine for local development, but you should not commit this change.
      ********************************************************************************
      """
          .trimIndent()
  )
}

if (hermesSubstitution != null) {
  val (hermesVersion, reason) = hermesSubstitution!!
  project(":packages:react-native:ReactAndroid:hermes-engine") {
    tasks.configureEach { enabled = false }
  }

  allprojects {
    configurations.all {
      resolutionStrategy.dependencySubstitution {
        substitute(project(":packages:react-native:ReactAndroid:hermes-engine"))
            .using(module("com.facebook.hermes:hermes-android:$hermesVersion"))
            .because(reason)
      }
    }
  }
}

/*
 * Autolinked third-party libraries, built against React Native from source.
 *
 * A library such as react-native-screens declares `com.facebook.react:react-native:+`. The React
 * Native Gradle plugin rewrites that to `com.facebook.react:react-android:<version>` and FORCES the
 * version, which is right for an app consuming a published React Native and impossible here: this
 * repository IS React Native, and 1000.0.0 has never been published anywhere.
 *
 * A dependency substitution cannot win against the plugin's `force`, so the coordinate is excluded
 * outright and the project that provides those classes is added in its place. Excluding rather than
 * substituting also keeps a second copy of React Native out of the APK, which is what resolving the
 * artifact alongside the project dependency would produce.
 *
 * Named projects rather than a pattern: this should fail loudly when a new library is autolinked
 * and needs the same treatment, rather than quietly matching something it should not.
 */
/*
 * Third-party libraries read their minimum SDK from this, and default to 21. ReactAndroid's prefab
 * is built for 24, and CMake refuses to link a library declaring a lower minimum against it —
 * "User has minSdkVersion 21 but library was built for 24".
 *
 * Kept because it is correct regardless, and because it is the first of the two walls in the way
 * of building react-native-screens here. The second is a link failure — undefined vtables for
 * RNSFullWindowOverlayProps and its siblings — which says the library's generated Props are not in
 * the autolinked C++ target. That is a codegen-integration problem between a released library and a
 * source build, and not one to guess at.
 */
extra["minSdkVersion"] = 24

val librariesBuiltAgainstSource = setOf("react-native-screens", "react-native-safe-area-context")

subprojects {
  if (name in librariesBuiltAgainstSource) {
    configurations.configureEach {
      exclude(mapOf("group" to "com.facebook.react", "module" to "react-android"))
      exclude(mapOf("group" to "com.facebook.react", "module" to "react-native"))
    }
    afterEvaluate {
      dependencies.add("implementation", project(":packages:react-native:ReactAndroid"))
    }
  }
}

ktfmt {
  blockIndent.set(2)
  continuationIndent.set(4)
  maxWidth.set(100)
  removeUnusedImports.set(false)
  manageTrailingCommas.set(false)
}

// Configure ktfmt tasks to include gradle-plugin
listOf("ktfmtCheck", "ktfmtFormat").forEach { taskName ->
  tasks.named(taskName) { dependsOn(gradle.includedBuild("gradle-plugin").task(":$taskName")) }
}

allprojects {
  // Apply exclusions for specific files that should not be formatted
  val excludePatterns = listOf(
      "**/build/**",
      "**/hermes-engine/**",
      "**/internal/featureflags/**",
      "**/systeminfo/ReactNativeVersion.kt",
  )
  listOf(
      com.ncorti.ktfmt.gradle.tasks.KtfmtCheckTask::class,
      com.ncorti.ktfmt.gradle.tasks.KtfmtFormatTask::class,
  )
      .forEach { tasks.withType(it) { exclude(excludePatterns) } }

  // Disable the problematic ktfmt script tasks due to symbolic link issues in subprojects
  afterEvaluate {
    listOf("ktfmtCheckScripts", "ktfmtFormatScripts").forEach {
      tasks.findByName(it)?.enabled = false
    }
  }
}

// We intentionally disable the `ktfmtCheck` tasks as the formatting is primarly handled inside
// fbsource
allprojects { tasks.withType<com.ncorti.ktfmt.gradle.tasks.KtfmtCheckTask>() { enabled = false } }
