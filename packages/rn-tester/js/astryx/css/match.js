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
 * Selector matching and the cascade (selectors-4 and cascade-5, the subsets
 * the parser emits), over element descriptors the intrinsics runtime
 * maintains.
 *
 * A matcher is built once per stylesheet set and consulted per element per
 * render. Rules are indexed by their subject's classes and tag, so an
 * element pays for the rules that could plausibly match it — for a Tailwind
 * sheet that is exactly the element's own class list — rather than the
 * whole sheet.
 */

import type {ComplexSelector, Compound, StyleRule, Stylesheet} from './parse';

export type InteractionStates = {
  readonly hovered?: boolean,
  readonly pressed?: boolean,
  readonly focused?: boolean,
  readonly focusVisible?: boolean,
  readonly disabled?: boolean,
};

/**
 * What the runtime knows about one element. `parent` links form the ancestor
 * chain for descendant/child combinators.
 */
export type ElementDescriptor = {
  tag: string | null,
  classes: Array<string>,
  // Attribute values as the element carries them; `true` models a bare
  // boolean attribute ([disabled]), null/undefined absence.
  attributes: {readonly [string]: unknown},
  states: InteractionStates,
  parent: ElementDescriptor | null,
  isRoot?: boolean,
};

/**
 * The environment side of matching: everything that is not the element.
 */
export type MatchContext = {
  schemeIsDark: boolean,
  reduceMotion: boolean,
  windowWidth: number,
  windowHeight: number,
  // Touch-first platform: hover/fine-pointer media branches do not apply.
  touch: boolean,
};

export type MatchResult = {
  // Winning declarations after the cascade, kebab-case as authored.
  declarations: {[string]: string},
  // Some candidate selector for this element gates on interaction pseudo
  // states — the runtime must track interaction on the element and re-match
  // when states change, even if nothing matches right now.
  dependsOnStates: boolean,
};

// -----------------------------------------------------------------------------
// Media queries
// -----------------------------------------------------------------------------

/**
 * Evaluates one @media condition. Comma = OR; 'and' = AND; each feature in
 * parens. Unknown features make their branch false — a rule guarded by
 * something the runtime cannot model must not apply.
 */
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
  // px and rem (16px root) cover every breakpoint Tailwind emits.
  const n = parseFloat(value);
  if (Number.isNaN(n)) {
    return Number.POSITIVE_INFINITY;
  }
  return value.endsWith('rem') || value.endsWith('em') ? n * 16 : n;
}

// -----------------------------------------------------------------------------
// Compound matching
// -----------------------------------------------------------------------------

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

/**
 * The `.dark` scheme compound: exactly one class, 'dark', nothing else. It
 * matches a real `.dark` ancestor like any other compound, but ALSO matches
 * "the OS scheme is dark" with no such element — Tailwind's class-strategy
 * dark mode maps onto the platform appearance rather than requiring apps to
 * plant a class on an ancestor.
 */
function isSchemeDarkCompound(compound: Compound): boolean {
  return (
    compound.tag == null &&
    compound.classes.length === 1 &&
    compound.classes[0] === 'dark' &&
    compound.attributes.length === 0 &&
    compound.pseudoClasses.length === 0
  );
}

/**
 * Matches a complex selector with the element as subject, walking ancestors
 * right to left (selectors-4 §16).
 */
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

  // Right-to-left (selectors-4 §16): parts[i] must match `element`; the
  // prefix is then satisfied against its ancestors through the combinator
  // stored on parts[i-1] (which connects part i-1 to part i).
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
    // The one ancestor the ENVIRONMENT can provide: a virtual `.dark`
    // wrapping the root when the platform scheme is dark (Tailwind's
    // class-strategy dark mode mapped onto Appearance).
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

// -----------------------------------------------------------------------------
// The cascade
// -----------------------------------------------------------------------------

type IndexedRule = {
  rule: StyleRule,
  selector: ComplexSelector,
  // cascade-5 §6.3: un-layered rules beat layered ones; among layers,
  // later-declared wins. Encoded so a simple ascending sort applies weakest
  // first: layered rules get their declaration index, un-layered rules get
  // a rank above every layer.
  layerRank: number,
};

export type Matcher = {
  matchDeclarations: (el: ElementDescriptor, ctx: MatchContext) => MatchResult,
  keyframes: (
    name: string,
  ) => Array<{offset: number, declarations: {[string]: string}}> | null,
  // A sheet with no interactive selectors lets every element skip state
  // tracking wholesale.
  anyStateDependent: boolean,
};

export function createMatcher(sheets: Array<Stylesheet>): Matcher {
  // Global layer order: first declaration wins the slot, across sheets.
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
        if (subject.pseudoClasses.includes('root')) {
          rootRules.push(indexed);
          continue;
        }
        if (subject.classes.length > 0) {
          // Indexed under ONE class; the matcher re-checks the rest.
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
      if (subject.pseudoClasses.some(p => p !== 'root' && p !== 'disabled')) {
        // hover/active/focus[-visible] on a candidate — whether or not it
        // matches right now, the element's styling is interaction-dependent.
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
    // standing: layer rank, then specificity, then source order.
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
  };
}
