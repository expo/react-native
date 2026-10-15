/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

/**
 * What a root-relative URL (`/template-assets/hero.png`) names.
 *
 * On the web such a URL resolves against the document's origin. An app has no
 * origin: it says here what its root holds — bundled assets as a rule, resolved
 * through `Image.resolveAssetSource`, or a server it chooses. Until it does, a
 * root-relative `src` is handed to the platform as written, which loads
 * nothing, as a page served from a file does.
 */
export type RootRelativeSource = {uri: string, width?: number, height?: number};

let resolver: ?(path: string) => ?RootRelativeSource = null;

export function setRootRelativeSourceResolver(
  resolve: ?(path: string) => ?RootRelativeSource,
): void {
  resolver = resolve;
}

export function resolveRootRelativeSource(uri: string): ?RootRelativeSource {
  if (resolver == null || !uri.startsWith('/') || uri.startsWith('//')) {
    return null;
  }
  return resolver(uri);
}
