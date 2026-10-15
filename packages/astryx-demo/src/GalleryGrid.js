/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import {PageViewportContext} from '../../rn-tester/js/astryx/overlay/TopLayerElement';
import {
  GALLERY_COLUMNS,
  galleryFoldTracks,
  galleryTilePlacement,
} from './galleryLayout';
import {useGalleryDivision} from './sizeClass';
import {Grid} from '@astryxdesign/core/Grid';
import * as React from 'react';

/** One scrolling grid: two columns on either side of the native hinge region. */
export default function GalleryGrid({
  children,
  columns = GALLERY_COLUMNS,
  division,
}) {
  const viewport = React.useContext(PageViewportContext);
  const reported = useGalleryDivision();
  const tracks = galleryFoldTracks(viewport, division ?? reported);
  return (
    <Grid
      columns={columns}
      gap={3}
      style={tracks == null ? undefined : {gridTemplateColumns: tracks}}>
      {React.Children.map(children, (child, index) => (
        <div
          style={
            tracks == null ? TILE : {...TILE, ...galleryTilePlacement(index)}
          }>
          {child}
        </div>
      ))}
    </Grid>
  );
}

const TILE = {minWidth: 0};
