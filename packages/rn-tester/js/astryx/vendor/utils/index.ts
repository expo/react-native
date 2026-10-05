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
