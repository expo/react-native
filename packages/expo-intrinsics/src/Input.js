/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {FormValue} from './FormContext';
import type {LabelableProps} from './Label';
import type {AutocorrectValue} from './TextCorrection';

import {authorStatesSurface, buttonProminence} from './Button';
import FormContext, {useFormControl} from './FormContext';
import {useControlLabel, useLabelActivation} from './Label';
import {useAutocorrect, useSpellcheck} from './TextCorrection';
import * as React from 'react';

// Which control `<input>` draws is `resolveUIViewClassName`'s decision from
// `type`; the component adds what a form needs: registration with the nearest
// form, the remembered value an uncontrolled input keeps in the native view,
// and submit and reset for the button types

/*
 * The types that act on a form rather than carry a value. HTML gives all three
 * a default label, which is why they read as buttons with no children.
 */
const BUTTON_TYPES: {[string]: string} = {
  submit: 'Submit',
  reset: 'Reset',
  button: '',
};

// Radio groups, scoped as HTML scopes them: within the owning form, or across
// the document outside any form
type RadioEntry = {off: () => void};
const radioGroups: Map<unknown, Map<string, Set<RadioEntry>>> = new Map();
const DOCUMENT_SCOPE: unknown = {};

function radioGroupFor(scope: unknown, name: string): Set<RadioEntry> {
  let byName = radioGroups.get(scope);
  if (byName == null) {
    byName = new Map();
    radioGroups.set(scope, byName);
  }
  let group = byName.get(name);
  if (group == null) {
    group = new Set();
    byName.set(name, group);
  }
  return group;
}

/**
 * Turn off every *other* uncontrolled radio in this group.
 *
 * Only the others: a radio cannot be unchecked by choosing it, which is HTML's
 * rule and the reason this takes the entry to skip rather than clearing all of
 * them and re-setting one.
 */
function deselectGroupSiblings(
  scope: unknown,
  name: ?string,
  self: RadioEntry,
): void {
  if (name == null || name === '') {
    return;
  }
  const group = radioGroups.get(scope)?.get(name);
  if (group == null) {
    return;
  }
  for (const entry of group) {
    if (entry !== self) {
      entry.off();
    }
  }
}

type InputProps = {
  ...LabelableProps,
  type?: string,
  name?: string,
  value?: string,
  defaultValue?: string,
  checked?: boolean,
  defaultChecked?: boolean,
  disabled?: boolean,
  onInput?: (event: $FlowFixMe) => unknown,
  // Dispatched synchronously before the control applies the edit:
  // `nativeEvent.preventDefault()` refuses it, `nativeEvent.setValue(text)`
  // substitutes. It blocks the JavaScript thread per keystroke, so the native
  // side takes that path only when a handler is present
  // HTML §6.8.5 and §6.8.8: marking mistakes and rewriting them are separate
  // attributes, resolved against the element tree in TextCorrection.js
  spellCheck?: boolean,
  autoCorrect?: AutocorrectValue,
  onBeforeInput?: (event: $FlowFixMe) => unknown,
  onChange?: (event: $FlowFixMe) => unknown,
  onClick?: (event: $FlowFixMe) => unknown,
  children?: React.Node,
  ...
};

function Input(props: InputProps): React.Node {
  // `key` is pulled out only so Flow knows the spread below cannot carry one;
  // React never puts it in props, so this is a no-op at runtime.
  const {
    type = 'text',
    name = '',
    onInput,
    onChange,
    onClick,
    onBeforeInput,
    children,
    // Pulled out because neither reaches the view as written: each is resolved
    // against the tree first, by its own algorithm. See TextCorrection.js.
    spellCheck,
    autoCorrect,
    ...rest
  } = props;
  /*
   * The accessible name, from a `<label>` — by `for`/`id`, or by wrapping. A
   * control with no name announces only its role and state ("switch, off"),
   * which is the most common accessibility failure in a form and the one a
   * screenshot cannot show.
   */
  const accessibilityLabel = useControlLabel(
    props.accessibilityLabel,
    props.id,
  );
  const form = React.useContext(FormContext);

  const isCheckable = type === 'checkbox' || type === 'radio';
  const isRadio = type === 'radio';
  const isButton = BUTTON_TYPES[type] != null;

  /*
   * The value as the control last reported it, kept so an uncontrolled input
   * can answer for itself. Seeded from `defaultValue`/`defaultChecked` so a
   * form submitted without any interaction still carries what the element was
   * born with — which is what a browser sends.
   */
  const initial = isCheckable
    ? props.defaultChecked === true || props.checked === true
    : (props.defaultValue ?? props.value ?? '');
  const latest = React.useRef<string | boolean>(initial);

  // Bumped to recreate the native view on reset: an uncontrolled control keeps
  // its text in the view, which applies `defaultValue` once
  const [resetToken, setResetToken] = React.useState(0);

  // An uncontrolled checkable is tracked in state rather than the ref: the
  // native control reads `checked` and has no `defaultChecked`, so the prop
  // has to follow the control
  const [uncontrolledChecked, setUncontrolledChecked] = React.useState(
    isCheckable ? initial === true : false,
  );

  // Uncontrolled radios only; a controlled group's exclusion is the app's
  const isControlledCheckable = isCheckable && props.checked != null;
  const radioScope = form ?? DOCUMENT_SCOPE;
  const radioEntry = React.useRef<RadioEntry>({off: () => {}});
  radioEntry.current.off = () => setUncontrolledChecked(false);

  React.useEffect(() => {
    if (!isRadio || isControlledCheckable || name === '') {
      return;
    }
    const group = radioGroupFor(radioScope, name);
    const entry = radioEntry.current;
    group.add(entry);
    return () => {
      group.delete(entry);
    };
  }, [isRadio, isControlledCheckable, name, radioScope]);

  // A controlled input's prop is the truth whenever it is given one.
  if (isCheckable && props.checked != null) {
    latest.current = props.checked;
  } else if (!isCheckable && props.value != null) {
    latest.current = props.value;
  } else if (isCheckable) {
    latest.current = uncontrolledChecked;
  }

  const getValue = React.useCallback((): FormValue | null => {
    if (isCheckable) {
      // An unchecked box or radio contributes nothing at all — not an empty
      // string. HTML's rule, and form handlers depend on it.
      if (latest.current !== true) {
        return null;
      }
      // A checked box with no `value` submits "on", which is the strangest
      // corner of HTML forms and the one everybody's server expects.
      return typeof props.value === 'string' ? props.value : 'on';
    }
    return String(latest.current ?? '');
  }, [isCheckable, props.value]);

  const isControlled = isCheckable
    ? props.checked != null
    : props.value != null;

  const reset = React.useCallback(() => {
    // A controlled control's value is the author's; the form does not touch it.
    if (isControlled) {
      return;
    }
    latest.current = initial;
    if (isCheckable) {
      setUncontrolledChecked(initial === true);
    }
    setResetToken(token => token + 1);
  }, [initial, isCheckable, isControlled]);

  // Buttons are not submitted. A submit button *is* submitted in HTML when it
  // has a name, so that a server can tell which one was pressed — kept simple
  // here by leaving them all out, which is what a form with one submit button
  // (the overwhelming case) would produce anyway.
  useFormControl({name: isButton ? '' : name, getValue, reset});

  /*
   * The echo half of the controlled-input handshake: the view refuses to write an
   * incoming `value` while its own edit count is ahead of this one, so the count
   * has to come back or every controlled write is skipped. State rather than a
   * ref, because a handler that clamps (`slice(0, 10)`) sets the same string once
   * the cap is hit and `useState` bails out; the count rises on every edit and so
   * carries the author's unchanged `value` back down.
   */
  const [mostRecentEventCount, setMostRecentEventCount] = React.useState(0);

  const handleInput = React.useCallback(
    (event: $FlowFixMe) => {
      if (event?.nativeEvent?.value !== undefined) {
        latest.current = event.nativeEvent.value;
      }
      onInput?.(event);
      // After the author's handler, which may set the state this carries down
      const count = event?.nativeEvent?.eventCount;
      if (typeof count === 'number') {
        setMostRecentEventCount(count);
      }
    },
    [onInput],
  );

  const handleChange = React.useCallback(
    (event: $FlowFixMe) => {
      const next = event?.nativeEvent;
      if (next?.checked !== undefined) {
        latest.current = next.checked;
        // Keeps the prop the control is given in step with the control itself.
        setUncontrolledChecked(next.checked === true);
        // Choosing a radio is what turns the rest of its group off.
        if (isRadio && next.checked === true) {
          deselectGroupSiblings(radioScope, name, radioEntry.current);
        }
      } else if (next?.value !== undefined) {
        latest.current = next.value;
      }
      onChange?.(event);
    },
    [onChange, isRadio, radioScope, name],
  );

  /*
   * DOM-CSS-LIMITATION(label-activation-is-radio-only): a label tap acts on a
   * radio, which UIKit does not provide and we draw, and not on a checkbox,
   * which is a `UISwitch` that iOS Settings does not toggle from its label.
   * A radio only turns on from a label tap, as HTML radios cannot be unchecked
   * by clicking them.
   */
  useLabelActivation(
    type === 'radio' && props.disabled !== true ? props.id : null,
    React.useCallback(() => {
      latest.current = true;
      setUncontrolledChecked(true);
      deselectGroupSiblings(radioScope, name, radioEntry.current);
      // Shaped like the native change event so a controlled radio's handler
      // cannot tell a label tap from a tap on the control itself.
      onChange?.({nativeEvent: {checked: true}});
    }, [onChange, radioScope, name]),
  );

  const handleClick = React.useCallback(
    (event: $FlowFixMe) => {
      onClick?.(event);
      // The form action happens after the author's handler, which is the DOM's
      // order and what lets `preventDefault` on the click stop the submission.
      if (event?.defaultPrevented === true) {
        return;
      }
      if (type === 'submit') {
        form?.submit();
      } else if (type === 'reset') {
        form?.reset();
      }
    },
    [form, onClick, type],
  );

  /*
   * The two text-correction attributes, each resolved by its own rule: the
   * element's own value, then what it inherits, then the default. `type` is
   * passed to the autocorrect resolution because HTML forbids autocorrection
   * outright on url, email and password fields.
   */
  const resolvedSpellCheck = useSpellcheck(spellCheck, type);
  const resolvedAutoCorrect = useAutocorrect(autoCorrect, type);

  // `<input type="submit">` has no children in HTML; its label is the `value`
  // attribute, defaulting to "Submit". Rendered as the button's text, because
  // the control it resolves to is the same box `<button>` uses.
  const buttonLabel = isButton
    ? typeof props.value === 'string'
      ? props.value
      : BUTTON_TYPES[type]
    : null;

  return (
    /* The key rides on a fragment rather than on the element itself.
       Remounting the fragment remounts what it contains, so the native view is
       still recreated on reset — without putting a `key` beside a props spread,
       which Flow cannot prove is free of one. */
    <React.Fragment key={resetToken}>
      {/* $FlowFixMe[prop-missing] intrinsic */}
      <element-input
        {...rest}
        accessibilityLabel={accessibilityLabel}
        nodeName="input"
        type={type}
        // The same prominence rule as <button>, from the same place: a submit
        // input is the form's primary action, everything else is neutral.
        buttonStyle={
          isButton ? buttonProminence(type, form != null) : undefined
        }
        hasAuthorChrome={
          isButton
            ? authorStatesSurface((props as $FlowFixMe).style)
            : undefined
        }
        name={name}
        // An uncontrolled checkbox is given its own tracked state, so the
        // control shows what the element was born with and stays in step with
        // what it is now. A controlled one is the author's prop, untouched.
        checked={
          isCheckable ? (props.checked ?? uncontrolledChecked) : props.checked
        }
        spellCheck={resolvedSpellCheck}
        autoCorrect={resolvedAutoCorrect}
        mostRecentEventCount={mostRecentEventCount}
        hasBeforeInput={onBeforeInput != null}
        onBeforeInput={onBeforeInput}
        onInput={handleInput}
        onChange={handleChange}
        onClick={handleClick}>
        {buttonLabel != null && buttonLabel !== '' ? buttonLabel : children}
      </element-input>
    </React.Fragment>
  );
}

export default Input;
