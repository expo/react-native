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

import '../dom-compat';

import {jsx} from '../jsx-runtime';
import * as React from 'react';
import TestRenderer from 'react-test-renderer';

/**
 * An `<input>`'s ref has the web field's `value` and `setSelectionRange`,
 * which Astryx's Selector calls to put the caret after the query when it
 * focuses its search field.
 */
describe('field instance', () => {
  function render(props: {[string]: unknown}): {
    field: $FlowFixMe,
    renderer: $FlowFixMe,
  } {
    const ref = React.createRef<$FlowFixMe>();
    let renderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        jsx('input', {...props, ref}) as $FlowFixMe,
        {
          createNodeMock: () => ({}),
        },
      );
    });
    return {field: ref.current, renderer};
  }

  it('reads the controlled value', () => {
    const {field} = render({value: 'Dog', onChange: () => {}});
    expect(field.value).toBe('Dog');
    expect(field.value.length).toBe(3);
  });

  it('reads the default value, then what was typed', () => {
    const {field, renderer} = render({defaultValue: 'Ca'});
    expect(field.value).toBe('Ca');
    const input = renderer.root.findAll(
      (n: $FlowFixMe) => typeof n.props.onChangeText === 'function',
    )[0];
    TestRenderer.act(() => {
      input.props.onChangeText('Cat');
    });
    expect(field.value).toBe('Cat');
  });

  it('places the caret through setSelectionRange and select', () => {
    const {field} = render({defaultValue: 'abc'});
    // TextInput's own `setSelection`, which it adds to its instance
    const selections: Array<[number, number]> = [];
    field.setSelection = (start: number, end: number) => {
      selections.push([start, end]);
    };
    field.setSelectionRange(field.value.length, field.value.length);
    field.select();
    expect(selections).toEqual([
      [3, 3],
      [0, 3],
    ]);
  });
});
