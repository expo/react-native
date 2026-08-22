/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * `spellcheck` and `autocorrect` resolve by two different algorithms, and the
 * whole point of this pair is that neither answer is the other's.
 *
 * The cases are read off the HTML standard rather than off our behaviour:
 * §6.8.5 for spellcheck (own attribute, then the nearest ancestor that states
 * one, then the element's default behaviour) and §6.8.8's "used autocorrection
 * state" (url/email/password first and unconditionally, then own attribute,
 * then the form owner, then on).
 */

import FormContext from '../src/FormContext';
import type {AutocorrectValue} from '../src/TextCorrection';

import {
  SpellcheckScope,
  useAutocorrect,
  useSpellcheck,
} from '../src/TextCorrection';
import * as React from 'react';
import TestRenderer from 'react-test-renderer';

/*
 * The hooks are called from real components rather than from a callback,
 * because that is the only place a hook may be called — and Flow enforces it.
 */
function SpellcheckProbe({
  own,
  report,
}: {
  own: boolean | void,
  report: (boolean) => void,
}) {
  report(useSpellcheck(own));
  return null;
}

function AutocorrectProbe({
  own,
  type,
  report,
}: {
  own: AutocorrectValue | void,
  type: string,
  report: (boolean) => void,
}) {
  report(useAutocorrect(own, type));
  return null;
}

/** Renders `node` inside `wrap` and returns what the probe in it computed. */
function render(
  probe: ((boolean) => void) => React.Node,
  wrap: (React.Node) => React.Node,
): boolean {
  let seen: boolean | void;
  TestRenderer.act(() => {
    // Wrapped in a fragment because `create` takes an element and `wrap`
    // returns a node — which a scope that renders its children bare will be.
    TestRenderer.create(
      <>
        {wrap(
          probe(value => {
            seen = value;
          }),
        )}
      </>,
    );
  });
  if (seen === undefined) {
    throw new Error('the probe never rendered');
  }
  return seen;
}

const spellcheck = (
  own: boolean | void,
  wrap: (React.Node) => React.Node = node => node,
): boolean =>
  render(report => <SpellcheckProbe own={own} report={report} />, wrap);

const autocorrect = (
  own: AutocorrectValue | void,
  type: string,
  wrap: (React.Node) => React.Node = node => node,
): boolean =>
  render(
    report => <AutocorrectProbe own={own} type={type} report={report} />,
    wrap,
  );

describe('the used spellcheck state', () => {
  test('a text field is checked when nothing says otherwise', () => {
    // "true-by-default": the element's own default behaviour, and what a
    // browser does with an unmarked field.
    expect(spellcheck(undefined)).toBe(true);
  });

  test('its own attribute decides', () => {
    expect(spellcheck(false)).toBe(false);
    expect(spellcheck(true)).toBe(true);
  });

  test('it inherits from an ancestor that states one', () => {
    const under = (value: boolean) => (node: React.Node) => (
      <SpellcheckScope value={value}>{node}</SpellcheckScope>
    );
    expect(spellcheck(undefined, under(false))).toBe(false);
    expect(spellcheck(undefined, under(true))).toBe(true);
  });

  test('its own attribute beats the ancestor', () => {
    const wrap = (node: React.Node) => (
      <SpellcheckScope value={false}>{node}</SpellcheckScope>
    );
    expect(spellcheck(true, wrap)).toBe(true);
  });

  test('the NEAREST ancestor wins', () => {
    const wrap = (node: React.Node) => (
      <SpellcheckScope value={false}>
        <SpellcheckScope value={true}>{node}</SpellcheckScope>
      </SpellcheckScope>
    );
    expect(spellcheck(undefined, wrap)).toBe(true);
  });

  test('an element that says nothing does not shadow the one that did', () => {
    // The reason the scope renders no provider for a null value. An element
    // with no attribute is transparent, not an assertion of the default —
    // otherwise an ancestor's spellcheck could never reach past one.
    const wrap = (node: React.Node) => (
      <SpellcheckScope value={false}>
        <SpellcheckScope value={undefined}>{node}</SpellcheckScope>
      </SpellcheckScope>
    );
    expect(spellcheck(undefined, wrap)).toBe(false);
  });
});

describe('the used autocorrection state', () => {
  test('it is on when nothing says otherwise', () => {
    expect(autocorrect(undefined, 'text')).toBe(true);
  });

  test('its own attribute decides, in both spellings', () => {
    expect(autocorrect('off', 'text')).toBe(false);
    expect(autocorrect('on', 'text')).toBe(true);
    // `element.autocorrect = false` is defined as setting the attribute to
    // "off", so the boolean is the same statement.
    expect(autocorrect(false, 'text')).toBe(false);
    expect(autocorrect(true, 'text')).toBe(true);
  });

  test('url, email and password are never autocorrected', () => {
    for (const type of ['url', 'email', 'password']) {
      expect(autocorrect(undefined, type)).toBe(false);
      // First step of the algorithm, so it beats an explicit request rather
      // than merely supplying a default. Correcting an address or a password
      // produces a value the user did not type and, for a password, cannot see.
      expect(autocorrect('on', type)).toBe(false);
    }
  });

  test('it inherits from the FORM OWNER', () => {
    const inForm = (owned: 'on' | 'off') => (node: React.Node) => (
      <FormContext.Provider
        value={{
          register: () => () => {},
          submit: () => {},
          reset: () => {},
          autocorrect: owned,
        }}>
        {node}
      </FormContext.Provider>
    );
    expect(autocorrect(undefined, 'text', inForm('off'))).toBe(false);
    // ...and the control's own attribute still beats it — the spec's own
    // example is a form with autocorrect="off" holding a textarea with "on".
    expect(autocorrect('on', 'text', inForm('off'))).toBe(true);
  });

  test('it does NOT inherit down the element tree the way spellcheck does', () => {
    // The two attributes are deliberately not symmetrical. A spellcheck scope
    // must not answer an autocorrect question.
    const wrap = (node: React.Node) => (
      <SpellcheckScope value={false}>{node}</SpellcheckScope>
    );
    expect(autocorrect(undefined, 'text', wrap)).toBe(true);
  });

  test('turning off the underline does not authorise rewriting', () => {
    // The conflation this pair exists to prevent, stated as a test: the two
    // resolve independently, so spellcheck="false" leaves autocorrect alone.
    expect(spellcheck(false)).toBe(false);
    expect(autocorrect(undefined, 'text')).toBe(true);
  });
});
