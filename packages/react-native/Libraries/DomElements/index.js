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
 * DOM elements module — entry point.
 *
 * Side-effect import that registers the intrinsic HTML-like elements (<b>, <i>,
 * <span>, <img>, <div>) as host component view configs (text-children-plan.md
 * §3.C). Lowercase JSX types resolve by name through ReactNativeViewConfigRegistry,
 * so registering these makes literal <b>/<i>/<span>/<img>/<div> usable with zero
 * reconciler changes. The attribute defaults (bold/italic) are baked into the
 * native shadow node classes.
 *
 * This module is the JS half of the DOM-elements catalog; its native half is the
 * element descriptors aggregated by
 * ReactCommon/.../components/text/DomElementsRegistry.h. It is deliberately
 * self-contained so it can one day live in its own package/repo — the string
 * children / text-node engine it renders against stays in core.
 */

import uaStyles from './uaStyles';
import {createViewConfig} from '../NativeComponent/ViewConfig';
import createReactNativeComponentClass from '../Renderer/shims/createReactNativeComponentClass';
import {type ViewConfig} from '../Renderer/shims/ReactNativeTypes';
import {setFallbackViewConfigResolver} from '../Renderer/shims/ReactNativeViewConfigRegistry';

const inlineTagViewConfig = {
  validAttributes: {
    isHighlighted: true,
    isPressable: true,
    maxFontSizeMultiplier: true,
  },
} as const;

function registerInlineTag(name: string) {
  createReactNativeComponentClass(name, () =>
    createViewConfig({
      ...inlineTagViewConfig,
      validAttributes: {...inlineTagViewConfig.validAttributes, nodeName: true},
      // The authored tag rides along so the element reports itself whichever
      // component ends up backing it.
      recordNodeName: true,
      uiViewClassName: name,
      resolveUIViewClassName: resolveInlineElementComponent(name, uaStyles[name]),
      // <b>'s bold and <i>'s italics live in the UA sheet, not in their C++
      // props classes.
      uaStyle: uaStyles[name],
    }),
  );
}

registerInlineTag('b');
registerInlineTag('i');
registerInlineTag('span');
// <u> (underline) — a fresh intrinsic wired natively via the LAZY on-demand descriptor seam only,
// to prove that path end-to-end (see OnDemandComponentDescriptorProviders / InlineTextTagShadowNodes).
registerInlineTag('u');

// The intrinsic <img> tag: an inline *replaced* element (text-children-plan.md
// §3.C), distinct from the block-level RN <Image> component. It flows inside a
// bare-text IFC as an inline attachment, but reuses the RN Image machinery for
// loading + rendering (ImageProps/ImageState). `source` takes the same shape as
// <Image>; createViewConfig merges the base View attributes (style/layout, incl.
// width/height). It is positioned by the owning View's attachment-layout pass.
createReactNativeComponentClass('img', () =>
  createViewConfig({
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
      tintColor: {process: require('../StyleSheet/processColor').default},
    },
    uiViewClassName: 'img',
  }),
);

// The intrinsic <div> tag: a block-level container with block *inner* display
// (text-children-plan.md §3.C) — the intrinsic analog of a View but display:block.
// Backed by the View block path (DivShadowNode forces displayBlock). Takes the
// same style/layout attributes as a View.
// createViewConfig already merges the base View validAttributes (style, layout,
// display, …), so <div> accepts the same props as a View.
createReactNativeComponentClass('div', () =>
  createViewConfig({
    validAttributes: {},
    uiViewClassName: 'div',
  }),
);

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
  createReactNativeComponentClass(name, () =>
    createViewConfig({
      ...inlineTagViewConfig,
      validAttributes: {
        ...inlineTagViewConfig.validAttributes,
        nodeName: true,
      },
      recordNodeName: true,
      uiViewClassName,
      resolveUIViewClassName: resolveInlineElementComponent(uiViewClassName, uaStyles[name]),
      uaStyle: uaStyles[name],
    }),
  );
}

// Their bold/italic now comes from the UA sheet, so they alias the unstyled
// <span> — one source of truth for the default, and no dependence on <b>/<i>
// happening to carry it.
registerInlineAlias('strong', 'span');
registerInlineAlias('em', 'span');
// Inline, unstyled, and clickable: DOM click events already dispatch to inline
// elements (W3C pointer events), so <button> and <a> need no gesture handler
// or Pressable to be interactive — an `onClick` on the element is enough.
registerInlineAlias('button', 'span');
registerInlineAlias('a', 'span');
registerInlineAlias('label', 'span');

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
  createReactNativeComponentClass(name, () =>
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
      uiViewClassName: 'div',
      uaStyle: uaStyles[name],
    }),
  );
}

// Block containers, headings, lists. All block-level, differing only in the
// metrics the UA sheet gives them.
for (const name of [
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
]) {
  registerInlineAlias(name, 'span');
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
function resolveInlineElementComponent(uiViewClassName: string, uaStyle?: Object) {
  return (props: Object): string => {
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
    const styleSheetModule = require('../StyleSheet/StyleSheet');
    const flatten = styleSheetModule.default?.flatten ?? styleSheetModule.flatten;
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
export function overrideUAStyle(tag: string, style: Object) {
  const existing = uaStyles[tag];
  if (existing != null) {
    Object.assign(existing, style);
  } else {
    uaStyles[tag] = {...style};
  }
}

// HTMLUnknownElement: any unregistered lowercase JSX tag (e.g. <foo>) resolves
// here — inline, unstyled, content renders — mirroring the web. This is the DOM
// *policy*; the resolution *mechanism* is core's generic fallback hook, so RN
// core stays agnostic. The element is backed by the native singleton "unknown"
// inline component; because every unknown tag shares one view config, the
// authored tag is otherwise lost, so `recordNodeName` has the reconciler stamp
// the JSX type onto a `nodeName` prop the native side reports through DOM APIs.
const unknownElementViewConfig: ViewConfig = {
  uiViewClassName: 'unknown',
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
