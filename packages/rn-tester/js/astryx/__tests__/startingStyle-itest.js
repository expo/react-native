/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true useSharedAnimatedBackend:true
 */

/**
 * `@starting-style` (css-transitions-2 §3.3): an element that comes to be
 * rendered, mounted or shown from `display: none`, has no before-change style,
 * and its transitions run from its starting style instead, given in StyleX as
 * a conditional value or a block and in a sheet as a rule.
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

function elementRef(): {current: $FlowFixMe} {
  return React.createRef<$FlowFixMe>();
}

const FADE = {
  transitionProperty: 'opacity',
  transitionDuration: '1000ms',
  transitionTimingFunction: 'linear',
};

// What the transitions engine last wrote to the element; nothing when it has
// written nothing to it
function written(element: $FlowFixMe): {readonly [string]: unknown} {
  try {
    return Fantom.unstable_getDirectManipulationProps(element) ?? {};
  } catch {
    return {};
  }
}

function writtenOpacity(element: $FlowFixMe): ?number {
  const {opacity} = written(element);
  return typeof opacity === 'number' ? opacity : null;
}

function translateYOf(element: $FlowFixMe): number {
  const {transform} = written(element);
  if (!Array.isArray(transform)) {
    return NaN;
  }
  for (const operation of transform) {
    if (operation != null && typeof operation.translateY === 'number') {
      return operation.translateY;
    }
  }
  return 0;
}

function mount(props: {readonly [string]: unknown}): {current: $FlowFixMe} {
  const box = elementRef();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      jsx('div', {
        ...props,
        ref: box,
        children: jsx('div', {style: {height: 20}}),
      }) as $FlowFixMe,
    );
  });
  return box;
}

describe('@starting-style', () => {
  it('fades a mounted element in from a conditional value', () => {
    const box = mount(
      stylex.props({
        opacity: {default: 1, '@starting-style': 0},
        ...FADE,
      }),
    );
    Fantom.unstable_produceFramesForDuration(500);
    const midway = writtenOpacity(box.current);
    expect(midway).toBeGreaterThan(0.3);
    expect(midway).toBeLessThan(0.7);
    Fantom.unstable_produceFramesForDuration(600);
    expect(writtenOpacity(box.current)).toBeCloseTo(1, 2);
  });

  it('runs every property a block gives', () => {
    const box = mount(
      stylex.props({
        opacity: 1,
        transform: 'translateY(0px)',
        transitionProperty: 'opacity, transform',
        transitionDuration: '1000ms',
        transitionTimingFunction: 'linear',
        '@starting-style': {opacity: 0, transform: 'translateY(100px)'},
      }),
    );
    Fantom.unstable_produceFramesForDuration(500);
    expect(writtenOpacity(box.current)).toBeGreaterThan(0.3);
    expect(writtenOpacity(box.current)).toBeLessThan(0.7);
    expect(translateYOf(box.current)).toBeGreaterThan(30);
    expect(translateYOf(box.current)).toBeLessThan(70);
  });

  it('resolves a percentage against the element’s own size', () => {
    // A bottom sheet's panel, rising from below its own height
    const box = mount(
      stylex.props({
        height: 200,
        transform: {
          default: 'translateY(0)',
          '@starting-style': 'translateY(100%)',
        },
        transitionProperty: 'transform',
        transitionDuration: '1000ms',
        transitionTimingFunction: 'linear',
      }),
    );
    Fantom.unstable_produceFramesForDuration(500);
    const midway = translateYOf(box.current);
    expect(midway).toBeGreaterThan(70);
    expect(midway).toBeLessThan(130);
  });

  it('applies a sheet’s @starting-style rule', () => {
    installStylesheet(
      '.entering { opacity: 1; transition: opacity 1000ms linear } ' +
        '@starting-style { .entering { opacity: 0 } }',
    );
    const box = mount({className: 'entering'});
    Fantom.unstable_produceFramesForDuration(500);
    const midway = writtenOpacity(box.current);
    expect(midway).toBeGreaterThan(0.3);
    expect(midway).toBeLessThan(0.7);
  });

  it('runs again when an ancestor is shown from display: none', () => {
    const root = Fantom.createRoot();
    const box = elementRef();
    const style = stylex.props({
      opacity: {default: 1, '@starting-style': 0},
      ...FADE,
    });
    const render = (shown: boolean) => {
      Fantom.runTask(() => {
        root.render(
          jsx('div', {
            style: {display: shown ? 'flex' : 'none'},
            children: jsx('div', {
              ref: box,
              ...style,
              children: jsx('div', {style: {height: 20}}),
            }),
          }) as $FlowFixMe,
        );
      });
    };
    render(false);
    Fantom.unstable_produceFramesForDuration(1100);
    expect(writtenOpacity(box.current)).toBe(null);

    render(true);
    Fantom.unstable_produceFramesForDuration(500);
    const midway = writtenOpacity(box.current);
    expect(midway).toBeGreaterThan(0.3);
    expect(midway).toBeLessThan(0.7);
  });

  it('does not run again while the element stays rendered', () => {
    const root = Fantom.createRoot();
    const box = elementRef();
    const style = stylex.props({
      opacity: {default: 1, '@starting-style': 0},
      ...FADE,
    });
    const render = (height: number) => {
      Fantom.runTask(() => {
        root.render(
          jsx('div', {
            ref: box,
            ...style,
            children: jsx('div', {style: {height}}),
          }) as $FlowFixMe,
        );
      });
    };
    render(20);
    Fantom.unstable_produceFramesForDuration(1100);
    expect(writtenOpacity(box.current)).toBeCloseTo(1, 2);

    render(30);
    Fantom.unstable_produceFramesForDuration(100);
    expect(writtenOpacity(box.current)).toBeCloseTo(1, 2);
  });

  it('leaves an element without one to appear as it is', () => {
    const box = mount(stylex.props({opacity: 1, ...FADE}));
    Fantom.unstable_produceFramesForDuration(500);
    expect(writtenOpacity(box.current)).toBe(null);
  });
});
