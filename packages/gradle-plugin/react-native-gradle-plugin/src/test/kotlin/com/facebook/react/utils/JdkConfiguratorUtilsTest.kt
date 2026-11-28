/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.utils

import com.android.build.api.dsl.CommonExtension
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

  @Test
  fun configureJavaToolChains_withALibraryEvaluatedBeforeTheApp_alignsTheApp() {
    val root = ProjectBuilder.builder().withProjectDir(tempFolder.newFolder("root")).build()
    val library = androidProject(root, "library", "com.android.library")
    val app = androidProject(root, "app", "com.android.application")
    evaluate(library)

    JdkConfiguratorUtils.configureJavaToolChains(app)
    evaluate(app)

    assertThat(javaVersions(app)).containsOnly(JavaVersion.VERSION_17)
  }

  @Test
  fun configureJavaToolChains_withTwoApps_alignsBoth() {
    val root = ProjectBuilder.builder().withProjectDir(tempFolder.newFolder("root")).build()
    val firstApp = androidProject(root, "first", "com.android.application")
    val secondApp = androidProject(root, "second", "com.android.application")

    JdkConfiguratorUtils.configureJavaToolChains(firstApp)
    evaluate(firstApp)
    JdkConfiguratorUtils.configureJavaToolChains(secondApp)
    evaluate(secondApp)

    assertThat(javaVersions(firstApp)).containsOnly(JavaVersion.VERSION_17)
    assertThat(javaVersions(secondApp)).containsOnly(JavaVersion.VERSION_17)
  }

  private fun androidProject(root: Project, name: String, plugin: String): Project {
    val project =
        ProjectBuilder.builder()
            .withName(name)
            .withParent(root)
            .withProjectDir(tempFolder.newFolder(name))
            .build()
    project.plugins.apply(plugin)
    project.extensions.getByType(CommonExtension::class.java).apply {
      compileSdk = 35
      namespace = "com.facebook.react.test.$name"
    }
    return project
  }

  // AGP finalizes a project's DSL when the project is evaluated.
  private fun evaluate(project: Project) {
    (project as ProjectInternal).evaluate()
  }

  private fun javaVersions(project: Project): List<JavaVersion> =
      project.extensions.getByType(CommonExtension::class.java).compileOptions.let {
        listOf(it.sourceCompatibility, it.targetCompatibility)
      }
}
