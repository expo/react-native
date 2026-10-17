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

import type {ElementDescriptor, MatchContext} from '../match';

import {selectorMatches} from '../match';
import {compileSelector} from '../parse';

const CTX: MatchContext = {schemeIsDark: false};

function el(overrides: Partial<ElementDescriptor>): ElementDescriptor {
  return {
    tag: 'div',
    classes: [],
    attributes: {},
    states: {},
    parent: null,
    ...overrides,
  };
}

describe('selectorMatches', () => {
  it('matches classes, tags, and compounds', () => {
    const button = el({tag: 'button', classes: ['btn', 'primary']});
    expect(selectorMatches(compileSelector('.btn'), button, CTX)).toBe(true);
    expect(selectorMatches(compileSelector('button'), button, CTX)).toBe(true);
    expect(
      selectorMatches(compileSelector('button.btn.primary'), button, CTX),
    ).toBe(true);
    expect(selectorMatches(compileSelector('.missing'), button, CTX)).toBe(
      false,
    );
    expect(selectorMatches(compileSelector('span.btn'), button, CTX)).toBe(
      false,
    );
  });

  it('matches attribute operators', () => {
    const open = el({
      attributes: {'data-state': 'open', 'aria-label': 'Open menu'},
    });
    expect(
      selectorMatches(compileSelector('[data-state=open]'), open, CTX),
    ).toBe(true);
    expect(
      selectorMatches(compileSelector('[data-state=closed]'), open, CTX),
    ).toBe(false);
    expect(selectorMatches(compileSelector('[data-state]'), open, CTX)).toBe(
      true,
    );
    expect(
      selectorMatches(compileSelector('[aria-label^="Open"]'), open, CTX),
    ).toBe(true);
    expect(
      selectorMatches(compileSelector('[aria-label$="menu"]'), open, CTX),
    ).toBe(true);
    expect(
      selectorMatches(compileSelector('[aria-label*="en m"]'), open, CTX),
    ).toBe(true);
  });

  it('treats bare boolean attributes as presence', () => {
    const disabled = el({attributes: {disabled: true}});
    expect(selectorMatches(compileSelector('[disabled]'), disabled, CTX)).toBe(
      true,
    );
    expect(selectorMatches(compileSelector(':disabled'), disabled, CTX)).toBe(
      true,
    );
    expect(selectorMatches(compileSelector(':disabled'), el({}), CTX)).toBe(
      false,
    );
  });

  it('matches interaction pseudo-classes against states', () => {
    const hovered = el({states: {hovered: true}});
    const pressed = el({states: {pressed: true}});
    const focusVisible = el({states: {focusVisible: true}});
    expect(selectorMatches(compileSelector(':hover'), hovered, CTX)).toBe(true);
    expect(selectorMatches(compileSelector(':hover'), pressed, CTX)).toBe(
      false,
    );
    expect(selectorMatches(compileSelector(':active'), pressed, CTX)).toBe(
      true,
    );
    expect(
      selectorMatches(compileSelector(':focus-visible'), focusVisible, CTX),
    ).toBe(true);
    expect(selectorMatches(compileSelector(':focus'), focusVisible, CTX)).toBe(
      true,
    );
  });

  it('walks descendant and child combinators right to left', () => {
    const card = el({classes: ['card']});
    const body = el({classes: ['body'], parent: card});
    const title = el({tag: 'b', classes: ['title'], parent: body});
    expect(selectorMatches(compileSelector('.card .title'), title, CTX)).toBe(
      true,
    );
    expect(
      selectorMatches(compileSelector('.card > .body > .title'), title, CTX),
    ).toBe(true);
    expect(selectorMatches(compileSelector('.card > .title'), title, CTX)).toBe(
      false,
    );
    expect(
      selectorMatches(compileSelector('.body .card .title'), title, CTX),
    ).toBe(false);
  });

  it('matches a real .dark ancestor class', () => {
    const dark = el({classes: ['dark']});
    const inner = el({classes: ['dark:bg-black'], parent: dark});
    expect(
      selectorMatches(compileSelector('.dark .dark\\:bg-black'), inner, CTX),
    ).toBe(true);
  });

  it('matches the scheme as a virtual .dark ancestor', () => {
    const alone = el({classes: ['dark:bg-black']});
    const darkCtx = {...CTX, schemeIsDark: true};
    expect(
      selectorMatches(
        compileSelector('.dark .dark\\:bg-black'),
        alone,
        darkCtx,
      ),
    ).toBe(true);
    expect(
      selectorMatches(compileSelector('.dark .dark\\:bg-black'), alone, CTX),
    ).toBe(false);
    // Tailwind v4's shape
    expect(
      selectorMatches(
        compileSelector('.dark\\:bg-black:is(.dark *)'),
        alone,
        darkCtx,
      ),
    ).toBe(true);
  });

  it('never matches unsupported selectors', () => {
    expect(
      selectorMatches(compileSelector('.a + .b'), el({classes: ['b']}), CTX),
    ).toBe(false);
    expect(
      selectorMatches(compileSelector('.a::before'), el({classes: ['a']}), CTX),
    ).toBe(false);
  });
});
