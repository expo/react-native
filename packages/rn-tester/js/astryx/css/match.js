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
 * Selector matching and the cascade (selectors-4, cascade-5) over the element
 * descriptors the intrinsics runtime maintains. Rules are indexed by their
 * subject's classes and tag, so an element tests only the rules that could
 * match it rather than the whole sheet.
 */

import type {ComplexSelector, Compound, StyleRule, Stylesheet} from './parse';

export type InteractionStates = {
  readonly hovered?: boolean,
  readonly pressed?: boolean,
  readonly focused?: boolean,
  readonly focusVisible?: boolean,
  readonly disabled?: boolean,
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

export type MatchContext = {
  schemeIsDark: boolean,
  reduceMotion: boolean,
  windowWidth: number,
  windowHeight: number,
  // A touch-first platform fails the hover and fine-pointer media branches
  touch: boolean,
};

export type MatchResult = {
  // Winning declarations after the cascade, kebab-case as authored
  declarations: {[string]: string},
  // Some candidate selector gates on interaction state, so the runtime must
  // track interaction and re-match when it changes even if nothing matches now
  dependsOnStates: boolean,
};

// :root and :disabled are read off the element itself, not tracked as
// interaction
function isInteractionPseudo(pseudo: string): boolean {
  return pseudo !== 'root' && pseudo !== 'disabled';
}

// Comma is OR and 'and' is AND. An unknown feature makes its branch false: a
// rule guarded by something the runtime cannot model must not apply.
export function mediaConditionApplies(
  condition: string,
  ctx: MatchContext,
): boolean {
  return condition.split(',').some(branch => {
    const terms = branch.split(/\band\b/);
    return terms.every(term => mediaTermApplies(term.trim(), ctx));
  });
}

function mediaTermApplies(term: string, ctx: MatchContext): boolean {
  const inner = term
    .replace(/^\(|\)$/g, '')
    .trim()
    .toLowerCase();
  if (inner === 'screen' || inner === 'all') {
    return true;
  }
  const colon = inner.indexOf(':');
  if (colon === -1) {
    return false;
  }
  const feature = inner.slice(0, colon).trim();
  const value = inner.slice(colon + 1).trim();
  switch (feature) {
    case 'min-width':
      return ctx.windowWidth >= parseLength(value);
    case 'max-width':
      return ctx.windowWidth <= parseLength(value);
    case 'min-height':
      return ctx.windowHeight >= parseLength(value);
    case 'max-height':
      return ctx.windowHeight <= parseLength(value);
    case 'prefers-color-scheme':
      return value === (ctx.schemeIsDark ? 'dark' : 'light');
    case 'prefers-reduced-motion':
      return (value === 'reduce') === ctx.reduceMotion;
    case 'hover':
      return (value === 'hover') !== ctx.touch;
    case 'pointer':
      return (value === 'coarse') === ctx.touch;
    case 'orientation':
      return (value === 'landscape') === ctx.windowWidth > ctx.windowHeight;
    default:
      return false;
  }
}

function parseLength(value: string): number {
  // A 16px root; px and rem cover every breakpoint Tailwind emits
  const n = parseFloat(value);
  if (Number.isNaN(n)) {
    return Number.POSITIVE_INFINITY;
  }
  return value.endsWith('rem') || value.endsWith('em') ? n * 16 : n;
}

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

type IndexedRule = {
  rule: StyleRule,
  selector: ComplexSelector,
  // cascade-5 §6.3: unlayered rules beat layered ones, and a later-declared
  // layer wins. Layered rules take their declaration index and unlayered ones
  // a rank above every layer, so an ascending sort runs weakest first.
  layerRank: number,
};

export type Matcher = {
  matchDeclarations: (el: ElementDescriptor, ctx: MatchContext) => MatchResult,
  keyframes: (
    name: string,
  ) => Array<{offset: number, declarations: {[string]: string}}> | null,
  // A sheet with no interactive selectors lets every element skip state
  // tracking
  anyStateDependent: boolean,
  // Whether some rule reads this class's interaction state from an ancestor
  // position (`.group:hover .x`), the only reason an element whose own styling
  // never changes still tracks state
  tracksStateForDescendants: (cls: string) => boolean,
};

export function createMatcher(sheets: Array<Stylesheet>): Matcher {
  // The first declaration of a layer, across sheets, fixes its slot
  const layerOrder: Array<string> = [];
  for (const sheet of sheets) {
    for (const name of sheet.layerOrder) {
      if (!layerOrder.includes(name)) {
        layerOrder.push(name);
      }
    }
  }
  const unlayeredRank = layerOrder.length;

  const byClass: Map<string, Array<IndexedRule>> = new Map();
  const byTag: Map<string, Array<IndexedRule>> = new Map();
  const universal: Array<IndexedRule> = [];
  const rootRules: Array<IndexedRule> = [];
  const keyframesByName: Map<
    string,
    Array<{offset: number, declarations: {[string]: string}}>,
  > = new Map();
  let anyStateDependent = false;
  const statefulAncestorClasses = new Set<string>();

  for (const sheet of sheets) {
    for (const kf of sheet.keyframes) {
      keyframesByName.set(kf.name, kf.stops);
    }
    for (const rule of sheet.rules) {
      for (const selector of rule.selectors) {
        if (selector.unsupported || selector.parts.length === 0) {
          continue;
        }
        const layerRank =
          rule.layer == null
            ? unlayeredRank
            : Math.max(0, layerOrder.indexOf(rule.layer));
        const indexed: IndexedRule = {rule, selector, layerRank};
        const subject = selector.parts[selector.parts.length - 1].compound;
        if (subject.pseudoClasses.length > 0) {
          anyStateDependent = true;
        }
        // `.group:hover .x` styles .x from an ancestor's state. The ancestor
        // is not the subject, so it is never indexed as a candidate and has to
        // be told that something depends on its state.
        for (let i = 0; i < selector.parts.length - 1; i++) {
          const ancestor = selector.parts[i].compound;
          if (ancestor.pseudoClasses.some(isInteractionPseudo)) {
            for (const cls of ancestor.classes) {
              statefulAncestorClasses.add(cls);
            }
          }
        }
        if (subject.pseudoClasses.includes('root')) {
          rootRules.push(indexed);
          continue;
        }
        if (subject.classes.length > 0) {
          // Index under one class; matching re-checks the rest
          const key = subject.classes[0];
          let list = byClass.get(key);
          if (list == null) {
            list = [];
            byClass.set(key, list);
          }
          list.push(indexed);
        } else if (subject.tag != null) {
          const tagKey = subject.tag;
          let list = byTag.get(tagKey);
          if (list == null) {
            list = [];
            byTag.set(tagKey, list);
          }
          list.push(indexed);
        } else {
          universal.push(indexed);
        }
      }
    }
  }

  function candidatesFor(el: ElementDescriptor): Array<IndexedRule> {
    const out: Array<IndexedRule> = [];
    for (const cls of el.classes) {
      const list = byClass.get(cls);
      if (list != null) {
        out.push(...list);
      }
    }
    if (el.tag != null) {
      const list = byTag.get(el.tag);
      if (list != null) {
        out.push(...list);
      }
    }
    out.push(...universal);
    if (el.isRoot === true) {
      out.push(...rootRules);
    }
    return out;
  }

  function matchDeclarations(
    el: ElementDescriptor,
    ctx: MatchContext,
  ): MatchResult {
    const matched: Array<{
      indexed: IndexedRule,
      specificity: number,
      order: number,
    }> = [];
    let dependsOnStates = false;

    for (const indexed of candidatesFor(el)) {
      const subject =
        indexed.selector.parts[indexed.selector.parts.length - 1].compound;
      if (subject.pseudoClasses.some(isInteractionPseudo)) {
        // An interaction pseudo on a candidate makes the element's styling
        // state-dependent whether or not it matches now
        dependsOnStates = true;
      }
      if (
        indexed.rule.media.length > 0 &&
        !indexed.rule.media.every(m => mediaConditionApplies(m, ctx))
      ) {
        continue;
      }
      if (!selectorMatches(indexed.selector, el, ctx)) {
        continue;
      }
      matched.push({
        indexed,
        specificity: indexed.selector.specificity,
        order: indexed.rule.order,
      });
    }

    // Weakest first, so a plain merge leaves the strongest declaration
    // standing: layer rank, then specificity, then source order
    matched.sort((x, y) => {
      if (x.indexed.layerRank !== y.indexed.layerRank) {
        return x.indexed.layerRank - y.indexed.layerRank;
      }
      if (x.specificity !== y.specificity) {
        return x.specificity - y.specificity;
      }
      return x.order - y.order;
    });

    const declarations: {[string]: string} = {};
    for (const m of matched) {
      const source = m.indexed.rule.declarations;
      for (const property of Object.keys(source)) {
        declarations[property] = source[property];
      }
    }
    return {declarations, dependsOnStates};
  }

  return {
    matchDeclarations,
    keyframes: name => keyframesByName.get(name) ?? null,
    anyStateDependent,
    tracksStateForDescendants: (cls: string) =>
      statefulAncestorClasses.has(cls),
  };
}
