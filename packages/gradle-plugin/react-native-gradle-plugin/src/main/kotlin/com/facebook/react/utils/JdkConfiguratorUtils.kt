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
  /** Marks the root project once the build-wide toolchain sweep has run */
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
    // The sweep below reaches every project in the build, so a second run is redundant and
    // harmful: AGP finalizes a project's DSL as it evaluates, and registering `finalizeDsl` on an
    // already-evaluated project fails with "It is too late to call `finalizeDsl`". Only a build
    // with more than one app sweeps twice.
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
       * A project whose DSL AGP has already finalized cannot be given a `finalizeDsl` callback (AGP
       * 9 fails the build), and evaluation is what finalizes it; an autolinked library that applies
       * this plugin the old way, as react-native-screens does, is evaluated before the app that
       * sweeps
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
