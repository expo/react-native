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
 * `spellcheck` and `autocorrect` — two attributes, two algorithms.
 *
 * They are easy to conflate and HTML does not: §6.8.5 defines `spellcheck` as
 * whether text is "checked for spelling and grammar" (the underline), and
 * §6.8.8 defines a SEPARATE `autocorrect` attribute for whether the user agent
 * "is permitted to automatically correct spelling errors while the user types".
 * Checking marks what is already wrong; correcting changes what you typed. An
 * author who turns off the underline on a field of surnames has not asked for
 * their typing to be silently rewritten, and vice versa.
 *
 * They also resolve differently, which is the other reason they live together
 * here rather than as a shared boolean:
 *
 *  - `spellcheck` INHERITS down the element tree. An element with no attribute
 *    takes the nearest ancestor that has one.
 *  - `autocorrect` does not. It reads its own attribute, then its FORM OWNER's,
 *    and otherwise defaults to on — and it is forced off for the input types
 *    where correcting the text would corrupt it.
 *
 * Resolution happens here, in JavaScript, because this is where the element
 * tree is. The platforms are handed a resolved boolean each, which is all
 * either of them can express.
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
 * The used spellcheck state: whether this element's text is checked.
 *
 * §6.8.5's algorithm, minus the two steps about user overrides, which belong to
 * the platform and are not ours to answer: the element's own attribute wins,
 * then the nearest ancestor that states one, then the element's own default
 * behaviour.
 *
 * That last step is where this departs from the letter of the spec, which lists
 * Email and URL among the types a user agent should consider checkable. An
 * address is not prose: every one of them is a "misspelling", so the field
 * fills with red underlines that mean nothing, and on iOS the predictive bar
 * appears above the keyboard with nothing to put in it — reported from a device
 * as exactly that, a bar that shows up empty. No system email field on either
 * platform checks spelling. So these three default to OFF and an author who
 * states `spellCheck` still gets it: a default, not a refusal, which is the
 * difference between this and the autocorrect rule above.
 *
 * DOM-CSS-DEVIATION(no-spellcheck-on-url-email-password)
 */
export function useSpellcheck(own: boolean | null | void, type: string): boolean {
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
