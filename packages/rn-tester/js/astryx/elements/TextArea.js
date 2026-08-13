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
 * The `<textarea>` element, backed by React Native's multiline `TextInput`.
 *
 * A behavioural element rather than a view-config alias, for the same reason
 * `<input>` is: the web's `value`/`onChange`/`rows`/`readOnly` vocabulary has
 * to be translated onto RN's, so vendored Astryx sources can go on rendering a
 * plain `<textarea>` unmodified.
 *
 * The differences from `<input>` are small but real: it is always multiline,
 * `rows` sets the visible height, and Return inserts a newline instead of
 * submitting.
 */

import type {InteractionState} from '../stylex-rn';

import * as React from 'react';
import {useCallback} from 'react';
import {TextInput} from 'react-native';

type WebChangeEvent = {target: {value: string}};

type Props = {
  value?: ?string,
  defaultValue?: ?string,
  placeholder?: ?string,
  disabled?: ?boolean,
  readOnly?: ?boolean,
  // The web sizes a textarea in LINES, not points.
  rows?: ?number,
  maxLength?: ?number,
  onChange?: ?(event: WebChangeEvent) => void,
  onInput?: ?(event: WebChangeEvent) => void,
  onFocus?: ?() => void,
  onBlur?: ?() => void,
  style?: unknown,
  state?: ?InteractionState,
  children?: React.Node,
};

// A line of text at the default font size, for turning `rows` into a height.
// The web computes this from the element's own line-height; this is the same
// arithmetic the UA stylesheet uses elsewhere in this project (16px root).
const APPROX_LINE_HEIGHT = 20;

export default function TextArea({
  value,
  defaultValue,
  placeholder,
  disabled,
  readOnly,
  rows,
  maxLength,
  onChange,
  onInput,
  onFocus,
  onBlur,
  style,
  // `children` is a textarea's initial value on the web. Accepted so it is not
  // forwarded to TextInput as renderable content, which would draw it as a
  // second, overlapping line of text.
  children,
}: Props): React.Node {
  // The web fires `change`/`input` with the new value on `event.target`; RN
  // hands the string straight to `onChangeText`. Synthesized to the shape the
  // vendored sources expect, exactly as `<input>` does.
  const handleChangeText = useCallback(
    (text: string) => {
      const event: WebChangeEvent = {target: {value: text}};
      onInput?.(event);
      onChange?.(event);
    },
    [onChange, onInput],
  );

  // Disabled is neither editable nor focusable; readOnly stays focusable and
  // selectable, which is the distinction the web draws.
  const editable = disabled !== true && readOnly !== true;

  const initialValue =
    defaultValue ?? (typeof children === 'string' ? children : undefined);

  // The StyleX runtime produces a plain style object; TextInput's style type
  // is stricter than what CSS resolution can be typed as.
  const textInputStyle: any = style;
  const rowsHeight =
    rows != null && rows > 0 ? rows * APPROX_LINE_HEIGHT : null;

  return (
    <TextInput
      multiline={true}
      // Without this the field is vertically centred on Android, so a
      // multi-line box starts its text in the middle of itself.
      textAlignVertical="top"
      value={value ?? undefined}
      defaultValue={initialValue}
      placeholder={placeholder ?? undefined}
      editable={editable}
      maxLength={maxLength ?? undefined}
      onChangeText={handleChangeText}
      onFocus={onFocus}
      onBlur={onBlur}
      style={
        rowsHeight != null
          ? [textInputStyle, {height: rowsHeight}]
          : textInputStyle
      }
    />
  );
}
