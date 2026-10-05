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
 * HTML §6.8.5 `spellcheck` (marking mistakes) and §6.8.8 `autocorrect`
 * (rewriting them) are separate attributes with separate algorithms:
 * `spellcheck` inherits down the element tree; `autocorrect` reads its own
 * attribute, then its form owner's, defaults to on, and is forced off for the
 * input types correction would corrupt. Resolved here, where the element tree
 * is, into the boolean each platform takes.
 */

import type {FormRegistry} from './FormContext';

import FormContext from './FormContext';
import * as React from 'react';

/**
 * The `autocorrect` attribute's two keywords, plus the boolean its IDL
 * attribute takes — `element.autocorrect = false` is defined as setting the
 * content attribute to "off", so accepting the boolean here is the same
 * spelling of the same thing rather than a convenience.
 */
export type AutocorrectValue = 'on' | 'off' | boolean;

/**
 * The nearest ancestor's EXPLICIT `spellcheck` state, or null where no ancestor
 * has stated one.
 *
 * Null rather than `true` because "nobody said" and "somebody said true" are
 * different answers: the first defers to the element's own default behaviour,
 * the second is an instruction. Collapsing them would make an ancestor's
 * `spellcheck` unremovable.
 */
export const SpellcheckContext: React.Context<boolean | null> =
  React.createContext<boolean | null>(null);

/**
 * The input types HTML never lets autocorrection touch.
 *
 * "The `autocorrect` attribute never causes autocorrection to be enabled for
 * `input` elements whose `type` attribute is in one of the URL, Email, or
 * Password states" (§6.8.8) — and the rule is stated as the FIRST step of the
 * resolution algorithm, so it beats an explicit `autocorrect="on"` rather than
 * merely supplying a default. That ordering is the point: autocorrecting an
 * email address or a password produces a value the user did not type and
 * cannot see, in a field where being one character wrong is total failure.
 */
const NEVER_AUTOCORRECTED: ReadonlySet<string> = new Set([
  'url',
  'email',
  'password',
]);

function isAutocorrectOn(value: AutocorrectValue): boolean {
  return typeof value === 'boolean' ? value : value === 'on';
}

/**
 * §6.8.5's algorithm without the user-override steps, which are the
 * platform's: the element's attribute, then the nearest ancestor's, then the
 * default. DOM-CSS-DEVIATION(no-spellcheck-on-url-email-password): the spec
 * counts email and URL as checkable, but an address is all misspellings and
 * no system email field checks spelling, so those default to off; an author's
 * `spellCheck` still wins.
 */
export function useSpellcheck(
  own: boolean | null | void,
  type: string,
): boolean {
  const inherited = React.useContext(SpellcheckContext);
  if (own != null) {
    return own;
  }
  if (inherited != null) {
    return inherited;
  }
  return !NEVER_AUTOCORRECTED.has(type);
}

/**
 * The used autocorrection state (§6.8.8), in the spec's own order.
 *
 * The form-owner step is what makes `<form autocorrect="off">` govern the
 * fields inside it without each one repeating the attribute, which is the
 * example the spec itself gives.
 */
export function useAutocorrect(
  own: AutocorrectValue | null | void,
  type: string,
): boolean {
  const form: FormRegistry | null = React.useContext(FormContext);
  if (NEVER_AUTOCORRECTED.has(type)) {
    return false;
  }
  if (own != null) {
    return isAutocorrectOn(own);
  }
  const inherited = form?.autocorrect;
  if (inherited != null) {
    return isAutocorrectOn(inherited);
  }
  return true;
}

/**
 * Publishes an element's own `spellcheck` to its subtree, for the ancestor step
 * of the algorithm above.
 *
 * Rendered only where an element actually states the attribute — an element
 * that says nothing must not shadow the ancestor that did, and a provider that
 * published `null` would do exactly that.
 */
export function SpellcheckScope({
  value,
  children,
}: {
  value: boolean | null | void,
  children: React.Node,
}): React.Node {
  if (value == null) {
    return children;
  }
  return (
    <SpellcheckContext.Provider value={value}>
      {children}
    </SpellcheckContext.Provider>
  );
}
