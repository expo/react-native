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
 * StyleX's other spelling of a condition: a block of declarations under it
 * (`':active': {backgroundColor: …}`, `'@media …': {…}`), which StyleX
 * compiles to the rules the condition inside each property's value would
 * compile to. Vendored Astryx writes both (its nav items' press colour, its
 * status dot's reduced motion). The two merge differently: StyleX keys a
 * block's declaration by the condition and the property, so a later style
 * replaces it only with a block of its own.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {jsx} from '../jsx-runtime';
import * as stylex from '../stylex-rn';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

// A ref to an element, which the test calls the DOM's methods of
function elementRef(): {current: $FlowFixMe} {
  return React.createRef();
}

const BLUE = 'rgba(0, 0, 255, 1)';
const RED = 'rgba(255, 0, 0, 1)';
const GREEN = 'rgba(0, 128, 0, 1)';

/** A box with the styles, and what it draws as its background and opacity. */
function renderBox(...styles: Array<unknown>): {
  box: {current: $FlowFixMe},
  drawn: () => {backgroundColor: ?string, opacity: ?string},
} {
  const box = elementRef();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      jsx('div', {
        ref: box,
        ...stylex.props({width: 10, height: 10}, ...styles),
        children: 'box',
      }) as $FlowFixMe,
    );
  });
  const drawn = () => {
    const json: $FlowFixMe = root
      .getRenderedOutput({props: ['backgroundColor', 'opacity']})
      .toJSON();
    const props = json?.props;
    return {
      backgroundColor: props?.backgroundColor,
      opacity: props?.opacity,
    };
  };
  return {box, drawn};
}

describe('a StyleX block', () => {
  it('declares its properties while its pseudo-class holds', () => {
    const {box, drawn} = renderBox({
      backgroundColor: 'rgb(0, 0, 255)',
      ':active': {backgroundColor: 'rgb(255, 0, 0)'},
    });
    expect(drawn().backgroundColor).toBe(BLUE);
    Fantom.dispatchNativeEvent(box, 'pointerDown');
    expect(drawn().backgroundColor).toBe(RED);
    Fantom.dispatchNativeEvent(box, 'pointerUp');
    expect(drawn().backgroundColor).toBe(BLUE);
  });

  it('holds a conditional value of its own', () => {
    // Astryx's nav item: its press colour, and the system's under forced
    // colours, which this renderer never has
    const {box, drawn} = renderBox({
      backgroundColor: 'rgb(0, 0, 255)',
      ':active': {
        backgroundColor: {
          default: 'rgb(255, 0, 0)',
          '@media (forced-colors: active)': 'Highlight',
        },
      },
    });
    Fantom.dispatchNativeEvent(box, 'pointerDown');
    expect(drawn().backgroundColor).toBe(RED);
  });

  it('declares what it holds where its media query matches', () => {
    const {drawn} = renderBox({
      backgroundColor: 'rgb(0, 0, 255)',
      '@media (min-width: 1px)': {backgroundColor: 'rgb(255, 0, 0)'},
      '@media (max-width: 1px)': {opacity: 0.5},
    });
    expect(drawn()).toEqual({backgroundColor: RED, opacity: undefined});
  });

  it('takes a when.* condition as its key', () => {
    const marker = stylex.defineMarker();
    const card = elementRef();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        jsx('div', {
          ref: card,
          ...stylex.props(marker),
          children: jsx('div', {
            ...stylex.props(
              {width: 10, height: 10, backgroundColor: 'rgb(0, 0, 255)'},
              {
                [stylex.when.ancestor(':hover', marker)]: {
                  backgroundColor: 'rgb(255, 0, 0)',
                },
              },
            ),
          }),
        }) as $FlowFixMe,
      );
    });
    const background = () => {
      const json: $FlowFixMe = root
        .getRenderedOutput({props: ['backgroundColor']})
        .toJSON();
      return json?.children?.[0]?.props.backgroundColor;
    };
    expect(background()).toBe(BLUE);
    Fantom.dispatchNativeEvent(card, 'pointerEnter');
    expect(background()).toBe(RED);
  });
});

describe('merging StyleX blocks', () => {
  it('keeps a block when a later style sets the property plainly', () => {
    const {box, drawn} = renderBox(
      {':active': {backgroundColor: 'rgb(255, 0, 0)'}},
      {backgroundColor: 'rgb(0, 128, 0)'},
    );
    expect(drawn().backgroundColor).toBe(GREEN);
    Fantom.dispatchNativeEvent(box, 'pointerDown');
    expect(drawn().backgroundColor).toBe(RED);
  });

  it('merges a later block declaration by declaration', () => {
    const {box, drawn} = renderBox(
      {':active': {backgroundColor: 'rgb(255, 0, 0)', opacity: 0.8}},
      {':active': {opacity: 0.5}},
    );
    Fantom.dispatchNativeEvent(box, 'pointerDown');
    expect(drawn()).toEqual({backgroundColor: RED, opacity: '0.5'});
  });
});

describe('the branches of a value that hold', () => {
  it('rank as StyleX ranks them: an attribute over :active', () => {
    // Astryx's press: `:active` yields to the controller's attribute under a
    // finger, which outranks it in StyleX's generated rules
    const {box, drawn} = renderBox({
      backgroundColor: {
        default: 'rgb(0, 0, 255)',
        ':active': {
          default: 'rgb(0, 128, 0)',
          '@media (pointer: coarse)': 'rgb(0, 128, 0)',
        },
        '[data-press="on"]': 'rgb(255, 0, 0)',
      },
    });
    Fantom.dispatchNativeEvent(box.current, 'pointerDown');
    expect(drawn().backgroundColor).toBe(GREEN);
    Fantom.runTask(() => {
      box.current.setAttribute('data-press', 'on');
    });
    expect(drawn().backgroundColor).toBe(RED);
  });

  it('rank an at-rule over a pseudo-class', () => {
    const {box, drawn} = renderBox({
      backgroundColor: {
        default: 'rgb(0, 0, 255)',
        ':hover': 'rgb(255, 0, 0)',
        '@media (min-width: 1px)': 'rgb(0, 128, 0)',
      },
    });
    expect(drawn().backgroundColor).toBe(GREEN);
    Fantom.dispatchNativeEvent(box.current, 'pointerEnter');
    expect(drawn().backgroundColor).toBe(GREEN);
  });

  it('go to the later of two of the same rank', () => {
    const {drawn} = renderBox({
      backgroundColor: {
        default: 'rgb(0, 0, 255)',
        '@media (min-width: 1px)': 'rgb(255, 0, 0)',
        '@media (min-width: 2px)': 'rgb(0, 128, 0)',
      },
    });
    expect(drawn().backgroundColor).toBe(GREEN);
  });
});

describe('a variable written as a key', () => {
  it('declares the variable, as the StyleX compiler reads it', () => {
    const vars = stylex.defineVars({'--strength': 1});
    const {drawn} = renderBox({
      [vars['--strength']]: 0.5,
      opacity: vars['--strength'],
    });
    expect(drawn().opacity).toBe('0.5');
  });
});

describe('color-mix()', () => {
  it('takes a percentage written as a math function', () => {
    const vars = stylex.defineVars({'--strength': 1});
    const {drawn} = renderBox({
      [vars['--strength']]: 1,
      backgroundColor: `color-mix(in srgb, rgb(255, 0, 0) calc(${vars['--strength']} * 100%), rgb(0, 0, 255))`,
    });
    expect(drawn().backgroundColor).toBe(RED);
    const {drawn: none} = renderBox({
      backgroundColor:
        'color-mix(in srgb, rgb(255, 0, 0) calc(0 * 100%), rgb(0, 0, 255))',
    });
    expect(none().backgroundColor).toBe(BLUE);
  });
});
