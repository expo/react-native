/**
 * @flow
 * @format
 */
import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

import type {HostInstance} from 'react-native';

import ensureInstance from '../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {Text, View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

/*
 * `white-space: nowrap` across every pass that lays the same text out.
 *
 * Three passes ask the line breaker the same question — the run's measure, the
 * placement of the atomic inlines inside it, and a paragraph's own measure —
 * and they have to get the same answer. They did not: only the run's measure
 * widened its constraints, so a container came out one line tall with its
 * elements on three.
 *
 * Every case reads the CHILDREN's positions, and the one that reads a height
 * reads it beside them. Measuring the container alone is what made the
 * disagreement look like a working feature.
 */
const TEXT = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj';

function spans(
  count: number,
  width: number,
  refs: Array<React$RefObject<HostInstance | null>>,
) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(
      // $FlowExpectedError[not-a-component] intrinsic <span> tag
      <span
        key={String(i)}
        ref={refs[i]}
        style={{
          display: 'inline-block',
          width,
          height: 20,
          verticalAlign: 'top',
        }}
      />,
    );
  }
  return out;
}

function refsFor(count: number): Array<React$RefObject<HostInstance | null>> {
  const refs = [];
  for (let i = 0; i < count; i++) {
    refs.push(createRef<HostInstance>());
  }
  return refs;
}

function topsOf(
  refs: Array<React$RefObject<HostInstance | null>>,
): Array<number> {
  return refs.map(
    r =>
      ensureInstance(r.current, ReactNativeElement).getBoundingClientRect().y,
  );
}

function distinctRows(tops: Array<number>): number {
  return new Set(tops).size;
}

describe('white-space: nowrap', () => {
  it('stops the atomic inlines in a run wrapping', () => {
    const refs = refsFor(4);
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View
          collapsable={false}
          style={{display: 'block', width: 300, whiteSpace: 'nowrap'}}>
          {spans(4, 100, refs)}
        </View>,
      );
    });
    const tops = topsOf(refs);
    root.destroy();

    // Safari keeps all four on one line and lets the fourth overflow to
    // x=300.
    expect(distinctRows(tops)).toBe(1);
  });

  it('keeps the container and its children on the same number of lines', () => {
    const containerRef = createRef<HostInstance>();
    const refs = refsFor(6);
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View
          ref={containerRef}
          collapsable={false}
          style={{display: 'block', width: 80, whiteSpace: 'nowrap'}}>
          {spans(6, 30, refs)}
        </View>,
      );
    });
    const tops = topsOf(refs);
    const containerHeight = ensureInstance(
      containerRef.current,
      ReactNativeElement,
    ).getBoundingClientRect().height;
    root.destroy();

    // The pair that used to contradict each other: one row of children, and a
    // container tall enough to hold it. `toBeGreaterThan` on the last row is
    // the half that failed before — the container measured one line while the
    // children ran past it.
    expect(distinctRows(tops)).toBe(1);
    expect(containerHeight).toBeGreaterThan(Math.max(...tops));
  });

  it('is honoured by <Text>', () => {
    const ref = createRef<HostInstance>();
    const plainRef = createRef<HostInstance>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View collapsable={false} style={{display: 'block', width: 80}}>
          <Text ref={ref} style={{whiteSpace: 'nowrap'}}>
            {TEXT}
          </Text>
          <Text ref={plainRef}>{TEXT}</Text>
        </View>,
      );
    });
    const nowrap = ensureInstance(
      ref.current,
      ReactNativeElement,
    ).getBoundingClientRect().height;
    const plain = ensureInstance(
      plainRef.current,
      ReactNativeElement,
    ).getBoundingClientRect().height;
    root.destroy();

    // `<Text>` reads the property by its own route (`BaseParagraphProps`) and
    // now acts on it, so it is one line where the untouched control beside it
    // wrapped to several.
    expect(plain).toBeGreaterThan(30); // the control did wrap
    expect(nowrap).toBeLessThan(plain / 2);
  });
});
