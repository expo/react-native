/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import * as React from 'react';
import {useWindowDimensions} from 'react-native';

/**
 * `<picture>` — art direction and format negotiation, written as HTML writes it.
 *
 * `<picture>` draws nothing. It is a *decision*: the user agent walks its
 * `<source>` children in order, takes the first whose `media` matches and whose
 * `type` it can decode, and hands that source to the `<img>` inside. The `<img>`
 * is what renders, and it is also the fallback — a `<picture>` with no matching
 * source is exactly the `<img>` on its own.
 *
 * So this is the same shape as `<select>`: the children are *read* rather than
 * mounted, and one real element does the drawing. `<source>` therefore needs no
 * view config, no shadow node and no native counterpart, because it never
 * becomes a view — it exists to be looked at.
 *
 * Doing it in JavaScript is not a compromise here. `media` has to be re-evaluated
 * when the window changes, which is a React concern; `useWindowDimensions` makes
 * a rotation re-run the choice, and the `<img>` underneath simply receives a
 * different `srcset`.
 */

/*
 * The formats we will claim to decode.
 *
 * `<picture>`'s main use is offering a modern format with a fallback —
 * `image/avif`, then `image/webp`, then a JPEG — and the whole mechanism only
 * works if a type we cannot decode is *skipped*. Guessing generously would defeat
 * it: claiming AVIF on a platform that cannot decode it produces a broken image
 * where the author had carefully provided a working fallback.
 *
 * Both platforms decode these natively, and `expo-image` adds AVIF where the OS
 * does not. Anything unrecognised is skipped rather than assumed, which is the
 * safe direction: the fallback still renders.
 */
const DECODABLE: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
  'image/svg+xml',
]);

type SourceDescriptor = {
  srcSet: string,
  sizes: ?string,
  type: ?string,
  media: ?string,
};

/**
 * Reads the `<source>` children, in order. Anything that is not a `<source>` —
 * the `<img>`, whitespace, a comment — is skipped, because the spec's algorithm
 * only ever looks at `source` elements before the image.
 */
export function collectSources(children: React.Node): Array<SourceDescriptor> {
  const sources: Array<SourceDescriptor> = [];
  React.Children.forEach(children, child => {
    if (child == null || typeof child !== 'object') {
      return;
    }
    // Read structurally: these are elements of a tag Flow has no component type
    // for, and every field is checked below.
    const element: $FlowFixMe = child;
    if (element.type !== 'source') {
      return;
    }
    const props: {[string]: $FlowFixMe} = element.props ?? {};
    // `srcset` is required on a `<source>` inside `<picture>`; one without it
    // is invalid and contributes nothing.
    const srcSet = props.srcSet ?? props.srcset;
    if (typeof srcSet !== 'string' || srcSet === '') {
      return;
    }
    sources.push({
      srcSet,
      sizes: typeof props.sizes === 'string' ? props.sizes : null,
      type: typeof props.type === 'string' ? props.type : null,
      media: typeof props.media === 'string' ? props.media : null,
    });
  });
  return sources;
}

/**
 * Evaluates a `media` attribute against the viewport.
 *
 * Only width conditions are understood — `min-width`, `max-width` and a bare
 * `all`/`screen` — because those are what art direction is written with and
 * what a viewport size can actually answer. An unrecognised condition does
 * **not** match, so an author using something exotic falls through to the next
 * source or to the `<img>`, rather than getting a source chosen on a guess.
 *
 * Conditions may be joined with `and`; a comma-separated list matches if any
 * of its parts does, which is what a media query list means.
 */
export function mediaMatches(media: ?string, width: number): boolean {
  // No media attribute means "always", which is the spec's default.
  if (media == null || media.trim() === '') {
    return true;
  }
  return media
    .split(',')
    .some(query => queryMatches(query.trim().toLowerCase(), width));
}

function queryMatches(query: string, width: number): boolean {
  if (query === '') {
    return false;
  }
  const clauses = query
    .split(/\s+and\s+/)
    .map(clause => clause.trim())
    .filter(clause => clause !== '');
  if (clauses.length === 0) {
    return false;
  }
  return clauses.every(clause => clauseMatches(clause, width));
}

function clauseMatches(clause: string, width: number): boolean {
  // A bare media type. `print` is never us; `all` and `screen` always are.
  if (clause === 'all' || clause === 'screen') {
    return true;
  }
  const match =
    /^\(\s*(min-width|max-width)\s*:\s*(\d+(?:\.\d+)?)px\s*\)$/.exec(clause);
  if (match == null) {
    return false;
  }
  const value = Number(match[2]);
  return match[1] === 'min-width' ? width >= value : width <= value;
}

function typeSupported(type: ?string): boolean {
  if (type == null || type.trim() === '') {
    return true;
  }
  // A MIME type may carry parameters (`image/webp; charset=…`); only the
  // essence decides whether we can decode it.
  return DECODABLE.has(type.split(';')[0].trim().toLowerCase());
}

/**
 * The spec's selection: first source whose type is decodable and whose media
 * matches. Null means none did, and the `<img>` renders on its own.
 */
export function selectSource(
  sources: Array<SourceDescriptor>,
  width: number,
): SourceDescriptor | null {
  for (const source of sources) {
    if (typeSupported(source.type) && mediaMatches(source.media, width)) {
      return source;
    }
  }
  return null;
}

type PictureProps = {
  children?: React.Node,
  ...
};

function Picture({children, ...rest}: PictureProps): React.Node {
  // Re-evaluated on rotation and on a window resize, which is the behaviour
  // that makes `media` worth having rather than a one-time choice at mount.
  const {width} = useWindowDimensions();

  const sources = React.useMemo(() => collectSources(children), [children]);
  const chosen = React.useMemo(
    () => selectSource(sources, width),
    [sources, width],
  );

  /*
   * The `<img>` child is the element that renders — and the only one. Finding it
   * rather than requiring it to be last matches the spec, which says the image
   * is the last child but treats a stray one leniently.
   */
  let image: React.Node = null;
  React.Children.forEach(children, child => {
    if (child != null && typeof child === 'object') {
      const element: $FlowFixMe = child;
      if (element.type === 'img') {
        image = child;
      }
    }
  });

  if (image == null) {
    // A `<picture>` with no `<img>` renders nothing, which is what a browser
    // does: the sources have nowhere to go.
    return null;
  }

  const element: $FlowFixMe = image;
  if (chosen == null) {
    // No source matched. The `<img>` keeps its own `src`/`srcset`, untouched —
    // it is the fallback, not a placeholder.
    return element;
  }

  /*
   * The chosen source *replaces* the image's own candidates rather than adding
   * to them. That is the point of art direction: a narrow-viewport source is
   * often a differently-cropped picture, and leaving the original candidates in
   * the list would let the platform pick the one the author just ruled out.
   *
   * `sizes` only comes across when the source supplies one, so an `<img sizes>`
   * still applies to a source that did not state its own.
   */
  return React.cloneElement(element, {
    src: undefined,
    srcSet: chosen.srcSet,
    sizes: chosen.sizes ?? element.props?.sizes,
  });
}

export default Picture;
