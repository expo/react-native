// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * Slim re-export barrel.
 *
 * The ONLY file in `vendor/` that differs from upstream Astryx. Upstream's
 * `utils/index.ts` re-exports the whole utils module — date parsing, locale
 * helpers and more — none of which the vendored `Card` slice needs, and each
 * of which would drag in further files. Narrowing it keeps the slice minimal
 * without editing any file Astryx actually renders through.
 */

export type {SizeValue} from './types';
export {mergeProps} from './mergeProps';

/*
 * Astryx 0.5.0 moved more of the shared helpers behind this barrel, and a
 * component importing one that is not re-exported gets `undefined` rather than
 * an error: the failure surfaces later, as a call on undefined during render,
 * which the surface error boundary then contains into a blank screen. Each of
 * these is a file already vendored beside this one, so re-exporting them adds
 * nothing to the slice — it only stops the barrel lying about what it has.
 */
export {composeEventHandlers} from './composeEventHandlers';
export {isRenderable} from './isRenderable';
export {mergeRefs} from './mergeRefs';
export {rtlStyles} from './rtlStyles';
export {themeProps} from './themeProps';
export {focusOutlineStyles, focusOutlineProps} from './focusOutline.stylex';
