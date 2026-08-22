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
 * `srcset` and `sizes`, parsed.
 *
 * Kept apart from the element so the parsing can be tested on its own — it is
 * the part with edge cases, and none of them need a renderer to demonstrate.
 *
 * `srcset` offers the user agent several files and lets it choose. This layer
 * *is* the user agent, so the choice is made here and exactly one source
 * reaches the platform — see `selectImageSource`, which also explains why
 * handing the list down instead is not an option.
 */

export type ImageCandidate = {
  uri: string,
  /* From an `x` descriptor: the density the file is intended for. */
  scale?: number,
  /* From a `w` descriptor: the file's intrinsic width in pixels. */
  width?: number,
};

/**
 * Parses a `srcset` attribute into candidates.
 *
 * The grammar is more awkward than it looks: URLs may contain commas, so the
 * separator is "comma followed by whitespace" only when the comma is not part
 * of a URL. The spec's own algorithm splits on whitespace first and treats a
 * trailing comma on a URL as the separator, which is what this does.
 *
 * A candidate with no descriptor is `1x`, per the spec's default.
 */
export function parseSrcSet(srcSet: string): Array<ImageCandidate> {
  const candidates: Array<ImageCandidate> = [];
  // Split on commas that are followed by something which looks like the start
  // of a new candidate rather than by more of the current URL. The spec reaches
  // the same place by consuming a URL up to whitespace and then stripping
  // trailing commas; this is that rule written as one pass.
  for (const raw of splitCandidates(srcSet)) {
    const parts = raw
      .trim()
      .split(/\s+/)
      .filter(part => part !== '');
    if (parts.length === 0) {
      continue;
    }
    const uri = parts[0];
    if (uri === '') {
      continue;
    }
    const candidate: ImageCandidate = {uri};
    // At most one descriptor is meaningful; a second one is invalid and the
    // spec drops the candidate. Being lenient here would silently pick a file
    // the author did not mean.
    const descriptor = parts[1];
    if (descriptor != null) {
      const match = /^(\d+(?:\.\d+)?)([wx])$/.exec(descriptor);
      if (match == null) {
        continue;
      }
      const value = Number(match[1]);
      // Zero and negative are invalid descriptors, not "unspecified".
      if (!(value > 0)) {
        continue;
      }
      if (match[2] === 'x') {
        candidate.scale = value;
      } else {
        candidate.width = value;
      }
    } else {
      candidate.scale = 1;
    }
    candidates.push(candidate);
  }
  return candidates;
}

function splitCandidates(srcSet: string): Array<string> {
  const out: Array<string> = [];
  let current = '';
  let seenUrl = false;
  for (let i = 0; i < srcSet.length; i++) {
    const char = srcSet[i];
    if (char === ',' && seenUrl) {
      out.push(current);
      current = '';
      seenUrl = false;
      continue;
    }
    // A comma only separates once the URL has ended, which is the first
    // whitespace after a non-space run. Before that it belongs to the URL —
    // data: URLs and generated filenames both contain commas.
    if (/\s/.test(char) && current.trim() !== '') {
      seenUrl = true;
    }
    current += char;
  }
  if (current.trim() !== '') {
    out.push(current);
  }
  return out;
}

/**
 * Resolves a `sizes` attribute to the width the image will be laid out at.
 *
 * `sizes` is a list of `(media-condition) length` pairs with a bare length
 * last, and the first matching condition wins. Only `min-width` and `max-width`
 * are understood, because they are the conditions `sizes` is actually written
 * with and the only ones answerable from a viewport width alone.
 *
 * Returns null when nothing matches or nothing is understood, which leaves the
 * choice to the platform rather than guessing.
 */
export function resolveSizes(
  sizes: string,
  viewportWidth: number,
): number | null {
  for (const entry of sizes.split(',')) {
    const text = entry.trim();
    if (text === '') {
      continue;
    }
    const match = /^\((.*)\)\s+(.+)$/.exec(text);
    if (match == null) {
      // No condition: the default, which per the grammar is last and always
      // applies.
      const length = parseLength(text, viewportWidth);
      if (length != null) {
        return length;
      }
      continue;
    }
    if (mediaConditionMatches(match[1], viewportWidth)) {
      const length = parseLength(match[2], viewportWidth);
      if (length != null) {
        return length;
      }
    }
  }
  return null;
}

function mediaConditionMatches(
  condition: string,
  viewportWidth: number,
): boolean {
  const match = /^\s*(min-width|max-width)\s*:\s*(\d+(?:\.\d+)?)px\s*$/.exec(
    condition,
  );
  if (match == null) {
    return false;
  }
  const value = Number(match[2]);
  return match[1] === 'min-width'
    ? viewportWidth >= value
    : viewportWidth <= value;
}

function parseLength(length: string, viewportWidth: number): number | null {
  const text = length.trim();
  const px = /^(\d+(?:\.\d+)?)px$/.exec(text);
  if (px != null) {
    return Number(px[1]);
  }
  // `vw` is the unit `sizes` is usually written in, and the one that makes the
  // attribute worth having: "this image is half the viewport".
  const vw = /^(\d+(?:\.\d+)?)vw$/.exec(text);
  if (vw != null) {
    return (Number(vw[1]) / 100) * viewportWidth;
  }
  const bare = /^(\d+(?:\.\d+)?)$/.exec(text);
  if (bare != null) {
    return Number(bare[1]);
  }
  return null;
}

/**
 * Chooses one candidate. The result is the source the image will load.
 *
 * Selecting here rather than handing the platform a list is both more faithful
 * and the only thing that works. More faithful because `srcset` selection is
 * defined as the *user agent's* job and this layer is the user agent. And the
 * only thing that works because a multi-source list is not a shape either
 * platform accepts from a `srcset`: Android's `ReactImageView.setSource` reads
 * `width` **and** `height` off every entry once there is more than one, and a
 * `srcset` never carries a height — only a width or a density. Passing two
 * candidates crashed with *"Error while updating property 'source'"* before this
 * resolved to one.
 *
 * The two descriptor kinds are answered with the two facts available:
 *
 *  - **`w`** needs a layout width. The smallest file that still covers the box
 *    at the device's pixel ratio wins, because upscaling is visible and
 *    downscaling is not.
 *  - **`x`** needs the pixel ratio alone: the smallest density that still meets
 *    the screen.
 *
 * A list mixing both prefers the width-based answer when a width is known,
 * since it is the more specific one.
 */
export function selectImageSource(
  candidates: Array<ImageCandidate>,
  layoutWidth: number | null,
  pixelRatio: number,
): ImageCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  const byWidth = candidates.filter(c => c.width != null);
  if (byWidth.length > 0 && layoutWidth != null && layoutWidth > 0) {
    const needed = layoutWidth * pixelRatio;
    const sorted = [...byWidth].sort(
      (a, b) => Number(a.width) - Number(b.width),
    );
    return (
      sorted.find(candidate => Number(candidate.width) >= needed) ??
      sorted[sorted.length - 1]
    );
  }

  const byScale = candidates.filter(c => c.scale != null);
  if (byScale.length > 0) {
    const sorted = [...byScale].sort(
      (a, b) => Number(a.scale) - Number(b.scale),
    );
    return (
      sorted.find(candidate => Number(candidate.scale) >= pixelRatio) ??
      sorted[sorted.length - 1]
    );
  }

  // Width candidates with no width to judge them by: source order is the only
  // signal left, and the first is what the author listed first.
  return candidates[0];
}
