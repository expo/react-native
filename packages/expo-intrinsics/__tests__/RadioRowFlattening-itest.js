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

/**
 * A row holding an `<input type="radio">` must survive view flattening. On iOS
 * a run of radios is presented as the platform's grouped list behind the rows
 * the author wrote, and Fabric flattens a view that draws nothing, so without
 * this rule the row is gone before anything looks for it. Written the way an
 * author writes, with no `collapsable` below the outer fixture. Mount-level
 * assertions, because flattening is a mount-side decision and a `nativeID`
 * marker would defeat flattening by itself.
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
   * The control: if every View mounted, the test above would pass without the
   * rule. Plain Views inside, since an element that draws text mounts a View of
   * its own.
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
   * Adjacency is read from the view tree, so two rows that are not siblings are
   * two runs of one.
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
   * The other construction path: a node built with its children in the fragment
   * answers in its constructor, a node appended to answers when the child
   * arrives, and the rule has to hold on both.
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

/**
 * The row's user-agent padding: a grouped list row insets its content, the
 * leading inset lining up every row's text and the trailing one holding the
 * checkmark accessory. It has to be the row's padding, since the box the
 * platform insets is whatever the author wrapped around the control and no
 * selector reaches a parent, and it cannot come from the mounting layer, since
 * Yoga has already positioned the row's children.
 */
describe("a row holding a radio takes the platform's row padding", () => {
  // `markup` is a function of the two refs so each case puts them on its own
  // elements; typed so the arrows below need no annotations
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
   * These are iOS's numbers in a host that reports itself as Android: Fantom
   * emulates the Android layout dialect on the renderer's default C++ host,
   * which iOS uses. Android's real answer is no padding, since it has a
   * `RadioButton` and presents no list; that is checked on the emulator.
   */
  test('its content is inset on both sides', () => {
    const offsets = childOffsets((row, child) => (
      <View ref={row}>
        {/* $FlowExpectedError[not-a-component] intrinsic tags */}
        <input type="radio" name="plan" value="free" />
        <View ref={child} style={{flexGrow: 1, height: 20}} />
      </View>
    ));
    // The platform's own insets: where a list row's text begins, and the
    // accessory's width
    expect(offsets.start).toBe(16);
    expect(offsets.end).toBe(48);
  });

  test('a row with no radio is not padded', () => {
    // The control: if every row were padded, the assertion above would pass
    // without the rule
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
