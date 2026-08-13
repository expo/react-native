/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

'use strict';

/**
 * `@/lib/utils` — shadcn's one utility: cn(...inputs) = twMerge(clsx(...)).
 *
 * clsx is implemented whole (it is tiny). The tailwind-merge half implements
 * the part shadcn actually leans on: LATER classes win over earlier ones in
 * the same conflict group (px-2 overriding px-4), so a consumer className
 * can override a component default regardless of stylesheet order. Grouping
 * is by utility root — the arbitrary-variant tail of real tailwind-merge is
 * out of scope and documented.
 */

function clsx(...inputs: Array<$FlowFixMe>): string {
  const out = [];
  for (const input of inputs) {
    if (input == null || input === false) {
      continue;
    }
    if (typeof input === 'string' || typeof input === 'number') {
      out.push(String(input));
    } else if (Array.isArray(input)) {
      const inner = clsx(...input);
      if (inner !== '') {
        out.push(inner);
      }
    } else if (typeof input === 'object') {
      for (const key of Object.keys(input)) {
        if (input[key]) {
          out.push(key);
        }
      }
    }
  }
  return out.join(' ');
}

// Real tailwind-merge resolves conflicts from a table of GROUPS, not from a
// class-name prefix: `flex` (display) and `flex-row` (flex-direction) share a
// prefix but never conflict, while `p-4` and `px-8` do. Collapsing them by
// prefix silently dropped `display: flex` whenever a component's own
// `flex flex-row` met a consumer className — which laid four inline badges
// out as four full-width blocks. These are the groups shadcn actually
// exercises; anything unmatched keys on its whole utility, so unknown
// classes never conflict with each other.
const DISPLAY_VALUES = new Set([
  'block',
  'inline-block',
  'inline',
  'flex',
  'inline-flex',
  'table',
  'grid',
  'inline-grid',
  'contents',
  'hidden',
  'flow-root',
  'list-item',
]);

const TEXT_SIZES = new Set([
  'xs',
  'sm',
  'base',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  '6xl',
  '7xl',
  '8xl',
  '9xl',
]);
const FONT_WEIGHTS = new Set([
  'thin',
  'extralight',
  'light',
  'normal',
  'medium',
  'semibold',
  'bold',
  'extrabold',
  'black',
]);
const FLEX_DIRECTIONS = new Set(['row', 'row-reverse', 'col', 'col-reverse']);
const FLEX_WRAPS = new Set(['wrap', 'wrap-reverse', 'nowrap']);
const POSITIONS = new Set([
  'static',
  'fixed',
  'absolute',
  'relative',
  'sticky',
]);

// Prefix → group, for utilities whose whole prefix IS one axis.
const PREFIX_GROUPS = [
  ['px', 'px'],
  ['py', 'py'],
  ['pt', 'pt'],
  ['pr', 'pr'],
  ['pb', 'pb'],
  ['pl', 'pl'],
  ['ps', 'ps'],
  ['pe', 'pe'],
  ['p', 'p'],
  ['mx', 'mx'],
  ['my', 'my'],
  ['mt', 'mt'],
  ['mr', 'mr'],
  ['mb', 'mb'],
  ['ml', 'ml'],
  ['ms', 'ms'],
  ['me', 'me'],
  ['m', 'm'],
  ['min-w', 'min-w'],
  ['min-h', 'min-h'],
  ['max-w', 'max-w'],
  ['max-h', 'max-h'],
  ['w', 'w'],
  ['h', 'h'],
  ['size', 'size'],
  ['bg', 'bg'],
  ['leading', 'leading'],
  ['tracking', 'tracking'],
  ['rounded', 'rounded'],
  ['shadow', 'shadow'],
  ['opacity', 'opacity'],
  ['gap-x', 'gap-x'],
  ['gap-y', 'gap-y'],
  ['gap', 'gap'],
  ['items', 'items'],
  ['justify', 'justify'],
  ['content', 'content'],
  ['inset-x', 'inset-x'],
  ['inset-y', 'inset-y'],
  ['inset', 'inset'],
  ['top', 'top'],
  ['right', 'right'],
  ['bottom', 'bottom'],
  ['left', 'left'],
  ['z', 'z'],
  ['ring-offset', 'ring-offset'],
  ['ring', 'ring'],
  ['underline-offset', 'underline-offset'],
  ['fill', 'fill'],
  ['stroke', 'stroke'],
  ['aspect', 'aspect'],
  ['grid-cols', 'grid-cols'],
  ['grid-rows', 'grid-rows'],
  ['order', 'order'],
  ['basis', 'basis'],
  ['grow', 'grow'],
  ['shrink', 'shrink'],
  ['origin', 'origin'],
  ['translate-x', 'translate-x'],
  ['translate-y', 'translate-y'],
  ['scale', 'scale'],
  ['rotate', 'rotate'],
  ['duration', 'duration'],
  ['delay', 'delay'],
  ['ease', 'ease'],
  ['animate', 'animate'],
  ['transition', 'transition'],
  ['overflow-x', 'overflow-x'],
  ['overflow-y', 'overflow-y'],
  ['overflow', 'overflow'],
  ['whitespace', 'whitespace'],
  ['break', 'break'],
  ['align', 'align'],
];

function conflictKey(cls: string): string {
  // Variants (hover:, focus-visible:, dark:, data-[…]:) scope the conflict:
  // two utilities only collide within the same variant chain.
  const lastColon = cls.lastIndexOf(':');
  const variants = lastColon === -1 ? '' : cls.slice(0, lastColon + 1);
  let utility = lastColon === -1 ? cls : cls.slice(lastColon + 1);
  if (utility.startsWith('-')) {
    utility = utility.slice(1);
  }

  // Bare keyword utilities: display and position are single-value axes.
  if (DISPLAY_VALUES.has(utility)) {
    return variants + 'display';
  }
  if (POSITIONS.has(utility)) {
    return variants + 'position';
  }

  // Prefixes whose SUFFIX decides which axis the utility sets.
  if (utility.startsWith('text-')) {
    const suffix = utility.slice('text-'.length);
    return variants + (TEXT_SIZES.has(suffix) ? 'text-size' : 'text-color');
  }
  if (utility.startsWith('font-')) {
    const suffix = utility.slice('font-'.length);
    return (
      variants + (FONT_WEIGHTS.has(suffix) ? 'font-weight' : 'font-family')
    );
  }
  if (utility.startsWith('flex-')) {
    const suffix = utility.slice('flex-'.length);
    if (FLEX_DIRECTIONS.has(suffix)) {
      return variants + 'flex-direction';
    }
    if (FLEX_WRAPS.has(suffix)) {
      return variants + 'flex-wrap';
    }
    return variants + 'flex';
  }
  if (utility === 'border' || /^border-\d/.test(utility)) {
    return variants + 'border-width';
  }
  if (utility.startsWith('border-')) {
    const sided = utility.match(/^border-([trblxyse])-/);
    if (sided != null && /\d/.test(utility)) {
      return variants + 'border-width-' + sided[1];
    }
    return variants + 'border-color';
  }

  for (const [prefix, group] of PREFIX_GROUPS) {
    if (utility === prefix || utility.startsWith(prefix + '-')) {
      return variants + group;
    }
  }
  return variants + utility;
}

export function twMerge(classNames: string): string {
  const classes = classNames.split(/\s+/).filter(Boolean);
  const byKey: Map<string, string> = new Map();
  for (const cls of classes) {
    byKey.set(conflictKey(cls), cls); // later wins
  }
  return [...byKey.values()].join(' ');
}

export function cn(...inputs: Array<$FlowFixMe>): string {
  return twMerge(clsx(...inputs));
}

export {clsx};
