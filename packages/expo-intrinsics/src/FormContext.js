/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import * as React from 'react';

/**
 * How a control finds the form it belongs to.
 *
 * In HTML the association is by containment: a form gathers its values by
 * walking its own subtree and reading each control's `value`. There is no
 * subtree to walk here that holds live values — the values are in native views
 * — so the direction is reversed and each control registers itself with the
 * nearest form.
 *
 * The reversal is what makes *uncontrolled* controls work. An uncontrolled
 * `<input>` keeps its value in the native view and never tells JavaScript about
 * it, so a form could not read it after the fact. Registering a getter means
 * the control answers for itself at submit time, which is the same answer the
 * DOM gives, arrived at from the other side.
 */

export type FormValue = string | Array<string>;

export type FormControl = {
  /*
   * The control's `name`. Unnamed controls are not submitted, as in HTML —
   * that is how a "Cancel" button or a display-only field stays out of the
   * data.
   */
  readonly name: string,
  /*
   * The control's value *now*, asked for at submit time rather than pushed on
   * every keystroke. A checkbox or radio that is not checked returns null and
   * contributes nothing, which is HTML's rule for them.
   */
  readonly getValue: () => FormValue | null,
  /*
   * Puts the control back to the value it was constructed with. `<form>` reset
   * is defined in terms of each control's *default*, not in terms of clearing.
   */
  readonly reset?: () => void,
};

export type FormRegistry = {
  readonly register: (control: FormControl) => () => void,
  /*
   * Submitting and resetting are on the same context as registration because
   * the controls that trigger them — `<input type="submit">`, a `<button>` with
   * no explicit type, Return in a single-line field — find their form the same
   * way every other control does.
   */
  readonly submit: () => void,
  readonly reset: () => void,
};

/*
 * Null outside a form, which is meaningful rather than an error: a control not
 * in a form is perfectly valid HTML and simply is not submitted with one.
 */
const FormContext: React.Context<FormRegistry | null> =
  React.createContext<FormRegistry | null>(null);

export default FormContext;

/**
 * Registers a control with the nearest form for as long as it is mounted.
 *
 * The registration carries a *getter*, and it is deliberately re-registered
 * whenever the getter identity changes, so a control that closes over changing
 * state cannot leave the form holding a stale reader.
 */
export function useFormControl(control: FormControl): void {
  const form = React.useContext(FormContext);
  const latest = React.useRef(control);
  latest.current = control;

  /*
   * Re-registered when the `name` changes, and only then.
   *
   * The value and reset are read through the ref, so the form always calls the
   * *current* getter without this re-running on every render — but the name is
   * data the form holds, so a control renamed after mounting would otherwise be
   * submitted under its old name for the rest of its life.
   */
  React.useEffect(() => {
    if (form == null) {
      return;
    }
    return form.register({
      name: control.name,
      getValue: () => latest.current.getValue(),
      reset: () => latest.current.reset?.(),
    });
  }, [form, control.name]);
}
