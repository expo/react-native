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

import {compileSelector, unescapeIdent} from '../parse';

describe('unescapeIdent', () => {
  it('unescapes Tailwind identifier escapes', () => {
    expect(unescapeIdent('hover\\:bg-primary\\/90')).toBe(
      'hover:bg-primary/90',
    );
    expect(unescapeIdent('w-\\[100px\\]')).toBe('w-[100px]');
    expect(unescapeIdent('data-\\[state\\=open\\]\\:animate-in')).toBe(
      'data-[state=open]:animate-in',
    );
  });

  it('unescapes hex escapes with the trailing-space rule', () => {
    expect(unescapeIdent('\\2f foo')).toBe('/foo');
    expect(unescapeIdent('\\34 2')).toBe('42');
  });
});

describe('compileSelector', () => {
  it('compiles a bare class', () => {
    const sel = compileSelector('.rounded-md');
    expect(sel.unsupported).toBe(false);
    expect(sel.parts).toHaveLength(1);
    expect(sel.parts[0].compound.classes).toEqual(['rounded-md']);
    // The class column of the packed specificity tuple; see `compileSelector`.
    // eslint-disable-next-line no-bitwise
    expect(sel.specificity).toBe(1 << 10);
  });

  it('compiles a Tailwind hover utility: escaped class + pseudo', () => {
    const sel = compileSelector('.hover\\:bg-primary\\/90:hover');
    expect(sel.unsupported).toBe(false);
    const [part] = sel.parts;
    expect(part.compound.classes).toEqual(['hover:bg-primary/90']);
    expect(part.compound.pseudoClasses).toEqual(['hover']);
    // eslint-disable-next-line no-bitwise
    expect(sel.specificity).toBe(2 << 10);
  });

  it('compiles a data-state attribute utility', () => {
    const sel = compileSelector(
      '.data-\\[state\\=open\\]\\:animate-in[data-state=open]',
    );
    expect(sel.unsupported).toBe(false);
    const [part] = sel.parts;
    expect(part.compound.classes).toEqual(['data-[state=open]:animate-in']);
    expect(part.compound.attributes).toEqual([
      {name: 'data-state', op: '=', value: 'open'},
    ]);
  });

  it('quotes and operators in attribute matchers', () => {
    const sel = compileSelector('[aria-label^="Open"]');
    expect(sel.parts[0].compound.attributes).toEqual([
      {name: 'aria-label', op: '^=', value: 'Open'},
    ]);
    const presence = compileSelector('[disabled]');
    expect(presence.parts[0].compound.attributes).toEqual([
      {name: 'disabled', op: null, value: null},
    ]);
  });

  it('compiles descendant and child combinators, subject last', () => {
    const sel = compileSelector('.card > .title b');
    expect(sel.unsupported).toBe(false);
    expect(sel.parts.map(p => p.combinator)).toEqual(['>', ' ', null]);
    expect(sel.parts[2].compound.tag).toBe('b');
  });

  it("compiles Tailwind v3's class-strategy dark variant (.dark ancestor)", () => {
    const sel = compileSelector('.dark .dark\\:bg-background');
    expect(sel.unsupported).toBe(false);
    expect(sel.parts).toHaveLength(2);
    expect(sel.parts[0].compound.classes).toEqual(['dark']);
    expect(sel.parts[0].combinator).toBe(' ');
    expect(sel.parts[1].compound.classes).toEqual(['dark:bg-background']);
  });

  it("hoists Tailwind v4's :is(.dark *) into a .dark ancestor part", () => {
    const sel = compileSelector('.dark\\:bg-background:is(.dark *)');
    expect(sel.unsupported).toBe(false);
    expect(sel.parts).toHaveLength(2);
    expect(sel.parts[0].compound.classes).toEqual(['dark']);
    expect(sel.parts[1].compound.classes).toEqual(['dark:bg-background']);
  });

  it('marks sibling combinators unsupported but keeps parsing', () => {
    const sel = compileSelector('.a + .b');
    expect(sel.unsupported).toBe(true);
  });

  it('marks pseudo-elements unsupported', () => {
    expect(compileSelector('.btn::before').unsupported).toBe(true);
  });

  it('marks unknown pseudo-classes unsupported', () => {
    expect(compileSelector('.x:nth-child(2)').unsupported).toBe(true);
  });

  it('ranks specificity: id > class > type', () => {
    const id = compileSelector('#app');
    const cls = compileSelector('.app');
    const type = compileSelector('div');
    expect(id.specificity).toBeGreaterThan(cls.specificity);
    expect(cls.specificity).toBeGreaterThan(type.specificity);
    // Ten classes still lose to one id: the packed fields do not carry
    const many = compileSelector('.a.b.c.d.e.f.g.h.i.j');
    expect(id.specificity).toBeGreaterThan(many.specificity);
  });
});
