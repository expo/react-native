/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

describe('MouseEvent', () => {
  it('is a UIEvent and an Event', () => {
    const event = new MouseEvent('click', {bubbles: true, cancelable: true});

    expect(event.type).toBe('click');
    expect(event.bubbles).toBe(true);
    expect(event.cancelable).toBe(true);
    expect(event).toBeInstanceOf(UIEvent);
    expect(event).toBeInstanceOf(Event);
  });

  it('defaults every member the way the web does', () => {
    const event = new MouseEvent('click');

    expect(event.detail).toBe(0);
    expect(event.view).toBe(null);
    expect(event.screenX).toBe(0);
    expect(event.screenY).toBe(0);
    expect(event.clientX).toBe(0);
    expect(event.clientY).toBe(0);
    expect(event.ctrlKey).toBe(false);
    expect(event.shiftKey).toBe(false);
    expect(event.altKey).toBe(false);
    expect(event.metaKey).toBe(false);
    expect(event.button).toBe(0);
    expect(event.buttons).toBe(0);
    expect(event.relatedTarget).toBe(null);
  });

  it('takes the init members and answers getModifierState from them', () => {
    const related = new EventTarget();
    const event = new MouseEvent('click', {
      detail: 2,
      screenX: 10,
      screenY: 20,
      clientX: 30,
      clientY: 40,
      ctrlKey: true,
      metaKey: true,
      button: 1,
      buttons: 4,
      relatedTarget: related,
    });

    expect(event.detail).toBe(2);
    expect(event.screenX).toBe(10);
    expect(event.screenY).toBe(20);
    expect(event.clientX).toBe(30);
    expect(event.clientY).toBe(40);
    expect(event.x).toBe(30);
    expect(event.y).toBe(40);
    expect(event.pageX).toBe(30);
    expect(event.pageY).toBe(40);
    expect(event.ctrlKey).toBe(true);
    expect(event.metaKey).toBe(true);
    expect(event.shiftKey).toBe(false);
    expect(event.button).toBe(1);
    expect(event.buttons).toBe(4);
    expect(event.relatedTarget).toBe(related);
    expect(event.getModifierState('Control')).toBe(true);
    expect(event.getModifierState('Meta')).toBe(true);
    expect(event.getModifierState('Shift')).toBe(false);
    expect(event.getModifierState('CapsLock')).toBe(false);
  });

  it('does NOT allow changing a member after construction', () => {
    const event = new MouseEvent('click', {button: 2});

    expect(() => {
      'use strict';
      // $FlowExpectedError[cannot-write]
      event.button = 0;
    }).toThrow();
  });

  it('is dispatched to a listener like any event', () => {
    const target = new EventTarget();
    let received = null;
    target.addEventListener('click', event => {
      received = event;
    });

    const event = new MouseEvent('click', {bubbles: true, button: 0});
    target.dispatchEvent(event);

    expect(received).toBe(event);
    expect(event.isTrusted).toBe(false);
  });
});
