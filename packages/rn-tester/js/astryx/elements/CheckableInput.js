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

/**
 * `<input type="checkbox">` and `<input type="radio">`: a box the author's
 * styles draw, with the activation behavior HTML gives them (§4.10.5.1.15–16).
 * A click on one, from a finger, from `click()` or dispatched by script, sets
 * its checkedness first (a checkbox toggles, a radio is checked), so the click's
 * listeners read the new value; the input then fires `input` and `change` if
 * the value changed, or, if a listener canceled the click, keeps the old one.
 *
 * Astryx lays such an input, transparent, over the indicator it draws, so a
 * finger lands on it. A text field had stood in for it, and a press focused
 * the field and raised the keyboard instead of checking the box.
 */

import {engineInputProps} from '../native-css/engine';
import {setCheckedness} from './checkedness';
import * as React from 'react';
import {jsx as reactJsx} from 'react/jsx-runtime';

type Handler = (event: $FlowFixMe) => void;

export type CheckableInputProps = {
  type: 'checkbox' | 'radio',
  checked?: ?boolean,
  defaultChecked?: ?boolean,
  disabled?: ?boolean,
  role?: ?string,
  onClick?: ?Handler,
  onInput?: ?Handler,
  onChange?: ?Handler,
  ref?: React.RefSetter<$FlowFixMe>,
  [string]: unknown,
};

// The handlers the element runtime adds to track the element's interaction
// states, which the host reports
function isStateHandler(key: string): boolean {
  return key.startsWith('onPointer') || key === 'onFocus' || key === 'onBlur';
}

export default function CheckableInput({
  type,
  checked,
  defaultChecked,
  disabled,
  role,
  onClick,
  onInput,
  onChange,
  ref,
  ...rest
}: CheckableInputProps): React.Node {
  const controlled = checked != null;
  const [ownChecked, setOwnChecked] = React.useState(defaultChecked === true);
  const isChecked = controlled ? checked === true : ownChecked;

  // What a click reads and runs, current at the time of the click
  const latest = React.useRef({type, isChecked, controlled, disabled});
  latest.current = {type, isChecked, controlled, disabled};
  const handlers = React.useRef({onClick, onInput, onChange});
  handlers.current = {onClick, onInput, onChange};
  // The checkedness while a click is dispatched, before the value it sets is
  // rendered
  const pending = React.useRef<?boolean>(null);

  const instanceRef = React.useRef<$FlowFixMe>(null);
  const forwardedRef = React.useRef(ref);
  forwardedRef.current = ref;
  const setInstance = React.useCallback((instance: $FlowFixMe) => {
    instanceRef.current = instance;
    if (instance != null && typeof instance === 'object') {
      setCheckedness(
        instance,
        () => pending.current ?? latest.current.isChecked,
      );
    }
    const forwarded = forwardedRef.current;
    if (typeof forwarded === 'function') {
      forwarded(instance);
    } else if (forwarded != null) {
      forwarded.current = instance;
    }
  }, []);

  const activate = React.useCallback((event: $FlowFixMe) => {
    const state = latest.current;
    // A disabled control receives no click (HTML §4.10.18.5)
    if (state.disabled === true) {
      return;
    }
    const next = state.type === 'radio' ? true : !state.isChecked;
    pending.current = next;
    try {
      handlers.current.onClick?.(event);
      if (event?.defaultPrevented === true) {
        return;
      }
      if (next === state.isChecked) {
        return;
      }
      if (!state.controlled) {
        setOwnChecked(next);
      }
      const target = instanceRef.current;
      handlers.current.onInput?.(changeEvent('input', target));
      handlers.current.onChange?.(changeEvent('change', target));
    } finally {
      pending.current = null;
    }
  }, []);

  const hostProps: {[string]: unknown} = {
    ...engineInputProps(rest),
    cssBox: true,
    ref: setInstance,
    onClick: activate,
    accessible: true,
    role: role ?? type,
    'aria-checked': isChecked,
    'aria-disabled': disabled === true,
  };
  for (const key of Object.keys(rest)) {
    if (isStateHandler(key)) {
      hostProps[key] = rest[key];
    }
  }
  return reactJsx('div', hostProps);
}

// An `input` or `change` event at the input, whose `checked` is its new value
function changeEvent(type: string, target: $FlowFixMe): $FlowFixMe {
  const event = {
    type,
    target,
    currentTarget: target,
    bubbles: true,
    defaultPrevented: false,
    preventDefault(): void {
      event.defaultPrevented = true;
    },
    stopPropagation(): void {},
    nativeEvent: {},
  };
  return event;
}
