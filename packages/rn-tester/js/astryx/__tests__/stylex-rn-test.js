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

/**
 * The resolved style from `props()`, or a loud failure.
 *
 * `StyleXProps.style` is optional — a declaration set that resolves to nothing
 * returns no style object at all — so reading a property off it needs the
 * absent case handled. Handling it by throwing keeps the assertions below
 * about the value of a property rather than about whether there was one, and
 * turns "props() silently returned nothing" into a named failure instead of a
 * confusing `undefined` mismatch further down.
 */
function styleOf(props: stylex.StyleXProps): {[string]: unknown} {
  const {style} = props;
  if (style == null) {
    throw new Error('props() resolved to no style object');
  }
  return style;
}

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

  it('merges a pseudo-element block declaration by declaration', () => {
    // Astryx's MobileNav sets the scrim's colour in one `::backdrop` block and
    // its open opacity in a later one; StyleX keeps both, as each declaration
    // is a class of its own
    const props = stylex.props(
      {'::backdrop': {backgroundColor: 'red', opacity: 0}},
      {'::backdrop': {opacity: 1}},
    ) as $FlowFixMe;
    expect(props.__stylexBackdrop).toEqual(
      expect.objectContaining({backgroundColor: 'red', opacity: 1}),
    );
  });

  it('resolves token references through defineVars at the element', () => {
    // Deferred by props(): a token's default is its :root value, and an
    // ancestor (a theme's `[data-astryx-theme]` rule) may shadow it
    const result = stylex.props({borderRadius: 'var(--radius-container)'});
    expect(result.style).toEqual({borderRadius: 'var(--radius-container)'});
    expect(resolved(result)).toEqual({borderRadius: 12});
    expect(resolved(result, new Map([['--radius-container', '4px']]))).toEqual({
      borderRadius: 4,
    });
  });

  it('finishes a unitless line-height against a deferred font size', () => {
    // The theme sets both through tokens an ancestor declares: the ratio must
    // wait for the font size and multiply it at the element, not collapse the
    // line box to a ratio in points
    const result = stylex.props({
      fontSize: 'var(--heading-size)',
      lineHeight: '1.25',
      paddingBlock: '0.5em',
    });
    expect(result.style).toEqual({
      fontSize: 'var(--heading-size)',
      lineHeight: '1.25',
      paddingBlock: '0.5em',
    });
    expect(resolved(result, new Map([['--heading-size', '32px']]))).toEqual({
      fontSize: 32,
      lineHeight: 40,
      paddingBlock: 16,
    });
  });

  it('surfaces a query container for the element instead of styling it', () => {
    const result = stylex.props({
      containerType: 'inline-size',
      containerName: 'gallery main',
      gap: '4px',
    });
    expect(result.style).toEqual({gap: 4});
    expect(result.__stylexContainer).toEqual({names: ['gallery', 'main']});
    expect(stylex.props({container: 'nav / size'}).__stylexContainer).toEqual({
      names: ['nav'],
    });
    expect(stylex.props({containerType: 'normal'}).__stylexContainer).toBe(
      undefined,
    );
  });

  it('sizes viewport and container units from the boxes in scope', () => {
    // A host surface declares the viewport, a laid-out container its size
    // (css/match.js); the window stands in for whatever is not declared
    const scope = new Map<string, unknown>([
      ['--astryx-viewport-inline-size', '400px'],
      ['--astryx-viewport-block-size', '800px'],
      ['--astryx-container-inline-size', '300px'],
      ['--astryx-container-block-size', '150px'],
    ]);
    const result = stylex.props({
      width: 'calc(50vw + 10px)',
      height: '100dvh',
      paddingInlineStart: 'calc((100cqi - 100px) / 2)',
      minHeight: '10cqb',
    });
    expect(resolved(result, scope)).toEqual({
      width: 210,
      height: 800,
      paddingInlineStart: 100,
      minHeight: 15,
    });
    const windowed = resolved(stylex.props({width: '100vw'}));
    expect(typeof windowed?.width).toBe('number');
  });

  it('resolves element-local custom properties shadowing tokens', () => {
    expect(
      resolved(
        stylex.props({
          '--_card-radius': 'var(--radius-container)',
          borderRadius: 'var(--_card-radius)',
        }),
      ),
    ).toEqual({borderRadius: 12});
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
    const style = resolved(
      stylex.props({backgroundColor: 'var(--color-background-card)'}),
    );
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
    // Box spacing resolves to longhands so it can outrank a UA default
    // applied outside this cascade (see expandShorthand).
    expect(style).toEqual({
      paddingTop: 8,
      paddingRight: 8,
      paddingBottom: 8,
      paddingLeft: 8,
      overflow: 'hidden',
    });
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
    // The runtime notes once per dropped property in dev, on console.info,
    // which is not a warning the app shows
    const warnSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const {style} = stylex.props({
      cursor: 'pointer',
      anchorName: '--x',
      width: '50%',
    });
    expect(style).toEqual({width: '50%'});
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('passes the transition longhands through to the renderer as strings', () => {
    // The renderer runs these natively (css-transitions-1, off the JS
    // thread); the runtime's job is to deliver the CSS strings untouched —
    // comma lists, units, kebab-case property names, and a bare-numeric delay
    // that must NOT be converted to a number.
    const {style} = stylex.props({
      transitionProperty: 'opacity, background-color',
      transitionDuration: '150ms, 0.3s',
      transitionDelay: '0',
      transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
      opacity: 1,
    });
    expect(style).toEqual({
      transitionProperty: 'opacity, background-color',
      transitionDuration: '150ms, 0.3s',
      transitionDelay: '0',
      transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
      opacity: 1,
    });
  });

  it('resolves @starting-style into first-commit overrides', () => {
    // The block rides native transitions: it resolves to a plain style
    // object the element renders with on its first commit only, for any
    // transitionable property.
    const props = stylex.props({
      opacity: 1,
      transitionProperty: 'opacity, transform',
      transitionDuration: '600ms',
      '@starting-style': {opacity: 0, transform: 'translateY(24px)', width: 10},
    });
    expect(props.__startingStyle).toEqual({
      opacity: 0,
      transform: [{translateY: 24}],
      width: 10,
    });
    // The transitions stay in the style itself; nothing extra is extracted.
    expect(props.style?.transitionDuration).toBe('600ms');
  });

  it('resolves var() inside the starting block as final', () => {
    // These values are the first committed frame — there is no later chance
    // for an ancestor to supply the token, so the fallback applies now.
    const props = stylex.props({
      '@starting-style': {transform: 'translateY(var(--nope, 6px))'},
    });
    expect(props.__startingStyle).toEqual({transform: [{translateY: 6}]});
  });

  it('says nothing when there is no starting block', () => {
    const props = stylex.props({opacity: 1});
    expect(props.__startingStyle).toBeUndefined();
  });

  it('resolves stylex.keyframes into serialized stops', () => {
    const spin = stylex.keyframes({
      '0%': {transform: 'rotate(0deg)'},
      '100%': {transform: 'rotate(360deg)'},
    });
    const {style} = stylex.props({
      animationName: spin,
      animationDuration: '1s',
      animationIterationCount: 'infinite',
      animationTimingFunction: 'linear',
      opacity: 1,
    });
    expect(JSON.parse(String(style?.animationKeyframes))).toEqual([
      {offset: 0, transform: 'rotate(0deg)'},
      {offset: 1, transform: 'rotate(360deg)'},
    ]);
    // The longhands ride through as CSS strings for the native parser.
    expect(style?.animationDuration).toBe('1s');
    expect(style?.animationIterationCount).toBe('infinite');
    expect(style?.animationTimingFunction).toBe('linear');
    // The name itself never reaches native; it resolved into the stops.
    expect(style?.animationName).toBeUndefined();
  });

  it('resolves tokens inside keyframe stops, sorts from/to, and honors none', () => {
    const fade = stylex.keyframes({
      to: {opacity: 1},
      from: {opacity: 0, transform: 'translateY(var(--nope, 6px))'},
    });
    const props = stylex.props({animationName: fade});
    expect(JSON.parse(String(props.style?.animationKeyframes))).toEqual([
      {offset: 0, opacity: 0, transform: 'translateY(6px)'},
      {offset: 1, opacity: 1},
    ]);
    const none = stylex.props({animationName: 'none', opacity: 1});
    expect(none.style?.animationKeyframes).toBeUndefined();
  });

  it('keeps the animation when animationName guards reduced-motion', () => {
    // Every vendored component writes its pulse exactly this way: the default
    // branch names the keyframes, a `prefers-reduced-motion: reduce` branch
    // turns it off. The `reduce` branch must match only when the OS setting
    // is on, or this shape, the only one Astryx uses, resolves to none.
    const pulse = stylex.keyframes({
      '0%': {opacity: 1},
      '50%': {opacity: 0.5},
      '100%': {opacity: 1},
    });
    const {style} = stylex.props({
      animationName: {
        default: pulse,
        '@media (prefers-reduced-motion: reduce)': 'none',
      },
      animationDuration: '2s',
    });
    expect(JSON.parse(String(style?.animationKeyframes))).toEqual([
      {offset: 0, opacity: 1},
      {offset: 0.5, opacity: 0.5},
      {offset: 1, opacity: 1},
    ]);
    expect(style?.animationDuration).toBe('2s');
  });

  it('plants __stylexStyle so a naked style attribute cannot clobber it', () => {
    // The web idiom `{...stylex.props(...)} style={{width}}` merges channels
    // on the web (className + inline style) but here both are `style`, and
    // the object spread lets the later attribute wipe the resolved styles.
    // props() must expose the same resolved object under a key the
    // attribute cannot collide with; the JSX runtime layers the override.
    const fill = stylex.props({height: '8px', backgroundColor: '#1570ef'});
    expect(fill.__stylexStyle).toBe(fill.style);
    expect(fill.__stylexStyle).toMatchObject({height: 8});
  });

  it('still drops transition-behavior, quietly', () => {
    // `allow-discrete` has no native counterpart. It is dropped without a
    // warning: warning on a transition-* member would fire on exactly the
    // components whose transitions run natively.
    const {style} = stylex.props({
      transitionBehavior: 'allow-discrete',
      opacity: 1,
    });
    expect(style).toEqual({opacity: 1});
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

  // css-variables-1 §2.1: `initial` on a custom property is the
  // guaranteed-invalid value, which Astryx's Layout uses to reset its padding
  // chain for a subtree; a `var()` of it takes the fallback
  it('takes the fallback of a custom property an ancestor set to initial', () => {
    const {scope} = stylex.resolveInherited(
      stylex.props({'--container-padding-inline-start': 'initial'}).style,
      null,
      null,
    );
    const child = stylex.props({
      marginInlineStart:
        'calc(-1 * var(--container-padding-inline-start, 8px))',
    });
    expect(stylex.resolveInherited(child.style, null, scope).style).toEqual({
      marginInlineStart: -8,
    });
  });

  // Astryx bleeds a block through its container's padding with
  // `calc(100% + pad-start + pad-end)`; with the padding unset the sum is the
  // percentage, which layout can take, not a value to drop
  it('keeps the percentage of a calc() whose lengths cancel', () => {
    const child = stylex.props({
      height:
        'calc(100% + var(--container-padding-block-start, 0px) + var(--container-padding-block-end, 0px))',
    });
    expect(stylex.resolveInherited(child.style, null, null).style).toEqual({
      height: '100%',
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
  // lineHeight is absolute points, so the ratio alone would collapse the line
  // box. Astryx writes every line-height this way.
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

describe('em lengths', () => {
  // `em` on a length is the element's own computed font size (css-values-4
  // §5.1.1), so it resolves like the ratio above; Tailwind's `tracking-tight`
  // is `letter-spacing: -0.025em`
  it('resolves against the font size in the same block', () => {
    const {style} = stylex.props({fontSize: '16px', letterSpacing: '-0.025em'});
    expect(style).toMatchObject({fontSize: 16, letterSpacing: -0.4});
  });

  it('resolves regardless of declaration order', () => {
    const {style} = stylex.props({letterSpacing: '0.1em', fontSize: '20px'});
    expect(style).toMatchObject({letterSpacing: 2});
  });

  // On `font-size` itself `em` is the inherited size, so it must not resolve
  // against the size being declared
  it('does not resolve em on font-size against itself', () => {
    const {style} = stylex.props({fontSize: '2em'});
    expect(style?.fontSize).not.toBe(4);
  });
});

describe('CSS-wide keywords', () => {
  // `inherit` on a property the renderer's cascade inherits becomes an
  // explicit null: the merge cancels the layers below and the cascade supplies
  // the value, which is what `inherit` computes to
  it('turns inherit on an inherited property into an explicit null', () => {
    const {style} = stylex.props({lineHeight: 'inherit', color: 'inherit'});
    expect(style).toMatchObject({lineHeight: null, color: null});
  });

  // `white-space` is inherited and carries a user-agent declaration (`pre` on
  // <pre>), where dropping and nulling differ: only a null cancels the layer
  // below
  it('nulls inherit on white-space, which has a user-agent declaration', () => {
    const {style} = stylex.props({whiteSpace: 'inherit'});
    expect(style).toMatchObject({whiteSpace: null});
  });

  it('drops inherit on a property with no inherited value to take', () => {
    const {style} = stylex.props({padding: 'inherit'});
    expect(style?.padding).toBe(undefined);
  });
});

describe('conditional custom properties', () => {
  // TabList's strip declares its bleed as `{default: '0px', ':has(...)': ...}`
  // and reads it back through var(); the object must not reach the string
  it('reads the picked value of a conditional custom property', () => {
    const {style} = stylex.props({
      '--_bleed': {default: '4px', ':hover': '8px'},
      paddingTop: 'var(--_bleed)',
      marginTop: 'calc(-1 * (var(--_bleed)))',
    });
    expect(style).toMatchObject({paddingTop: 4, marginTop: -4});
  });
});

describe('math functions and window units', () => {
  // LayoutContent centres a column of alignment width W inside its container
  // with `max(pad, calc((100cqi - W) / 2 + pad))`; on a phone the window is
  // the container and narrower than W, so the padding wins
  // Viewport and container units are the element's to size (an ancestor
  // may name the boxes they measure), so these resolve through its pass
  it('evaluates max() over calc() with container-query units', () => {
    const style = resolved(
      stylex.props({
        paddingInlineStart: 'max(2rem, calc((100cqi - 1200px) / 2 + 2rem))',
      }),
    );
    expect(style).toEqual({paddingInlineStart: 32});
  });

  it('evaluates clamp() and viewport units', () => {
    const width = require('react-native').Dimensions.get('window').width;
    const style = resolved(
      stylex.props({fontSize: 'clamp(10px, 5vw, 1000px)'}),
    );
    expect(style).toEqual({fontSize: (5 * width) / 100});
  });
});

describe('env() in calc', () => {
  // The Layer sizes a popover to the viewport minus the safe area:
  // `calc(100vi - calc(max(1rem, env(safe-area-inset-left, 0px)) + 0px) - …)`
  it('takes the fallback when the app registered nothing', () => {
    const width = require('react-native').Dimensions.get('window').width;
    const style = resolved(
      stylex.props({
        maxWidth: 'calc(100vi - max(1rem, env(safe-area-inset-left, 0px)))',
      }),
    );
    expect(style).toEqual({maxWidth: width - 16});
  });

  it('takes the registered inset', () => {
    const width = require('react-native').Dimensions.get('window').width;
    stylex.setEnvironmentResolver(name =>
      name === 'safe-area-inset-left' ? 44 : null,
    );
    try {
      const style = resolved(
        stylex.props({
          maxWidth: 'calc(100svi - max(1rem, env(safe-area-inset-left, 0px)))',
        }),
      );
      expect(style).toEqual({maxWidth: width - 44});
    } finally {
      stylex.setEnvironmentResolver(null);
    }
  });
});

describe('@container keys', () => {
  // DOM-CSS-DEVIATION(container-query-is-a-media-query)
  it('answer as a media query over the window', () => {
    const narrow = stylex.props({
      flexDirection: {
        default: 'row',
        '@container chips (max-width: 100000px)': 'column',
      },
    });
    expect(narrow.style).toEqual({flexDirection: 'column'});
    const wide = stylex.props({
      flexDirection: {
        default: 'row',
        '@container (min-width: 100000px)': 'column',
      },
    });
    expect(wide.style).toEqual({flexDirection: 'row'});
  });
});

describe('visibility', () => {
  // Tab reserves the width of its bold label with a hidden copy; the copy
  // must keep its box and draw nothing
  it('maps hidden to an invisible, untouchable box', () => {
    const {style} = stylex.props({visibility: 'hidden', width: 40});
    expect(style).toEqual({opacity: 0, pointerEvents: 'none', width: 40});
  });

  it('leaves visible alone', () => {
    const {style} = stylex.props({visibility: 'visible', width: 40});
    expect(style).toEqual({width: 40});
  });
});

describe('border-style: none', () => {
  // React Native's `borderStyle` takes solid, dotted or dashed and has no way
  // to say "no border". CSS says `none` forces the used width to zero
  // (CSS2 §8.5.3), which is the translation.
  it('becomes a zero border width', () => {
    const {style} = stylex.props({borderStyle: 'none', borderColor: 'red'});
    expect(style?.borderWidth).toBe(0);
    expect(style?.borderStyle).toBe(undefined);
  });

  it('leaves a real border style alone', () => {
    const {style} = stylex.props({borderStyle: 'dashed'});
    expect(style?.borderStyle).toBe('dashed');
  });
});

describe('CSS Grid', () => {
  // The renderer implements css-grid-2 natively and reads track lists as CSS
  // strings, so the runtime's job is only to NOT drop them: `grid` is on
  // DROPPED_PREFIXES for the shorthands, and must not swallow the longhands.
  it('passes the longhands through untouched', () => {
    const {style} = stylex.props({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
      gridTemplateRows: 'auto 1fr',
      gridAutoFlow: 'row dense',
      gap: '8px',
    });
    expect(style).toMatchObject({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
      gridTemplateRows: 'auto 1fr',
      gridAutoFlow: 'row dense',
      gap: 8,
    });
  });

  it('passes placement through, including named areas', () => {
    const {style} = stylex.props({
      gridTemplateAreas: '"head head" "side main"',
      gridArea: 'main',
      gridColumnStart: '1',
      gridColumnEnd: 'span 2',
      gridRowStart: '2',
      gridRowEnd: '3',
    });
    // Line NUMBERS arrive as numbers — the runtime's usual numeric coercion,
    // which is what the native prop wants; keywords like `span 2` stay strings.
    expect(style).toMatchObject({
      gridTemplateAreas: '"head head" "side main"',
      gridArea: 'main',
      gridColumnStart: 1,
      gridColumnEnd: 'span 2',
      gridRowStart: 2,
      gridRowEnd: 3,
    });
  });

  it('resolves tokens and calc() inside a track list', () => {
    const style = styleOf(
      stylex.props({
        '--col': '90px',
        gridTemplateColumns: 'var(--col) 1fr',
      }),
    );
    expect(style.gridTemplateColumns).toBe('90px 1fr');
  });

  it('still drops the shorthands, which have no RN property', () => {
    const warnSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    // A supported longhand rides along so `style` exists at all: when every
    // declaration is dropped, props() returns no style object to inspect.
    const style = styleOf(
      stylex.props({
        gridColumn: '1 / 3',
        gridGap: '8px',
        gridColumnStart: '1',
      }),
    );
    expect(style.gridColumnStart).toBe(1);
    expect(style.gridColumn).toBeUndefined();
    expect(style.gridGap).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('list-style', () => {
  // The element catalog's `<ul>`/`<ol>` read the longhands as style props, so
  // the runtime passes them through rather than dropping them with the rest of
  // the `listStyle` prefix; Astryx's Stepper, List and Outline all write
  // `listStyleType: 'none'` to turn the marker off.
  it('passes the longhands through without warning', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const style = styleOf(
      stylex.props(
        stylex.create({
          root: {listStyleType: 'none', listStylePosition: 'inside'},
        }).root,
      ),
    );
    expect(style).toMatchObject({
      listStyleType: 'none',
      listStylePosition: 'inside',
    });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('expands the shorthand into the longhands', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const style = styleOf(
      stylex.props(stylex.create({root: {listStyle: 'inside decimal'}}).root),
    );
    expect(style).toMatchObject({
      listStyleType: 'decimal',
      listStylePosition: 'inside',
    });
    expect(style.listStyle).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('drops only the image token of the shorthand, with a warning', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const style = styleOf(
      stylex.props(
        stylex.create({root: {listStyle: 'square url(dot.png)'}}).root,
      ),
    );
    expect(style.listStyleType).toBe('square');
    expect(style.listStyle).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('draws a logical border on the physical side it names', () => {
    const styles = stylex.create({
      divider: {
        borderBlockEndWidth: 1,
        borderBlockEndStyle: 'solid',
        borderInlineStartWidth: 2,
      },
      both: {borderBottomWidth: 3, borderBlockEndWidth: 1},
      physicalLast: {borderBlockEndWidth: 1, borderBottomWidth: 3},
    });
    const divider: $FlowFixMe = stylex.props(styles.divider).style;
    expect(divider.borderBottomWidth).toBe(1);
    expect(divider.borderStartWidth).toBe(2);
    expect(divider.borderStyle).toBe('solid');
    expect(divider.borderBlockEndWidth).toBeUndefined();
    // Whichever of the two is declared later wins
    const both: $FlowFixMe = stylex.props(styles.both).style;
    expect(both.borderBottomWidth).toBe(1);
    const physicalLast: $FlowFixMe = stylex.props(styles.physicalLast).style;
    expect(physicalLast.borderBottomWidth).toBe(3);
  });
});
