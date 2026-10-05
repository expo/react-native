/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_native_opt false
 * @fantom_js_bytecode false
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {View} from 'react-native';

/*
 * What an ABSENT prop costs.
 *
 * `BaseViewProps` declares around eighty-five keys and the parser reads each
 * one whether or not it is present, so a screen that sets six still pays for
 * the other seventy-nine. Whether that is worth a mechanism to skip turns on
 * the cost of a prop nobody set — and `ViewProps-benchmark-itest.js` cannot
 * answer it, because every view there sets every prop.
 *
 * It is a separate file rather than another case in that one for two reasons.
 * A file named `*Benchmark-itest.` is marked native-optimized automatically,
 * which the OSS runner skips outright ("Optimized mode is not yet supported in
 * OSS"), so a number needs `@fantom_native_opt false` — and putting that on the
 * shared file would silently unoptimize Meta's benchmarks too, which is the
 * one thing a benchmark must not do.
 *
 * So the numbers here are DEV-BUILD numbers. That makes this the wrong
 * instrument for "how fast is this" and a sound one for "is this worth doing":
 * a dev build exaggerates per-call cost, so a saving that is already small
 * here is smaller still in a build anyone ships.
 */
function buildViews(count: number): React.MixedElement {
  const children = [];
  for (let i = 0; i < count; i++) {
    children.push(
      <View
        key={i}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 8,
          backgroundColor: i % 2 === 0 ? 'white' : '#f2f2f7',
          borderRadius: 8,
        }}
      />,
    );
  }
  return <View style={{flex: 1}}>{children}</View>;
}

let root = Fantom.createRoot();
let tree: React.MixedElement = buildViews(1);

Fantom.unstable_benchmark
  .suite('Absent props', {
    minIterations: 50,
    disableOptimizedBuildCheck: true,
  })
  .test(
    'mount 1000 views setting six of the eighty-five props',
    () => {
      Fantom.runTask(() => root.render(tree));
    },
    {
      beforeAll: () => {
        tree = buildViews(1000);
      },
      beforeEach: () => {
        root = Fantom.createRoot();
      },
      afterEach: () => {
        root.destroy();
      },
    },
  );
