/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <fbjni/fbjni.h>

namespace facebook::react {

/*
 * Android's door into `ElementControlMetrics`: the Kotlin probe measures the
 * real controls, on the app's theme, and hands the answers across here.
 *
 * The iOS probe publishes from Objective-C++ directly; Android needs this one
 * hop because the controls it measures are Java objects. What crosses is plain
 * numbers, in density-independent points — the unit layout works in.
 */
class ElementControlMetricsBinding : public jni::JavaClass<ElementControlMetricsBinding> {
 public:
  static constexpr auto kJavaDescriptor = "Lcom/facebook/react/views/view/ElementControlMetricsProbe;";

  static void registerNatives();

 private:
  static void publish(
      jni::alias_ref<jclass> /*unused*/,
      jfloat textAreaInsetBlock,
      jfloat textAreaLineBox,
      jfloat textAreaPaddingTop,
      jfloat textAreaPaddingBottom,
      jfloat textFieldWidth,
      jfloat textFieldHeight,
      jfloat selectLabelFontSize,
      jfloat selectBlockSize,
      jfloat fileDefaultWidth,
      jfloat fileDefaultHeight,
      jfloat datePickerDefaultWidth,
      jfloat datePickerDefaultHeight,
      jfloat timePickerDefaultWidth,
      jfloat timePickerDefaultHeight,
      jfloat dateTimePickerDefaultWidth,
      jfloat dateTimePickerDefaultHeight,
      jfloat selectBaseline,
      jfloat textFieldBaseline,
      jfloat datePickerBaseline,
      jfloat timePickerBaseline,
      jfloat dateTimePickerBaseline);
};

} // namespace facebook::react
