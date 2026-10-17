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
 * Unlike the pure containers, `<input>` needs *behavioral* translation: the web's
 * `value`/`onChange`/`disabled`/`readOnly` vocabulary onto RN's
 * `value`/`onChangeText`/`editable` one, and `type` onto the keyboard and
 * secure-entry flags. So it is a composite component, which the element
 * runtime renders for `<input>` (see ../native-css/EngineElement.js), keeping
 * vendored Astryx sources rendering plain `<input>` unmodified.
 *
 * This module is the one place that changes if a different field backs it.
 */

import type {KeyboardTypeOptions} from 'react-native';

import {engineInputProps} from '../native-css/engine';
import useFieldInstance from './fieldInstance';
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
  testID?: string,
  ref?: React.RefSetter<React.ElementRef<typeof TextInput>>,
  // Web attributes Astryx also passes (aria-*, data-*, name, id). They are
  // accepted so the element type-checks, then dropped: TextInput's props are
  // exact, and RN has no equivalent for most of them.
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
  testID,
  ref,
  ...rest
}: InputProps): React.Node {
  // The web fires `change`/`input` with the new value on `event.target`;
  // RN hands the string straight to `onChangeText`. Synthesize the shape the
  // Astryx handlers expect rather than making them RN-aware.
  // `rest` is dropped (see the InputProps note above) but for what the
  // renderer's style engine reads, which the field's host carries
  const engineInputs = engineInputProps(rest);

  const field = useFieldInstance(ref, value, defaultValue);
  const onText = field.onText;
  const handleChangeText = React.useCallback(
    (text: string) => {
      onText(text);
      const event: WebChangeEvent = {target: {value: text}};
      onInput?.(event);
      onChange?.(event);
    },
    [onChange, onInput, onText],
  );

  // A disabled field is not editable and not focusable; readOnly stays
  // focusable/selectable but rejects edits — the same split as the web.
  const editable = disabled !== true && readOnly !== true;

  return (
    <TextInput
      ref={field.ref}
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
      testID={typeof testID === 'string' ? testID : undefined}
      {...(engineInputs as $FlowFixMe)}
    />
  );
}

Input.displayName = 'input';

export default Input;
