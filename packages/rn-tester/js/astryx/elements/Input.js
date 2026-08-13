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
 * The `<input>` element, backed by React Native's `TextInput`.
 *
 * Unlike `<div>`/`<p>`/`<button>` — pure containers that are registered as
 * view-config aliases — `<input>` needs *behavioral* translation: the web's
 * `value`/`onChange`/`disabled`/`readOnly` vocabulary onto RN's
 * `value`/`onChangeText`/`editable` one, and `type` onto the keyboard and
 * secure-entry flags. So it is a composite component, resolved by the Astryx
 * JSX runtime (see ../jsx-runtime.js), which keeps vendored Astryx sources
 * rendering plain `<input>` unmodified.
 *
 * TextInput is the deliberate near-term choice (per project direction);
 * @expo/ui's native field is the eventual target, and this module is the one
 * place that would change.
 */

import type {InteractionState} from '../stylex-rn';
import type {KeyboardTypeOptions} from 'react-native';

import * as React from 'react';
import {TextInput} from 'react-native';

// `type` → the RN keyboard/secure-entry configuration. Types RN cannot
// express natively (date, file, range, color) fall back to a text field so
// the surrounding component still renders and stays interactive.
const KEYBOARD_BY_TYPE: {[string]: KeyboardTypeOptions} = {
  email: 'email-address',
  number: 'numeric',
  tel: 'phone-pad',
  url: 'url',
  search: 'web-search',
};

type WebChangeEvent = {target: {value: string, ...}};

export type InputProps = {
  type?: string,
  value?: string,
  defaultValue?: string,
  placeholder?: string,
  disabled?: boolean,
  readOnly?: boolean,
  required?: boolean,
  maxLength?: number,
  autoFocus?: boolean,
  onChange?: (event: WebChangeEvent) => void,
  onInput?: (event: WebChangeEvent) => void,
  onFocus?: () => void,
  onBlur?: () => void,
  style?: {[string]: unknown},
  testID?: string,
  ref?: React.RefSetter<React.ElementRef<typeof TextInput>>,
  // Interaction state, when the caller drives pseudo-class styling.
  __interactionState?: InteractionState,
  // Web attributes Astryx also passes (aria-*, data-*, name, id). They are
  // accepted so the element type-checks, then dropped: TextInput's props are
  // exact, and RN has no equivalent for most of them today. Accessibility
  // mapping is the follow-up.
  [string]: unknown,
};

function Input({
  type = 'text',
  value,
  defaultValue,
  placeholder,
  disabled,
  readOnly,
  maxLength,
  autoFocus,
  onChange,
  onInput,
  onFocus,
  onBlur,
  style,
  testID,
  ref,
  ...rest
}: InputProps): React.Node {
  // The web fires `change`/`input` with the new value on `event.target`;
  // RN hands the string straight to `onChangeText`. Synthesize the shape the
  // Astryx handlers expect rather than making them RN-aware.
  // `rest` is intentionally unused — see the InputProps note above.
  void rest;

  const handleChangeText = React.useCallback(
    (text: string) => {
      const event: WebChangeEvent = {target: {value: text}};
      onInput?.(event);
      onChange?.(event);
    },
    [onChange, onInput],
  );

  // A disabled field is not editable and not focusable; readOnly stays
  // focusable/selectable but rejects edits — the same split as the web.
  const editable = disabled !== true && readOnly !== true;

  // The StyleX runtime produces a plain style object; RN's TextInput style
  // type is exact, so it cannot accept an indexed one directly.
  // $FlowFixMe[unclear-type] see above
  const textInputStyle: any = style;

  return (
    <TextInput
      ref={ref}
      value={value}
      defaultValue={defaultValue}
      placeholder={placeholder}
      editable={editable}
      focusable={disabled !== true}
      maxLength={maxLength}
      autoFocus={autoFocus}
      secureTextEntry={type === 'password'}
      keyboardType={KEYBOARD_BY_TYPE[type] ?? 'default'}
      autoCapitalize={
        type === 'email' || type === 'url' || type === 'password'
          ? 'none'
          : 'sentences'
      }
      autoCorrect={type !== 'email' && type !== 'url' && type !== 'password'}
      onChangeText={handleChangeText}
      onFocus={onFocus}
      onBlur={onBlur}
      style={textInputStyle}
      testID={typeof testID === 'string' ? testID : undefined}
    />
  );
}

Input.displayName = 'input';

export default Input;
