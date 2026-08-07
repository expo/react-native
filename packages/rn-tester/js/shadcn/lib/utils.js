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

// Utility roots that conflict when they share a prefix AND variant chain.
// 'p' covers p-*, px/py/pt/pr/pb/pl distinctly; color-bearing roots split on
// their own axis (text- size vs color cannot collide reliably without the
// full tailwind-merge tables; both being rare in one call, last-wins by
// whole-root is the documented approximation).
const CONFLICT_ROOTS = [
  'px',
  'py',
  'pt',
  'pr',
  'pb',
  'pl',
  'p',
  'mx',
  'my',
  'mt',
  'mr',
  'mb',
  'ml',
  'm',
  'w',
  'h',
  'min-w',
  'min-h',
  'max-w',
  'max-h',
  'size',
  'bg',
  'leading',
  'tracking',
  'rounded',
  'shadow',
  'opacity',
  'gap',
  'items',
  'justify',
  'flex',
  'grid',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'z',
  'ring',
  'ring-offset',
  'underline-offset',
];

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

function conflictKey(cls: string): string {
  // Split variants (hover:, focus-visible:, dark:, data-[...]:) from the
  // utility; conflicts only occur within the same variant chain.
  const lastColon = cls.lastIndexOf(':');
  const variants = lastColon === -1 ? '' : cls.slice(0, lastColon + 1);
  let utility = lastColon === -1 ? cls : cls.slice(lastColon + 1);
  const negative = utility.startsWith('-');
  if (negative) {
    utility = utility.slice(1);
  }
  // Roots whose suffix decides the AXIS: text size vs color, font weight vs
  // family, border width vs color — the distinctions real tailwind-merge
  // draws from its class tables.
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
  if (utility === 'border' || /^border-\d/.test(utility)) {
    return variants + 'border-width';
  }
  if (utility.startsWith('border-')) {
    const side = utility.match(/^border-([trblxy]|[se])(?:-|$)/);
    if (side != null && /\d/.test(utility)) {
      return variants + 'border-width-' + side[1];
    }
    return variants + 'border-color';
  }
  for (const root of CONFLICT_ROOTS) {
    if (utility === root || utility.startsWith(root + '-')) {
      return variants + root;
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
