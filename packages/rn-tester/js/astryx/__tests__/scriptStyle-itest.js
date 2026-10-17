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
 * What script writes to `element.style` is the element's inline style as the
 * engine styles it: it restyles the element without React rendering, it sits
 * over React's `style`, and React writing a property anew takes it back, the
 * last write to a property winning as in a browser.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {jsx} from '../jsx-runtime';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

function elementRef(): {current: $FlowFixMe} {
  return React.createRef<$FlowFixMe>();
}

let renders = 0;

// A box with React's `style`, around a child whose width reads `--w`
function Box({
  box,
  inner,
  style,
}: {
  box: {current: $FlowFixMe},
  inner: {current: $FlowFixMe},
  style: {[string]: unknown},
}): React.Node {
  renders++;
  return jsx('div', {
    ref: box,
    style,
    children: jsx('div', {
      ref: inner,
      style: {width: 'var(--w, 10px)', height: 4},
    }),
  }) as $FlowFixMe;
}

function render(
  root: $FlowFixMe,
  box: {current: $FlowFixMe},
  inner: {current: $FlowFixMe},
  style: {[string]: unknown},
): void {
  Fantom.runTask(() => {
    root.render(<Box box={box} inner={inner} style={style} />);
  });
}

function widthOf(element: $FlowFixMe): number {
  return element.getBoundingClientRect().width;
}

describe('element.style', () => {
  it('restyles the element without React rendering', () => {
    const root = Fantom.createRoot();
    const box = elementRef();
    const inner = elementRef();
    render(root, box, inner, {width: 100, height: 20});
    const rendered = renders;

    Fantom.runTask(() => {
      box.current.style.width = '50px';
    });
    expect(widthOf(box.current)).toBe(50);
    expect(renders).toBe(rendered);
  });

  it('sets a custom property its subtree reads', () => {
    const root = Fantom.createRoot();
    const box = elementRef();
    const inner = elementRef();
    render(root, box, inner, {width: 100, height: 20});
    expect(widthOf(inner.current)).toBe(10);

    Fantom.runTask(() => {
      box.current.style.setProperty('--w', '40px');
    });
    expect(widthOf(inner.current)).toBe(40);

    Fantom.runTask(() => {
      box.current.style.removeProperty('--w');
    });
    expect(widthOf(inner.current)).toBe(10);
  });

  it('is read back, and computed style reads it in the same task', () => {
    const root = Fantom.createRoot();
    const box = elementRef();
    const inner = elementRef();
    render(root, box, inner, {width: 100, height: 20});

    let custom = '';
    Fantom.runTask(() => {
      box.current.style.setProperty('--w', '30px');
      custom = getComputedStyle(box.current).getPropertyValue('--w');
    });
    expect(custom).toBe('30px');
    expect(box.current.style.getPropertyValue('--w')).toBe('30px');
  });

  it('stands while React renders other values', () => {
    const root = Fantom.createRoot();
    const box = elementRef();
    const inner = elementRef();
    render(root, box, inner, {width: 100, height: 20});
    Fantom.runTask(() => {
      box.current.style.width = '50px';
    });

    render(root, box, inner, {width: 100, height: 24});
    expect(widthOf(box.current)).toBe(50);
    expect(box.current.style.width).toBe('50px');
  });

  it('yields a property React writes anew, for good', () => {
    const root = Fantom.createRoot();
    const box = elementRef();
    const inner = elementRef();
    render(root, box, inner, {width: 100, height: 20});
    Fantom.runTask(() => {
      box.current.style.width = '50px';
      box.current.style.setProperty('--w', '30px');
    });

    render(root, box, inner, {width: 120, height: 20});
    expect(widthOf(box.current)).toBe(120);
    // React's own write back to the value script overrode is React's too
    render(root, box, inner, {width: 100, height: 20});
    expect(widthOf(box.current)).toBe(100);
    // What React did not write stands
    expect(widthOf(inner.current)).toBe(30);
    expect(box.current.style.getPropertyValue('--w')).toBe('30px');
  });

  it('gives React its value back when removed', () => {
    const root = Fantom.createRoot();
    const box = elementRef();
    const inner = elementRef();
    render(root, box, inner, {width: 100, height: 20});
    Fantom.runTask(() => {
      box.current.style.width = '50px';
    });
    Fantom.runTask(() => {
      box.current.style.cssText = '';
    });
    expect(widthOf(box.current)).toBe(100);
  });
});
