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
 * That a controlled `<input>` can still refuse a character.
 *
 * The view will not write an incoming `value` while its own edit count is ahead
 * of the `mostRecentEventCount` coming back from JavaScript: a value computed
 * without the keystrokes still in flight would rewind the field under the
 * user's fingers. That guard is right, and it is only half a handshake — it
 * needs the count echoed back. Nothing in JavaScript ever set that prop, so it
 * sat at 0 while the view counted upward, every controlled write was judged
 * stale, and `value` stopped meaning anything after the first keystroke. On a
 * device that read as "Max 10 does not stop at 10".
 *
 * The clamping handler is what makes it visible and is what these pin.
 * `slice(0, 10)` sets the SAME string once the cap is reached, so `useState`
 * bails out and React does not re-render — without a value that changes every
 * keystroke, no props reach the view at all. That is why the echoed count has
 * to live in state rather than a ref: it rises on every edit, so it is what
 * carries the author's unchanged `value` back down.
 *
 * Asserted here at the JS boundary — the props the element hands its host —
 * because that is where the defect was. Fantom's rendered-output snapshot
 * reports only base view props, so it cannot see these two.
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

    // Left at 0 — the defect — the view reads every later `value` as stale and
    // never writes one back.
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

    // The eleventh character. The handler clamps it to the same ten it already
    // held, so the author's state does not change; with only that to render,
    // React would produce nothing and the character would stay on screen.
    type(renderer, '0123456789X', 2);

    // The count moved even though the value did not, so a render happened and
    // the view is handed the clamped ten with a count no longer behind its
    // own — which is what allows it to overwrite the character.
    expect(hostProps(renderer).mostRecentEventCount).toBe(2);
    expect(hostProps(renderer).value).toBe('0123456789');
  });
});
