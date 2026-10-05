/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 * @format
 */

/**
 * Which native image view backs `<img>`: `auto` is expo-image where the Expo
 * runtime is present, else the framework's. Set it before the first `<img>`
 * renders; the answer is latched when first asked.
 */
export type ImgBacking = 'auto' | 'framework' | 'expo-image';

let preferred: ImgBacking = 'auto';
let resolved: ?boolean = null;

export function setImgBacking(backing: ImgBacking): void {
  if (
    backing !== 'auto' &&
    backing !== 'framework' &&
    backing !== 'expo-image'
  ) {
    throw new Error(
      `setImgBacking: "${String(backing)}" is not a backing; use "auto", "framework" or "expo-image".`,
    );
  }
  if (resolved != null) {
    console.warn(
      `setImgBacking("${backing}") came after an <img> was already registered with its backing; the backing stays "${preferred}". Set it before the first <img> renders.`,
    );
    return;
  }
  preferred = backing;
}

export function getImgBacking(): ImgBacking {
  return preferred;
}

// Latched, so the elements registered and every later question agree
export function imgIsExpoImage(): boolean {
  if (resolved != null) {
    return resolved;
  }
  if (preferred === 'framework') {
    resolved = false;
    return false;
  }
  // $FlowFixMe[prop-missing] `expo` is installed by expo-modules-core at runtime.
  // $FlowFixMe[unclear-type] runtime capability probe.
  const expoRuntime: any = globalThis.expo;
  resolved = expoRuntime?.getViewConfig?.('ExpoImage') != null;
  return resolved;
}
