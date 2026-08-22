/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {LabelableProps} from './Label';

import {useFormControl} from './FormContext';
import {useControlLabel} from './Label';
import * as React from 'react';

/**
 * `<textarea>` — the control, plus the part of it that belongs to a form.
 *
 * A component for the same narrow reason `<input>` is one: a form needs to be
 * able to ask it for its value, and an *uncontrolled* textarea keeps that value
 * in the native view where JavaScript never sees it. Everything else passes
 * straight through to the control.
 *
 * HTML seeds a textarea from its *children* rather than from a `value`
 * attribute — `<textarea>hello</textarea>` — and that is honoured here, because
 * it is how the element is actually written.
 */

type TextAreaProps = {
  ...LabelableProps,
  children?: React.Node,
  name?: string,
  value?: string,
  defaultValue?: string,
  onInput?: (event: $FlowFixMe) => unknown,
  ...
};

function TextArea(props: TextAreaProps): React.Node {
  // See Input.js: pulled out so the spread is provably free of a `key`.
  const {children, name = '', onInput, ...rest} = props;
  // See Input.js: a control's accessible name comes from its <label>.
  const accessibilityLabel = useControlLabel(
    props.accessibilityLabel,
    props.id,
  );

  // The children are the initial text, as in HTML. Only strings count: a
  // nested element in a textarea has no meaning to a text control.
  const childText = React.useMemo(
    () =>
      React.Children.toArray<$FlowFixMe>(children)
        .filter(node => typeof node === 'string' || typeof node === 'number')
        .join(''),
    [children],
  );

  const initial = props.defaultValue ?? props.value ?? childText;
  const latest = React.useRef<string>(initial);
  // Recreates the native view so a reset is visible, not just remembered — see
  // Input.js for why a control cannot simply be told its default again.
  const [resetToken, setResetToken] = React.useState(0);
  if (props.value != null) {
    latest.current = props.value;
  }

  const isControlled = props.value != null;

  useFormControl({
    name,
    getValue: () => latest.current,
    reset: () => {
      if (isControlled) {
        return;
      }
      latest.current = initial;
      setResetToken(token => token + 1);
    },
  });

  const handleInput = React.useCallback(
    (event: $FlowFixMe) => {
      if (event?.nativeEvent?.value !== undefined) {
        latest.current = event.nativeEvent.value;
      }
      onInput?.(event);
    },
    [onInput],
  );

  const {defaultValue, ...forwarded} = rest;

  return (
    /* See Input.js: the key is on a fragment so a reset still recreates the
       native view without placing a `key` beside a props spread. */
    <React.Fragment key={resetToken}>
      {/* $FlowFixMe[prop-missing] intrinsic */}
      <element-textarea
        {...forwarded}
        accessibilityLabel={accessibilityLabel}
        nodeName="textarea"
        name={name}
        // The children stand in for `defaultValue` when one is not given, which
        // is the shape HTML uses and the only way the element is usually written.
        defaultValue={
          defaultValue ?? (childText !== '' ? childText : undefined)
        }
        onInput={handleInput}
      />
    </React.Fragment>
  );
}

export default TextArea;
