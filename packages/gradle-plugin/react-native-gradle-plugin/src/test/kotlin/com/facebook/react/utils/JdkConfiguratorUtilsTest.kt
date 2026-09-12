/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.utils

import com.android.build.api.dsl.ApplicationExtension
import org.assertj.core.api.Assertions.assertThat
import org.gradle.api.JavaVersion
import org.gradle.api.Project
import org.gradle.api.internal.project.ProjectInternal
import org.gradle.testfixtures.ProjectBuilder
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class JdkConfiguratorUtilsTest {

  @get:Rule val tempFolder = TemporaryFolder()

  private fun appProject(name: String, parent: Project): Project {
    val project =
        ProjectBuilder.builder()
            .withName(name)
            .withParent(parent)
            .withProjectDir(tempFolder.newFolder(name))
            .build()
    project.plugins.apply("com.android.application")
    // The minimum AGP needs to evaluate a project; evaluation finalizes the DSL, which is the
    // thing under test
    val android = project.extensions.getByType(ApplicationExtension::class.java)
    android.compileSdk = 35
    android.namespace = "com.facebook.react.test.${name.replace("-", "")}"
    return project
  }

  @Test
  fun configureJavaToolChains_alignsTheAppToJava17() {
    val root = ProjectBuilder.builder().withProjectDir(tempFolder.newFolder("root")).build()
    val app = appProject("app", root)

    JdkConfiguratorUtils.configureJavaToolChains(app)
    (app as ProjectInternal).evaluate()

    // The sweep's job, asserted so the test below cannot pass with `configureJavaToolChains`
    // emptied out
    val compileOptions = app.extensions.getByType(ApplicationExtension::class.java).compileOptions
    assertThat(compileOptions.sourceCompatibility).isEqualTo(JavaVersion.VERSION_17)
    assertThat(compileOptions.targetCompatibility).isEqualTo(JavaVersion.VERSION_17)
  }

  @Test
  fun configureJavaToolChains_withASecondAppInTheBuild_stillAlignsBothApps() {
    val root = ProjectBuilder.builder().withProjectDir(tempFolder.newFolder("root")).build()
    val firstApp = appProject("first-app", root)
    val secondApp = appProject("second-app", root)

    // Two application projects in one build, each applying the React plugin. The first app has
    // been evaluated, and its DSL finalized, by the time the second asks for the sweep, so a
    // second sweep would register `finalizeDsl` on it and fail the build.
    JdkConfiguratorUtils.configureJavaToolChains(firstApp)
    (firstApp as ProjectInternal).evaluate()
    JdkConfiguratorUtils.configureJavaToolChains(secondApp)
    (secondApp as ProjectInternal).evaluate()

    // Both apps are still aligned: the first sweep reached `secondApp` too
    for (app in listOf(firstApp, secondApp)) {
      val compileOptions = app.extensions.getByType(ApplicationExtension::class.java).compileOptions
      assertThat(compileOptions.sourceCompatibility).isEqualTo(JavaVersion.VERSION_17)
      assertThat(compileOptions.targetCompatibility).isEqualTo(JavaVersion.VERSION_17)
    }
  }
}
