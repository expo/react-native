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

// $FlowFixMe[untyped-import]
import demoCss from '../../examples/Astryx/css-stylesheets-demo.css';
// $FlowFixMe[untyped-import]
import radixCss from '../../examples/Astryx/radix-demo.css';
// $FlowFixMe[untyped-import]
import shadcnGlobals from '../../shadcn/globals.css';

/*
 * A demo screen's stylesheet must not reach the screen next door.
 *
 * `installStylesheet` is global and every one of these calls it at MODULE
 * scope, while `RNTesterList` requires all ~108 example modules at startup —
 * so all three sheets are live for the whole app whatever screen is showing.
 * There is one cascade, and a `:root` block in any of them is a `:root` block
 * for every screen.
 *
 * That is how the CSS-stylesheets demo's `--accent: rgb(21, 112, 239)` became
 * shadcn's accent: pressing an `outline` or `ghost` button — the two variants
 * whose only interaction rule is `hover:bg-accent` — painted them that blue,
 * with the theme's dark label left on top of it. Its `--radius: 10px` was
 * quietly resizing every shadcn corner too.
 *
 * The fix is a naming convention, and this is what keeps it: a per-screen
 * sheet prefixes its tokens (`--rx-` for Radix, `--cs-` for the CSS demo) so
 * it cannot collide with a design system that uses the conventional names.
 */
function customProperties(css: string): Set<string> {
  const names = new Set<string>();
  // Definitions only (`--x: value`), not `var(--x)` references.
  const pattern = /(--[a-zA-Z][\w-]*)\s*:/g;
  let match = pattern.exec(css);
  while (match != null) {
    names.add(match[1]);
    match = pattern.exec(css);
  }
  return names;
}

const THEME = customProperties(shadcnGlobals);

describe('per-screen demo stylesheets', () => {
  it.each([
    ['css-stylesheets-demo.css', demoCss, '--cs-'],
    ['radix-demo.css', radixCss, '--rx-'],
  ])('%s defines no token the shadcn theme also defines', (_name, css) => {
    const shared = [...customProperties(css)].filter(token =>
      THEME.has(token),
    );
    expect(shared).toEqual([]);
  });

  it.each([
    ['css-stylesheets-demo.css', demoCss, '--cs-'],
    ['radix-demo.css', radixCss, '--rx-'],
  ])('%s prefixes every token it defines', (_name, css, prefix) => {
    const unprefixed = [...customProperties(css)].filter(
      token => !token.startsWith(prefix),
    );
    expect(unprefixed).toEqual([]);
  });

  it('is checking something — the theme really does define these names', () => {
    // Without this the two cases above pass trivially if the theme import
    // ever resolves to an empty string.
    expect(THEME.has('--accent')).toBe(true);
    expect(THEME.has('--radius')).toBe(true);
  });
});
