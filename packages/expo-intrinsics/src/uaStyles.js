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
 * The user-agent stylesheet, a table like a browser's html.css: a default is a
 * row, and the author always wins because the table is merged beneath the
 * author's style (css-cascade §6.1). Grouped by role in WebKit's order.
 *
 * Divergences from the web:
 *  - DOM-CSS-LIMITATION(no-em-units): there are no font-relative units, so
 *    values are points computed against a 16px root and do not track the
 *    user's font size.
 *  - DOM-CSS-LIMITATION(no-quirks-mode): no quirks.css equivalent.
 *  - DOM-CSS-LIMITATION(no-native-form-widgets): form controls are not
 *    platform-drawn, so <button> gets layout defaults but no appearance.
 *  - DOM-CSS-LIMITATION(no-link-state): <a> gets no colour or underline;
 *    `:link` and `:visited` need history state.
 */

export type UAStyle = {[string]: unknown};

// The root font size browsers compute their em defaults against
const EM = 16;

const uaStyles: {[string]: UAStyle} = {
  // Block containers; `display` comes from the registration
  p: {marginBlock: EM},
  blockquote: {marginBlock: EM, marginInline: 40},
  figure: {marginBlock: EM, marginInline: 40},
  pre: {marginBlock: EM, fontFamily: 'monospace', whiteSpace: 'pre'},
  hr: {marginBlock: 8, borderTopWidth: 1, borderColor: '#0000001f'},

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

  // <form>'s 1em block-end margin is a quirks-mode rule,
  // DOM-CSS-LIMITATION(no-quirks-mode)
  form: {},
  // DOM-CSS-LIMITATION(no-groove-border): <fieldset>'s `groove 2px ThreeDFace`
  // has no platform analogue, so a hairline in the separator colour stands in
  fieldset: {
    marginInline: 2,
    borderWidth: 1,
    borderColor: '#0000001f',
    // `padding-block: 0.35em 0.625em` needs the longhands here
    paddingBlockStart: 0.35 * EM,
    paddingBlockEnd: 0.625 * EM,
    paddingInline: 0.75 * EM,
  },
  legend: {paddingInline: 2},

  address: {fontStyle: 'italic'},
  // The HTML Standard styles <menu> as a <ul>
  menu: {marginBlock: EM, paddingInlineStart: 40, listStyleType: 'disc'},
  // Scripting is always enabled, so <noscript> never renders
  noscript: {display: 'none'},
  // The 40pt inline-start padding is the gutter an outside marker hangs in,
  // where the list container generates it (css-lists-3 §3)
  ul: {marginBlock: EM, paddingInlineStart: 40},
  ol: {marginBlock: EM, paddingInlineStart: 40},
  dl: {marginBlock: EM},
  dd: {marginInlineStart: 40},

  // `inline-block` makes <button> a box that takes padding while sitting in a
  // line of text. Browsers centre its content on both axes: `text-align` for
  // the inline axis and `align-content` for the block one (css-align-3 §5.3).
  // Not `justify-content`, which would override a button the author made a
  // flex container.
  button: {
    display: 'inline-block',
    textAlign: 'center',
    alignContent: 'center',
  },

  // Inline presentational
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

// CSS initial values that differ from React Native's defaults. They belong to
// the elements, not to the components backing them, so a <View> keeps RN's.
const INITIAL_VALUES: {[string]: unknown} = {
  // css-flexbox-1 §5.1; only a flex container reads it
  flexDirection: 'row',
  // css-flexbox-1 §7.3; a flex item yields instead of overflowing the row
  flexShrink: 1,
};

// Returns the same object each time and seeds it in place: view configs
// capture it by reference when the element is registered, and `overrideUAStyle`
// mutates it. A per-tag declaration beats an initial value.
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
