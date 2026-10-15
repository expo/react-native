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

import * as React from 'react';

/**
 * The ref an `<input>` or `<textarea>` hands its author: React Native's
 * `TextInput` instance, given the web field's `value`, `setSelectionRange` and
 * `select`. The vendored sources call them to place the caret, as Astryx's
 * Selector and Typeahead do when they focus their search field
 * (`input.setSelectionRange(input.value.length, input.value.length)`).
 *
 * `value` reads the text the field last showed: the controlled value, else
 * what was typed, else the default value.
 *
 * DOM-CSS-LIMITATION(field-value-write-is-not-shown): writing `value` changes
 * what `value` reads, not the text the field shows; React Native's
 * `TextInput` takes its text from its props.
 */
export default function useFieldInstance<T>(
  ref: ?React.RefSetter<T>,
  value: ?string,
  defaultValue: ?string,
): {
  ref: React.RefSetter<T>,
  onText: (text: string) => void,
} {
  const textRef = React.useRef<string>(value ?? defaultValue ?? '');
  if (value != null) {
    textRef.current = value;
  }
  const authorRef = React.useRef(ref);
  authorRef.current = ref;
  // One callback for the life of the field, which hands the instance on to
  // whichever ref the author passes now
  const fieldRef = React.useCallback((instance: T | null) => {
    if (instance != null) {
      defineFieldInterface(instance, textRef);
    }
    const author = authorRef.current;
    if (typeof author === 'function') {
      author(instance);
    } else if (author != null) {
      author.current = instance;
    }
  }, []);
  const onText = React.useCallback((text: string) => {
    textRef.current = text;
  }, []);
  return {ref: fieldRef, onText};
}

function defineFieldInterface(
  instance: unknown,
  textRef: {current: string},
): void {
  // $FlowFixMe[unclear-type] the instance is extended by name
  const field: any = instance;
  Object.defineProperty(field, 'value', {
    get(): string {
      return textRef.current;
    },
    set(text: unknown): void {
      textRef.current = String(text ?? '');
    },
    configurable: true,
  });
  Object.defineProperty(field, 'setSelectionRange', {
    value(start: number, end: number): void {
      field.setSelection?.(start, end);
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(field, 'select', {
    value(): void {
      field.setSelection?.(0, textRef.current.length);
    },
    configurable: true,
    writable: true,
  });
}
