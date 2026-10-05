/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "ElementControlMetricsBinding.h"

#include <react/renderer/components/view/ElementControlMetrics.h>

namespace facebook::react {

void ElementControlMetricsBinding::registerNatives() {
  javaClassStatic()->registerNatives({
      makeNativeMethod("nativePublish", ElementControlMetricsBinding::publish),
  });
}

void ElementControlMetricsBinding::publish(
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
    jfloat dateTimePickerBaseline) {
  /*
   * Starting from what is published rather than from the defaults, so a field
   * this probe does not measure keeps whatever it already had, and published as
   * one struct so no reader sees half an answer. A control the probe could not
   * build arrives as zero and keeps its default.
   */
  auto metrics = elementControlMetrics();
  const auto take = [](Float& field, jfloat measured) {
    if (measured > 0) {
      field = measured;
    }
  };
  if (textAreaLineBox > 0) {
    metrics.textAreaInsetBlock = textAreaInsetBlock;
    metrics.textAreaLineBox = textAreaLineBox;
    metrics.textAreaPaddingTop = textAreaPaddingTop;
    metrics.textAreaPaddingBottom = textAreaPaddingBottom;
  }
  take(metrics.textFieldDefaultWidth, textFieldWidth);
  take(metrics.textFieldDefaultHeight, textFieldHeight);
  take(metrics.selectLabelFontSize, selectLabelFontSize);
  take(metrics.selectBlockSize, selectBlockSize);
  take(metrics.fileDefaultWidth, fileDefaultWidth);
  take(metrics.fileDefaultHeight, fileDefaultHeight);
  take(metrics.datePickerDefaultWidth, datePickerDefaultWidth);
  take(metrics.datePickerDefaultHeight, datePickerDefaultHeight);
  take(metrics.timePickerDefaultWidth, timePickerDefaultWidth);
  take(metrics.timePickerDefaultHeight, timePickerDefaultHeight);
  take(metrics.dateTimePickerDefaultWidth, dateTimePickerDefaultWidth);
  take(metrics.dateTimePickerDefaultHeight, dateTimePickerDefaultHeight);
  take(metrics.selectBaseline, selectBaseline);
  take(metrics.textFieldBaseline, textFieldBaseline);
  take(metrics.datePickerBaseline, datePickerBaseline);
  take(metrics.timePickerBaseline, timePickerBaseline);
  take(metrics.dateTimePickerBaseline, dateTimePickerBaseline);
  setElementControlMetrics(metrics);
}

} // namespace facebook::react
