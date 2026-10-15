/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

import {cssVersion, installStylesheet, resetStylesheets} from '../css';
import {ElementDescriptorContext, VarScopeContext, jsx} from '../jsx-runtime';
import * as React from 'react';
import TestRenderer from 'react-test-renderer';

afterEach(() => {
  resetStylesheets();
});

/**
 * Renders an element around a stable child that reads what the element hands
 * its subtree, and reports how many times the child rendered again after
 * mounting.
 */
function rerendersOfChild(outerProps: (n: number) => {[string]: unknown}): {
  scope: number,
  descriptor: number,
} {
  const counts = {scope: -1, descriptor: -1};
  function ReadsScope(): React.Node {
    React.useContext(VarScopeContext);
    counts.scope += 1;
    return null;
  }
  function ReadsDescriptor(): React.Node {
    React.useContext(ElementDescriptorContext);
    counts.descriptor += 1;
    return null;
  }
  const children = [<ReadsScope key="scope" />, <ReadsDescriptor key="d" />];
  let setCount: ?(number) => void = null;
  function Outer(): React.Node {
    const [count, set] = React.useState(0);
    setCount = set;
    return jsx('div', {...outerProps(count), children});
  }
  let renderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(<Outer />);
  });
  for (let i = 1; i <= 3; i++) {
    TestRenderer.act(() => {
      setCount?.(i);
    });
  }
  TestRenderer.act(() => {
    renderer?.unmount();
  });
  return counts;
}

describe('re-rendering an element', () => {
  beforeEach(() => {
    installStylesheet('.outer .inner { color: red; }');
  });

  it('leaves its subtree alone when what it hands down is unchanged', () => {
    // A new style object and custom property map on every render, with the
    // same content: the subtree's descriptor and scope are the same
    expect(
      rerendersOfChild(() => ({
        className: 'outer',
        style: {'--gap': '4px', padding: 2},
      })),
    ).toEqual({scope: 0, descriptor: 0});
  });

  it('re-renders its subtree when its custom properties change', () => {
    expect(
      rerendersOfChild(n => ({
        className: 'outer',
        style: {'--gap': `${n}px`},
      })).scope,
    ).toBe(3);
  });

  it('re-renders its subtree when what descendants match against changes', () => {
    expect(
      rerendersOfChild(n => ({
        className: n % 2 === 0 ? 'outer' : 'outer odd',
      })).descriptor,
    ).toBe(3);
  });
});

describe('an element that starts providing something', () => {
  it('keeps its subtree mounted', () => {
    let mounts = 0;
    function Mounted(): React.Node {
      React.useEffect(() => {
        mounts += 1;
      }, []);
      return null;
    }
    const child = <Mounted />;
    let setCount: ?(number) => void = null;
    function Outer(): React.Node {
      const [count, set] = React.useState(0);
      setCount = set;
      // From nothing, to a colour and a custom property, and back
      const style = count === 1 ? {color: 'red', '--gap': '4px'} : {};
      return jsx('div', {style, children: child});
    }
    let renderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(<Outer />);
    });
    TestRenderer.act(() => {
      setCount?.(1);
    });
    TestRenderer.act(() => {
      setCount?.(2);
    });
    TestRenderer.act(() => {
      renderer?.unmount();
    });
    expect(mounts).toBe(1);
  });
});

describe('installing a stylesheet', () => {
  it('re-resolves nothing for a sheet with no style rules', () => {
    installStylesheet('.a { color: red; }');
    const before = cssVersion();
    // Astryx's Layer slide rules: only `@position-try` blocks
    installStylesheet(
      '@position-try --astryx-slide{position-area:block-end;margin:0}',
    );
    expect(cssVersion()).toBe(before);
    installStylesheet('.b { color: blue; }');
    expect(cssVersion()).toBe(before + 1);
  });
});
