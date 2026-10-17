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
 * Astryx paints a press under a finger with its own controller
 * (`utils/pressFeedback.ts`, unmodified): one set of listeners on `window`
 * and `document` hears the press, and once the press is believed it writes
 * `data-astryx-press` onto the pressed control, whose styles read the
 * attribute over `:active`. Every part has to work for a control to answer a
 * finger: the page's listeners hear a press on a bare host element, the
 * attribute restyles the control, a `defineVars()` variable written as a key
 * declares the press's strength, `color-mix()` takes the strength through
 * `calc()`, and the attribute's branch outranks `:active`'s, as StyleX ranks
 * them.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import type {TimerMock} from '@react-native/fantom';

import {jsx} from '../jsx-runtime';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

const TOUCH = {
  pointerType: 'touch',
  pointerId: 2,
  isPrimary: true,
  button: 0,
  clientX: 10,
  clientY: 10,
};

let timers: TimerMock;

beforeEach(() => {
  timers = Fantom.installTimerMock();
});

afterEach(() => {
  timers.uninstall();
});

// An Astryx Button, as the templates render it, and what its view is drawn
// with
function renderButton(): {
  button: $FlowFixMe,
  drawn: () => {transform: unknown, backgroundImage: unknown},
} {
  // Fantom's Hermes is built without `Intl`, which `utils/characters` reads
  // as it loads
  (globalThis as $FlowFixMe).Intl ??= {};
  // $FlowFixMe[cannot-resolve-module] the vendored sources are TypeScript
  const {Button} = require('../vendor/Button');
  const ref = React.createRef<$FlowFixMe>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      jsx(Button, {ref, label: 'Restock', variant: 'secondary'}) as $FlowFixMe,
    );
  });
  const drawn = () => {
    const props: $FlowFixMe = (
      root
        .getRenderedOutput({props: ['transform', 'backgroundImage']})
        .toJSON() as $FlowFixMe
    )?.props;
    return {
      transform: props?.transform,
      backgroundImage: props?.backgroundImage,
    };
  };
  return {button: ref.current, drawn};
}

describe('a touch press on an Astryx Button', () => {
  it('paints once the press is believed, over :active, and fades on release', () => {
    const {button, drawn} = renderButton();
    const rest = drawn();
    expect(rest.backgroundImage).toBe(undefined);

    Fantom.dispatchNativeEvent(button, 'pointerDown', TOUCH);
    // Nothing yet: a finger that is about to scroll paints nothing
    expect(button.getAttribute('data-astryx-press')).toBe(null);
    expect(drawn()).toEqual(rest);

    timers.advanceTimersByTime(150);
    expect(button.getAttribute('data-astryx-press')).toBe('on');
    const pressed = drawn();
    expect(pressed.transform).toBe('[{"scale": 0.98}]');
    expect(String(pressed.backgroundImage)).toContain('linear-gradient');

    Fantom.dispatchNativeEvent(button, 'pointerUp', TOUCH);
    expect(button.getAttribute('data-astryx-press')).toBe('fading');

    timers.advanceTimersByTime(200);
    expect(button.getAttribute('data-astryx-press')).toBe(null);
    expect(drawn()).toEqual(rest);
  });

  it('flashes a tap too quick for the onset delay', () => {
    const {button, drawn} = renderButton();

    Fantom.dispatchNativeEvent(button, 'pointerDown', TOUCH);
    timers.advanceTimersByTime(40);
    Fantom.dispatchNativeEvent(button, 'pointerUp', TOUCH);
    expect(button.getAttribute('data-astryx-press')).toBe('on');
    expect(String(drawn().backgroundImage)).toContain('linear-gradient');

    timers.advanceTimersByTime(100);
    expect(button.getAttribute('data-astryx-press')).toBe('fading');
    timers.advanceTimersByTime(200);
    expect(button.getAttribute('data-astryx-press')).toBe(null);
  });

  it('paints nothing for a finger that leaves to scroll', () => {
    const {button, drawn} = renderButton();
    const rest = drawn();

    Fantom.dispatchNativeEvent(button, 'pointerDown', TOUCH);
    Fantom.dispatchNativeEvent(button, 'pointerCancel', TOUCH);
    timers.advanceTimersByTime(300);
    expect(button.getAttribute('data-astryx-press')).toBe(null);
    expect(drawn()).toEqual(rest);
  });
});
