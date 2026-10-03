/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:*
 * @fantom_native_opt false
 * @fantom_js_bytecode false
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {Text, View} from 'react-native';
import {NativeText} from 'react-native/Libraries/Text/TextNativeComponent';
import * as ReactNativeFeatureFlags from 'react-native/src/private/featureflags/ReactNativeFeatureFlags';

/*
 * Apples-to-apples with the ecosystem's Text-replacement libraries.
 *
 * react-native-fast-text and react-native-boost exist to strip <Text>'s
 * JavaScript wrapper and render through NativeText/RCTText directly; the
 * community measurement they cite is "15k lines of text" (4.33s -> 2.52s,
 * ~40% faster), and boost claims "up to 50% faster rendering". This suite
 * reproduces that workload shape — N independent lines — across three tiers:
 *
 *   <Text>       the classic component (their baseline)
 *   NativeText   the stripped wrapper (what those libraries ship)
 *   bare string  string children (JS wrapper AND per-line Paragraph removed)
 *
 * Lines are unstyled, matching the ecosystem benchmarks. The styled version
 * of the comparison lives in StringChildrenOverhead-benchmark-itest.
 *
 * Fairness rule: every tier renders each line as ONE string. Splitting a line
 * into several children costs a text node apiece, so a tier written as
 * {'Line '}{i}{' of text'} would be measured against two extra nodes per line
 * that the other tiers never pay for.
 *
 * READ THE FLOOR TIER BEFORE COMPARING. The two component tiers ARE the line;
 * a bare string is not a component, so it needs an element to live in, and the
 * bare tier's number therefore includes one View per line that the others
 * never pay for. That container is most of the difference: subtract the floor
 * and the ordering reverses. This suite keeps the ecosystem's shape (N sibling
 * components, no rows) on purpose; for the comparison with containers held
 * equal on every tier, see StringChildrenCosting-benchmark-itest.
 */

const stringChildrenEnabled = ReactNativeFeatureFlags.enableStringChildren();

function textLines(count: number): Array<React.Node> {
  const lines: Array<React.Node> = [];
  for (let i = 0; i < count; i++) {
    lines.push(
      <Text key={String(i)}>{`Line ${i} of benchmark text content`}</Text>,
    );
  }
  return lines;
}

function nativeTextLines(count: number): Array<React.Node> {
  const lines: Array<React.Node> = [];
  for (let i = 0; i < count; i++) {
    lines.push(
      <NativeText key={String(i)}>
        {`Line ${i} of benchmark text content`}
      </NativeText>,
    );
  }
  return lines;
}

function bareStringLines(count: number): Array<React.Node> {
  const lines: Array<React.Node> = [];
  for (let i = 0; i < count; i++) {
    lines.push(
      // $FlowFixMe[incompatible-type] bare string child under View
      <View key={String(i)}>{`Line ${i} of benchmark text content`}</View>,
    );
  }
  return lines;
}

/** The container the bare-string tier needs and the others do not. */
function emptyLines(count: number): Array<React.Node> {
  const lines: Array<React.Node> = [];
  for (let i = 0; i < count; i++) {
    lines.push(<View key={String(i)} />);
  }
  return lines;
}

const LINE_COUNTS = [1000, 5000, 15000];

let root: Fantom.Root;

const suite = Fantom.unstable_benchmark.suite('Text alternatives', {
  minIterations: 10,
  disableOptimizedBuildCheck: true,
});

for (const count of LINE_COUNTS) {
  const label = `${count / 1000}k`;
  suite
    .test(
      `${label} lines: empty Views (the bare tier's container floor)`,
      () => {
        Fantom.runTask(() => root.render(<View>{emptyLines(count)}</View>));
      },
      {
        beforeEach: () => {
          root = Fantom.createRoot();
        },
        afterEach: () => {
          root.destroy();
        },
      },
    )
    .test(
      `${label} lines: <Text>`,
      () => {
        Fantom.runTask(() => root.render(<View>{textLines(count)}</View>));
      },
      {
        beforeEach: () => {
          root = Fantom.createRoot();
        },
        afterEach: () => {
          root.destroy();
        },
      },
    )
    .test(
      `${label} lines: NativeText (the fast-text/boost approach)`,
      () => {
        Fantom.runTask(() =>
          root.render(<View>{nativeTextLines(count)}</View>),
        );
      },
      {
        beforeEach: () => {
          root = Fantom.createRoot();
        },
        afterEach: () => {
          root.destroy();
        },
      },
    )
    .test(
      `${label} lines: feature syntax (bare strings ON / <Text> OFF)`,
      () => {
        Fantom.runTask(() =>
          root.render(
            <View>
              {stringChildrenEnabled
                ? bareStringLines(count)
                : textLines(count)}
            </View>,
          ),
        );
      },
      {
        beforeEach: () => {
          root = Fantom.createRoot();
        },
        afterEach: () => {
          root.destroy();
        },
      },
    );
}
