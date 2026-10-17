/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

'use strict';

/**
 * The style engine's conformance corpus: the CSS the engine implements, case
 * by case, each tied to the section of the spec it checks.
 *
 * A case is a sheet, a tree of elements and what to read of them. Every read
 * states the value the spec gives (`expect`), worked out from the spec's text;
 * `oracle.js` renders the corpus in Safari and refuses to write
 * `expected.json` unless Safari agrees with every one, so a case that misreads
 * the spec cannot become the standard. `StyleEngineConformance-itest.js` then
 * holds the engine to Safari's answers.
 *
 * What a read can be, chosen so a wrong answer cannot pass by accident:
 *   - `rect`: the element's box relative to the case's root, `[x, y, w, h]`.
 *     Every box has an explicit size and no text, so layout is not in
 *     question, only the values the cascade produced.
 *   - `background`: the computed `background-color` as `[r, g, b, a]`, and
 *     `background-color: currentColor` reads `color`.
 *   - `matches`: whether the element matches a selector.
 *   - `custom`: a custom property's computed value.
 *
 * A tree node is `[tag, attributes, children]`; `id` names what a read reads.
 * Each case's root is `#root`, 300px wide, and every box is a flex column.
 */

// Under every case, at no specificity so any rule of the case's beats it:
// boxes with no user-agent spacing, each a column whose items stretch, so
// the cases' own declarations are all that sizes them, no margin collapses
// and nothing shrinks
const PRELUDE = `
:where(#root, #root *) { margin: 0; padding: 0; border: 0 solid black; box-sizing: content-box; display: flex; flex-direction: column; flex-shrink: 0; }
:where(#root) { width: 300px; }
`;

const RED = [255, 0, 0, 1];
const GREEN = [0, 128, 0, 1];
const BLUE = [0, 0, 255, 1];

// A box `height` tall in a 300px root, at the top
const box = (height, x = 0, y = 0, width = 300) => [x, y, width, height];

const div = (attributes = {}, children = []) => ['div', attributes, children];

const CASES = [
  // -- selectors-4 --

  {
    name: 'type, class and id selectors',
    spec: 'selectors-4 §5, §6.6, §6.7',
    css: `
      div.a { height: 1px; }
      #t.a { height: 2px; }
      section { height: 3px; }`,
    tree: div({}, [div({id: 't', class: 'a'}), ['section', {id: 's'}, []]]),
    reads: [
      {id: 't', rect: box(2)},
      {id: 's', rect: box(3, 0, 2)},
    ],
  },
  {
    name: 'attribute presence and exact value',
    spec: 'selectors-4 §6.1',
    css: `
      [data-x] { height: 1px; }
      [data-x="two"] { height: 2px; }
      [data-x=three] { height: 3px; }`,
    tree: div({}, [
      div({id: 'a', 'data-x': 'one'}),
      div({id: 'b', 'data-x': 'two'}),
      div({id: 'c', 'data-x': 'three'}),
    ]),
    reads: [
      {id: 'a', rect: box(1)},
      {id: 'b', rect: box(2, 0, 1)},
      {id: 'c', rect: box(3, 0, 3)},
    ],
  },
  {
    name: 'attribute word, prefix, suffix, substring and dash matches',
    spec: 'selectors-4 §6.1, §6.2',
    css: `
      [data-w~="b"] { height: 1px; }
      [data-p^="ab"] { height: 2px; }
      [data-s$="yz"] { height: 3px; }
      [data-c*="mid"] { height: 4px; }
      [lang|="en"] { height: 5px; }`,
    tree: div({}, [
      div({id: 'w', 'data-w': 'a b c'}),
      div({id: 'w2', 'data-w': 'abc'}),
      div({id: 'p', 'data-p': 'abc'}),
      div({id: 's', 'data-s': 'xyz'}),
      div({id: 'c', 'data-c': 'amidst'}),
      div({id: 'l', lang: 'en-US'}),
      div({id: 'l2', lang: 'english'}),
    ]),
    reads: [
      {id: 'w', matches: '[data-w~="b"]', expect: true},
      {id: 'w2', matches: '[data-w~="b"]', expect: false},
      {id: 'p', matches: '[data-p^="ab"]', expect: true},
      {id: 's', matches: '[data-s$="yz"]', expect: true},
      {id: 'c', matches: '[data-c*="mid"]', expect: true},
      {id: 'l', matches: '[lang|="en"]', expect: true},
      {id: 'l2', matches: '[lang|="en"]', expect: false},
      {id: 'w', rect: box(1)},
      {id: 'w2', rect: box(0, 0, 1)},
      {id: 'l', rect: box(5, 0, 10)},
    ],
  },
  {
    name: 'an empty prefix, suffix or substring matches nothing',
    spec: 'selectors-4 §6.2',
    css: '',
    tree: div({}, [div({id: 't', 'data-x': 'abc'})]),
    reads: [
      {id: 't', matches: '[data-x^=""]', expect: false},
      {id: 't', matches: '[data-x$=""]', expect: false},
      {id: 't', matches: '[data-x*=""]', expect: false},
      {id: 't', matches: '[data-x~=""]', expect: false},
    ],
  },
  {
    name: 'the case-insensitive attribute flag',
    spec: 'selectors-4 §6.3',
    css: `[data-x="ABC" i] { height: 4px; }`,
    tree: div({}, [div({id: 't', 'data-x': 'abc'})]),
    reads: [
      {id: 't', matches: '[data-x="ABC" i]', expect: true},
      {id: 't', matches: '[data-x="ABC"]', expect: false},
      {id: 't', rect: box(4)},
    ],
  },
  {
    name: ':not, :is and :where',
    spec: 'selectors-4 §4.2, §4.3, §4.4',
    css: `
      .k:not(.x) { height: 1px; }
      :is(.p, .q) { height: 2px; }
      :where(.r) { height: 3px; }`,
    tree: div({}, [
      div({id: 'a', class: 'k'}),
      div({id: 'b', class: 'k x'}),
      div({id: 'c', class: 'q'}),
      div({id: 'd', class: 'r'}),
    ]),
    reads: [
      {id: 'a', rect: box(1)},
      {id: 'b', rect: box(0, 0, 1)},
      {id: 'c', rect: box(2, 0, 1)},
      {id: 'd', rect: box(3, 0, 3)},
      {id: 'b', matches: ':not(.x, .y)', expect: false},
      {id: 'a', matches: ':not(.x, .y)', expect: true},
    ],
  },
  {
    name: ':is and :where forgive an invalid argument, :not does not',
    spec: 'selectors-4 §3.6, §4.2, §4.3',
    css: `
      :is(.a, :unknown-pseudo) { height: 1px; }
      :where(:unknown-pseudo, .b) { height: 2px; }
      :not(:unknown-pseudo) { height: 9px; }`,
    tree: div({}, [div({id: 'a', class: 'a'}), div({id: 'b', class: 'b'})]),
    reads: [
      {id: 'a', rect: box(1)},
      {id: 'b', rect: box(2, 0, 1)},
    ],
  },
  {
    name: 'one invalid selector drops the whole rule',
    spec: 'selectors-4 §3.2, css-syntax-3 §9',
    css: `
      .a, .b..c { height: 7px; }
      .a { width: 10px; }`,
    tree: div({}, [div({id: 'a', class: 'a', style: 'height: 1px'})]),
    reads: [{id: 'a', rect: [0, 0, 10, 1]}],
  },
  {
    name: 'a pseudo-element selects no element',
    spec: 'selectors-4 §3.6.1',
    css: `.a::before { height: 7px; } .a { height: 1px; }`,
    tree: div({}, [div({id: 'a', class: 'a'})]),
    reads: [{id: 'a', rect: box(1)}],
  },
  {
    name: 'first, last and only child',
    spec: 'selectors-4 §14.3, §14.4, §14.5',
    css: `
      .l > :first-child { height: 1px; }
      .l > :last-child { height: 2px; }
      .o > :only-child { height: 3px; }`,
    tree: div({}, [
      div({class: 'l'}, [
        div({id: 'f', style: 'height: 5px'}),
        div({id: 'm', style: 'height: 5px'}),
        div({id: 'z', style: 'height: 5px'}),
      ]),
      div({class: 'o'}, [div({id: 'only'})]),
    ]),
    reads: [
      {id: 'f', matches: ':first-child', expect: true},
      {id: 'm', matches: ':first-child', expect: false},
      {id: 'z', matches: ':last-child', expect: true},
      {id: 'only', matches: ':only-child', expect: true},
      {id: 'm', matches: ':only-child', expect: false},
      {id: 'only', rect: box(3, 0, 15)},
    ],
  },
  {
    name: ':nth-child and :nth-last-child with An+B',
    spec: 'selectors-4 §14.1, §14.2, css-syntax-3 §6',
    css: '',
    tree: div({}, [
      div({id: 'c1'}),
      div({id: 'c2'}),
      div({id: 'c3'}),
      div({id: 'c4'}),
      div({id: 'c5'}),
    ]),
    reads: [
      {id: 'c1', matches: ':nth-child(odd)', expect: true},
      {id: 'c2', matches: ':nth-child(odd)', expect: false},
      {id: 'c4', matches: ':nth-child(even)', expect: true},
      {id: 'c3', matches: ':nth-child(2n+1)', expect: true},
      {id: 'c3', matches: ':nth-child(-n+3)', expect: true},
      {id: 'c4', matches: ':nth-child(-n+3)', expect: false},
      {id: 'c3', matches: ':nth-child(3)', expect: true},
      {id: 'c5', matches: ':nth-child(n+4)', expect: true},
      {id: 'c2', matches: ':nth-child(n+4)', expect: false},
      {id: 'c4', matches: ':nth-last-child(2)', expect: true},
      {id: 'c5', matches: ':nth-last-child(odd)', expect: true},
      {id: 'c2', matches: ':nth-child( 2n + 0 )', expect: true},
      {id: 'c1', matches: ':nth-child(n)', expect: true},
    ],
  },
  {
    name: ':nth-child of a selector counts only its matches',
    spec: 'selectors-4 §14.1',
    css: '',
    tree: div({}, [
      div({id: 'a', class: 'x'}),
      div({id: 'b'}),
      div({id: 'c', class: 'x'}),
      div({id: 'd', class: 'x'}),
    ]),
    reads: [
      {id: 'c', matches: ':nth-child(2 of .x)', expect: true},
      {id: 'b', matches: ':nth-child(2 of .x)', expect: false},
      {id: 'd', matches: ':nth-child(odd of .x)', expect: true},
      {id: 'd', matches: ':nth-last-child(1 of .x)', expect: true},
    ],
  },
  {
    name: 'descendant, child, next-sibling and subsequent-sibling combinators',
    spec: 'selectors-4 §15.1–§15.4',
    css: '',
    tree: div({class: 'g'}, [
      div({class: 'p'}, [div({}, [div({id: 'deep'})]), div({id: 'kid'})]),
      div({id: 'n1', class: 'n'}),
      div({id: 'n2'}),
      div({id: 'n3'}),
    ]),
    reads: [
      {id: 'deep', matches: '.p div', expect: true},
      {id: 'deep', matches: '.p > div', expect: false},
      {id: 'kid', matches: '.p > div', expect: true},
      {id: 'n1', matches: '.p + div', expect: true},
      {id: 'n2', matches: '.p + div', expect: false},
      {id: 'n3', matches: '.p ~ div', expect: true},
      {id: 'n2', matches: '.g > .n + div', expect: true},
      {id: 'n3', matches: '.n ~ div ~ div', expect: true},
      {id: 'kid', matches: '.g .p > div:last-child', expect: true},
    ],
  },
  {
    name: ':root is the document element',
    spec: 'selectors-4 §14.4.1',
    css: `:root #t { height: 3px; } :root > #t { height: 9px; }`,
    tree: div({}, [div({id: 't'})]),
    reads: [
      {id: 't', rect: box(3)},
      {id: 't', matches: ':root', expect: false},
    ],
  },
  {
    name: ':disabled reads a form control, not any element',
    spec: 'html §4.16.3, selectors-4 §11.1',
    css: '',
    tree: div({}, [div({id: 't', disabled: ''})]),
    reads: [
      {id: 't', matches: ':disabled', expect: false},
      {id: 't', matches: '[disabled]', expect: true},
    ],
  },

  // -- specificity (selectors-4 §17) and the cascade (css-cascade-5 §6) --

  {
    name: 'an id beats any number of classes',
    spec: 'selectors-4 §17',
    css: `
      #t { height: 1px; }
      .a.b.c.d.e.f.g.h.i.j.k { height: 2px; }`,
    tree: div({}, [div({id: 't', class: 'a b c d e f g h i j k'})]),
    reads: [{id: 't', rect: box(1)}],
  },
  {
    name: 'more classes beat fewer, and a type adds less than a class',
    spec: 'selectors-4 §17',
    css: `
      .a.b { height: 2px; }
      div.a { height: 3px; }
      .a { height: 4px; }`,
    tree: div({}, [div({id: 't', class: 'a b'})]),
    reads: [{id: 't', rect: box(2)}],
  },
  {
    name: 'equal specificity: the later rule wins',
    spec: 'css-cascade-5 §6.6',
    css: `
      .a { height: 2px; }
      .b { height: 3px; }`,
    tree: div({}, [div({id: 't', class: 'b a'})]),
    reads: [{id: 't', rect: box(3)}],
  },
  {
    name: ':where adds nothing, :is and :not take their most specific argument',
    spec: 'selectors-4 §17',
    css: `
      :is(#t, .a) { height: 5px; }
      .a.a { height: 6px; }
      :where(#t) { width: 10px; }
      div { width: 20px; }
      :not(#zz, .y) { height: 7px; }`,
    tree: div({}, [div({id: 't', class: 'a'})]),
    reads: [{id: 't', rect: [0, 0, 20, 7]}],
  },
  {
    name: ':nth-child of a selector adds the selector’s specificity',
    spec: 'selectors-4 §17',
    css: `
      :nth-child(1 of #t) { height: 5px; }
      .a.a.a { height: 6px; }`,
    tree: div({}, [div({id: 't', class: 'a'})]),
    reads: [{id: 't', rect: box(5)}],
  },
  {
    name: 'an important declaration beats a more specific normal one',
    spec: 'css-cascade-5 §6.4',
    css: `
      .a { height: 2px !important; }
      #t { height: 3px; }`,
    tree: div({}, [div({id: 't', class: 'a'})]),
    reads: [{id: 't', rect: box(2)}],
  },
  {
    name: 'an inline style beats every rule, and an important rule beats it',
    spec: 'css-cascade-5 §6.1, §6.3',
    css: `
      #t { height: 3px; }
      .a { width: 40px !important; }`,
    tree: div({}, [
      div({id: 't', class: 'a', style: 'height: 8px; width: 9px'}),
    ]),
    reads: [{id: 't', rect: [0, 0, 40, 8]}],
  },
  {
    name: 'a later layer beats an earlier one, whatever the specificity',
    spec: 'css-cascade-5 §6.4',
    css: `
      @layer one, two;
      @layer two { div { height: 2px; } }
      @layer one { #t.a.b { height: 9px; } }`,
    tree: div({}, [div({id: 't', class: 'a b'})]),
    reads: [{id: 't', rect: box(2)}],
  },
  {
    name: 'unlayered rules beat every layer',
    spec: 'css-cascade-5 §6.4',
    css: `
      div { height: 4px; }
      @layer top { #t#t { height: 9px; } }`,
    tree: div({}, [div({id: 't'})]),
    reads: [{id: 't', rect: box(4)}],
  },
  {
    name: 'important declarations rank the layers in reverse',
    spec: 'css-cascade-5 §6.4',
    css: `
      @layer one, two;
      @layer one { div { height: 1px !important; } }
      @layer two { div { height: 2px !important; } }
      div { height: 3px !important; }`,
    tree: div({}, [div({id: 't'})]),
    reads: [{id: 't', rect: box(1)}],
  },
  {
    name: 'a layer is placed where it is first named',
    spec: 'css-cascade-5 §6.4.3',
    css: `
      @layer b { div { height: 2px; } }
      @layer a { div { height: 1px; } }
      @layer b { div { width: 20px; } }
      @layer a { div { width: 10px; } }`,
    tree: div({}, [div({id: 't'})]),
    reads: [{id: 't', rect: [0, 0, 10, 1]}],
  },
  {
    name: 'nested layers order inside their parent',
    spec: 'css-cascade-5 §6.4.2',
    css: `
      @layer outer { @layer x { div { height: 1px; } } @layer y { div { height: 2px; } } }
      @layer outer.x { div { width: 10px; } }
      @layer outer { div { width: 30px; } }`,
    tree: div({}, [div({id: 't'})]),
    reads: [{id: 't', rect: [0, 0, 30, 2]}],
  },
  {
    name: 'anonymous layers are each their own',
    spec: 'css-cascade-5 §6.4.2',
    css: `
      @layer { div { height: 1px; } }
      @layer { div { height: 2px; } }`,
    tree: div({}, [div({id: 't'})]),
    reads: [{id: 't', rect: box(2)}],
  },

  // -- custom properties (css-variables-1) --

  {
    name: 'a custom property inherits, and a descendant can redeclare it',
    spec: 'css-variables-1 §2',
    css: `
      .o { --h: 3px; }
      .i { --h: 5px; }
      .u { height: var(--h); }`,
    tree: div({class: 'o'}, [
      div({id: 'a', class: 'u'}),
      div({class: 'i'}, [div({id: 'b', class: 'u'})]),
    ]),
    reads: [
      {id: 'a', rect: box(3)},
      {id: 'b', rect: box(5, 0, 3)},
      {id: 'b', custom: '--h', expect: '5px'},
    ],
  },
  {
    name: 'a fallback stands in for a property nothing declared',
    spec: 'css-variables-1 §3',
    css: `
      #t { height: var(--missing, 6px); width: var(--also-missing, var(--w, 12px)); }`,
    tree: div({}, [div({id: 't'})]),
    reads: [{id: 't', rect: [0, 0, 12, 6]}],
  },
  {
    name: 'a fallback runs to the closing parenthesis, commas included',
    spec: 'css-variables-1 §3',
    css: `#t { --x: var(--missing, 1px, 2px); }`,
    tree: div({}, [div({id: 't'})]),
    reads: [{id: 't', custom: '--x', expect: '1px, 2px'}],
  },
  {
    name: 'a reference resolves where it is declared, not where it is used',
    spec: 'css-variables-1 §3',
    css: `
      .o { --a: 4px; --b: var(--a); }
      .i { --a: 9px; height: var(--b); }`,
    tree: div({class: 'o'}, [div({id: 't', class: 'i'})]),
    reads: [{id: 't', rect: box(4)}],
  },
  {
    name: 'properties in a cycle are invalid, and a fallback stands in',
    spec: 'css-variables-1 §2.3',
    css: `
      #t { --a: var(--b); --b: var(--a); height: var(--a, 5px); --c: var(--c); width: var(--c, 15px); }`,
    tree: div({}, [div({id: 't'})]),
    reads: [{id: 't', rect: [0, 0, 15, 5]}],
  },
  {
    name: 'initial makes a custom property the guaranteed-invalid value',
    spec: 'css-variables-1 §2.1',
    css: `
      .o { --h: 9px; }
      #t { --h: initial; height: var(--h, 3px); }`,
    tree: div({class: 'o'}, [div({id: 't'})]),
    reads: [{id: 't', rect: box(3)}],
  },
  {
    name: 'a declaration invalid at computed-value time is unset',
    spec: 'css-variables-1 §3.1',
    css: `
      .o { --c: 10px; --len: green; }
      #t { width: 40px; height: 2px; }
      #t { width: var(--len); background-color: var(--c); }`,
    tree: div({class: 'o'}, [div({id: 't'})]),
    // width falls back to its initial value, auto, not to the earlier 40px;
    // background-color to transparent
    reads: [
      {id: 't', rect: box(2)},
      {id: 't', background: [0, 0, 0, 0]},
    ],
  },
  {
    name: 'a custom property in a shorthand',
    spec: 'css-variables-1 §3.2',
    css: `
      .o { --m: 1px 2px 3px 4px; }
      #t { margin: var(--m); height: 5px; }`,
    tree: div({class: 'o'}, [div({id: 't'})]),
    reads: [{id: 't', rect: [4, 1, 294, 5]}],
  },
  {
    name: 'custom properties are case-sensitive',
    spec: 'css-variables-1 §2',
    css: `
      #t { --H: 9px; --h: 2px; height: var(--h); }`,
    tree: div({}, [div({id: 't'})]),
    reads: [{id: 't', rect: box(2)}],
  },

  // -- values and units (css-values-4) --

  {
    name: 'calc with sums, products and nesting',
    spec: 'css-values-4 §10.1',
    css: `
      #a { height: calc(10px + 5px); }
      #b { height: calc(3 * 4px - 2px); }
      #c { height: calc((20px + 10px) / 3); }
      #d { height: calc(calc(2px * 2) + 1px); }`,
    tree: div({}, [
      div({id: 'a'}),
      div({id: 'b'}),
      div({id: 'c'}),
      div({id: 'd'}),
    ]),
    reads: [
      {id: 'a', rect: box(15)},
      {id: 'b', rect: box(10, 0, 15)},
      {id: 'c', rect: box(10, 0, 25)},
      {id: 'd', rect: box(5, 0, 35)},
    ],
  },
  {
    name: 'min, max and clamp',
    spec: 'css-values-4 §10.2',
    css: `
      #a { height: min(10px, 4px, 7px); }
      #b { height: max(10px, 4px); }
      #c { height: clamp(5px, 1px, 20px); }
      #d { height: clamp(5px, 30px, 20px); }
      #e { height: clamp(5px, 8px, 20px); }`,
    tree: div({}, [
      div({id: 'a'}),
      div({id: 'b'}),
      div({id: 'c'}),
      div({id: 'd'}),
      div({id: 'e'}),
    ]),
    reads: [
      {id: 'a', rect: box(4)},
      {id: 'b', rect: box(10, 0, 4)},
      {id: 'c', rect: box(5, 0, 14)},
      {id: 'd', rect: box(20, 0, 19)},
      {id: 'e', rect: box(8, 0, 39)},
    ],
  },
  {
    name: 'a percentage in a math function is of the containing block',
    spec: 'css-values-4 §10.1, §10.2; CSS2 §10.2, §10.5',
    css: `
      #a { height: 1px; width: calc(100% - 2em); font-size: 10px; }
      #b { height: 1px; max-width: max(50%, 100px); }
      #c { height: 1px; width: clamp(100px, 50%, 120px); }
      #d { height: 1px; width: 100px; margin-left: max(0px, calc((100% - 100px) / 2)); }
      #p { height: 20px; }
      #e { height: calc(50% + 2px); }`,
    tree: div({}, [
      div({id: 'a'}),
      div({id: 'b'}),
      div({id: 'c'}),
      div({id: 'd'}),
      div({id: 'p'}, [div({id: 'e'})]),
    ]),
    reads: [
      {id: 'a', rect: [0, 0, 280, 1]},
      {id: 'b', rect: [0, 1, 150, 1]},
      {id: 'c', rect: [0, 2, 120, 1]},
      {id: 'd', rect: [100, 3, 100, 1]},
      {id: 'e', rect: [0, 4, 300, 12]},
    ],
  },
  {
    name: 'em is the element’s font size, and font-size em is its parent’s',
    spec: 'css-values-4 §6.1.1',
    css: `
      .o { font-size: 10px; }
      .m { font-size: 2em; height: 1em; }
      #t { font-size: 1.5em; height: 2em; width: 3em; }`,
    tree: div({class: 'o'}, [div({class: 'm'}, [div({id: 't'})])]),
    // .m is 20px, so #t is 30px and its lengths 60 and 90
    reads: [{id: 't', rect: [0, 0, 90, 60]}],
  },
  {
    name: 'rem is the root element’s font size',
    spec: 'css-values-4 §6.1.1',
    css: `
      .o { font-size: 40px; }
      #t { height: 0.5rem; width: 2rem; }`,
    tree: div({class: 'o'}, [div({id: 't'})]),
    reads: [{id: 't', rect: [0, 0, 32, 8]}],
  },
  {
    name: 'absolute units',
    spec: 'css-values-4 §6.2',
    css: `
      #a { height: 1in; }
      #b { height: 2.54cm; }
      #c { height: 72pt; }
      #d { height: 6pc; }
      #e { height: 25.4mm; }`,
    tree: div({}, [
      div({id: 'a'}),
      div({id: 'b'}),
      div({id: 'c'}),
      div({id: 'd'}),
      div({id: 'e'}),
    ]),
    reads: [
      {id: 'a', rect: box(96)},
      {id: 'b', rect: box(96, 0, 96)},
      {id: 'c', rect: box(96, 0, 192)},
      {id: 'd', rect: box(96, 0, 288)},
      {id: 'e', rect: box(96, 0, 384)},
    ],
  },
  {
    name: 'calc with em and rem together',
    spec: 'css-values-4 §10.1',
    css: `#t { font-size: 10px; height: calc(2em + 1rem); }`,
    tree: div({}, [div({id: 't'})]),
    reads: [{id: 't', rect: box(36)}],
  },

  // -- colours (css-color-4, css-color-5) --

  {
    name: 'hex, rgb and named colours',
    spec: 'css-color-4 §5, §6, §5.1',
    css: `
      #a { background-color: #f00; }
      #b { background-color: #00800080; }
      #c { background-color: rgb(0 0 255 / 50%); }
      #d { background-color: rgba(255, 0, 0, 0.25); }
      #e { background-color: green; }
      #f { background-color: transparent; }`,
    tree: div(
      {},
      ['a', 'b', 'c', 'd', 'e', 'f'].map(id => div({id})),
    ),
    reads: [
      {id: 'a', background: RED},
      {id: 'b', background: [0, 128, 0, 0.502]},
      {id: 'c', background: [0, 0, 255, 0.5]},
      {id: 'd', background: [255, 0, 0, 0.25]},
      {id: 'e', background: GREEN},
      {id: 'f', background: [0, 0, 0, 0]},
    ],
  },
  {
    name: 'hsl and hwb',
    spec: 'css-color-4 §7, §8',
    css: `
      #a { background-color: hsl(120 100% 25%); }
      #b { background-color: hsl(240, 100%, 50%); }
      #c { background-color: hwb(0 0% 0%); }`,
    tree: div(
      {},
      ['a', 'b', 'c'].map(id => div({id})),
    ),
    reads: [
      {id: 'a', background: [0, 128, 0, 1]},
      {id: 'b', background: BLUE},
      {id: 'c', background: RED},
    ],
  },
  {
    name: 'currentColor is the element’s color, inherited or its own',
    spec: 'css-color-4 §4.4',
    css: `
      .o { color: blue; }
      #a { background-color: currentColor; }
      #b { color: red; background-color: currentColor; }`,
    tree: div({class: 'o'}, [div({id: 'a'}), div({id: 'b'})]),
    reads: [
      {id: 'a', background: BLUE},
      {id: 'b', background: RED},
    ],
  },
  {
    name: 'color-mix in sRGB',
    spec: 'css-color-5 §2',
    css: `
      #a { background-color: color-mix(in srgb, red, blue); }
      #b { background-color: color-mix(in srgb, red 25%, blue); }
      #c { background-color: color-mix(in srgb, red, transparent); }`,
    tree: div(
      {},
      ['a', 'b', 'c'].map(id => div({id})),
    ),
    reads: [
      {id: 'a', background: [128, 0, 128, 1]},
      {id: 'b', background: [64, 0, 191, 1]},
      {id: 'c', background: [255, 0, 0, 0.5]},
    ],
  },
  {
    name: 'light-dark picks by the used colour scheme',
    spec: 'css-color-5 §8',
    css: `
      #a { color-scheme: light; background-color: light-dark(red, blue); }
      #b { color-scheme: dark; background-color: light-dark(red, blue); }`,
    tree: div({}, [div({id: 'a'}), div({id: 'b'})]),
    reads: [
      {id: 'a', background: RED},
      {id: 'b', background: BLUE},
    ],
  },

  // -- shorthands --

  {
    name: 'margin and padding with one to four values',
    spec: 'css-box-4 §3.2, §4.2',
    css: `
      #a { margin: 1px; height: 2px; }
      #b { margin: 1px 2px; height: 2px; }
      #c { margin: 1px 2px 3px; height: 2px; }
      #d { padding: 1px 2px 3px 4px; height: 2px; }`,
    tree: div({}, [
      div({id: 'a'}),
      div({id: 'b'}),
      div({id: 'c'}),
      div({id: 'd'}),
    ]),
    // No margin collapses between flex items: each box is its margins apart
    reads: [
      {id: 'a', rect: [1, 1, 298, 2]},
      {id: 'b', rect: [2, 5, 296, 2]},
      {id: 'c', rect: [2, 9, 296, 2]},
      {id: 'd', rect: [0, 14, 300, 6]},
    ],
  },
  {
    name: 'a longhand after its shorthand wins, and a shorthand after resets it',
    spec: 'css-cascade-5 §1.2',
    css: `
      #a { padding: 4px; padding-top: 1px; height: 2px; }
      #b { padding-top: 1px; padding: 4px; height: 2px; }`,
    tree: div({}, [div({id: 'a'}), div({id: 'b'})]),
    reads: [
      {id: 'a', rect: [0, 0, 300, 7]},
      {id: 'b', rect: [0, 7, 300, 10]},
    ],
  },
  {
    name: 'border-width and the border shorthand',
    spec: 'css-backgrounds-3 §4.3, §4.4',
    css: `
      #a { border-width: 1px 2px; border-style: solid; height: 2px; }
      #b { border: 3px solid red; height: 2px; }
      #c { border-top: 4px solid; height: 2px; }`,
    tree: div({}, [div({id: 'a'}), div({id: 'b'}), div({id: 'c'})]),
    reads: [
      {id: 'a', rect: [0, 0, 300, 4]},
      {id: 'b', rect: [0, 4, 300, 8]},
      {id: 'c', rect: [0, 12, 300, 6]},
    ],
  },
  {
    name: 'a border style of none makes the width zero',
    spec: 'css-backgrounds-3 §4.3',
    css: `#t { border-width: 5px; border-style: none; height: 2px; }`,
    tree: div({}, [div({id: 't'})]),
    reads: [{id: 't', rect: box(2)}],
  },
  {
    name: 'logical margins and padding in a horizontal writing mode',
    spec: 'css-logical-1 §4',
    css: `
      #t { margin-inline-start: 5px; margin-block-start: 3px; padding-inline: 1px 2px; height: 2px; }`,
    tree: div({}, [div({id: 't'})]),
    reads: [{id: 't', rect: [5, 3, 295, 2]}],
  },
  {
    name: 'inset in a positioned box',
    spec: 'css-position-3 §3.1',
    css: `
      .o { position: relative; height: 100px; }
      #t { position: absolute; inset: 10px 20px auto auto; width: 5px; height: 6px; }`,
    tree: div({class: 'o'}, [div({id: 't'})]),
    reads: [{id: 't', rect: [275, 10, 5, 6]}],
  },
  {
    name: 'flex: a number is a grow factor over a zero basis',
    spec: 'css-flexbox-1 §7.1.1',
    css: `
      .row { display: flex; flex-direction: row; height: 10px; }
      #a { flex: 1; }
      #b { flex: 2; }
      #c { flex: none; width: 30px; }`,
    tree: div({class: 'row'}, [div({id: 'a'}), div({id: 'b'}), div({id: 'c'})]),
    reads: [
      {id: 'a', rect: [0, 0, 90, 10]},
      {id: 'b', rect: [90, 0, 180, 10]},
      {id: 'c', rect: [270, 0, 30, 10]},
    ],
  },
  {
    name: 'gap with one or two values',
    spec: 'css-align-3 §8.1',
    css: `
      .row { display: flex; flex-direction: row; gap: 5px 10px; }
      .row > div { width: 20px; height: 20px; }`,
    tree: div({class: 'row'}, [div({id: 'a'}), div({id: 'b'})]),
    reads: [{id: 'b', rect: [30, 0, 20, 20]}],
  },

  // -- keywords --

  {
    name: 'inherit takes the parent’s computed value, initial the initial one',
    spec: 'css-cascade-5 §7.2, §7.1',
    css: `
      .o { height: 20px; width: 120px; }
      #a { height: inherit; width: inherit; }
      #b { height: 5px; width: 60px; }
      #b { width: initial; }`,
    tree: div({}, [div({class: 'o'}, [div({id: 'a'})]), div({id: 'b'})]),
    reads: [
      {id: 'a', rect: [0, 0, 120, 20]},
      {id: 'b', rect: [0, 20, 300, 5]},
    ],
  },
  {
    name: 'unset inherits an inherited property and resets the rest',
    spec: 'css-cascade-5 §7.3',
    css: `
      .o { color: red; height: 10px; }
      #t { color: blue; color: unset; background-color: currentColor; height: 4px; height: unset; }`,
    tree: div({}, [div({class: 'o'}, [div({id: 't'})])]),
    reads: [
      {id: 't', background: RED},
      {id: 't', rect: box(0)},
    ],
  },

  // -- media queries (mediaqueries-4, mediaqueries-5) --

  {
    name: 'media types and negation',
    spec: 'mediaqueries-4 §2.3, §2.2',
    css: `
      @media screen { #a { height: 1px; } }
      @media print { #b { height: 9px; } }
      @media not print { #c { height: 3px; } }
      @media only screen { #d { height: 4px; } }
      @media all and (min-width: 0px) { #e { height: 5px; } }`,
    tree: div(
      {},
      ['a', 'b', 'c', 'd', 'e'].map(id => div({id})),
    ),
    reads: [
      {id: 'a', rect: box(1)},
      {id: 'b', rect: box(0, 0, 1)},
      {id: 'c', rect: box(3, 0, 1)},
      {id: 'd', rect: box(4, 0, 4)},
      {id: 'e', rect: box(5, 0, 8)},
    ],
  },
  {
    name: 'range syntax and boolean logic',
    spec: 'mediaqueries-4 §2.4.3, §3',
    css: `
      @media (width >= 1px) { #a { height: 1px; } }
      @media (1px <= width <= 100000px) { #b { height: 2px; } }
      @media (max-width: 0px), (min-width: 1px) { #c { height: 3px; } }
      @media (max-width: 0px) or (min-width: 1px) { #d { height: 4px; } }
      @media not ((max-width: 0px) and (color)) { #e { height: 5px; } }
      @media (color) { #f { height: 6px; } }
      @media (monochrome) { #g { height: 9px; } }`,
    tree: div(
      {},
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => div({id})),
    ),
    reads: [
      {id: 'a', rect: box(1)},
      {id: 'b', rect: box(2, 0, 1)},
      {id: 'c', rect: box(3, 0, 3)},
      {id: 'd', rect: box(4, 0, 6)},
      {id: 'e', rect: box(5, 0, 10)},
      {id: 'f', rect: box(6, 0, 15)},
      {id: 'g', rect: box(0, 0, 21)},
    ],
  },
  {
    name: 'an unknown feature is false, and so is its negation',
    spec: 'mediaqueries-4 §3.2',
    css: `
      @media (unknown-feature) { #a { height: 9px; } }
      @media not (unknown-feature) { #b { height: 9px; } }
      @media (min-width: 0px) and (unknown-feature: 1) { #c { height: 9px; } }
      #a, #b, #c { width: 10px; }`,
    tree: div(
      {},
      ['a', 'b', 'c'].map(id => div({id})),
    ),
    reads: [
      {id: 'a', rect: [0, 0, 10, 0]},
      {id: 'b', rect: [0, 0, 10, 0]},
      {id: 'c', rect: [0, 0, 10, 0]},
    ],
  },
  {
    name: 'nested @media applies when both apply',
    spec: 'css-conditional-3 §2',
    css: `
      @media screen { @media (min-width: 0px) { #a { height: 2px; } } @media print { #b { height: 9px; } } }`,
    tree: div({}, [div({id: 'a'}), div({id: 'b'})]),
    reads: [
      {id: 'a', rect: box(2)},
      {id: 'b', rect: box(0, 0, 2)},
    ],
  },
  {
    name: '@supports with a property, not, and, or',
    spec: 'css-conditional-3 §6',
    css: `
      @supports (display: flex) { #a { height: 1px; } }
      @supports not (display: flex) { #b { height: 9px; } }
      @supports (display: flex) and (not (unknown-property: 1)) { #c { height: 3px; } }
      @supports (unknown-property: 1) or (height: 1px) { #d { height: 4px; } }
      @supports (unknown-property: 1) { #e { height: 9px; } }`,
    tree: div(
      {},
      ['a', 'b', 'c', 'd', 'e'].map(id => div({id})),
    ),
    reads: [
      {id: 'a', rect: box(1)},
      {id: 'b', rect: box(0, 0, 1)},
      {id: 'c', rect: box(3, 0, 1)},
      {id: 'd', rect: box(4, 0, 4)},
      {id: 'e', rect: box(0, 0, 8)},
    ],
  },

  // -- @scope (css-cascade-6) --

  {
    name: '@scope applies inside its root and stops at its limit',
    spec: 'css-cascade-6 §2.5',
    css: `
      @scope (.card) to (.inner) { .t { height: 2px; } }
      @scope (.card) { :scope { width: 100px; } }`,
    tree: div({}, [
      div({id: 'card', class: 'card'}, [
        div({id: 'in', class: 't'}),
        div({class: 'inner'}, [div({id: 'out', class: 't'})]),
      ]),
      div({id: 'outside', class: 't'}),
    ]),
    reads: [
      {id: 'in', rect: [0, 0, 100, 2]},
      {id: 'out', rect: [0, 2, 100, 0]},
      {id: 'outside', rect: [0, 2, 300, 0]},
    ],
  },
  {
    name: 'scope proximity: the nearer scope root wins',
    spec: 'css-cascade-6 §2.5.3',
    css: `
      @scope (.b) { .t { height: 2px; } }
      @scope (.a) { .t { height: 9px; } }`,
    tree: div({class: 'b'}, [div({class: 'a'}, [div({id: 't', class: 't'})])]),
    reads: [{id: 't', rect: box(9)}],
  },

  {
    name: 'scope proximity outranks source order',
    spec: 'css-cascade-6 §2.5.3',
    css: `
      @scope (.a) { .t { height: 2px; } }
      @scope (.b) { .t { height: 9px; } }`,
    tree: div({class: 'b'}, [div({class: 'a'}, [div({id: 't', class: 't'})])]),
    reads: [{id: 't', rect: box(2)}],
  },
  {
    name: '@supports selector()',
    spec: 'css-conditional-4 §2',
    css: `
      @supports selector(.a > .b) { #a { height: 1px; } }
      @supports selector(:unknown-pseudo) { #b { height: 9px; } }
      @supports not selector(:unknown-pseudo) { #c { height: 3px; } }`,
    tree: div(
      {},
      ['a', 'b', 'c'].map(id => div({id})),
    ),
    reads: [
      {id: 'a', rect: box(1)},
      {id: 'b', rect: box(0, 0, 1)},
      {id: 'c', rect: box(3, 0, 1)},
    ],
  },

  // -- syntax (css-syntax-3) --

  {
    name: 'comments, escapes and case in identifiers',
    spec: 'css-syntax-3 §4.3, §4.3.7',
    css: `
      /* a comment */ .a\\62 c { height: 3px; } /* .abc */
      DIV.UPPER { width: 10px; }
      #t2 { HEIGHT: 4px; }`,
    tree: div({}, [
      div({id: 't', class: 'abc'}),
      div({id: 't2', class: 'UPPER'}),
    ]),
    reads: [
      {id: 't', rect: box(3)},
      {id: 't2', rect: [0, 3, 10, 4]},
    ],
  },
  {
    name: 'an invalid declaration is dropped, its neighbours kept',
    spec: 'css-syntax-3 §5.4.5',
    css: `
      #t { height: 2px; height: banana; width: 10px; width: 10; }`,
    tree: div({}, [div({id: 't'})]),
    reads: [{id: 't', rect: [0, 0, 10, 2]}],
  },
  {
    name: 'an unknown at-rule is skipped whole, block and all',
    spec: 'css-syntax-3 §5.4.2',
    css: `
      @unknown-rule foo { #t { height: 9px; } }
      #t { height: 3px; }`,
    tree: div({}, [div({id: 't'})]),
    reads: [{id: 't', rect: box(3)}],
  },
  // -- origins (css-cascade-5) --

  {
    name: 'an author’s padding and margin beat the user agent’s, however each is spelled',
    spec: 'css-cascade-5 §6.1; HTML §15.3.7, §15.3.8',
    // The user agent indents a list with `padding-inline-start: 40px`, and a
    // block quote and a description with an inline-start margin; the prelude's
    // `margin: 0; padding: 0` is the author's, at no specificity
    css: `
      li, #q, #v { height: 4px; }`,
    tree: div({}, [
      ['ul', {}, [['li', {id: 'u'}, []]]],
      ['ol', {}, [['li', {id: 'o'}, []]]],
      ['blockquote', {}, [div({id: 'q'})]],
      ['dl', {}, [['dd', {}, [div({id: 'v'})]]]],
    ]),
    reads: [
      {id: 'u', rect: box(4)},
      {id: 'o', rect: box(4, 0, 4)},
      {id: 'q', rect: box(4, 0, 8)},
      {id: 'v', rect: box(4, 0, 12)},
    ],
  },
];

module.exports = {CASES, PRELUDE};
