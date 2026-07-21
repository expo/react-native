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
// bare-text IFC as an inline attachment. Stage 1 wires classification + the
// `src`/sizing props; iOS attachment layout + image rendering are a follow-up.
createReactNativeComponentClass('img', () =>
  createViewConfig({
    validAttributes: {
      src: true,
      width: true,
      height: true,
    },
    uiViewClassName: 'img',
  }),
);
