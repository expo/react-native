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

export type UAStyle = {[string]: mixed};

// Browsers compute their defaults against a 16px root font size. Values below
// are that arithmetic done once, so `1em` reads as 16 and `0.67em` as 10.72.
const EM = 16;

const uaStyles: {[string]: UAStyle} = {
  // Block-level containers. `display` comes from the element's registration
  // (they alias <div>), so only the box metrics belong here.
  p: {marginBlock: EM},
  blockquote: {marginBlock: EM, marginInline: 40},
  figure: {marginBlock: EM, marginInline: 40},
  pre: {marginBlock: EM, fontFamily: 'monospace'},
  hr: {marginBlock: 8, borderTopWidth: 1, borderColor: '#0000001f'},

  // Headings: bold, with sizes and margins that shrink together down the
  // scale. h1 is 2em down to h6 at 0.67em, and the margins move the other way.
  h1: {fontSize: 2 * EM, fontWeight: 'bold', marginBlock: 0.67 * EM},
  h2: {fontSize: 1.5 * EM, fontWeight: 'bold', marginBlock: 0.83 * EM},
  h3: {fontSize: 1.17 * EM, fontWeight: 'bold', marginBlock: EM},
  h4: {fontSize: EM, fontWeight: 'bold', marginBlock: 1.33 * EM},
  h5: {fontSize: 0.83 * EM, fontWeight: 'bold', marginBlock: 1.67 * EM},
  h6: {fontSize: 0.67 * EM, fontWeight: 'bold', marginBlock: 2.33 * EM},

  // Lists. The 40pt inline-start padding is the marker gutter.
  // DOM-CSS-LIMITATION(no-list-markers): markers themselves are not drawn (no
  // `::marker` and no generated content), so a list indents without bullets.
  ul: {marginBlock: EM, paddingInlineStart: 40},
  ol: {marginBlock: EM, paddingInlineStart: 40},
  dl: {marginBlock: EM},
  dd: {marginInlineStart: 40},

  // Form controls. Browsers give <button> `display: inline-block`, which is
  // what makes it a box that takes padding while still sitting in a line of
  // text. Without it a <button> is a span-like inline element and its padding
  // has nowhere to apply.
  button: {display: 'inline-block'},

  // Inline presentational. <b>/<i>/<u> are here rather than baked into their
  // C++ props classes, so a default lives in exactly one place.
  b: {fontWeight: 'bold'},
  i: {fontStyle: 'italic'},
  u: {textDecorationLine: 'underline'},
  strong: {fontWeight: 'bold'},
  em: {fontStyle: 'italic'},
  cite: {fontStyle: 'italic'},
  small: {fontSize: 0.83 * EM},
  code: {fontFamily: 'monospace'},
  kbd: {fontFamily: 'monospace'},
  samp: {fontFamily: 'monospace'},
  s: {textDecorationLine: 'line-through'},
  del: {textDecorationLine: 'line-through'},
  ins: {textDecorationLine: 'underline'},
  mark: {backgroundColor: '#ffff00', color: '#000000'},
};

export default uaStyles;
