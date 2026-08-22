/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import '@react-native/expo-intrinsics-poc';

import {
  buildFormData,
  encodeBody,
  urlWithQuery,
} from '@react-native/expo-intrinsics-poc/src/Form';
import FormContext from '@react-native/expo-intrinsics-poc/src/FormContext';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

/*
 * What a `<form>` actually submits.
 *
 * These are the rules that are easy to get wrong because they are invisible
 * until a server disagrees with you: which controls are included, what an
 * unchecked box contributes, and — the one this nearly shipped wrong — that
 * HTML's default encoding is `application/x-www-form-urlencoded` and not the
 * multipart that handing a `FormData` to `fetch` would produce.
 */

function control(name: string, value: string | Array<string> | null) {
  return {name, getValue: () => value};
}

test('named controls are submitted, in registration order', () => {
  const formData = buildFormData([
    control('first', 'Ada'),
    control('last', 'Lovelace'),
  ]);
  expect(formData.getAll('first')).toEqual(['Ada']);
  expect(formData.getAll('last')).toEqual(['Lovelace']);
});

test('an unnamed control is not submitted', () => {
  // How a Cancel button or a display-only field stays out of the data.
  const formData = buildFormData([
    control('', 'ignored'),
    control('kept', 'yes'),
  ]);
  expect(formData.getAll('kept')).toEqual(['yes']);
  expect(formData.getAll('')).toEqual([]);
});

test('a control with no value contributes nothing at all', () => {
  // An unchecked checkbox is absent, not empty — form handlers distinguish the
  // two, and `formData.has(name)` is how they do it.
  const formData = buildFormData([
    control('agree', null),
    control('name', 'Ada'),
  ]);
  expect(formData.has('agree')).toBe(false);
  expect(formData.has('name')).toBe(true);
});

test('a control may contribute several values under one name', () => {
  const formData = buildFormData([control('tag', ['a', 'b'])]);
  expect(formData.getAll('tag')).toEqual(['a', 'b']);
});

test('the default encoding is urlencoded, not multipart', () => {
  // The bug this pins: `FormData` handed to `fetch` sends multipart, but a
  // classic form posts `application/x-www-form-urlencoded`. Both the missing-
  // value and invalid-value default in the spec.
  const formData = buildFormData([
    control('q', 'hello world'),
    control('n', '1'),
  ]);
  const body = encodeBody(formData, 'application/x-www-form-urlencoded');
  expect(String(body)).toBe('q=hello+world&n=1');
});

test('multipart passes the entries through as FormData', () => {
  // The one case where FormData *is* the encoding — and the one a file input
  // requires.
  const formData = buildFormData([control('q', 'hello')]);
  expect(encodeBody(formData, 'multipart/form-data')).toBe(formData);
});

test('text/plain is name=value lines', () => {
  const formData = buildFormData([control('a', '1'), control('b', '2')]);
  expect(encodeBody(formData, 'text/plain')).toBe('a=1\r\nb=2\r\n');
});

test('a GET replaces the action query string rather than adding to it', () => {
  // The spec's "mutate action URL" step, which surprises people who expect an
  // existing `?page=2` to survive the submission.
  const formData = buildFormData([control('q', 'shoes')]);
  expect(urlWithQuery('/search?page=2', formData)).toBe('/search?q=shoes');
});

test('a GET with no fields leaves the action bare', () => {
  expect(urlWithQuery('/search', buildFormData([]))).toBe('/search');
});

/**
 * A function action that throws must not take the app down.
 *
 * The async path already tolerated a rejection, but a *synchronous* throw
 * escaped the submit handler and reached the runtime as an unhandled error,
 * killing the surface. A React error boundary cannot cover it: boundaries
 * catch rendering, and a submit runs from an event.
 *
 * The assertion is partly the absence of a crash — if the throw escapes, this
 * test fails by throwing rather than by comparing — and partly that it was
 * REPORTED, because a submission failure that vanished silently would be worse
 * than the crash it replaced.
 */
test('a synchronous throw in a form action is reported, not fatal', () => {
  const errors: Array<unknown> = [];
  const original = console.error;
  // $FlowFixMe[cannot-write] test double
  console.error = (...args: Array<unknown>) => {
    errors.push(args[0]);
  };

  let submit: (() => void) | null = null;

  function Trigger() {
    const form = React.useContext(FormContext);
    submit = form?.submit ?? null;
    return null;
  }

  const root = Fantom.createRoot();
  try {
    Fantom.runTask(() => {
      root.render(
        // $FlowExpectedError[not-a-component] intrinsic tag
        <form
          action={() => {
            throw new Error('server unavailable');
          }}>
          <Trigger />
        </form>,
      );
    });

    expect(typeof submit).toBe('function');

    // Before the guard this threw straight out of the task.
    Fantom.runTask(() => {
      submit?.();
    });

    expect(errors.length).toBeGreaterThan(0);
    expect(String(errors[0])).toContain('threw');
  } finally {
    // $FlowFixMe[cannot-write] restore
    console.error = original;
  }
});

/**
 * The submit handler is told what would happen, before it decides.
 *
 * `onSubmit` used to receive only `{formData, preventDefault}`. Everything
 * else — method, enctype, url, body — was resolved AFTER the handler ran, and
 * only inside the string-action branch, so a handler reading `event.method`
 * got `undefined`. Choosing POST in a form therefore changed nothing the app
 * could observe, which is exactly how it was reported from the device.
 *
 * It also matters for `preventDefault`: cancelling a submission you have not
 * been told the shape of is not an informed decision.
 */
test('the submit event carries the resolved method, url and body', () => {
  const seen: Array<$FlowFixMe> = [];
  let submit: (() => void) | null = null;

  function Trigger() {
    const form = React.useContext(FormContext);
    submit = form?.submit ?? null;
    return null;
  }

  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[not-a-component] intrinsic tags
      <form
        action="/api/signup"
        method="post"
        onSubmit={(e: $FlowFixMe) => {
          seen.push(e);
          e.preventDefault();
        }}>
        {/* $FlowExpectedError[not-a-component] */}
        <input name="who" defaultValue="ada" />
        <Trigger />
      </form>,
    );
  });

  Fantom.runTask(() => {
    submit?.();
  });

  expect(seen.length).toBe(1);
  const event = seen[0];
  // The specific regression: this was `undefined`.
  expect(event.method).toBe('post');
  expect(event.enctype).toBe('application/x-www-form-urlencoded');
  expect(event.action).toBe('/api/signup');
  // A POST carries a body; a GET would carry null and put the fields in the URL.
  expect(event.body).not.toBeNull();
  expect(String(event.url)).toContain('/api/signup');
});

test('a GET submission is reported as a GET, with no body', () => {
  const seen: Array<$FlowFixMe> = [];
  let submit: (() => void) | null = null;

  function Trigger() {
    const form = React.useContext(FormContext);
    submit = form?.submit ?? null;
    return null;
  }

  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[not-a-component]
      <form
        action="/search"
        onSubmit={(e: $FlowFixMe) => {
          seen.push(e);
          e.preventDefault();
        }}>
        {/* $FlowExpectedError[not-a-component] */}
        <input name="q" defaultValue="cats" />
        <Trigger />
      </form>,
    );
  });

  Fantom.runTask(() => {
    submit?.();
  });

  // HTML's default method, not an error and not a guess.
  expect(seen[0].method).toBe('get');
  expect(seen[0].body).toBeNull();
  expect(String(seen[0].url)).toContain('q=cats');
});
