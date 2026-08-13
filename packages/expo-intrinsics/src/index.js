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
 * The HTML element catalog — every element, defined outside react-native.
 *
 * A side-effect import. Lowercase JSX types resolve by name through
 * ReactNativeViewConfigRegistry, so registering a view config under a tag is all
 * it takes for literal <span>, <p> or <h1> to work, with no reconciler change
 * and — for everything here except <img> — no native code.
 *
 * An element is three things:
 *
 *   - a TAG NAME, which is the registration key and what `nodeName` reports;
 *   - a USER-AGENT STYLE, which is every default a browser would apply, merged
 *     beneath the author's style so an author declaration still wins;
 *   - a BACKING COMPONENT, which is one of the two react-native offers —
 *     `inline-text` for an element that folds into a line of text, and
 *     `element-box` for one that generates a box — chosen from the computed
 *     `display` rather than from the tag.
 *
 * Block versus inline is therefore not a fourth thing to declare. It is what
 * the user-agent style says, and the rest follows.
 *
 * react-native supplies the machinery these render against — text nodes, the
 * anonymous inline formatting contexts, Yoga's block display, the lazy
 * descriptor seam — and names none of these elements.
 */

import type {UAStyle} from './uaStyles';

import {createViewConfig} from 'react-native/Libraries/NativeComponent/ViewConfig';
import {registerFrameworkElement} from './ElementRegistry';
import {type ViewConfig} from 'react-native/Libraries/Renderer/shims/ReactNativeTypes';
import {setFallbackViewConfigResolver} from 'react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry';
import uaStyles, {uaStyleFor} from './uaStyles';

const inlineTagViewConfig = {
  validAttributes: {
    isHighlighted: true,
    isPressable: true,
    maxFontSizeMultiplier: true,
  },
} as const;

function registerInlineTag(name: string) {
  registerFrameworkElement(name, () =>
    createViewConfig({
      ...inlineTagViewConfig,
      validAttributes: {...inlineTagViewConfig.validAttributes, nodeName: true},
      // The authored tag rides along so the element reports itself whichever
      // component ends up backing it.
      recordNodeName: true,
      uiViewClassName: 'inline-text',
      resolveUIViewClassName: resolveInlineElementComponent(
        'inline-text',
        uaStyleFor(name),
      ),
      // <b>'s bold and <i>'s italics live in the UA sheet, not in their C++
      // props classes.
      uaStyle: uaStyleFor(name),
    }),
  );
}

// Bold, italic and underline are declarations in the user-agent sheet, not
// components — so these are aliases of the generic inline backing like every
// other unstyled inline element, and react-native ships no `b`, `i` or `u`.
registerInlineTag('b');
registerInlineTag('i');
registerInlineTag('u');
registerInlineTag('span');

// The intrinsic <img> tag: an inline *replaced* element (text-children-plan.md
// §3.C) — it flows inside a bare-text IFC as an inline attachment, positioned
// by the owning View's attachment-layout pass.
//
// Which native component backs it depends on the host. When the Expo runtime is
// present, <img> is expo-image — the SDK's image component, with its caching,
// format support and SwiftUI awareness — and this is the catalog's first
// SDK-backed element. Elsewhere (Fantom, bare hosts) it falls back to the
// framework's Image machinery. Resolved lazily at first render, by which time
// the native runtime is up; layout treats both the same way, through the
// InlineText + InlineReplaced traits their shadow nodes declare.
registerFrameworkElement('img', () => {
  // $FlowFixMe[unclear-type] the Expo runtime global has no static type here.
  // $FlowFixMe[prop-missing] `expo` is installed by expo-modules-core at runtime.
  const expoRuntime: any = globalThis.expo;
  const expoViewConfig = expoRuntime?.getViewConfig?.('ExpoImage');
  if (expoViewConfig != null) {
    return createViewConfig({
      ...expoViewConfig,
      validAttributes: {
        ...expoViewConfig.validAttributes,
        // The HTML-shaped singular source; expo-image's native side takes a
        // list of them.
        source: {
          process: (src: unknown) =>
            src == null || Array.isArray(src) ? src : [src],
        },
        nodeName: true,
      },
      recordNodeName: true,
      uiViewClassName: 'ViewManagerAdapter_ExpoImage',
      uaStyle: uaStyleFor('img'),
    });
  }
  return createViewConfig({
    // The image-load events the Image machinery fires must be declared, or the
    // reconciler rejects e.g. "topLoadStart".
    directEventTypes: {
      topLoadStart: {registrationName: 'onLoadStart'},
      topProgress: {registrationName: 'onProgress'},
      topError: {registrationName: 'onError'},
      topLoad: {registrationName: 'onLoad'},
      topLoadEnd: {registrationName: 'onLoadEnd'},
    },
    validAttributes: {
      source: true,
      resizeMode: true,
      tintColor: {
        process: require('react-native/Libraries/StyleSheet/processColor')
          .default,
      },
    },
    uiViewClassName: 'img',
  });
});

/**
 * Elements whose rendering is identical to an already-registered intrinsic.
 * They point at that intrinsic's native component through `uiViewClassName`,
 * so they need no shadow node, descriptor or native code of their own — the
 * same view-config aliasing that maps an intrinsic onto any existing RN
 * component.
 *
 * The authored tag is preserved for DOM APIs: a view config is per-component,
 * not per-tag, so `recordNodeName` has the reconciler stamp the JSX type onto a
 * `nodeName` prop that the element reports through `NodeNameProvider`. Without
 * it an aliased <strong> would identify as <b>.
 */
function registerInlineAlias(name: string, uiViewClassName: string) {
  registerFrameworkElement(name, () =>
    createViewConfig({
      ...inlineTagViewConfig,
      validAttributes: {
        ...inlineTagViewConfig.validAttributes,
        nodeName: true,
      },
      recordNodeName: true,
      uiViewClassName,
      resolveUIViewClassName: resolveInlineElementComponent(
        uiViewClassName,
        uaStyleFor(name),
      ),
      uaStyle: uaStyleFor(name),
    }),
  );
}

// Their bold/italic now comes from the UA sheet, so they alias the unstyled
// <span> — one source of truth for the default, and no dependence on <b>/<i>
// happening to carry it.
// A forced line break. Registered as an inline element so it takes part in the
// inline formatting context; the break itself is emitted by
// `BaseTextShadowNode`, which gives it a newline that survives whitespace
// collapsing (css-text-3 §3 collapses ordinary newlines to a space).
registerInlineAlias('br', 'inline-text');
registerInlineAlias('strong', 'inline-text');
registerInlineAlias('em', 'inline-text');
// Inline, unstyled, and clickable: DOM click events already dispatch to inline
// elements (W3C pointer events), so <button> and <a> need no gesture handler
// or Pressable to be interactive — an `onClick` on the element is enough.
registerInlineAlias('button', 'inline-text');
registerInlineAlias('a', 'inline-text');
registerInlineAlias('label', 'inline-text');

// <p> is block-level. Aliasing it to <div> is what makes it lay out as a block
// at all: an unregistered tag falls through to the *inline* unknown element,
// so <p> previously flowed inline with its siblings.
//
// Its default block margins come from the UA stylesheet (uaStyles.js), merged
// beneath the author's style so `<p style={{marginBlock: 0}}>` still wins.
/**
 * A block-level element: aliases <div>'s native component and takes its box
 * metrics from the UA sheet. Adding one is a row in uaStyles.js plus a name
 * here — no shadow node, descriptor, or native code.
 */
function registerBlockElement(name: string) {
  // Block-ness is a DECLARATION, not a component choice: it goes in the user-agent
  // style, where an author style can still beat it, and the generic box then
  // honours it. That is what lets a block element be defined without a C++ class
  // of its own — the whole definition is a tag name and a UA entry.
  const uaStyle = uaStyleFor(name);
  if (uaStyle.display == null) {
    uaStyle.display = 'block';
  }
  registerFrameworkElement(name, () =>
    createViewConfig({
      // `listStyleType`/`listStylePosition` are style properties and `start` an
      // HTML attribute, but all three are declared here because markers are
      // generated in C++ by the list container, which needs them natively.
      validAttributes: {
        nodeName: true,
        listStyleType: true,
        listStylePosition: true,
        start: true,
      },
      recordNodeName: true,
      uiViewClassName: 'element-box',
      uaStyle,
    }),
  );
}

// Block containers, headings, lists. All block-level, differing only in the
// metrics the UA sheet gives them.
// <div> is not special: a block element is a tag whose user-agent style says
// `display: block`, backed by the generic box. react-native ships no `div`
// component, no DivShadowNode and no DivProps — which is exactly what makes a
// block element definable from outside it.
for (const name of [
  'div',
  'p',
  'blockquote',
  'figure',
  'figcaption',
  'pre',
  'hr',
  'section',
  'article',
  'header',
  'footer',
  'nav',
  'main',
  'aside',
  'address',
  'hgroup',
  'search',
  'menu',
  'noscript',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
]) {
  registerBlockElement(name);
}

// Inline presentational elements, styled entirely by the UA sheet.
for (const name of [
  'cite',
  'small',
  'code',
  'kbd',
  'samp',
  's',
  'del',
  'ins',
  'mark',
  'sub',
  'sup',
  'abbr',
  'q',
  'time',
  'var',
  'dfn',
  'data',
]) {
  registerInlineAlias(name, 'inline-text');
}

/**
 * Displays whose box establishes a formatting context, so the element cannot
 * fold into the surrounding inline flow and needs a real box of its own.
 *
 * `inline` is absent on purpose: it is precisely the display that folds.
 */
const BOX_DISPLAYS = new Set([
  'flex',
  'inline-flex',
  'block',
  'inline-block',
  'grid',
  'inline-grid',
]);

/**
 * Picks the native component backing an inline element, from its resolved
 * `display`.
 *
 * Box generation follows computed display, not the tag: a `<span>` is the
 * cheap text-backed component while it folds into an inline formatting
 * context, and the box-backed one when its display establishes one. Browsers
 * make the same choice at the same point — `LayoutObject::CreateObject`
 * constructs a different class per computed display.
 *
 * Cheap by construction: a set lookup on an already-flattened style, and only
 * for elements that can be either flavor.
 */
function resolveInlineElementComponent(
  uiViewClassName: string,
  uaStyle?: UAStyle,
): (props: {[string]: unknown}) => string {
  return (props: {[string]: unknown}): string => {
    // The UA display counts too: `<button>`'s inline-block comes from the
    // stylesheet, and box selection has to see it or the element would resolve
    // as text-backed and its padding would have nowhere to apply.
    const style = props?.style;
    if (style == null) {
      const uaDisplay = uaStyle?.display;
      return typeof uaDisplay === 'string' && BOX_DISPLAYS.has(uaDisplay)
        ? 'element-box'
        : uiViewClassName;
    }
    // Required lazily: importing StyleSheet at module scope pulls this module
    // into a require cycle, which re-evaluates it and re-runs the element
    // registrations ("tried to register two views with the same name").
    // $FlowFixMe[unclear-type] a lazily-required module has no static type
    const styleSheetModule: any = require('react-native/Libraries/StyleSheet/StyleSheet');
    const flatten =
      styleSheetModule.default?.flatten ?? styleSheetModule.flatten;
    const display = flatten(style)?.display ?? uaStyle?.display;
    return typeof display === 'string' && BOX_DISPLAYS.has(display)
      ? 'element-box'
      : uiViewClassName;
  };
}

/**
 * Adjusts the user-agent default for a tag — a CSS reset, in other words.
 *
 * Design systems ship one: they zero the UA margins they do not want and then
 * style from scratch. On the web that is a stylesheet at the *author* origin
 * overriding the UA origin. Here the UA sheet is the only global layer, so a
 * reset edits it in place.
 *
 * Mutates the entry rather than replacing it, because a view config captures
 * the style object by reference when it is first built. Call before rendering.
 */
export function overrideUAStyle(tag: string, style: UAStyle) {
  const existing = uaStyles[tag];
  if (existing != null) {
    // Mutated in place, not replaced: view configs captured this object by
    // reference when the element was registered.
    for (const key of Object.keys(style)) {
      existing[key] = style[key];
    }
  } else {
    uaStyles[tag] = {...style};
  }
}

// HTMLUnknownElement: any unregistered lowercase JSX tag (e.g. <foo>) resolves
// here — inline, unstyled, content renders — mirroring the web. This is the DOM
// *policy*; the resolution *mechanism* is a generic fallback hook, so
// react-native stays agnostic. The element is backed by the native singleton "unknown"
// inline component; because every unknown tag shares one view config, the
// authored tag is otherwise lost, so `recordNodeName` has the reconciler stamp
// the JSX type onto a `nodeName` prop the native side reports through DOM APIs.
const unknownElementViewConfig: ViewConfig = {
  // Points at the generic inline text backing, like any other inline element.
  uiViewClassName: 'inline-text',
  bubblingEventTypes: {},
  directEventTypes: {},
  validAttributes: {nodeName: true},
  recordNodeName: true,
};

setFallbackViewConfigResolver(name =>
  typeof name[0] === 'string' && /^[a-z]/.test(name)
    ? unknownElementViewConfig
    : null,
);

// The provider entry point: a library defines namespaced elements — see
// ElementRegistry for the precedence rules.
export {defineReactElement} from './ElementRegistry';
