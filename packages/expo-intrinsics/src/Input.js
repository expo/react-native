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

/**
 * `<input>` — the control, plus the part of it that belongs to a form.
 *
 * The element is a component only because of the form. Everything about which
 * control it draws is still decided by the view config's
 * `resolveUIViewClassName` from `type`, and the props pass straight through;
 * what this adds is the three things a form needs and a bare host element
 * cannot give it:
 *
 *  - it **registers** with the nearest form, so `<form>` can ask for its value
 *    at submit time;
 *  - it **remembers** its own value, which is what makes an *uncontrolled*
 *    input submit correctly. An uncontrolled input keeps its value in the
 *    native view and never tells JavaScript, so the form would otherwise have
 *    nothing to read;
 *  - it **submits and resets**, for the types whose whole purpose is to.
 */

/*
 * The types that act on a form rather than carry a value. HTML gives all three
 * a default label, which is why they read as buttons with no children.
 */
const BUTTON_TYPES: {[string]: string} = {
  submit: 'Submit',
  reset: 'Reset',
  button: '',
};

/*
 * Radio groups.
 *
 * `name` is what makes radios mutually exclusive, and until now it was only
 * used for submission — so two uncontrolled radios sharing a name could both
 * be on, and the form would offer two values for a field that permits one.
 * A *controlled* group never showed this, because the app's own state did the
 * excluding; the bug was only ever visible where a browser needs no help.
 *
 * Scoped the way HTML scopes it: radios owned by a form group within that
 * form, and radios outside any form group across the document. The form object
 * itself is the scope key, so two forms can each have a `tier` group without
 * reaching into one another.
 */
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
  /*
   * `beforeinput`, dispatched *synchronously* before the control applies the
   * edit. `event.nativeEvent.preventDefault()` refuses it, and
   * `event.nativeEvent.setValue(text)` substitutes — either way nothing
   * intermediate is ever shown, which is the point.
   *
   * It costs a blocked JavaScript thread per keystroke, so the native side only
   * takes that path when a handler is actually present.
   */
  /*
   * HTML's two text-correction attributes, which are NOT one attribute: the
   * first governs whether mistakes are marked, the second whether they are
   * rewritten as you type (§6.8.5 and §6.8.8). Both are resolved against the
   * element tree before the view sees them — see TextCorrection.js.
   */
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

  /*
   * Bumped to put the native view back to its default.
   *
   * Resetting the remembered value is not enough: an uncontrolled control keeps
   * its text in the native view, which applies `defaultValue` once when it is
   * created and never again — by design, or every prop update would undo the
   * user's typing. So the only way to genuinely reset one is to give React a
   * new key and let the view be recreated. Without this the field would still
   * *show* what was typed while the form believed it had been cleared.
   */
  const [resetToken, setResetToken] = React.useState(0);

  /*
   * An *uncontrolled* checkbox or radio has to be tracked in state, not in the
   * ref, because unlike text its default has to reach the control.
   *
   * A text field is told its `defaultValue` once and then owns the text. A
   * checkbox has no such prop on the native side — the control reads `checked`
   * — so with only the ref, `<input type="checkbox" defaultChecked>` rendered
   * *unchecked* while the form submitted `on`. What the user saw and what was
   * submitted disagreed, which is worse than either being wrong on its own.
   * Holding it in state means the prop follows the control, and the two cannot
   * drift apart.
   */
  const [uncontrolledChecked, setUncontrolledChecked] = React.useState(
    isCheckable ? initial === true : false,
  );

  /*
   * Membership in the radio group, for uncontrolled radios only.
   *
   * A controlled group is the app's business — it already decides which one is
   * on, and reaching in would fight it. An uncontrolled one has no such owner,
   * which is exactly the case a browser handles for free and this did not.
   */
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

  const handleInput = React.useCallback(
    (event: $FlowFixMe) => {
      if (event?.nativeEvent?.value !== undefined) {
        latest.current = event.nativeEvent.value;
      }
      onInput?.(event);
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
   * `<label for>` activation — RADIO ONLY, and deliberately so.
   *
   * HTML says a click on a label acts on its control. We honour that for
   * radios and NOT for checkboxes, because the two have different native
   * situations:
   *
   *  - UIKit has no radio control, so ours is drawn. There is no platform
   *    behaviour to preserve, and HTML's is what a user of a form expects.
   *  - A checkbox is a real `UISwitch`. iOS Settings does not toggle a switch
   *    when its label is tapped — the switch is the only target — and making
   *    ours behave otherwise would make it the odd switch on the system.
   *
   * DOM-CSS-LIMITATION(label-activation-is-radio-only): a documented deviation,
   * not an oversight. Pinned by tests both ways so it cannot drift silently.
   *
   * A radio only ever turns ON from a label tap: HTML radios cannot be
   * unchecked by clicking them, only by another in the group being chosen.
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
  const resolvedSpellCheck = useSpellcheck(spellCheck);
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
