/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.tasks

import com.facebook.react.tests.createTestTask
import org.assertj.core.api.Assertions.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class GenerateEntryPointTaskTest {

  @get:Rule val tempFolder = TemporaryFolder()

  @Test
  fun generatePackageListTask_groupIsSetCorrectly() {
    val task = createTestTask<GenerateEntryPointTask> {}
    assertThat(task.group).isEqualTo("react")
  }

  @Test
  fun generatePackageListTask_staticInputs_areSetCorrectly() {
    val outputFolder = tempFolder.newFolder("build")
    val inputFile = tempFolder.newFile("config.json")

    val task =
        createTestTask<GenerateEntryPointTask> { task ->
          task.generatedOutputDirectory.set(outputFolder)
          task.autolinkInputFile.set(inputFile)
        }

    assertThat(task.inputs.files.singleFile).isEqualTo(inputFile)
    assertThat(task.outputs.files.singleFile).isEqualTo(outputFolder)
  }

  @Test
  fun composeFileContent_withNoPackages_returnsValidFile() {
    val task = createTestTask<GenerateEntryPointTask>()
    val packageName = "com.facebook.react"
    val result = task.composeFileContent(packageName)
    // language=java
    assertThat(result)
        .isEqualTo(
            """
            package com.facebook.react;

            import android.app.Application;
            import android.content.Context;
            import android.content.res.Resources;

            import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;
            import com.facebook.react.common.annotations.internal.LegacyArchitectureLogger;
            import com.facebook.react.views.view.WindowUtilKt;
            import com.facebook.react.soloader.OpenSourceMergedSoMapping;
            import com.facebook.soloader.SoLoader;

            import java.io.IOException;

            /**
              * This class is the entry point for loading React Native using the configuration
              * that the users specifies in their .gradle files.
              *
              * The `loadReactNative(this)` method invocation should be called inside the
              * application onCreate otherwise the app won't load correctly.            
              */
            public class ReactNativeApplicationEntryPoint {
              public static void loadReactNative(Context context) {
                try {
                   SoLoader.init(context, OpenSourceMergedSoMapping.INSTANCE);
                } catch (IOException error) {
                  throw new RuntimeException(error);
                }
                
                if (com.facebook.react.BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
                  DefaultNewArchitectureEntryPoint.load();
                }
                
                if (com.facebook.react.BuildConfig.IS_EDGE_TO_EDGE_ENABLED) {
                  WindowUtilKt.setEdgeToEdgeFeatureFlagOn();
                }
              }
            }
            """
                .trimIndent()
        )
  }

  @Test
  fun taskAction_prefersTheApplicationNamespaceOverTheAutolinkingConfig() {
    val outputFolder = tempFolder.newFolder("build")
    val inputFile =
        tempFolder.newFile("config.json").apply {
          // The autolinking config describes ONE app — whichever one `react-native config` was run
          // for. A build holding two apps generates an entry point for each from this same file.
          writeText("""{"project":{"android":{"packageName":"com.first.app"}}}""")
        }

    val task =
        createTestTask<GenerateEntryPointTask> { task ->
          task.generatedOutputDirectory.set(outputFolder)
          task.autolinkInputFile.set(inputFile)
          task.applicationNamespace.set("com.second.app")
        }
    task.taskAction()

    // AGP emits BuildConfig into the app's own namespace, so the second app has to read its own.
    // Given the first app's package it would fail to compile against a class not on its classpath.
    val generated =
        java.io.File(outputFolder, GenerateEntryPointTask.GENERATED_FILENAME).readText()
    assertThat(generated).contains("com.second.app.BuildConfig.IS_NEW_ARCHITECTURE_ENABLED")
    assertThat(generated).contains("com.second.app.BuildConfig.IS_EDGE_TO_EDGE_ENABLED")
    assertThat(generated).doesNotContain("com.first.app")
  }

  @Test
  fun taskAction_withoutANamespace_fallsBackToTheAutolinkingConfig() {
    val outputFolder = tempFolder.newFolder("build")
    val inputFile =
        tempFolder.newFile("config.json").apply {
          writeText("""{"project":{"android":{"packageName":"com.only.app"}}}""")
        }

    val task =
        createTestTask<GenerateEntryPointTask> { task ->
          task.generatedOutputDirectory.set(outputFolder)
          task.autolinkInputFile.set(inputFile)
        }
    task.taskAction()

    // Nothing changes for a build that never sets the namespace.
    val generated =
        java.io.File(outputFolder, GenerateEntryPointTask.GENERATED_FILENAME).readText()
    assertThat(generated).contains("com.only.app.BuildConfig.IS_NEW_ARCHITECTURE_ENABLED")
  }
}
