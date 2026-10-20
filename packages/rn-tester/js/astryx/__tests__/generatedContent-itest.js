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
 * `::before` and `::after` (css-pseudo-4 §2), as StyleX writes them: a box
 * the element draws first or last, with the text its `content` generates.
 * Astryx's Stepper fills a step's bar with a scaled `::before`, and its code
 * block numbers each line with `content: attr(data-line)`. A generated box is
 * not an element: it holds no place among its siblings and is not one of its
 * parent's children.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {installStylesheet} from '../css';
import {jsx} from '../jsx-runtime';
import * as stylex from '../stylex-rn';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

const styles = stylex.create({
  bar: {
    position: 'relative',
    width: 100,
    height: 4,
    '::before': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: 0,
      width: 40,
      height: 4,
      backgroundColor: 'rgb(255, 0, 0)',
    },
  },
  numbered: {
    '::before': {content: 'attr(data-line)'},
    '::after': {content: '"!"'},
  },
  plain: {
    '::before': {width: 10},
  },
});

function render(element: unknown): $FlowFixMe {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element as $FlowFixMe);
  });
  return root;
}

describe('generated content', () => {
  it('draws a `::before` box under the element', () => {
    const bar = React.createRef<$FlowFixMe>();
    const root = render(jsx('div', {ref: bar, ...stylex.props(styles.bar)}));
    const output = JSON.stringify(
      root.getRenderedOutput({props: ['backgroundColor', 'width']}).toJSX(),
    );
    expect(output).toContain('rgba(255, 0, 0');
    // Not an element: the bar has no children
    expect(bar.current?.childNodes.length).toBe(0);
  });

  it('generates its text from a string or an attribute', () => {
    const root = render(
      jsx('div', {
        'data-line': '12',
        ...stylex.props(styles.numbered),
        children: 'const a = 1;',
      }),
    );
    const output = JSON.stringify(root.getRenderedOutput({props: []}).toJSX());
    expect(output).toContain('12');
    expect(output).toContain('!');
  });

  it('generates no box without `content`', () => {
    const element = React.createRef<$FlowFixMe>();
    render(jsx('div', {ref: element, ...stylex.props(styles.plain)}));
    expect(element.current?.childNodes.length).toBe(0);
  });

  it('holds no place among its siblings', () => {
    installStylesheet('.row > :first-child { width: 50px }');
    const first = React.createRef<$FlowFixMe>();
    render(
      jsx('div', {
        className: 'row',
        ...stylex.props(styles.numbered),
        'data-line': '1',
        children: [
          jsx('div', {ref: first, style: {height: 10}}, 'a'),
          jsx('div', {style: {height: 10}}, 'b'),
        ],
      }),
    );
    expect(first.current?.getBoundingClientRect().width).toBe(50);
  });
});
