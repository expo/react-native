/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.utils

import com.android.build.api.variant.ApplicationAndroidComponentsExtension
import com.android.build.api.variant.LibraryAndroidComponentsExtension
import com.facebook.react.utils.PropertyUtils.INTERNAL_DISABLE_JAVA_VERSION_ALIGNMENT
import org.gradle.api.Action
import org.gradle.api.JavaVersion
import org.gradle.api.Project
import org.gradle.api.plugins.AppliedPlugin
import org.jetbrains.kotlin.gradle.dsl.kotlinExtension

internal object JdkConfiguratorUtils {
  /** Marks the root project once the build-wide toolchain sweep has run. */
  private const val JAVA_TOOLCHAINS_CONFIGURED = "react.internal.javaToolchainsConfigured"

  /**
   * Function that takes care of configuring the JDK toolchain for all the projects. As we do decide
   * the JDK version based on the AGP version that RNGP brings over, here we can safely configure
   * the toolchain to 17.
   */
  fun configureJavaToolChains(input: Project) {
    // Check at the app level if react.internal.disableJavaVersionAlignment is set.
    if (input.hasProperty(INTERNAL_DISABLE_JAVA_VERSION_ALIGNMENT)) {
      return
    }
    // The sweep below reaches every project in the build, so one run covers the whole build and a
    // second is exactly redundant — same root project, same set, same decision per project. It is
    // also harmful: AGP finalizes a project's DSL as it evaluates, so registering `finalizeDsl` on
    // a project the first sweep already reached and that has since been evaluated fails with "It
    // is too late to call `finalizeDsl`". Latching the sweep to once per build keeps the single-app
    // case byte-identical and lets a build hold two application projects.
    //
    // Only builds with more than one app hit this, which is why it has not come up upstream: with
    // one app nothing has been evaluated by the time it sweeps. rn-tester survived a sibling app
    // for exactly one reason — ReactAndroid opts out via the property above.
    val rootProject = input.rootProject
    val alreadySwept = rootProject.extensions.extraProperties
    if (alreadySwept.has(JAVA_TOOLCHAINS_CONFIGURED)) {
      return
    }
    alreadySwept.set(JAVA_TOOLCHAINS_CONFIGURED, true)
    rootProject.allprojects { project ->
      // Allows every single module to set react.internal.disableJavaVersionAlignment also.
      if (project.hasProperty(INTERNAL_DISABLE_JAVA_VERSION_ALIGNMENT)) {
        return@allprojects
      }
      /*
       * A project whose DSL AGP has already finalized cannot be given a `finalizeDsl` callback:
       * AGP 9 fails the build outright rather than ignoring it. Evaluation is what finalizes it,
       * so an already-evaluated project is skipped — not because skipping is desirable, but
       * because there is nothing left to configure and the alternative is the build not running.
       *
       * Reachable as soon as the build contains an autolinked library that applies this plugin the
       * old way, which is what react-native-screens does: it is evaluated before the app that
       * sweeps, and the sweep then arrives too late for it. ReactPlugin's namespace sweep has
       * carried the same guard for the same reason.
       */
      if (project.state.executed) {
        return@allprojects
      }

      val applicationAction =
          Action<AppliedPlugin> {
            project.extensions
                .getByType(ApplicationAndroidComponentsExtension::class.java)
                .finalizeDsl { ext ->
                  ext.compileOptions.sourceCompatibility = JavaVersion.VERSION_17
                  ext.compileOptions.targetCompatibility = JavaVersion.VERSION_17
                }
          }
      val libraryAction =
          Action<AppliedPlugin> {
            project.extensions
                .getByType(LibraryAndroidComponentsExtension::class.java)
                .finalizeDsl { ext ->
                  ext.compileOptions.sourceCompatibility = JavaVersion.VERSION_17
                  ext.compileOptions.targetCompatibility = JavaVersion.VERSION_17
                }
          }
      project.pluginManager.withPlugin("com.android.application", applicationAction)
      project.pluginManager.withPlugin("com.android.library", libraryAction)
      project.pluginManager.withPlugin("org.jetbrains.kotlin.android") {
        project.kotlinExtension.jvmToolchain(17)
      }
      project.pluginManager.withPlugin("org.jetbrains.kotlin.jvm") {
        project.kotlinExtension.jvmToolchain(17)
      }
    }
  }
}
