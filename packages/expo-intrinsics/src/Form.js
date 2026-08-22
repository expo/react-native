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

import FormContext from './FormContext';
import * as React from 'react';

/**
 * `<form>` — the element that turns a group of controls into a submission.
 *
 * A component rather than a box, for the same reason `<select>` is one: what it
 * does is not layout. It still renders a plain block box, so `<form>` lays out
 * exactly as it did before; what it adds is the registry its controls join and
 * the act of submitting.
 */

/*
 * Where a string `action` goes — and what happens when nothing is listening.
 *
 * On the web, submitting to a URL *navigates*: GET puts the fields in the query
 * string, POST sends a body, and in both cases the response replaces the
 * current document. That is why POST-redirect-GET exists.
 *
 * Neither of those is something this package can do, and — the part that took a
 * wrong turn first — neither is something it should *approximate*. Firing a
 * `fetch` and dropping the response is not "the default action minus the
 * navigation": it sends the user's data with no result, no error surfaced, and
 * nothing to stop it happening twice.
 *
 * So the default action is **nothing**. The submission is announced, and if no
 * one handles it, no navigation happens and no request is made. That is not a
 * failure state — it is a form whose submission nobody was listening for, which
 * is exactly what a `<form>` on a page with no server does.
 *
 * Handling belongs to whoever owns navigation, which is the router:
 *
 *  - on **native**, it decides whether the action names a screen (navigate,
 *    fields as parameters) or an API route (a request whose response it may
 *    follow — `Response.redirect` to a screen being the pattern that works on
 *    both platforms);
 *  - on the **web** it has more work, not less: React only prevents the default
 *    for a *function* action. A string action "will behave like the HTML form
 *    component", so the browser does a full document navigation and takes the
 *    single-page app with it unless the router intercepts.
 *
 * A library hooks in by providing `FormSubmitContext` above the forms it wants
 * to handle. Context rather than a global registration so it can be scoped, and
 * so nesting works; the true DOM shape — a cancelable `submit` event bubbling
 * to the root — is what this stands in for until events can be dispatched from
 * JavaScript into the element tree.
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

/*
 * The three encodings HTML defines, and the serialisations they imply.
 *
 * `application/x-www-form-urlencoded` is the default — both the missing-value
 * and invalid-value default in the spec — which is worth stating because it is
 * the opposite of what a `FormData` object suggests. Handing a `FormData` to
 * `fetch` sends *multipart*, so a form that looked like it was following HTML
 * would in fact be posting something most servers parse differently, and that
 * an Expo API route calling `request.json()` would reject either way.
 */
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
    // $FlowFixMe[prop-missing] FormData is iterable at runtime.
    for (const [name, value] of formData.entries()) {
      text += `${name}=${String(value)}\r\n`;
    }
    return text;
  }
  const params = new URLSearchParams();
  // $FlowFixMe[prop-missing] FormData is iterable at runtime.
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

/**
 * Builds the submission from the controls that registered, in the order they
 * did.
 *
 * Order matters and is not incidental: HTML submits controls in *tree* order,
 * and code that reads `formData.getAll('tag')` depends on it. Registration
 * order is mount order, which is tree order for the case that matters.
 */
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
  /*
   * The resolved submission, not just the data.
   *
   * These fields are what `submit` already passes — see the comment there: the
   * submission is resolved before the handler runs so that `preventDefault` is
   * an informed choice rather than a blind one. This type had only `formData`
   * and `preventDefault`, so a handler reading `event.method` was a Flow error
   * on a value that was in fact present. Typed to what is actually delivered.
   */
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

    /*
     * The submission is resolved BEFORE the handler sees it.
     *
     * `onSubmit` used to receive only `{formData, preventDefault}`, so a
     * handler reading `event.method` got `undefined` — choosing POST in a form
     * changed nothing observable, because the method was not decided until
     * after the handler had already run and only inside the string-action
     * branch. Resolving first means the handler is told what WOULD happen,
     * which is the only thing that makes `preventDefault` an informed choice.
     *
     * HTML's defaults: GET, and `application/x-www-form-urlencoded` as both the
     * missing-value and invalid-value default, so an unrecognised `enctype`
     * falls back to it rather than erroring.
     */
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
        /*
         * A synchronous throw must not take the app down.
         *
         * The async path below already tolerates a rejection — the fields are
         * left alone and the app carries on — but a *synchronous* throw escaped
         * this handler entirely. That is not something a React error boundary
         * can catch: boundaries cover rendering, and this runs from an event.
         * So it reached the runtime as an unhandled error and killed the
         * surface, which is precisely what a browser does not do. There, an
         * exception in an event listener is reported and the page keeps going.
         *
         * Reported rather than swallowed: a silently discarded submission
         * failure would be worse than a crash, because nobody would know. And
         * the fields are deliberately NOT reset, which is the same rule the
         * rejection path follows — the user does not lose what they typed
         * because the submission failed.
         */
        console.error(
          '[form] The action passed to <form> threw. The form was left ' +
            'untouched and the app is still running; a browser reports an ' +
            'error thrown in a submit handler the same way.',
          error,
        );
        return;
      }
      /*
       * React 19 resets the form's *uncontrolled* fields once a function action
       * succeeds — "after the action function succeeds, all uncontrolled field
       * elements in the form are reset". Without this the same `<form>` would
       * clear itself on web and keep its text on a device, which is exactly the
       * kind of divergence this whole exercise exists to avoid.
       *
       * Only on success: an action that throws or rejects leaves the fields
       * alone, so the user does not lose what they typed when a submission
       * fails. Controlled fields are untouched either way — their value is the
       * author's to change.
       */
      // An async action resets only once it settles successfully, so the fields
      // survive a failed submission.
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
    () => ({register, submit, reset}),
    [register, submit, reset],
  );

  return (
    <FormContext.Provider value={value}>
      {/* The box `<form>` used to be. Its block display comes from the
          user-agent style on `element-form`, so layout is unchanged; `nodeName`
          is stated here because the host is registered under its own name.
        $FlowFixMe[prop-missing] intrinsic */}
      <element-form {...rest} nodeName="form">
        {children}
      </element-form>
    </FormContext.Provider>
  );
}

export default Form;
