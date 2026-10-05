/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true
 * @fantom_flags enableYogaDisplayBlock:true
 * @flow strict-local
 * @format
 */

/**
 * An `inside` marker is part of its item's first line (css-lists-3 §3.3), so
 * a list whose markers change lays its items out again. A marker changes with
 * the list's style and with the items before it, while the item itself, its
 * props and children unchanged, is still the one the committed revision holds:
 * the list gives the new marker to a clone of it, and dirties what measures
 * the marker so the item is not served from Yoga's cache.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

type ListStyle = {
  listStylePosition: 'inside' | 'outside',
  listStyleType: 'decimal' | 'upper-roman',
};

function List({
  listStyle,
  probe,
}: {
  listStyle: ListStyle,
  probe: {current: HostInstance | null},
}): React.Node {
  return (
    // $FlowFixMe[prop-missing] intrinsic
    <div style={{width: 360}}>
      {/* $FlowFixMe[prop-missing] intrinsic */}
      <ol style={listStyle}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <li>One</li>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <li>Two</li>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <li>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <span ref={probe}>Three</span>
        </li>
      </ol>
    </div>
  );
}

function Items({
  names,
  probe,
}: {
  names: $ReadOnlyArray<string>,
  probe: {current: HostInstance | null},
}): React.Node {
  return (
    // $FlowFixMe[prop-missing] intrinsic
    <div style={{width: 360}}>
      {/* $FlowFixMe[prop-missing] intrinsic */}
      <ol style={{listStylePosition: 'inside', listStyleType: 'upper-roman'}}>
        {names.map(name => (
          // $FlowFixMe[prop-missing] intrinsic
          <li key={name}>
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <span ref={name === 'Last' ? probe : undefined}>{name}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function lastTextStart(
  from: $ReadOnlyArray<string>,
  to: $ReadOnlyArray<string>,
): number {
  const root = Fantom.createRoot();
  const probe = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(<Items names={from} probe={probe} />);
  });
  Fantom.runTask(() => {
    root.render(<Items names={to} probe={probe} />);
  });
  return nullthrows(probe.current).getBoundingClientRect().left;
}

function textStartAfterUpdate(from: ListStyle, to: ListStyle): number {
  const root = Fantom.createRoot();
  const probe = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(<List listStyle={from} probe={probe} />);
  });
  Fantom.runTask(() => {
    root.render(<List listStyle={to} probe={probe} />);
  });
  return nullthrows(probe.current).getBoundingClientRect().left;
}

function textStart(listStyle: ListStyle): number {
  return textStartAfterUpdate(listStyle, listStyle);
}

describe('a list whose markers change', () => {
  it('lays an inside marker out again when its type changes', () => {
    const decimal = {listStylePosition: 'inside', listStyleType: 'decimal'};
    const roman = {listStylePosition: 'inside', listStyleType: 'upper-roman'};
    // "III." is wider than "3.", so the text starts further in
    expect(textStart(roman)).toBeGreaterThan(textStart(decimal));
    expect(textStartAfterUpdate(decimal, roman)).toBe(textStart(roman));
    expect(textStartAfterUpdate(roman, decimal)).toBe(textStart(decimal));
  });

  it('lays an item out again when its marker moves inside or outside', () => {
    const outside = {listStylePosition: 'outside', listStyleType: 'decimal'};
    const inside = {listStylePosition: 'inside', listStyleType: 'decimal'};
    expect(textStart(inside)).toBeGreaterThan(textStart(outside));
    expect(textStartAfterUpdate(outside, inside)).toBe(textStart(inside));
    expect(textStartAfterUpdate(inside, outside)).toBe(textStart(outside));
  });

  it('numbers an item again when an item before it comes or goes', () => {
    const two = ['First', 'Last'];
    const three = ['First', 'Second', 'Last'];
    // "III." is wider than "II.", so the text starts further in
    expect(lastTextStart(three, three)).toBeGreaterThan(
      lastTextStart(two, two),
    );
    expect(lastTextStart(two, three)).toBe(lastTextStart(three, three));
    expect(lastTextStart(three, two)).toBe(lastTextStart(two, two));
  });
});
