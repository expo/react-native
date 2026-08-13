/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * The user-agent stylesheet.
 *
 * Browsers all ship one of these — WebKit's `html.css`, Blink's copy, Gecko's
 * `html.css` + `forms.css` — a plain stylesheet applied at the lowest cascade
 * origin. Two properties of that design are worth copying and are why this is
 * a table rather than code:
 *
 *  1. **Defaults are data.** Adding `<article>` is a row here, not a props
 *     class in C++.
 *  2. **The author always wins**, because a UA declaration is simply a lower
 *     origin (CSS Cascade §6.1). Here that is realised by merging these
 *     *beneath* the author's style, so no per-property special-casing exists.
 *
 * Grouped by role in WebKit's order, because that grouping is the
 * documentation.
 *
 * Divergences from the web, stated rather than discovered:
 *  - DOM-CSS-LIMITATION(no-em-units): browsers express these in `em`; we have
 *    no font-relative units, so values are points computed against a 16px
 *    root. They do not track the user's font size the way the web does.
 *  - DOM-CSS-LIMITATION(no-quirks-mode): no `quirks.css` equivalent, since
 *    there is no quirks mode to be compatible with.
 *  - DOM-CSS-LIMITATION(no-native-form-widgets): form controls are not
 *    platform-drawn, so `<button>` gets layout defaults but no native
 *    appearance.
 *  - DOM-CSS-LIMITATION(no-link-state): `<a>` gets no colour or underline;
 *    those depend on `:link`/`:visited`, which need history state we lack.
 */

export type UAStyle = {[string]: unknown};

// Browsers compute their defaults against a 16px root font size. Values below
// are that arithmetic done once, so `1em` reads as 16 and `0.67em` as 10.72.
const EM = 16;

const uaStyles: {[string]: UAStyle} = {
  // Block-level containers. `display` comes from the element's registration
  // (they alias <div>), so only the box metrics belong here.
  p: {marginBlock: EM},
  blockquote: {marginBlock: EM, marginInline: 40},
  figure: {marginBlock: EM, marginInline: 40},
  // `white-space: pre` is the whole point of <pre>: browsers set it in
  // html.css, and it is what preserves the newlines and space runs an author
  // wrote — in the rendering and on the clipboard alike.
  pre: {marginBlock: EM, fontFamily: 'monospace', whiteSpace: 'pre'},
  hr: {marginBlock: 8, borderTopWidth: 1, borderColor: '#0000001f'},

  // Headings: bold, with sizes and margins that shrink together down the
  // scale. h1 is 2em down to h6 at 0.67em, and the margins move the other way.
  h1: {fontSize: 2 * EM, fontWeight: 'bold', marginBlock: 0.67 * EM},
  h2: {fontSize: 1.5 * EM, fontWeight: 'bold', marginBlock: 0.83 * EM},
  h3: {fontSize: 1.17 * EM, fontWeight: 'bold', marginBlock: EM},
  h4: {fontSize: EM, fontWeight: 'bold', marginBlock: 1.33 * EM},
  h5: {
    fontSize: 0.83 * EM,
    fontWeight: 'bold',
    marginBlock: 1.67 * (0.83 * EM),
  },
  h6: {
    fontSize: 0.67 * EM,
    fontWeight: 'bold',
    marginBlock: 2.33 * (0.67 * EM),
  },

  // Lists. The 40pt inline-start padding is the gutter an `outside` marker
  // hangs in, which is where the list container generates them (css-lists-3
  // §3); `<li>` needs no rule of its own here.
  // Form containers. <form> is block-level with no box metrics of its own in
  // standards mode (the 1em block-end margin is a quirks-mode rule, and there
  // is no quirks mode here — DOM-CSS-LIMITATION(no-quirks-mode)).
  form: {},
  // <fieldset>'s border is `groove 2px ThreeDFace`, a 3D system border with no
  // analogue on either platform and no system colour to resolve ThreeDFace
  // against. A 1px hairline in the platform's separator colour is the honest
  // approximation; DOM-CSS-LIMITATION(no-groove-border) records the gap.
  fieldset: {
    marginInline: 2,
    borderWidth: 1,
    borderColor: '#0000001f',
    // CSS's `padding-block: 0.35em 0.625em` is two values; RN's paddingBlock
    // takes one, so the asymmetry needs the longhands.
    paddingBlockStart: 0.35 * EM,
    paddingBlockEnd: 0.625 * EM,
    paddingInline: 0.75 * EM,
  },
  legend: {paddingInline: 2},

  // <address> is block-level AND italic; both come from html.css.
  address: {fontStyle: 'italic'},
  // <menu> is a list: the HTML Standard groups it with dir/ol/ul for margins
  // and with dir/ul for the disc marker.
  menu: {marginBlock: EM, paddingInlineStart: 40, listStyleType: 'disc'},
  // Scripting is always enabled here, so <noscript> content never renders —
  // `@media (scripting) { noscript { display: none !important } }`. There is no
  // no-scripting mode to fall back to, so this is unconditional.
  noscript: {display: 'none'},
  ul: {marginBlock: EM, paddingInlineStart: 40},
  ol: {marginBlock: EM, paddingInlineStart: 40},
  dl: {marginBlock: EM},
  dd: {marginInlineStart: 40},

  // Form controls. Browsers give <button> `display: inline-block`, which is
  // what makes it a box that takes padding while still sitting in a line of
  // text. Without it a <button> is a span-like inline element and its padding
  // has nowhere to apply.
  //
  // Browsers centre a button's content on BOTH axes — which is why a radio's
  // dot and a checkbox's tick sit in the middle of their box on the web
  // without the markup saying anything about alignment. `text-align` does the
  // inline axis; `align-content` does the block one (css-align-3 §5.3 applies
  // it to block containers, where a block container's contents are a single
  // alignment subject).
  //
  // Neither reaches for `justify-content`, and that matters: a button whose
  // author made it a flex container keeps its own alignment. Centring with
  // `justify-content` here is what once centred the sliding thumb inside a
  // switch track — an `inline-flex` button whose thumb's whole job is to sit
  // at one end.
  button: {
    display: 'inline-block',
    textAlign: 'center',
    alignContent: 'center',
  },

  // Inline presentational. <b>/<i>/<u> are here rather than baked into their
  // C++ props classes, so a default lives in exactly one place.
  b: {fontWeight: 'bold'},
  i: {fontStyle: 'italic'},
  u: {textDecorationLine: 'underline'},
  strong: {fontWeight: 'bold'},
  em: {fontStyle: 'italic'},
  cite: {fontStyle: 'italic'},
  dfn: {fontStyle: 'italic'},
  small: {fontSize: 0.83 * EM},
  code: {fontFamily: 'monospace'},
  kbd: {fontFamily: 'monospace'},
  samp: {fontFamily: 'monospace'},
  s: {textDecorationLine: 'line-through'},
  del: {textDecorationLine: 'line-through'},
  ins: {textDecorationLine: 'underline'},
  mark: {backgroundColor: '#ffff00', color: '#000000'},
};

/**
 * CSS initial values that differ from React Native's defaults.
 *
 * The web applies these to every element before any stylesheet runs, so they
 * belong to the elements rather than to the components backing them — which is
 * exactly why they live here and not in `View`. A react-native `<View>` or
 * `<ScrollView>` keeps RN's own defaults; only registered HTML intrinsics get
 * these.
 */
const INITIAL_VALUES: {[string]: unknown} = {
  // `flex-direction`'s initial value is `row` (css-flexbox-1 §5.1); React
  // Native defaults to `column`. On the web this only takes effect on a flex
  // container, and the same holds here: a block container lays out through
  // Yoga's block display, which ignores it.
  flexDirection: 'row',
  // `flex-shrink`'s initial value is 1 (css-flexbox-1 §7.3); React Native
  // defaults to 0. On the web a flex item yields when the row runs out of
  // room; an RN item overflows instead — which is how a `<label>` beside a
  // checkbox in a flex row CLIPPED its text at the row's edge where a
  // browser wraps it. Like flexDirection above, it only means anything when
  // the element is actually a flex item.
  flexShrink: 1,
};

/**
 * The UA style for `tag`, including the initial values above.
 *
 * Returns the SAME object each time and seeds it in place rather than building
 * a merged copy, because view configs capture this object by reference when
 * the element is registered — `overrideUAStyle` depends on that, and a fresh
 * object here would silently stop later overrides from being seen.
 *
 * A per-tag declaration wins: the table below is a more specific origin than
 * an initial value, so `in` rather than a blind assignment.
 */
export function uaStyleFor(tag: string): UAStyle {
  let style: UAStyle = uaStyles[tag];
  if (style == null) {
    const created: UAStyle = {};
    uaStyles[tag] = created;
    style = created;
  }
  for (const key of Object.keys(INITIAL_VALUES)) {
    if (!(key in style)) {
      style[key] = INITIAL_VALUES[key];
    }
  }
  return style;
}

export default uaStyles;
