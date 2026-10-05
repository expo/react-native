// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * The type `defaultIcons.tsx` imports, so that file can be vendored byte for
 * byte.
 *
 * Upstream's `globalIconRegistry.tsx` is not vendored: it reaches into the
 * theme registry and drags in most of the library. `defaultIcons` needs only
 * this shape, and it is a TYPE import — erased before the bundler ever sees
 * it — so nothing here exists at runtime.
 */
import type {ReactNode} from 'react';

export type IconRegistry = Record<string, ReactNode>;
