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
      uiViewClassName: name,
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
    }),
  );
}

// Bold and italic by default, exactly like their presentational twins.
registerInlineAlias('strong', 'b');
registerInlineAlias('em', 'i');
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
// It does not carry the UA stylesheet's default block margins; nothing here
// implements UA styles yet, and design systems reset them regardless.
createReactNativeComponentClass('p', () =>
  createViewConfig({
    validAttributes: {},
    uiViewClassName: 'div',
  }),
);

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
