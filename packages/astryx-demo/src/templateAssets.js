/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

import {setRootRelativeSourceResolver} from '../../expo-intrinsics/src/rootRelativeSources';
import {Image} from 'react-native';

/**
 * The images the templates show, under the root-relative paths they are
 * written with (`<img src="/template-assets/moody-scene-horizontal-1.png">`),
 * which Astryx's docsite serves from `apps/docsite/public`. Here they are
 * bundled from `template-assets/`, looked up by file name without its
 * extension: the copies are resized to phone width and re-encoded as JPEG,
 * so a `.png` in a template is a `.jpg` in the bundle.
 */
const assets = require.context('../template-assets', false, /\.(png|jpe?g)$/);
const byStem = new Map(
  assets
    .keys()
    .map(key => [key.replace(/^\.\//, '').replace(/\.[^.]+$/, ''), key]),
);

const ROOT = '/template-assets/';

setRootRelativeSourceResolver(path => {
  if (!path.startsWith(ROOT)) {
    return null;
  }
  const stem = path.slice(ROOT.length).replace(/\.[^.]+$/, '');
  const key = byStem.get(stem);
  return key == null ? null : Image.resolveAssetSource(assets(key));
});
