/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

import '../dom-compat';

import LegacySyntheticEvent from 'react-native/src/private/renderer/events/LegacySyntheticEvent';

// The payload of a one-finger touch start, as `TouchEventEmitter` builds it
function touchStart(): $FlowFixMe {
  const touch = {
    identifier: 1,
    target: 12,
    pageX: 40,
    pageY: 300,
    locationX: 4,
    locationY: 6,
    screenX: 40,
    screenY: 300,
    force: 0,
    timestamp: 1000,
  };
  return new LegacySyntheticEvent(
    'touchstart',
    {bubbles: true},
    {
      ...touch,
      touches: [touch],
      changedTouches: [touch],
      targetTouches: [touch],
    },
  );
}

describe('event fields', () => {
  it('gives a touch event its touch lists, with client points', () => {
    const event = touchStart();
    expect(event.touches.length).toBe(1);
    expect(event.touches[0].clientX).toBe(40);
    expect(event.touches[0].clientY).toBe(300);
    // The finger's pointer id, which iOS counts from 2
    expect(event.changedTouches[0].identifier).toBe(3);
    expect(event.targetTouches.length).toBe(1);
  });

  it('reads a list as the same object each time', () => {
    const event = touchStart();
    expect(event.touches).toBe(event.touches);
  });

  it('gives a pointer event its pointer fields', () => {
    const event: $FlowFixMe = new LegacySyntheticEvent(
      'pointerdown',
      {bubbles: true},
      {
        clientX: 10,
        clientY: 20,
        pointerType: 'touch',
        button: 0,
        isPrimary: true,
      },
    );
    expect(event.clientX).toBe(10);
    expect(event.clientY).toBe(20);
    expect(event.pointerType).toBe('touch');
    expect(event.button).toBe(0);
    expect(event.touches).toBe(undefined);
  });
});
