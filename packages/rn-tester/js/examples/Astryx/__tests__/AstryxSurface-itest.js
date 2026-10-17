/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

/**
 * The surface the Astryx examples render in carries Astryx's reset, as an
 * Astryx app's document does, and RNTester's other screens keep the user
 * agent's styles.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../../../astryx/document-shim';
import '../../../astryx/dom-compat';

import {jsx} from '../../../astryx/jsx-runtime';
import AstryxSurface from '../AstryxSurface';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

function elementRef(): {current: $FlowFixMe} {
  return React.createRef<$FlowFixMe>();
}

// Where a list's first item starts, from the list's own left edge
function itemInset(inSurface: boolean): number {
  const list = elementRef();
  const item = elementRef();
  const ul = jsx('ul', {
    ref: list,
    children: jsx('li', {ref: item, children: 'An item'}),
  });
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      (inSurface ? jsx(AstryxSurface, {children: ul}) : ul) as $FlowFixMe,
    );
  });
  return (
    item.current.getBoundingClientRect().x -
    list.current.getBoundingClientRect().x
  );
}

describe('an Astryx surface', () => {
  it('takes a list’s user-agent indent away, as Astryx’s reset does', () => {
    expect(itemInset(true)).toBe(0);
  });

  it('leaves a list outside it its user-agent indent', () => {
    expect(itemInset(false)).toBeGreaterThan(0);
  });
});
