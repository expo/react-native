/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 * @oncall react_native
 */

/**
 * What Astryx's field containers ask of an element when the container is
 * pressed (`useInputContainer`): whether it is an `HTMLInputElement`, its
 * `type`, and, failing both, `click()`. A press on Login Card's field padding
 * reached `click()` on an `<input>`, which React Native's element does not
 * have, and the app aborted.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {jsx} from '../jsx-runtime';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

function renderWithRefs(element: (refs: $FlowFixMe) => $FlowFixMe): {
  [string]: $FlowFixMe,
} {
  const refs = {
    input: React.createRef<$FlowFixMe>(),
    plain: React.createRef<$FlowFixMe>(),
    pressable: React.createRef<$FlowFixMe>(),
  };
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element(refs));
  });
  return {
    input: refs.input.current,
    plain: refs.plain.current,
    pressable: refs.pressable.current,
  };
}

describe('an element activated from script', () => {
  it('is an HTMLInputElement when it is an <input>', () => {
    const {input, plain} = renderWithRefs(refs =>
      jsx('div', {
        ref: refs.plain,
        children: jsx('input', {ref: refs.input, type: 'email'}),
      }),
    );
    expect(input instanceof global.HTMLInputElement).toBe(true);
    expect(plain instanceof global.HTMLInputElement).toBe(false);
    expect(plain instanceof global.HTMLElement).toBe(true);
  });

  it('reflects an <input> type, text by default', () => {
    const {input, plain} = renderWithRefs(refs =>
      jsx('div', {
        children: [
          jsx('input', {ref: refs.input, type: 'password'}, 'a'),
          jsx('input', {ref: refs.plain}, 'b'),
        ],
      }),
    );
    expect(input.type).toBe('password');
    expect(plain.type).toBe('text');
  });

  it('runs the authored click handler', () => {
    const onClick = jest.fn();
    const {pressable} = renderWithRefs(refs =>
      jsx('div', {ref: refs.pressable, onClick}),
    );
    pressable.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0].type).toBe('click');
  });

  it('does nothing without a handler', () => {
    const {input} = renderWithRefs(refs =>
      jsx('div', {children: jsx('input', {ref: refs.input})}),
    );
    expect(() => input.click()).not.toThrow();
  });
});
