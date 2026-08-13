/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {ScrollView, Text, View} from 'react-native';

/*
 * Sanity guards for the StringChildrenCosting and DeviceTextBenchmark tiers:
 * every benchmark shape must render its FULL claimed content, asserted by
 * line count (deterministic measurer: 20pt per line). A benchmark whose
 * content silently fails — a dropped whiteSpace key collapsing 1,000 lines
 * into one, a catalog element failing to register, a string swallowed by
 * collapsing — would run FASTER and mislead every comparison built on it.
 * These tests turn that failure mode into a red suite instead of a wrong
 * number. Shapes mirror the benchmark generators; keep them in sync.
 */

const LINE = 20;

function measuredHeight(children: React.Node): number {
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View ref={ref} collapsable={false}>
        {children}
      </View>,
    );
  });
  return ensureInstance(ref.current, ReactNativeElement).getBoundingClientRect()
    .height;
}

function body(lines: number): string {
  const out: Array<string> = [];
  for (let i = 0; i < lines; i++) {
    out.push(`Line ${i} of benchmark text content`);
  }
  return out.join('\n');
}

test('a settings-row bare string renders exactly one line of real text', () => {
  // $FlowFixMe[incompatible-type] bare string child under View
  expect(
    measuredHeight(<View>{'Line 0 of benchmark text content'}</View>),
  ).toBe(LINE);
});

test('a message body under pre-line renders ALL ten lines', () => {
  // The fast-but-wrong vector this suite exists for: if `whiteSpace:
  // 'pre-line'` were silently dropped, ten lines would collapse into one
  // wrapped blob and the tier would get cheaper while measuring nothing.
  const h = measuredHeight(
    // $FlowFixMe[incompatible-type] whiteSpace is a new style key
    <View style={{whiteSpace: 'pre-line'}}>{body(10)}</View>,
  );
  expect(h).toBe(10 * LINE);
});

test('the two message-list tiers render IDENTICAL content: Text body height equals bare body height', () => {
  // Fairness of the head-to-head: both tiers must do the same layout work.
  const textBody = measuredHeight(<Text>{body(10)}</Text>);
  const bareBody = measuredHeight(
    // $FlowFixMe[incompatible-type] whiteSpace is a new style key
    <View style={{whiteSpace: 'pre-line'}}>{body(10)}</View>,
  );
  expect(textBody).toBe(10 * LINE);
  expect(bareBody).toBe(textBody);
});

test('the two article tiers render IDENTICAL content: 1,000 lines each', () => {
  // Measure the article NODES directly, not a wrapper: the root viewport is
  // 844pt tall and a wrapper's reported box clamps to it, which reads as
  // "844" even when the content laid out all 20,000pt. The content nodes
  // themselves must report the full extent — proving the benchmark tiers do
  // the whole 1,000-line layout rather than a viewport's worth.
  // Inside a ScrollView — where real articles live — the main axis is
  // unbounded, so a clamped measure cannot masquerade as full layout. This
  // is also what makes the benchmark tiers honest: outside a scroll
  // container, platform text engines clamp LAYOUT WORK at the viewport
  // constraint, and a 1,000-line tier would silently measure ~42 lines.
  const textRef = createRef<HostInstance>();
  const bareRef = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <ScrollView>
        <Text ref={textRef}>{body(1000)}</Text>
        {/* $FlowFixMe[incompatible-type] whiteSpace is a new style key */}
        <View ref={bareRef} style={{whiteSpace: 'pre-line'}}>
          {body(1000)}
        </View>
      </ScrollView>,
    );
  });
  const textArticle = ensureInstance(
    textRef.current,
    ReactNativeElement,
  ).getBoundingClientRect().height;
  const bareArticle = ensureInstance(
    bareRef.current,
    ReactNativeElement,
  ).getBoundingClientRect().height;
  expect(textArticle).toBe(1000 * LINE);
  expect(bareArticle).toBe(textArticle);
});

test('rendered output carries the actual text, not empty runs', () => {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false}>
        {/* $FlowFixMe[incompatible-type] whiteSpace is a new style key */}
        <View style={{whiteSpace: 'pre-line'}}>{body(3)}</View>
      </View>,
    );
  });
  const out = JSON.stringify(root.getRenderedOutput({props: []}).toJSX()) ?? '';
  expect(out).toContain('Line 0 of benchmark text content');
  expect(out).toContain('Line 2 of benchmark text content');
});
