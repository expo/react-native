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
 * What script writes with `setAttribute` and `removeAttribute` is the
 * element's attribute as selectors see it: it restyles the element and what
 * reads it without React rendering, it sits over React's attribute, and React
 * writing the attribute anew takes it back, as React DOM sets an attribute
 * only when its prop changes. Astryx's touch press controller paints a press
 * this way, writing `data-astryx-press` onto the pressed control.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {installStylesheet} from '../css';
import {jsx} from '../jsx-runtime';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

function elementRef(): {current: $FlowFixMe} {
  return React.createRef<$FlowFixMe>();
}

installStylesheet(`
  .box { width: 100px; height: 20px; }
  .box[data-press="on"] { width: 50px; opacity: 0.5; }
  .inner { width: 10px; height: 4px; }
  .box[data-press="on"] .inner { width: 40px; }
  .box[aria-busy] { height: 30px; }
`);

let renders = 0;

// A box with React's attributes, around a child a descendant rule sizes
function Box({
  box,
  inner,
  attributes,
}: {
  box: {current: $FlowFixMe},
  inner: {current: $FlowFixMe},
  attributes: {[string]: unknown},
}): React.Node {
  renders++;
  return jsx('div', {
    ...attributes,
    ref: box,
    className: 'box',
    children: jsx('div', {ref: inner, className: 'inner'}),
  }) as $FlowFixMe;
}

function render(
  root: $FlowFixMe,
  box: {current: $FlowFixMe},
  inner: {current: $FlowFixMe},
  attributes: {[string]: unknown},
): void {
  Fantom.runTask(() => {
    root.render(<Box box={box} inner={inner} attributes={attributes} />);
  });
}

function widthOf(element: $FlowFixMe): number {
  return element.getBoundingClientRect().width;
}

function heightOf(element: $FlowFixMe): number {
  return element.getBoundingClientRect().height;
}

describe('setAttribute', () => {
  it('restyles the element and its subtree without React rendering', () => {
    const root = Fantom.createRoot();
    const box = elementRef();
    const inner = elementRef();
    render(root, box, inner, {});
    const rendered = renders;
    expect(widthOf(box.current)).toBe(100);
    expect(widthOf(inner.current)).toBe(10);

    Fantom.runTask(() => {
      box.current.setAttribute('data-press', 'on');
    });
    expect(widthOf(box.current)).toBe(50);
    expect(widthOf(inner.current)).toBe(40);

    Fantom.runTask(() => {
      box.current.removeAttribute('data-press');
    });
    expect(widthOf(box.current)).toBe(100);
    expect(widthOf(inner.current)).toBe(10);
    expect(renders).toBe(rendered);
  });

  it('is read back and matched, and computed style reads it, in the same task', () => {
    const root = Fantom.createRoot();
    const box = elementRef();
    const inner = elementRef();
    render(root, box, inner, {});

    let opacity = '';
    let matched = false;
    Fantom.runTask(() => {
      box.current.setAttribute('data-press', 'on');
      matched = box.current.matches('[data-press="on"]');
      opacity = String(getComputedStyle(box.current).opacity);
    });
    expect(matched).toBe(true);
    expect(opacity).toBe('0.5');
    expect(box.current.getAttribute('data-press')).toBe('on');
    expect(box.current.dataset.press).toBe('on');
  });

  it('lowercases the name, as HTML does', () => {
    const root = Fantom.createRoot();
    const box = elementRef();
    const inner = elementRef();
    render(root, box, inner, {});

    Fantom.runTask(() => {
      box.current.setAttribute('Data-Press', 'on');
    });
    expect(box.current.getAttribute('data-press')).toBe('on');
    expect(widthOf(box.current)).toBe(50);
  });

  it('stands while React renders other attributes', () => {
    const root = Fantom.createRoot();
    const box = elementRef();
    const inner = elementRef();
    render(root, box, inner, {'data-kind': 'a'});
    Fantom.runTask(() => {
      box.current.setAttribute('data-press', 'on');
    });

    render(root, box, inner, {'data-kind': 'b'});
    expect(widthOf(box.current)).toBe(50);
    expect(box.current.getAttribute('data-press')).toBe('on');
  });

  it('stands over React’s value until React writes the attribute anew', () => {
    const root = Fantom.createRoot();
    const box = elementRef();
    const inner = elementRef();
    render(root, box, inner, {'data-press': 'off'});
    Fantom.runTask(() => {
      box.current.setAttribute('data-press', 'on');
    });
    expect(widthOf(box.current)).toBe(50);

    // The same value again is no write
    render(root, box, inner, {'data-press': 'off'});
    expect(widthOf(box.current)).toBe(50);
    expect(box.current.getAttribute('data-press')).toBe('on');

    // A new value is, and the last write wins, for good
    render(root, box, inner, {'data-press': 'idle'});
    expect(widthOf(box.current)).toBe(100);
    expect(box.current.getAttribute('data-press')).toBe('idle');
    render(root, box, inner, {'data-press': 'off'});
    expect(box.current.getAttribute('data-press')).toBe('off');
  });

  it('removes an attribute React gives until React writes it anew', () => {
    const root = Fantom.createRoot();
    const box = elementRef();
    const inner = elementRef();
    render(root, box, inner, {'aria-busy': true});
    expect(heightOf(box.current)).toBe(30);

    Fantom.runTask(() => {
      box.current.removeAttribute('aria-busy');
    });
    expect(heightOf(box.current)).toBe(20);
    expect(box.current.hasAttribute('aria-busy')).toBe(false);

    render(root, box, inner, {'aria-busy': true});
    expect(heightOf(box.current)).toBe(20);

    render(root, box, inner, {});
    render(root, box, inner, {'aria-busy': true});
    expect(heightOf(box.current)).toBe(30);
  });

  it('toggles an attribute', () => {
    const root = Fantom.createRoot();
    const box = elementRef();
    const inner = elementRef();
    render(root, box, inner, {});

    Fantom.runTask(() => {
      box.current.toggleAttribute('aria-busy');
    });
    expect(heightOf(box.current)).toBe(30);
    Fantom.runTask(() => {
      box.current.toggleAttribute('aria-busy');
    });
    expect(heightOf(box.current)).toBe(20);
  });
});
