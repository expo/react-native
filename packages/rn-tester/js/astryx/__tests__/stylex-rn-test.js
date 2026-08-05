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

import * as stylex from '../stylex-rn';

// The scenarios below are lifted from the vendored Astryx Card slice —
// they are the exact value shapes the runtime must resolve.

// `props()` resolves eagerly but *defers* custom properties nothing local or
// global defines, because an ancestor element may still supply them (CSS
// inheritance). The element finishes them via `resolveInherited()`. This
// helper runs both passes with no ancestor scope — i.e. what a lone element
// renders.
function resolved(
  result: stylex.StyleXProps,
  inheritedScope?: ?Map<string, unknown>,
) {
  return stylex.resolveInherited(
    result.style,
    result.__stylexVars,
    inheritedScope,
  ).style;
}

describe('stylex-rn', () => {
  beforeAll(() => {
    stylex.defineVars({
      '--spacing-4': '16px',
      '--spacing-2': '8px',
      '--border-width': '1px',
      '--radius-container': '12px',
      '--color-background-card': 'light-dark(#FFFFFF, #1F1F22)',
      '--shadow-low':
        '0px 1px 1px light-dark(rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.2)), 0px 2px 8px light-dark(rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.2))',
    });
  });

  it('resolves token references through defineVars', () => {
    const {style} = stylex.props({borderRadius: 'var(--radius-container)'});
    expect(style).toEqual({borderRadius: 12});
  });

  it('resolves element-local custom properties shadowing tokens', () => {
    const {style} = stylex.props({
      '--_card-radius': 'var(--radius-container)',
      borderRadius: 'var(--_card-radius)',
    });
    expect(style).toEqual({borderRadius: 12});
  });

  it('resolves chained var() fallbacks (the Astryx padding chains)', () => {
    const cardShorthand = 'var(--astryx-card-padding, var(--spacing-4))';
    const cardInline = `var(--astryx-card-padding-inline, ${cardShorthand})`;
    const cardInlineStart = `var(--astryx-card-padding-inline-start, ${cardInline})`;
    // Deferred by props() (nothing defines --astryx-card-padding), then
    // finished at the element, where the fallback chain applies.
    expect(stylex.props({paddingInlineStart: cardInlineStart}).style).toEqual({
      paddingInlineStart: cardInlineStart,
    });
    expect(
      resolved(stylex.props({paddingInlineStart: cardInlineStart})),
    ).toEqual({paddingInlineStart: 16});
  });

  it('evaluates calc() with var() arithmetic (border inset)', () => {
    expect(
      resolved(
        stylex.props({
          '--container-padding-inline-start':
            'var(--astryx-card-padding, var(--spacing-4))',
          paddingInlineStart:
            'calc(var(--container-padding-inline-start) - var(--border-width))',
        }),
      ),
    ).toEqual({paddingInlineStart: 15});
  });

  it('resolves light-dark() against the light scheme (test default)', () => {
    const {style} = stylex.props({
      backgroundColor: 'var(--color-background-card)',
    });
    expect(style).toEqual({backgroundColor: '#FFFFFF'});
  });

  it('resolves shadow token lists with embedded light-dark()', () => {
    const style = resolved(
      stylex.props({
        '--_card-elevation': 'var(--shadow-low)',
        boxShadow:
          'var(--_card-ring, 0 0 transparent), var(--_card-elevation, 0 0 transparent)',
      }),
    );
    expect(style).toEqual({
      boxShadow:
        '0 0 transparent, 0px 1px 1px rgba(0, 0, 0, 0.1), 0px 2px 8px rgba(0, 0, 0, 0.1)',
    });
  });

  it('merges styles last-wins, skipping falsy entries and arrays', () => {
    const styles = stylex.create({
      a: {padding: '16px', overflow: 'clip'},
      b: {padding: '8px'},
    });
    const {style} = stylex.props(styles.a, false && styles.a, null, [styles.b]);
    expect(style).toEqual({padding: 8, overflow: 'hidden'});
  });

  it('supports dynamic (function-valued) styles with null skips', () => {
    const styles = stylex.create({
      sizing: (width: ?number, height: ?number) => ({width, height}),
    });
    // $FlowFixMe[not-a-function] dynamic style
    const {style} = stylex.props(styles.sizing(300, null));
    expect(style).toEqual({width: 300});
  });

  it('takes the default branch of conditional values', () => {
    const {style} = stylex.props({
      color: {default: '#111111', ':hover': '#222222'},
    });
    expect(style).toEqual({color: '#111111'});
  });

  it('drops unsupported declarations without throwing', () => {
    // The runtime warns once per dropped property in dev; silence the repo's
    // warn-is-error jest guard for this intentional case.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const {style} = stylex.props({
      transitionProperty: 'opacity',
      cursor: 'pointer',
      anchorName: '--x',
      width: '50%',
    });
    expect(style).toEqual({width: '50%'});
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('stylex-rn interaction states', () => {
  // Astryx always guards hover with @media (hover: hover); the jest preset
  // reports Platform.OS === 'ios', so hover must NOT apply while :active and
  // :focus-visible must.
  const buttonStyles = {
    backgroundColor: '#0064E0',
    ':active': {backgroundColor: '#00459C'},
    ':focus-visible': {borderColor: '#2694FE'},
    '@media (hover: hover)': {':hover': {backgroundColor: '#1A74E4'}},
  };

  it('resolves the resting state by default', () => {
    const {style} = stylex.props(buttonStyles);
    expect(style).toEqual({backgroundColor: '#0064E0'});
  });

  it('applies :active on press', () => {
    const {style} = stylex.propsWithState({pressed: true}, buttonStyles);
    expect(style).toEqual({backgroundColor: '#00459C'});
  });

  it('applies :focus-visible on focus', () => {
    const {style} = stylex.propsWithState({focused: true}, buttonStyles);
    expect(style).toEqual({
      backgroundColor: '#0064E0',
      borderColor: '#2694FE',
    });
  });

  it('ignores @media (hover: hover) branches on touch platforms', () => {
    const {style} = stylex.propsWithState({hovered: true}, buttonStyles);
    expect(style).toEqual({backgroundColor: '#0064E0'});
  });

  it('resolves per-property conditional values against state', () => {
    const {style} = stylex.propsWithState(
      {pressed: true},
      {opacity: {default: 1, ':active': 0.7}},
    );
    expect(style).toEqual({opacity: 0.7});
  });

  it(':active wins over :focus (cascade order)', () => {
    const {style} = stylex.propsWithState(
      {focused: true, pressed: true},
      {
        color: '#111111',
        ':focus': {color: '#222222'},
        ':active': {color: '#333333'},
      },
    );
    expect(style).toEqual({color: '#333333'});
  });

  it('applies :disabled styling', () => {
    const {style} = stylex.propsWithState(
      {disabled: true},
      {color: '#111111', ':disabled': {color: '#A4B0BC'}},
    );
    expect(style).toEqual({color: '#A4B0BC'});
  });
});

describe('stylex-rn custom-property inheritance (M3)', () => {
  // The real Astryx shape: an ancestor (Card) declares
  // --container-padding-*, a descendant (Section) reads it — and resets it to
  // 0px for its own subtree.
  const ancestor = stylex.props({
    '--container-padding-inline-start': '16px',
    paddingInlineStart: 'var(--container-padding-inline-start)',
  });

  it('carries declared custom properties on the props for the element', () => {
    expect(ancestor.__stylexVars).toEqual({
      '--container-padding-inline-start': '16px',
    });
  });

  it('publishes a scope descendants can read', () => {
    const {scope} = stylex.resolveInherited(
      ancestor.style,
      ancestor.__stylexVars,
      null,
    );
    expect(scope?.get('--container-padding-inline-start')).toBe('16px');

    // The descendant reads the inherited value it could not resolve alone.
    const child = stylex.props({
      marginInlineStart:
        'calc(-1 * var(--container-padding-inline-start, 0px))',
    });
    expect(stylex.resolveInherited(child.style, null, scope).style).toEqual({
      marginInlineStart: -16,
    });
  });

  it('falls back only when no ancestor defines the property', () => {
    const child = stylex.props({
      marginInlineStart:
        'calc(-1 * var(--container-padding-inline-start, 8px))',
    });
    expect(stylex.resolveInherited(child.style, null, null).style).toEqual({
      marginInlineStart: -8,
    });
  });

  it('lets a descendant shadow the inherited value for its own subtree', () => {
    const {scope: outerScope} = stylex.resolveInherited(
      ancestor.style,
      ancestor.__stylexVars,
      null,
    );
    // Section's `inner`: reset for descendants, while its own box still used
    // the ancestor value.
    const section = stylex.props({'--container-padding-inline-start': '0px'});
    const {scope: innerScope} = stylex.resolveInherited(
      section.style,
      section.__stylexVars,
      outerScope,
    );
    expect(innerScope?.get('--container-padding-inline-start')).toBe('0px');
    // The outer scope is untouched (no mutation across the tree).
    expect(outerScope?.get('--container-padding-inline-start')).toBe('16px');

    const grandchild = stylex.props({
      paddingInlineStart: 'var(--container-padding-inline-start, 99px)',
    });
    expect(
      stylex.resolveInherited(grandchild.style, null, innerScope).style,
    ).toEqual({paddingInlineStart: 0});
  });

  it('resolves a declaration against the scope it sees before publishing', () => {
    const outer = stylex.props({'--layout-padding-outer-x': '24px'});
    const {scope: s1} = stylex.resolveInherited(
      outer.style,
      outer.__stylexVars,
      null,
    );
    // LayoutHeader's real declaration: chain through the ancestor's var.
    const header = stylex.props({
      '--container-padding-inline-start':
        'var(--layout-padding-outer-x, var(--spacing-4))',
    });
    const {scope: s2} = stylex.resolveInherited(
      header.style,
      header.__stylexVars,
      s1,
    );
    expect(s2?.get('--container-padding-inline-start')).toBe('24px');
  });
});

describe('rem units', () => {
  // Astryx's whole type scale is authored in rem, so without this every font
  // size reaches RN as a string and is rejected.
  it('resolves rem against a 16px root', () => {
    const {style} = stylex.props({fontSize: '0.875rem'});
    expect(style).toMatchObject({fontSize: 14});
  });

  it('handles the whole scale the tokens use', () => {
    const cases = [
      ['0.375rem', 6],
      ['0.75rem', 12],
      ['1rem', 16],
      ['1.25rem', 20],
    ];
    for (const [input, expected] of cases) {
      const {style} = stylex.props({fontSize: input});
      expect(style).toMatchObject({fontSize: expected});
    }
  });

  it('leaves px values alone', () => {
    const {style} = stylex.props({fontSize: '13px'});
    expect(style).toMatchObject({fontSize: 13});
  });
});

describe('unitless line-height', () => {
  // CSS treats a unitless line-height as a MULTIPLIER of the font size; RN's
  // lineHeight is absolute points. Passing the ratio through told RN the line
  // was 1.6667pt tall, collapsing the line box — which, with `alignItems:
  // center`, pushed text to the top of its container. Astryx writes every
  // line-height this way.
  it('resolves against the font size in the same block', () => {
    const {style} = stylex.props({fontSize: '0.75rem', lineHeight: '1.6667'});
    expect(style).toMatchObject({fontSize: 12, lineHeight: 20.0004});
  });

  it('does not touch a line-height that already has units', () => {
    const {style} = stylex.props({fontSize: '12px', lineHeight: '20px'});
    expect(style).toMatchObject({fontSize: 12, lineHeight: 20});
  });

  it('resolves regardless of declaration order', () => {
    const {style} = stylex.props({lineHeight: '2', fontSize: '10px'});
    expect(style).toMatchObject({lineHeight: 20});
  });
});
