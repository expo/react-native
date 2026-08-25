/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * A controlled `<input>` can refuse a character. The view will not write an
 * incoming `value` while its own edit count is ahead of `mostRecentEventCount`,
 * so the count has to be echoed back from JavaScript, and in state rather than
 * a ref: `slice(0, 10)` sets the same string once the cap is reached, `useState`
 * bails out, and only a count that rises on every edit carries the unchanged
 * `value` back down. Asserted at the props the element hands its host, which
 * Fantom's rendered-output snapshot does not report.
 */

import Input from '../src/Input';
import * as React from 'react';
import {useState} from 'react';
import TestRenderer from 'react-test-renderer';

/** The props `<input>` handed down to its host element. */
function hostProps(renderer: $FlowFixMe): $FlowFixMe {
  return renderer.root.findByType('element-input').props;
}

function CappedInput(): React.Node {
  const [value, setValue] = useState('');
  return (
    <Input
      value={value}
      onInput={(event: $FlowFixMe) =>
        setValue(event.nativeEvent.value.slice(0, 10))
      }
    />
  );
}

/** One keystroke, as the view reports it: the whole text, and its edit count. */
function type(renderer: $FlowFixMe, value: string, eventCount: number) {
  TestRenderer.act(() => {
    hostProps(renderer).onInput({nativeEvent: {value, eventCount}});
  });
}

describe('a controlled <input>', () => {
  test('echoes the edit count the view reported', () => {
    let renderer: $FlowFixMe;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(<CappedInput />);
    });

    // Nothing has happened yet, so nothing is owed.
    expect(hostProps(renderer).mostRecentEventCount).toBe(0);

    type(renderer, 'abcdef', 1);

    // Left at 0, the view would read every later `value` as stale
    expect(hostProps(renderer).mostRecentEventCount).toBe(1);
    expect(hostProps(renderer).value).toBe('abcdef');
  });

  test('carries the clamped value down when the author state did not move', () => {
    let renderer: $FlowFixMe;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(<CappedInput />);
    });

    type(renderer, '0123456789', 1);
    expect(hostProps(renderer).value).toBe('0123456789');
    expect(hostProps(renderer).mostRecentEventCount).toBe(1);

    // The eleventh character: the handler clamps to the same ten, so the
    // author's state alone would not re-render
    type(renderer, '0123456789X', 2);

    // The count moved though the value did not, so the view gets the clamped
    // ten with a count no longer behind its own
    expect(hostProps(renderer).mostRecentEventCount).toBe(2);
    expect(hostProps(renderer).value).toBe('0123456789');
  });
});
