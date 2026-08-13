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

import {createMatcher, mediaConditionApplies, selectorMatches} from '../match';
import {compileSelector, parseStylesheet} from '../parse';

const CTX: MatchContext = {
  schemeIsDark: false,
  reduceMotion: false,
  windowWidth: 400,
  windowHeight: 800,
  touch: true,
};

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
    // The v4 shape too.
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

describe('mediaConditionApplies', () => {
  it('evaluates width against the window', () => {
    expect(mediaConditionApplies('(min-width: 768px)', CTX)).toBe(false);
    expect(
      mediaConditionApplies('(min-width: 768px)', {...CTX, windowWidth: 800}),
    ).toBe(true);
    expect(mediaConditionApplies('(max-width: 640px)', CTX)).toBe(true);
  });

  it('evaluates scheme, motion, and pointer', () => {
    expect(mediaConditionApplies('(prefers-color-scheme: dark)', CTX)).toBe(
      false,
    );
    expect(
      mediaConditionApplies('(prefers-color-scheme: dark)', {
        ...CTX,
        schemeIsDark: true,
      }),
    ).toBe(true);
    expect(mediaConditionApplies('(prefers-reduced-motion: reduce)', CTX)).toBe(
      false,
    );
    expect(mediaConditionApplies('(hover: hover)', CTX)).toBe(false);
    expect(mediaConditionApplies('(hover: none)', CTX)).toBe(true);
    expect(mediaConditionApplies('(pointer: coarse)', CTX)).toBe(true);
  });

  it('honors and-chains and comma-alternatives', () => {
    expect(
      mediaConditionApplies('(min-width: 100px) and (max-width: 500px)', CTX),
    ).toBe(true);
    expect(
      mediaConditionApplies('(min-width: 768px), (pointer: coarse)', CTX),
    ).toBe(true);
    expect(mediaConditionApplies('(unknown-feature: x)', CTX)).toBe(false);
  });
});

describe('createMatcher cascade', () => {
  it('later source order wins at equal specificity', () => {
    const matcher = createMatcher([
      parseStylesheet('.a { color: red } .a { color: blue }'),
    ]);
    const {declarations} = matcher.matchDeclarations(el({classes: ['a']}), CTX);
    expect(declarations.color).toBe('blue');
  });

  it('higher specificity wins regardless of order', () => {
    const matcher = createMatcher([
      parseStylesheet('.a.b { color: red } .a { color: blue }'),
    ]);
    const {declarations} = matcher.matchDeclarations(
      el({classes: ['a', 'b']}),
      CTX,
    );
    expect(declarations.color).toBe('red');
  });

  it('unlayered beats layered; later layer beats earlier', () => {
    const matcher = createMatcher([
      parseStylesheet(`
        @layer base, utilities;
        @layer utilities { .a { color: green } }
        @layer base { .a { color: red } }
        .a { padding: 1px }
      `),
    ]);
    const {declarations} = matcher.matchDeclarations(el({classes: ['a']}), CTX);
    // utilities beats base by layer order even though base comes later in
    // source; the unlayered padding also lands.
    expect(declarations.color).toBe('green');
    expect(declarations.padding).toBe('1px');
  });

  it('unlayered wins over any layer at equal specificity', () => {
    const matcher = createMatcher([
      parseStylesheet(`
        @layer x { .a { color: red } }
        .a { color: blue }
      `),
    ]);
    expect(
      matcher.matchDeclarations(el({classes: ['a']}), CTX).declarations.color,
    ).toBe('blue');
  });

  it('media-gated rules only apply when the condition holds', () => {
    const matcher = createMatcher([
      parseStylesheet(`
        .a { padding: 4px }
        @media (min-width: 768px) { .a { padding: 8px } }
      `),
    ]);
    expect(
      matcher.matchDeclarations(el({classes: ['a']}), CTX).declarations.padding,
    ).toBe('4px');
    expect(
      matcher.matchDeclarations(el({classes: ['a']}), {
        ...CTX,
        windowWidth: 900,
      }).declarations.padding,
    ).toBe('8px');
  });

  it('reports interaction-state dependence for candidates, matched or not', () => {
    const matcher = createMatcher([
      parseStylesheet('.btn:hover { opacity: 0.9 } .plain { opacity: 1 }'),
    ]);
    const hoverable = matcher.matchDeclarations(el({classes: ['btn']}), CTX);
    expect(hoverable.dependsOnStates).toBe(true);
    expect(hoverable.declarations).toEqual({});
    const plain = matcher.matchDeclarations(el({classes: ['plain']}), CTX);
    expect(plain.dependsOnStates).toBe(false);
  });

  it('styles a descendant from an ancestor state (.group:hover .x)', () => {
    // Tailwind's whole group-* family is this shape, and shadcn leans on it.
    const matcher = createMatcher([
      parseStylesheet('.group:hover .label { opacity: 1 }'),
    ]);
    const restingGroup = el({classes: ['group'], states: {}});
    const hoveredGroup = el({classes: ['group'], states: {hovered: true}});

    const underResting = matcher.matchDeclarations(
      el({classes: ['label'], parent: restingGroup}),
      CTX,
    );
    expect(underResting.declarations).toEqual({});

    const underHovered = matcher.matchDeclarations(
      el({classes: ['label'], parent: hoveredGroup}),
      CTX,
    );
    expect(underHovered.declarations).toEqual({opacity: '1'});
  });

  it('tells an ancestor to track state for its descendants', () => {
    const matcher = createMatcher([
      parseStylesheet(
        '.group:hover .label { opacity: 1 } .plain span { color: red }',
      ),
    ]);
    // Nothing about .group's OWN styling depends on hover, so the subject
    // check reports false — but it still has to track, or the hover never
    // reaches the descendant that does depend on it.
    expect(
      matcher.matchDeclarations(el({classes: ['group']}), CTX).dependsOnStates,
    ).toBe(false);
    expect(matcher.tracksStateForDescendants('group')).toBe(true);
    expect(matcher.tracksStateForDescendants('plain')).toBe(false);
  });

  it('collects :root variables for the root element', () => {
    const matcher = createMatcher([
      parseStylesheet(':root { --primary: 222.2 47.4% 11.2% }'),
    ]);
    const root = matcher.matchDeclarations(el({isRoot: true, tag: null}), CTX);
    expect(root.declarations['--primary']).toBe('222.2 47.4% 11.2%');
    const nonRoot = matcher.matchDeclarations(el({}), CTX);
    expect(nonRoot.declarations['--primary']).toBeUndefined();
  });

  it('exposes keyframes by name', () => {
    const matcher = createMatcher([
      parseStylesheet(
        '@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }',
      ),
    ]);
    expect(matcher.keyframes('spin')).toHaveLength(2);
    expect(matcher.keyframes('nope')).toBe(null);
  });

  it('resolves a Tailwind button slice end to end', () => {
    const matcher = createMatcher([
      parseStylesheet(`
        .inline-flex { display: inline-flex }
        .rounded-md { border-radius: 6px }
        .bg-primary { background-color: hsl(var(--primary)) }
        .hover\\:bg-primary\\/90:hover { background-color: hsl(var(--primary) / 0.9) }
        .disabled\\:opacity-50:disabled { opacity: 0.5 }
      `),
    ]);
    const classes = [
      'inline-flex',
      'rounded-md',
      'bg-primary',
      'hover:bg-primary/90',
      'disabled:opacity-50',
    ];
    const resting = matcher.matchDeclarations(
      el({tag: 'button', classes}),
      CTX,
    );
    expect(resting.declarations).toEqual({
      display: 'inline-flex',
      'border-radius': '6px',
      'background-color': 'hsl(var(--primary))',
    });
    expect(resting.dependsOnStates).toBe(true);

    const hovered = matcher.matchDeclarations(
      el({tag: 'button', classes, states: {hovered: true}}),
      CTX,
    );
    expect(hovered.declarations['background-color']).toBe(
      'hsl(var(--primary) / 0.9)',
    );

    const disabled = matcher.matchDeclarations(
      el({tag: 'button', classes, attributes: {disabled: true}}),
      CTX,
    );
    expect(disabled.declarations.opacity).toBe('0.5');
  });
});
