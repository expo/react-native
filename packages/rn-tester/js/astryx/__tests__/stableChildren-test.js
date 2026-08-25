/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

'use strict';

import {installStylesheet, resetStylesheets} from '../css';
import {jsx} from '../jsx-runtime';
import * as React from 'react';
import TestRenderer from 'react-test-renderer';

/**
 * An element that re-renders for its own reasons hands React the same child
 * elements it did before: the runtime stamps children with their position for
 * `:nth-child`, and a fresh clone on every render re-rendered every element in
 * the page whenever its host did.
 */
describe('an element re-rendering with the same children', () => {
  afterEach(() => {
    resetStylesheets();
  });

  it('does not re-render them', () => {
    // A positional selector in a sheet turns the stamping on
    installStylesheet('.row:nth-child(2) { color: red; }');
    let probeRenders = 0;
    function Probe(): React.Node {
      probeRenders++;
      return null;
    }
    const children = [jsx('p', {children: 'first'}, 'a'), jsx(Probe, {}, 'b')];
    let renderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(jsx('div', {children}) as $FlowFixMe);
    });
    expect(probeRenders).toBe(1);
    // A stylesheet change re-renders every intrinsic element, the host among
    // them, with the children it had
    TestRenderer.act(() => {
      installStylesheet('.other { color: blue; }');
    });
    expect(probeRenders).toBe(1);
    TestRenderer.act(() => {
      renderer.unmount();
    });
  });
});
