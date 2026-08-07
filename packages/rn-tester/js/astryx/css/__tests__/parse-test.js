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

import {compileSelector, parseStylesheet, unescapeIdent} from '../parse';

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
    expect(sel.specificity).toBe(1 << 10);
  });

  it('compiles a Tailwind hover utility: escaped class + pseudo', () => {
    const sel = compileSelector('.hover\\:bg-primary\\/90:hover');
    expect(sel.unsupported).toBe(false);
    const [part] = sel.parts;
    expect(part.compound.classes).toEqual(['hover:bg-primary/90']);
    expect(part.compound.pseudoClasses).toEqual(['hover']);
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
    // Ten classes still lose to one id (the packed fields do not carry).
    const many = compileSelector('.a.b.c.d.e.f.g.h.i.j');
    expect(id.specificity).toBeGreaterThan(many.specificity);
  });
});

describe('parseStylesheet', () => {
  it('parses rules, media, and preserves source order', () => {
    const sheet = parseStylesheet(`
      .btn { padding-inline: 1rem; border-radius: 0.375rem; }
      @media (min-width: 768px) {
        .btn { padding-inline: 2rem; }
      }
    `);
    expect(sheet.rules).toHaveLength(2);
    expect(sheet.rules[0].declarations).toEqual({
      'padding-inline': '1rem',
      'border-radius': '0.375rem',
    });
    expect(sheet.rules[0].media).toEqual([]);
    expect(sheet.rules[1].media).toEqual(['(min-width: 768px)']);
    expect(sheet.rules[1].order).toBeGreaterThan(sheet.rules[0].order);
  });

  it('strips comments, including inside blocks', () => {
    const sheet = parseStylesheet(`
      /* header */
      .a { /* pad */ padding: 4px; }
    `);
    expect(sheet.rules[0].declarations).toEqual({padding: '4px'});
  });

  it('keeps functions with semicolode-free commas intact', () => {
    const sheet = parseStylesheet(
      '.x { background-color: hsl(222.2 84% 4.9%); transition: color 150ms, opacity 150ms; }',
    );
    expect(sheet.rules[0].declarations['background-color']).toBe(
      'hsl(222.2 84% 4.9%)',
    );
    expect(sheet.rules[0].declarations.transition).toBe(
      'color 150ms, opacity 150ms',
    );
  });

  it('parses :root variable blocks', () => {
    const sheet = parseStylesheet(
      ':root { --background: 0 0% 100%; --radius: 0.5rem; }',
    );
    expect(sheet.rules[0].selectors[0].parts[0].compound.pseudoClasses).toEqual(
      ['root'],
    );
    expect(sheet.rules[0].declarations).toEqual({
      '--background': '0 0% 100%',
      '--radius': '0.5rem',
    });
  });

  it('parses @layer statements and blocks with nesting', () => {
    const sheet = parseStylesheet(`
      @layer base, components, utilities;
      @layer base { .a { color: red; } }
      @layer utilities { .b { color: blue; } }
      .c { color: green; }
    `);
    expect(sheet.layerOrder).toEqual(['base', 'components', 'utilities']);
    expect(sheet.rules[0].layer).toBe('base');
    expect(sheet.rules[1].layer).toBe('utilities');
    expect(sheet.rules[2].layer).toBe(null);
  });

  it('parses @keyframes into sorted offset stops', () => {
    const sheet = parseStylesheet(`
      @keyframes enter {
        to { opacity: 1 }
        from { opacity: 0; transform: translateY(4px) }
        50% { opacity: 0.7 }
      }
    `);
    expect(sheet.keyframes).toHaveLength(1);
    const [kf] = sheet.keyframes;
    expect(kf.name).toBe('enter');
    expect(kf.stops.map(s => s.offset)).toEqual([0, 0.5, 1]);
    expect(kf.stops[0].declarations).toEqual({
      opacity: '0',
      transform: 'translateY(4px)',
    });
  });

  it('takes @supports blocks and skips unknown at-rules whole', () => {
    const sheet = parseStylesheet(`
      @supports (backdrop-filter: blur(4px)) { .y { opacity: 0.5; } }
      @font-face { font-family: X; src: url(x.woff2); }
      .z { color: black; }
    `);
    expect(sheet.rules).toHaveLength(2);
    expect(sheet.rules[0].declarations).toEqual({opacity: '0.5'});
    expect(sheet.rules[1].declarations).toEqual({color: 'black'});
  });

  it('drops unparseable declarations without losing the rule', () => {
    const sheet = parseStylesheet('.a { color: red; garbage; padding: 1px }');
    expect(sheet.rules[0].declarations).toEqual({
      color: 'red',
      padding: '1px',
    });
  });

  it('threads source order across sheets', () => {
    const first = parseStylesheet('.a { color: red }', 0);
    const second = parseStylesheet('.a { color: blue }', first.rules.length);
    expect(second.rules[0].order).toBeGreaterThan(first.rules[0].order);
  });

  it('survives a representative Tailwind slice end to end', () => {
    const sheet = parseStylesheet(`
      .inline-flex { display: inline-flex }
      .items-center { align-items: center }
      .rounded-md { border-radius: calc(var(--radius) - 2px) }
      .bg-primary { background-color: hsl(var(--primary)) }
      .text-primary-foreground { color: hsl(var(--primary-foreground)) }
      .hover\\:bg-primary\\/90:hover { background-color: hsl(var(--primary) / 0.9) }
      .focus-visible\\:outline-none:focus-visible { outline: 2px solid transparent }
      .disabled\\:opacity-50:disabled { opacity: 0.5 }
      .data-\\[state\\=open\\]\\:fade-in-0[data-state=open] { --tw-enter-opacity: 0 }
    `);
    expect(sheet.rules).toHaveLength(9);
    expect(sheet.rules.every(r => r.selectors[0].unsupported === false)).toBe(
      true,
    );
  });
});
