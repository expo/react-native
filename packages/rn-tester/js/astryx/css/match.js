/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

/**
 * Selector matching (selectors-4) over the element descriptors the runtime
 * records, for the DOM shim's `matches()`, `closest()` and `querySelector()`
 * where the renderer's style engine cannot answer: an element whose attributes
 * a script set, and the stub document's own nodes.
 */

import type {ComplexSelector, Compound} from './parse';

export type InteractionStates = {
  readonly hovered?: boolean,
  readonly pressed?: boolean,
  readonly focused?: boolean,
  readonly focusVisible?: boolean,
  readonly disabled?: boolean,
  // Shown with `showPopover()` (HTML §6.12): `:popover-open`
  readonly popoverOpen?: boolean,
};

export type ElementDescriptor = {
  tag: string | null,
  classes: Array<string>,
  // `true` models a bare boolean attribute ([disabled]); null or undefined is
  // absence
  attributes: {readonly [string]: unknown},
  states: InteractionStates,
  // The ancestor chain for descendant and child combinators
  parent: ElementDescriptor | null,
  isRoot?: boolean,
};

/**
 * The custom properties through which the host surface a page renders in (an
 * app's screen or a split view's column rather than the window) declares its
 * size, which the style engine's viewport units and media queries read
 */
export const VIEWPORT_INLINE_SIZE = '--astryx-viewport-inline-size';
export const VIEWPORT_BLOCK_SIZE = '--astryx-viewport-block-size';

export type MatchContext = {
  // A virtual `.dark` around the root when the platform's scheme is dark
  readonly schemeIsDark: boolean,
};

function attributeValue(el: ElementDescriptor, name: string): unknown {
  return el.attributes[name];
}

function compoundMatches(compound: Compound, el: ElementDescriptor): boolean {
  if (compound.tag != null && compound.tag !== el.tag) {
    return false;
  }
  for (const cls of compound.classes) {
    if (!el.classes.includes(cls)) {
      return false;
    }
  }
  for (const attr of compound.attributes) {
    const raw = attributeValue(el, attr.name);
    if (raw == null || raw === false) {
      return false;
    }
    if (attr.op == null) {
      continue; // presence
    }
    const actual = String(raw);
    const expected = attr.value ?? '';
    switch (attr.op) {
      case '=':
        if (actual !== expected) {
          return false;
        }
        break;
      case '^=':
        if (expected === '' || !actual.startsWith(expected)) {
          return false;
        }
        break;
      case '$=':
        if (expected === '' || !actual.endsWith(expected)) {
          return false;
        }
        break;
      case '*=':
        if (expected === '' || !actual.includes(expected)) {
          return false;
        }
        break;
      case '~=':
        if (!actual.split(/\s+/).includes(expected)) {
          return false;
        }
        break;
      case '|=':
        if (actual !== expected && !actual.startsWith(expected + '-')) {
          return false;
        }
        break;
      default:
        return false;
    }
  }
  for (const pseudo of compound.pseudoClasses) {
    switch (pseudo) {
      case 'hover':
        if (el.states.hovered !== true) {
          return false;
        }
        break;
      case 'active':
        if (el.states.pressed !== true) {
          return false;
        }
        break;
      case 'focus':
        if (el.states.focused !== true && el.states.focusVisible !== true) {
          return false;
        }
        break;
      case 'focus-visible':
        if (el.states.focusVisible !== true) {
          return false;
        }
        break;
      case 'disabled':
        if (
          el.states.disabled !== true &&
          attributeValue(el, 'disabled') !== true &&
          attributeValue(el, 'aria-disabled') !== 'true'
        ) {
          return false;
        }
        break;
      case 'popover-open':
        if (el.states.popoverOpen !== true) {
          return false;
        }
        break;
      case 'root':
        if (el.isRoot !== true) {
          return false;
        }
        break;
      default:
        return false;
    }
  }
  return true;
}

// The `.dark` scheme compound: exactly one class, 'dark'. It matches a real
// `.dark` ancestor like any compound and also "the OS scheme is dark" with no
// such element, mapping Tailwind's class-strategy dark mode onto the platform
// appearance.
function isSchemeDarkCompound(compound: Compound): boolean {
  return (
    compound.tag == null &&
    compound.classes.length === 1 &&
    compound.classes[0] === 'dark' &&
    compound.attributes.length === 0 &&
    compound.pseudoClasses.length === 0
  );
}

export function selectorMatches(
  selector: ComplexSelector,
  el: ElementDescriptor,
  ctx: MatchContext,
): boolean {
  if (selector.unsupported) {
    return false;
  }
  const parts = selector.parts;
  if (parts.length === 0) {
    return false;
  }

  // Right to left (selectors-4 §16): parts[i] must match element, and the
  // prefix is satisfied against its ancestors through the combinator stored on
  // parts[i-1]
  function satisfiable(i: number, element: ElementDescriptor): boolean {
    if (!compoundMatches(parts[i].compound, element)) {
      return false;
    }
    if (i === 0) {
      return true;
    }
    const combinator = parts[i - 1].combinator;
    if (combinator === '>') {
      return element.parent != null && satisfiable(i - 1, element.parent);
    }
    for (let a = element.parent; a != null; a = a.parent) {
      if (satisfiable(i - 1, a)) {
        return true;
      }
    }
    // The one ancestor the environment provides: a virtual `.dark` around the
    // root when the platform scheme is dark
    if (
      i - 1 === 0 &&
      isSchemeDarkCompound(parts[0].compound) &&
      ctx.schemeIsDark
    ) {
      return true;
    }
    return false;
  }

  return satisfiable(parts.length - 1, el);
}
