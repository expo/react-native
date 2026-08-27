/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import '@react-native/expo-intrinsics-poc';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import ensureInstance from 'react-native/src/private/__tests__/utilities/ensureInstance';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

/*
 * A row holding an `<input type="radio">` must survive view flattening.
 *
 * On iOS a run of radios is presented as the platform's grouped list, and what
 * the list hosts in each cell is the ROW — the element the author wrote around
 * the control, with its label and whatever else it holds. Fabric flattens a
 * view that draws nothing, and a row usually draws nothing, so without this
 * rule the row an author wrote is not in the view tree by the time anything
 * looks for it. Observed as a section the size of the whole screen, because the
 * walk landed on the container above.
 *
 * The alternative was `collapsable={false}` on every row, which is a renderer's
 * implementation detail appearing in markup for a reason nothing about the
 * markup explains. `<input type="radio">` is all anyone should have to write,
 * so these tests are written the way an author writes: no `collapsable`
 * anywhere below the outer fixture.
 *
 * Mount-level assertions, not rendered output: flattening is a MOUNT-side
 * decision, and a flattened View simply never appears in a Create log. Counting
 * creates is also the only way to see it — `nativeID` cannot be used as a
 * marker here, because carrying one defeats flattening by itself and every
 * tagged View would pass.
 */

function viewCreateCount(logs: Array<string>): number {
  return logs.filter(l => l.startsWith('Create {type: "View"')).length;
}

test('a row holding a radio is mounted', () => {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} nativeID="container">
        {/* No `collapsable`: the radio inside must be what mounts this row. */}
        <View>
          {/* $FlowExpectedError[not-a-component] intrinsic tags */}
          <input type="radio" name="plan" value="free" />
        </View>
      </View>,
    );
  });

  // The fixture plus the row: two Views, where without the rule there is one.
  expect(viewCreateCount(root.takeMountingManagerLogs())).toBe(2);
});

test('a row holding no radio is still flattened', () => {
  /*
   * The control, and the reason the test above means anything. If every View
   * mounted, the assertion there would pass without the rule existing — so
   * this pins that the rule is about radios and has not quietly become "never
   * flatten".
   *
   * Plain Views inside, deliberately. A first attempt used a `<span>` for the
   * label and counted two — an element that draws text mounts a View of its
   * own, so the control was measuring the label rather than the row.
   */
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} nativeID="container">
        <View>
          <View />
        </View>
      </View>,
    );
  });

  expect(viewCreateCount(root.takeMountingManagerLogs())).toBe(1);
});

test('each row of a group is mounted, so the rows are siblings', () => {
  /*
   * What the run actually needs. One mounted row is not enough: adjacency is
   * read from the view tree, so two rows that are not siblings are two runs of
   * one — which is what a wrapper around each row produced, a group that could
   * never be more than a single row long.
   */
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} nativeID="container">
        {['free', 'pro', 'team'].map(value => (
          <View key={value}>
            {/* $FlowExpectedError[not-a-component] */}
            <input type="radio" name="plan" value={value} />
          </View>
        ))}
      </View>,
    );
  });

  expect(viewCreateCount(root.takeMountingManagerLogs())).toBe(4);
});

test('a row that gains a radio in an update is mounted too', () => {
  /*
   * The other construction path. A node built with its children already in the
   * fragment answers the question in its constructor; a node that is appended
   * to answers it when the child arrives. An implementation with only the
   * first half mounts nothing on first render, and one with only the second
   * half loses the row the moment anything re-renders — both were seen.
   */
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} nativeID="container">
        <View />
      </View>,
    );
  });
  root.takeMountingManagerLogs();

  Fantom.runTask(() => {
    root.render(
      <View collapsable={false} nativeID="container">
        <View>
          {/* $FlowExpectedError[not-a-component] */}
          <input type="radio" name="plan" value="free" />
        </View>
      </View>,
    );
  });

  expect(viewCreateCount(root.takeMountingManagerLogs())).toBe(1);
});

/*
 * The row's user-agent PADDING, which is the same rule seen from the layout
 * side.
 *
 * A run of radios is drawn as the platform's grouped list, and a list row
 * insets its content: the leading inset lines every row's text up with every
 * other row's and with the separator, and the trailing one is the space the
 * checkmark accessory occupies. Without them the author's content sits flush
 * against the card's edges and runs underneath the mark — reported from the
 * device as exactly that, not enough spacing on the left and the right.
 *
 * It has to be the ROW's padding rather than anything the element itself can
 * express, because the box the platform insets is whatever the author wrapped
 * around the control, and no selector reaches a parent. It cannot come from the
 * mounting layer either: a row's children are positioned by Yoga and cannot be
 * re-flowed afterwards, so a row squeezed to fit a cell's content area loses
 * whatever sat at its trailing edge instead of moving it.
 */
describe("a row holding a radio takes the platform's row padding", () => {
  // `markup` is a FUNCTION of the two refs, not a rendered node: each case has
  // to put them on its own elements, and a node would have had to be built
  // before there were refs to build it with. Typed as one, so that the arrows
  // below get their parameter types from here rather than needing annotations
  // at every call site.
  type Markup = (
    row: {current: HostInstance | null},
    child: {current: HostInstance | null},
  ) => React.MixedElement;

  function childOffsets(markup: Markup): {start: number, end: number} {
    const row = createRef<HostInstance | null>();
    const child = createRef<HostInstance | null>();
    const root = Fantom.createRoot({viewportWidth: 300});
    Fantom.runTask(() => {
      root.render(markup(row, child));
    });
    const rowBox = ensureInstance(row.current, ReactNativeElement).getBoundingClientRect();
    const childBox = ensureInstance(child.current, ReactNativeElement).getBoundingClientRect();
    return {
      start: childBox.x - rowBox.x,
      end: rowBox.x + rowBox.width - (childBox.x + childBox.width),
    };
  }

  /*
   * These are IOS's numbers, in a host that reports itself as Android.
   *
   * Fantom emulates the Android layout dialect but builds the renderer's
   * default C++ host, which is the one iOS uses — so the row padding it sees is
   * iOS's 16/48. Android's real answer is no padding at all: it has a real
   * `RadioButton`, presents no list, and takes neither the padding nor the
   * forced view. Nothing here covers that; it is checked on the emulator.
   */
  test('its content is inset on both sides', () => {
    const offsets = childOffsets((row, child) => (
      <View ref={row}>
        {/* $FlowExpectedError[not-a-component] intrinsic tags */}
        <input type="radio" name="plan" value="free" />
        <View ref={child} style={{flexGrow: 1, height: 20}} />
      </View>
    ));
    // The leading inset is where a list row's text begins; the trailing one is
    // the accessory's. Both are the platform's own numbers.
    expect(offsets.start).toBe(16);
    expect(offsets.end).toBe(48);
  });

  test('a row with no radio is not padded', () => {
    // The control, and the reason the assertion above means anything: if every
    // row were padded, it would pass without the rule existing.
    const offsets = childOffsets((row, child) => (
      <View ref={row}>
        <View ref={child} style={{flexGrow: 1, height: 20}} />
      </View>
    ));
    expect(offsets.start).toBe(0);
    expect(offsets.end).toBe(0);
  });

  test("an author's own horizontal padding wins", () => {
    // A user-agent default gives way to an author's, as it does on the web.
    const offsets = childOffsets((row, child) => (
      <View ref={row} style={{paddingHorizontal: 4}}>
        {/* $FlowExpectedError[not-a-component] */}
        <input type="radio" name="plan" value="free" />
        <View ref={child} style={{flexGrow: 1, height: 20}} />
      </View>
    ));
    expect(offsets.start).toBe(4);
    expect(offsets.end).toBe(4);
  });
});
