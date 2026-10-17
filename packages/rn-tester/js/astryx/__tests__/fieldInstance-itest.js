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
 * An `<input>`'s ref has the web field's `value` and `setSelectionRange`,
 * which Astryx's Selector calls to put the caret after the query when it
 * focuses its search field.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {jsx} from '../jsx-runtime';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

describe('field instance', () => {
  function render(props: {[string]: unknown}): {
    field: $FlowFixMe,
    root: $FlowFixMe,
  } {
    const ref = React.createRef<$FlowFixMe>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(jsx('input', {...props, ref}) as $FlowFixMe);
    });
    return {field: ref.current, root};
  }

  it('reads the controlled value', () => {
    const {field} = render({value: 'Dog', onChange: () => {}});
    expect(field.value).toBe('Dog');
    expect(field.value.length).toBe(3);
  });

  it('reads the default value, then what was typed', () => {
    const {field} = render({defaultValue: 'Ca'});
    expect(field.value).toBe('Ca');
    Fantom.dispatchNativeEvent(field, 'change', {text: 'Cat'});
    expect(field.value).toBe('Cat');
  });

  it('places the caret through setSelectionRange and select', () => {
    const {field, root} = render({defaultValue: 'abc'});
    root.takeMountingManagerLogs();
    Fantom.runTask(() => {
      field.setSelectionRange(field.value.length, field.value.length);
      field.select();
    });
    // TextInput's own `setSelection`, which it adds to its instance, sends
    // the selection to the native field as a command
    const selections = root
      .takeMountingManagerLogs()
      .map((log: string) =>
        /setTextAndSelection, args: \[\d+,null,(\d+),(\d+)\]/.exec(log),
      )
      .filter(Boolean)
      .map(match => [Number(match[1]), Number(match[2])]);
    expect(selections).toEqual([
      [3, 3],
      [0, 3],
    ]);
  });
});
