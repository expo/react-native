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

/**
 * A demo screen's stylesheet must not reach the screen next door.
 * `installStylesheet` is global and every demo calls it at module scope while
 * `RNTesterList` requires every example module at startup, so all the sheets
 * are live at once and a `:root` block in any of them is a `:root` block for
 * every screen. A per-screen sheet therefore prefixes its tokens (`--rx-` for
 * Radix, `--cs-` for the CSS demo) so they cannot collide with a design
 * system's conventional names.
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
    const shared = [...customProperties(css)].filter(token => THEME.has(token));
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
    // Without this the two cases above pass trivially on an empty theme import
    expect(THEME.has('--accent')).toBe(true);
    expect(THEME.has('--radius')).toBe(true);
  });
});
