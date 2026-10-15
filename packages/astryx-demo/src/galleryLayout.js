/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

// Measure the gallery's own column, including when UIKit narrows it at a fold.
// Four 128 pt tiles fit even the Duo's unfolded portrait safe column; a cover
// or narrow pane fits two. Capping the count keeps iPad tiles useful too.
export const GALLERY_COLUMNS: {
  readonly minWidth: number,
  readonly max: number,
  readonly repeat: 'fit',
} = {minWidth: 128, max: 4, repeat: 'fit'};

/** Four columns share their rows and scroll position, with a gutter at the fold. */
export function galleryFoldTracks(
  viewport: ?{x?: number, width: number, ...},
  division: ?{x: number, width: number, ...},
): ?string {
  if (viewport == null || division == null) {
    return null;
  }
  // AppPage reserves 16 pt at the outside; keep the same margin at the hinge.
  const start = (viewport.x ?? 0) + 16;
  const end = (viewport.x ?? 0) + viewport.width - 16;
  const left = (division.x - 16 - start - 12) / 2;
  const right = (end - division.x - division.width - 16 - 12) / 2;
  if (left <= 0 || right <= 0) {
    return null;
  }
  // The empty middle track has a 12 pt grid gap on each side.
  return `${left}px ${left}px ${division.width + 8}px ${right}px ${right}px`;
}

export function galleryTilePlacement(index: number): {
  gridColumn: number,
  gridRow: number,
} {
  const column = index % 4;
  return {
    gridColumn: column + (column < 2 ? 1 : 2),
    gridRow: Math.floor(index / 4) + 1,
  };
}

/** A document-shaped peek, rather than a short, window-wide landscape strip. */
export function galleryPreviewSize(
  width: number,
  height: number,
): {width: number, height: number} {
  const previewWidth = Math.max(
    1,
    Math.floor(Math.min(width - 32, height * 0.8 * 0.75, 600)),
  );
  return {width: previewWidth, height: Math.round((previewWidth * 4) / 3)};
}
