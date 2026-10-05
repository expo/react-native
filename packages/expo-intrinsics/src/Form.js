/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {FormControl, FormRegistry} from './FormContext';
import type {AutocorrectValue} from './TextCorrection';

import FormContext from './FormContext';
import {SpellcheckScope} from './TextCorrection';
import * as React from 'react';

// `<form>` renders a plain block box and adds the registry its controls join
// and the act of submitting

/*
 * A string `action` is announced to the nearest `FormSubmitContext` provider;
 * with none, nothing happens. On the web a submission navigates and the
 * response replaces the document, which this package cannot do and must not
 * approximate with a `fetch` whose response is dropped. Handling belongs to
 * whoever owns navigation, which is the router. Context rather than a global
 * registration so it can be scoped and nested; it stands in for a cancelable
 * `submit` event bubbling to the root.
 */
export type FormEncoding =
  'application/x-www-form-urlencoded' | 'multipart/form-data' | 'text/plain';

export type FormSubmission = {
  readonly action: string,
  readonly method: 'get' | 'post',
  readonly enctype: FormEncoding,
  /*
   * The entries, for a handler that would rather work with them directly.
   */
  readonly formData: FormData,
  /*
   * The action with the fields appended as a query string — what a GET
   * submission navigates to. Built for every submission because the spec
   * serialises a GET the same way whatever the `enctype` says.
   */
  readonly url: string,
  /*
   * The body a POST would send, already encoded to match `enctype`, and null
   * for a GET. Provided so the handler does not have to re-derive it and,
   * more importantly, cannot get the default wrong: a classic form posts
   * `application/x-www-form-urlencoded`, not multipart.
   */
  readonly body: URLSearchParams | FormData | string | null,
};

/**
 * Provided by whoever owns navigation — Expo Router, or an app that wants to
 * handle its own submissions. A form with a string `action` announces to the
 * nearest provider; with no provider, nothing happens.
 */
export const FormSubmitContext: React.Context<?(
  submission: FormSubmission,
) => unknown> =
  React.createContext<?(submission: FormSubmission) => unknown>(null);

// The three encodings HTML defines. `application/x-www-form-urlencoded` is the
// missing-value and invalid-value default, whereas a `FormData` handed to
// `fetch` sends multipart
export function encodeBody(
  formData: FormData,
  enctype: FormEncoding,
): URLSearchParams | FormData | string {
  if (enctype === 'multipart/form-data') {
    // Returned as-is: this is the one case where `FormData` is the encoding,
    // and the boundary is the sender's to choose.
    return formData;
  }
  if (enctype === 'text/plain') {
    // The spec's plain-text format: `name=value` pairs separated by CRLF, with
    // no escaping at all — which is why it is only for human-readable payloads.
    let text = '';
    // $FlowFixMe[incompatible-type] FormData is iterable at runtime.
    for (const [name, value] of formData.entries()) {
      text += `${name}=${String(value)}\r\n`;
    }
    return text;
  }
  const params = new URLSearchParams();
  // $FlowFixMe[incompatible-type] FormData is iterable at runtime.
  for (const [name, value] of formData.entries()) {
    // A file in an urlencoded form submits its *name*, not its bytes — the
    // spec's rule, and the reason file inputs require multipart.
    params.append(
      name,
      typeof value === 'string' ? value : (value?.name ?? ''),
    );
  }
  return params;
}

/*
 * The action with the entries as its query string. A GET submission replaces
 * the action's query wholesale rather than adding to it, which is the spec's
 * "mutate action URL" step and surprises people who expect their existing
 * `?foo=1` to survive.
 */
export function urlWithQuery(action: string, formData: FormData): string {
  const params = encodeBody(formData, 'application/x-www-form-urlencoded');
  const query = params.toString();
  const [base] = action.split('?');
  return query === '' ? base : `${base}?${query}`;
}

// HTML submits controls in tree order, and registration order is mount order
export function buildFormData(controls: ReadonlyArray<FormControl>): FormData {
  const formData = new FormData();
  for (const control of controls) {
    if (control.name === '') {
      // An unnamed control is not submitted, as in HTML.
      continue;
    }
    const value = control.getValue();
    if (value == null) {
      // A checkbox or radio that is not checked contributes nothing at all —
      // not an empty string. Form handlers distinguish the two.
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        formData.append(control.name, entry);
      }
    } else {
      formData.append(control.name, value);
    }
  }
  return formData;
}

type FormProps = {
  children?: React.Node,
  /*
   * HTML's two text-correction attributes, which are NOT one attribute: the
   * first governs whether mistakes are marked, the second whether they are
   * rewritten as you type (§6.8.5 and §6.8.8). Both are resolved against the
   * element tree before the view sees them — see TextCorrection.js.
   */
  spellCheck?: boolean,
  autoCorrect?: AutocorrectValue,
  /*
   * A function — React 19's form action, called with the `FormData` — or a URL
   * string, submitted through the handler above. The function form is the one
   * that behaves identically on every platform.
   */
  action?: string | ((formData: FormData) => unknown),
  method?: string,
  /*
   * HTML's `enctype`. Defaults to `application/x-www-form-urlencoded`; a form
   * with a file input needs `multipart/form-data`, as on the web.
   */
  enctype?: string,
  // The resolved submission, so `preventDefault` is an informed choice
  onSubmit?: (event: {
    formData: FormData,
    method: 'get' | 'post',
    enctype: FormEncoding,
    action: string,
    url: string,
    body: URLSearchParams | FormData | string | null,
    preventDefault: () => void,
  }) => unknown,
  onReset?: () => unknown,
  ...
};

function Form({
  children,
  action,
  method,
  enctype,
  onSubmit,
  onReset,
  autoCorrect,
  spellCheck,
  ...rest
}: FormProps): React.Node {
  // A ref, not state: registering a control must not re-render the form, and
  // the set is only read at submit time.
  const controlsRef = React.useRef<Array<FormControl>>([]);

  // Whoever owns navigation, if anyone does.
  const onSubmission = React.useContext(FormSubmitContext);

  const register = React.useMemo(
    () => (control: FormControl) => {
      controlsRef.current.push(control);
      return () => {
        const index = controlsRef.current.indexOf(control);
        if (index >= 0) {
          controlsRef.current.splice(index, 1);
        }
      };
    },
    [],
  );

  /*
   * Putting every control back to the value it was born with. A control that is
   * *controlled* reports its own reset as a no-op, because its value belongs to
   * the author rather than to the form.
   */
  const resetUncontrolled = React.useCallback(() => {
    for (const control of controlsRef.current) {
      control.reset?.();
    }
  }, []);

  const submit = React.useCallback(() => {
    const formData = buildFormData(controlsRef.current);

    // Resolved before the handler runs, so it is told what would happen.
    // HTML's defaults: GET, and urlencoded for a missing or unrecognised
    // `enctype`
    const resolvedMethod: 'get' | 'post' =
      method?.toLowerCase() === 'post' ? 'post' : 'get';
    const requested = enctype?.toLowerCase();
    const resolvedEnctype: FormEncoding =
      requested === 'multipart/form-data' || requested === 'text/plain'
        ? requested
        : 'application/x-www-form-urlencoded';
    const resolvedAction = typeof action === 'string' ? action : '';
    const url = urlWithQuery(resolvedAction, formData);
    // A GET carries nothing in its body; its fields are in the URL above.
    const body =
      resolvedMethod === 'post' ? encodeBody(formData, resolvedEnctype) : null;

    // `onSubmit` runs first and may cancel, which is the DOM's order: the
    // handler sees the event before the default action happens.
    let defaultPrevented = false;
    if (onSubmit != null) {
      onSubmit({
        formData,
        method: resolvedMethod,
        enctype: resolvedEnctype,
        action: resolvedAction,
        url,
        body,
        preventDefault: () => {
          defaultPrevented = true;
        },
      });
    }
    if (defaultPrevented) {
      return;
    }

    if (typeof action === 'function') {
      let result: unknown;
      try {
        result = action(formData);
      } catch (error) {
        // An error boundary covers rendering, not an event, so a synchronous
        // throw would kill the surface; a browser reports an exception in a
        // submit handler and keeps going. The fields are not reset, as on the
        // rejection path
        console.error(
          '[form] The action passed to <form> threw. The form was left ' +
            'untouched and the app is still running; a browser reports an ' +
            'error thrown in a submit handler the same way.',
          error,
        );
        return;
      }
      // React 19: "after the action function succeeds, all uncontrolled field
      // elements in the form are reset". Only on success, so the fields
      // survive a failed submission; controlled fields are the author's
      if (
        result != null &&
        typeof result === 'object' &&
        typeof result.then === 'function'
      ) {
        // $FlowFixMe[incompatible-use] a thenable, narrowed above.
        result.then(resetUncontrolled, () => {});
      } else {
        resetUncontrolled();
      }
      return;
    }
    if (typeof action === 'string' && action !== '') {
      // Reuses exactly what the handler was shown, so the two cannot disagree.
      const submission: FormSubmission = {
        action,
        method: resolvedMethod,
        enctype: resolvedEnctype,
        formData,
        url,
        body,
      };
      // Announced to whoever is listening. With nobody listening the default
      // action is nothing at all: no navigation, and deliberately no request.
      onSubmission?.(submission);
    }
    // A form with no action and no handler submits to nothing, which is what a
    // browser does with `<form>` on a page it cannot reload: nothing happens.
  }, [action, method, enctype, onSubmit, onSubmission, resetUncontrolled]);

  const reset = React.useCallback(() => {
    resetUncontrolled();
    onReset?.();
  }, [onReset, resetUncontrolled]);

  const value: FormRegistry = React.useMemo(
    // `autocorrect` rides on the registry because a control reads it from its
    // FORM OWNER rather than from its nearest ancestor — see TextCorrection.js.
    () => ({register, submit, reset, autocorrect: autoCorrect ?? null}),
    [register, submit, reset, autoCorrect],
  );

  return (
    <FormContext.Provider value={value}>
      {/* The box `<form>` used to be. Its block display comes from the
          user-agent style on `element-form`, so layout is unchanged; `nodeName`
          is stated here because the host is registered under its own name.
        $FlowFixMe[prop-missing] intrinsic */}
      <element-form {...rest} nodeName="form">
        {/* `spellcheck` DOES inherit down the tree, so a form that states one
            governs the fields inside it the same way any ancestor would. */}
        <SpellcheckScope value={spellCheck}>{children}</SpellcheckScope>
      </element-form>
    </FormContext.Provider>
  );
}

export default Form;
