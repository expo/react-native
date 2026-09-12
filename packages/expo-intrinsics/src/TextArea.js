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
import type {AutocorrectValue} from './TextCorrection';

import {useControlHandle} from './controlHandle';
import {useFormControl} from './FormContext';
import {useControlLabel} from './Label';
import {useAutocorrect, useSpellcheck} from './TextCorrection';
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
  /*
   * HTML's two text-correction attributes, which are NOT one attribute: the
   * first governs whether mistakes are marked, the second whether they are
   * rewritten as you type (§6.8.5 and §6.8.8). Both are resolved against the
   * element tree before the view sees them — see TextCorrection.js.
   */
  spellCheck?: boolean,
  autoCorrect?: AutocorrectValue,
  ...LabelableProps,
  /*
   * Declared, because this component destructures it: React 19 passes `ref` as
   * an ordinary prop, and a props type that omits it makes both the destructure
   * and the spread of everything else unsound.
   */
  ref?: React.RefSetter<$FlowFixMe>,
  children?: React.Node,
  name?: string,
  value?: string,
  defaultValue?: string,
  onInput?: (event: $FlowFixMe) => unknown,
  ...
};

function TextArea(props: TextAreaProps): React.Node {
  // See Input.js: pulled out so the spread is provably free of a `key`.
  // `ref` is pulled out so the spread below cannot carry it: React 19 makes it
  // an ordinary prop, and leaving it in would overwrite the ref this component
  // attaches with the caller's own.
  const {children, name = '', onInput, ref, ...rest} = props;
  const hostRef = React.useRef<$FlowFixMe>(null);
  useControlHandle(ref, hostRef);
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

  /*
   * The edit count, without which a controlled `<textarea>` can never be
   * written to again.
   *
   * The native side only accepts a `value` from props while
   * `mostRecentEventCount >= nativeEventCount` — the staleness rule that stops
   * a value computed before the keystrokes still in flight from rewinding the
   * field under the user's fingers. `<input>` has always carried the count;
   * this did not, so it sat at 0 while the native count climbed with every
   * keystroke, and the test was false forever after the first character.
   *
   * The visible symptom is as basic as it gets: a composer that will not clear
   * when its `value` is set to `''` after sending. Everything about the
   * component looked right — the state changed, React re-rendered, the prop
   * arrived — and the native view discarded it as stale.
   */
  const [mostRecentEventCount, setMostRecentEventCount] = React.useState(0);

  const handleInput = React.useCallback(
    (event: $FlowFixMe) => {
      if (event?.nativeEvent?.value !== undefined) {
        latest.current = event.nativeEvent.value;
      }
      onInput?.(event);
      // After the author's handler, as React Native's own TextInput does: the
      // handler may set the state whose value this then carries down.
      const count = event?.nativeEvent?.eventCount;
      if (typeof count === 'number') {
        setMostRecentEventCount(count);
      }
    },
    [onInput],
  );

  // Resolved against the tree rather than forwarded — see TextCorrection.js.
  // A textarea has no `type`, so nothing forbids it autocorrection outright.
  const {defaultValue, spellCheck, autoCorrect, ...forwarded} = rest;
  const resolvedSpellCheck = useSpellcheck(spellCheck, 'textarea');
  const resolvedAutoCorrect = useAutocorrect(autoCorrect, 'textarea');

  return (
    /* See Input.js: the key is on a fragment so a reset still recreates the
       native view without placing a `key` beside a props spread. */
    <React.Fragment key={resetToken}>
      {/* $FlowFixMe[prop-missing] intrinsic */}
      {/* $FlowFixMe[cannot-spread-inexact] `ref` is destructured out above, so
          the spread cannot carry one; the props type is inexact by design, so
          Flow cannot prove it. */}
      <element-textarea
        // The spread FIRST and our ref after it, as in Input.js. If one ever did
        // come through, this order is the difference between our ref winning and
        // being silently replaced — which is how the ref went missing before.
        {...forwarded}
        ref={hostRef}
        accessibilityLabel={accessibilityLabel}
        nodeName="textarea"
        name={name}
        // The children stand in for `defaultValue` when one is not given, which
        // is the shape HTML uses and the only way the element is usually written.
        defaultValue={
          defaultValue ?? (childText !== '' ? childText : undefined)
        }
        spellCheck={resolvedSpellCheck}
        autoCorrect={resolvedAutoCorrect}
        mostRecentEventCount={mostRecentEventCount}
        onInput={handleInput}
      />
    </React.Fragment>
  );
}

export default TextArea;
