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
 * Registers intrinsic inline text tags (<b>, <i>, <span>) as host component
 * view configs (implicit-text-plan.md §3.C). Lowercase JSX types resolve by
 * name through ReactNativeViewConfigRegistry, so registering these makes
 * literal <b>/<i>/<span> usable with zero reconciler changes. The attribute
 * defaults (bold/italic) are baked into the native shadow node classes.
 */

import {createViewConfig} from '../NativeComponent/ViewConfig';
import createReactNativeComponentClass from '../Renderer/shims/createReactNativeComponentClass';

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

// The intrinsic <img> tag: an inline *replaced* element (implicit-text-plan.md
// §3.C), distinct from the block-level RN <Image> component. It flows inside a
// bare-text IFC as an inline attachment, but reuses the RN Image machinery for
// loading + rendering (ImageProps/ImageState). `source` takes the same shape as
// <Image>; createViewConfig merges the base View attributes (style/layout, incl.
// width/height). It is positioned by the owning View's attachment-layout pass.
createReactNativeComponentClass('img', () =>
  createViewConfig({
    validAttributes: {
      source: true,
      resizeMode: true,
      tintColor: {process: require('../StyleSheet/processColor').default},
    },
    uiViewClassName: 'img',
  }),
);

// The intrinsic <div> tag: a block-level container with block *inner* display
// (implicit-text-plan.md §3.C) — the intrinsic analog of a View but display:block.
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
