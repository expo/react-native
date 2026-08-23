/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {ImageCandidate} from './imgSources';
import type {ImageStyleProp} from 'react-native/Libraries/StyleSheet/StyleSheet';

import {parseSrcSet, resolveSizes, selectImageSource} from './imgSources';
import * as React from 'react';
import {Dimensions, PixelRatio, StyleSheet} from 'react-native';

/**
 * `<img>` — the element, written the way HTML writes it.
 *
 * The box was already right: `<img>` lays out as an inline replaced element
 * from the user-agent sheet, and mounts each platform's own image view. What
 * this adds is the *attributes* — `src` rather than `source`, `alt`, `srcset`,
 * the `width`/`height` presentational hints, and `object-fit` — so that an
 * `<img>` copied out of a web page works, which is the whole point of the tag
 * having its own name.
 *
 * A component rather than more entries in the view config because none of these
 * are renames. `src` becomes a *list*, `alt` becomes two different accessibility
 * states depending on whether it is empty, and `object-fit` is a style that has
 * to become a prop whose name depends on the backing. A view config maps names
 * to names; this is a translation.
 */

/*
 * Which prop the fit goes to depends on which image view is backing the tag —
 * `expo-image` takes `contentFit`, the framework's own takes `resizeMode` — and
 * this layer deliberately does not know which. Both are passed and each backing
 * ignores the name it does not declare, which is what the view configs already
 * do for every other unknown prop.
 *
 * The two vocabularies are not the same. `contentFit` is CSS's, so `object-fit`
 * passes through unchanged; `resizeMode` has no `scale-down` and spells
 * `fill` as `stretch`, so those are mapped and `none` — which RN has no word
 * for — falls back to `center`, the nearest thing that does not scale.
 */
const RESIZE_MODE: {[string]: string} = {
  contain: 'contain',
  cover: 'cover',
  fill: 'stretch',
  none: 'center',
  'scale-down': 'contain',
};

/**
 * The fit props for a given `object-fit`, defaulting the way CSS does.
 *
 * `fill` when the author says nothing, because that is `object-fit`'s initial
 * value (css-images-3 §5.5) — confirmed against Safari, which reports exactly
 * that from `getComputedStyle` on a bare `<img>`.
 *
 * Leaving the props unset is NOT the same thing: it hands the decision to the
 * backing image view, and both backings default to `cover`. An `<img>` given a
 * width and a height that do not match its intrinsic ratio was then cropped
 * where a browser stretches it — which is what made the `<figure>` and
 * `<picture>` demos zoom into a logo the browser squashes. Squashing is the
 * correct answer: an author who sets both dimensions has asked for exactly that
 * box, and `object-fit` is how they ask for anything else.
 *
 * An unrecognised value falls back to the initial value rather than being
 * passed through, because the backings react to a word they do not know by
 * applying their own default, which puts `cover` back.
 */
export function objectFitProps(objectFit: ?string): {
  contentFit: string,
  resizeMode: string,
} {
  const fit =
    typeof objectFit === 'string' && RESIZE_MODE[objectFit] != null
      ? objectFit
      : 'fill';
  return {contentFit: fit, resizeMode: RESIZE_MODE[fit]};
}

type ImgProps = {
  src?: ?string,
  srcSet?: ?string,
  sizes?: ?string,
  alt?: ?string,
  width?: ?number,
  height?: ?number,
  /* The RN-shaped source, still accepted: this element predates `src`. */
  source?: $FlowFixMe,
  style?: ?ImageStyleProp,
  /*
   * The load-lifecycle handlers, named because `wantsLoadEvents` below reads
   * them off the rest pattern — an inexact object type does not let undeclared
   * properties be read, only spread.
   */
  onLoadStart?: ?(event: $FlowFixMe) => unknown,
  onLoad?: ?(event: $FlowFixMe) => unknown,
  onLoadEnd?: ?(event: $FlowFixMe) => unknown,
  onError?: ?(event: $FlowFixMe) => unknown,
  onProgress?: ?(event: $FlowFixMe) => unknown,
  ...
};

/**
 * The accessibility props an `alt` implies.
 *
 * Exported and pure so it can be tested directly: the mounted props do not
 * carry `accessibilityLabel`, `accessibilityRole` or `accessible`, so a test
 * that renders an `<img>` can only see `importantForAccessibility` and cannot
 * tell a labelled image from an unlabelled one. Extracting the mapping is the
 * difference between pinning this behaviour and pretending to.
 */
/*
 * The two shapes this returns, spelled out.
 *
 * An indexer here (`{[string]: unknown}`) made the JSX spread below unusable:
 * Flow cannot tell whether an indexed key will overwrite an explicit prop, so
 * `{...accessibility}` before `nodeName` was an error. Naming the fields also
 * documents the mapping, which an indexer erased.
 */
export type AltAccessibility =
  | {
      accessible: true,
      accessibilityRole: 'image',
      accessibilityLabel: string,
    }
  | {
      accessible: false,
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    };

/**
 * Rewrites the load-lifecycle handlers so `loadend` fires on a backing that
 * never emits it natively. Exported and pure so the rule itself is testable:
 * loadend after load, loadend after error, no double-fire on a backing that
 * emits its own, untouched handlers otherwise.
 */
export type LoadLifecycleHandlers = {
  onLoad?: ?(event: $FlowFixMe) => unknown,
  onError?: ?(event: $FlowFixMe) => unknown,
  onLoadEnd?: ?(event: $FlowFixMe) => unknown,
  ...
};

export function withSynthesizedLoadEnd(
  handlers: LoadLifecycleHandlers,
  backingLacksLoadEnd: boolean,
): LoadLifecycleHandlers {
  const onLoadEnd = handlers.onLoadEnd;
  if (!backingLacksLoadEnd || onLoadEnd == null) {
    return handlers;
  }
  const {onLoad, onError} = handlers;
  return {
    ...handlers,
    onLoad: (event: $FlowFixMe) => {
      onLoad?.(event);
      onLoadEnd(event);
    },
    onError: (event: $FlowFixMe) => {
      onError?.(event);
      onLoadEnd(event);
    },
    // Not deleted — set to undefined, which the element treats identically
    // and which keeps this a plain width-typed spread.
    onLoadEnd: undefined,
  };
}

export function accessibilityForAlt(alt: ?string): AltAccessibility | null {
  if (alt != null && alt !== '') {
    return {
      accessible: true,
      accessibilityRole: 'image',
      accessibilityLabel: alt,
    };
  }
  if (alt === '') {
    return {
      accessible: false,
      // The two platforms spell "and not my children either" differently, and
      // both are needed: one element, two spellings.
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    };
  }
  return null;
}

/*
 * The style keys that make an `<img>` need its own element box (see the
 * composite in `Img`): everything that paints or insets the box rather than the
 * picture. `margin`/layout keys are NOT here — they work identically on the
 * single view, and alone they keep the fast path.
 */
const BOX_CHROME_PREFIXES = ['padding', 'border', 'background', 'outline'];

function hasBoxChrome(style: {readonly [string]: unknown, ...}): boolean {
  for (const key of Object.keys(style)) {
    for (const prefix of BOX_CHROME_PREFIXES) {
      if (key.startsWith(prefix) && style[key] != null) {
        return true;
      }
    }
  }
  return false;
}

// Grow-and-stretch rather than percentage sizes: flex fills the parent's
// CONTENT box, which is the padding inset doing its job. `display: 'block'`
// is load-bearing: an <img> is inline, and an inline child would be laid out
// as a text attachment in an inline formatting context, where flex sizing
// means nothing. Blockifying it (css-display-3 §2) keeps it an ordinary Yoga
// child of the wrapper. A wrapper with box chrome but NO height still
// collapses to its padding — an image only a browser's intrinsic sizing
// would size; state the dimensions, as the demos do.
const IMAGE_FILLS_CONTENT_BOX = {
  display: 'block',
  width: '100%',
  height: '100%',
};

// The element box half of the composite: an inline replaced box (the img UA
// display) that clips its content at the padding edge, so a border radius
// rounds the picture too, the way a browser clips replaced content.
const ELEMENT_BOX_BASE = {display: 'inline-block', overflow: 'hidden'};

function Img(props: ImgProps): React.Node {
  // `ref` is pulled out because it must always land on the ELEMENT's box —
  // the single image view on the fast path, the wrapper of the composite —
  // never on the composite's inner image, which is an implementation detail.
  // $FlowFixMe[prop-missing] React 19 delivers `ref` as an ordinary prop.
  const {src, srcSet, sizes, alt, width, height, source, style, ref, ...rest} =
    props;

  /*
   * Annotated rather than inferred: `flatten` returns the union of everything
   * an image style may hold, and destructuring an inferred `{}` fallback seals
   * the type so that reading `width` below becomes an error. Naming the two
   * properties this component actually reads keeps that honest.
   *
   * `width` stays `unknown` because a style width is a `DimensionValue` — a
   * number, a percentage string or `auto` — and only the number case can answer
   * "how wide will this be drawn", which is what the `w` candidate choice
   * needs. The `typeof` test below is the narrowing, not a formality.
   */
  const flattened: Readonly<{objectFit?: ?string, width?: unknown, ...}> =
    StyleSheet.flatten(style) ?? {};
  const {objectFit, ...boxStyle} = flattened;

  /*
   * The width the image will be drawn at, for choosing between `w` candidates.
   * An authored width wins over `sizes`, because it is a fact rather than a
   * description of one; `sizes` is the fallback for the common case of an image
   * sized by its container.
   */
  const styleWidth = typeof boxStyle.width === 'number' ? boxStyle.width : null;
  const layoutWidth =
    styleWidth ??
    (typeof width === 'number' ? width : null) ??
    (typeof sizes === 'string'
      ? resolveSizes(sizes, Dimensions.get('window').width)
      : null);

  const resolvedSource = React.useMemo(() => {
    // An explicit `source` is the author being specific, and is left alone.
    if (source != null) {
      return Array.isArray(source) ? source : [source];
    }
    const candidates: Array<ImageCandidate> = [];
    if (typeof srcSet === 'string' && srcSet !== '') {
      candidates.push(...parseSrcSet(srcSet));
    }
    // `src` is the fallback for a user agent that understood none of the
    // candidates, so it goes last rather than first.
    if (typeof src === 'string' && src !== '') {
      candidates.push({uri: src});
    }
    // Exactly one source, chosen here — see `selectImageSource` for why the
    // platform is not handed the list.
    const chosen = selectImageSource(candidates, layoutWidth, PixelRatio.get());
    return chosen == null ? [] : [{uri: chosen.uri}];
  }, [source, src, srcSet, layoutWidth]);

  /*
   * `alt` is three states, not two, and they are genuinely different to a
   * screen reader:
   *
   *  - **text** — the image carries meaning, and this is that meaning. It gets
   *    the label and the image role.
   *  - **empty** — `alt=""` is the author saying *this image is decorative*, and
   *    the spec is explicit that it should then be ignored entirely. Announcing
   *    "image" over a spacer or a bullet is exactly the noise the attribute
   *    exists to remove, so it is hidden from assistive technology rather than
   *    merely left unlabelled.
   *  - **absent** — no claim either way. Left as the platform's default, which
   *    is what a browser does too; it is a validity error in HTML rather than
   *    something to paper over.
   */
  const accessibility = accessibilityForAlt(alt);

  /*
   * HTML's `width` and `height` attributes are *presentational hints* — the
   * spec's own term. They act as if they were in the user-agent stylesheet, so
   * an author's `style` wins, which is why they are applied underneath it.
   */
  const dimensionHints: {width?: number, height?: number} = {};
  if (typeof width === 'number') {
    dimensionHints.width = width;
  }
  if (typeof height === 'number') {
    dimensionHints.height = height;
  }

  const fit = objectFitProps(objectFit);

  /*
   * Android's image view emits its load events only when told handlers exist —
   * `shouldNotifyLoadEvents`, the same gate React Native's own Image sets from
   * handler presence. iOS emits unconditionally, which is how `<img
   * onLoadStart onError>` fired on one platform and never on the other. The
   * DOM's model is the platform-neutral one: an `<img>` fires its lifecycle
   * events whether or not anyone listens, but *telling* Android to emit only
   * when a listener exists is behaviourally identical and skips the bridge
   * traffic for the overwhelmingly common listener-less image.
   */
  const wantsLoadEvents =
    // $FlowFixMe[prop-missing] handlers ride through rest.
    rest.onLoadStart != null ||
    rest.onLoad != null ||
    rest.onLoadEnd != null ||
    rest.onError != null ||
    rest.onProgress != null;

  /*
   * `loadend` fires after `load` OR `error` — HTML's "the fetch is over,
   * however it went". The framework's image view emits it natively; the
   * expo-image backing does NOT — its own JS component synthesises loadend,
   * and this element mounts the native view directly, so `<img onLoadEnd>`
   * silently never fired on iOS while Android reported the full lifecycle.
   * Synthesise it here for exactly the backing that lacks it, by the same
   * rule the spec states; the native-emitting backing keeps its own event and
   * gets no duplicate.
   */
  // $FlowFixMe[prop-missing] the Expo runtime global has no static type here.
  // $FlowFixMe[unclear-type] runtime capability probe.
  const expoBacked = (globalThis.expo as any)?.getViewConfig?.('ExpoImage') != null;
  const relayed = withSynthesizedLoadEnd(rest, expoBacked);

  /*
   * A replaced element paints its own box: `<img style={{backgroundColor,
   * padding, borderRadius}}>` shows the background as a ring THROUGH the
   * padding, around the image (css-backgrounds-3 §2.2), and the radius clips
   * the picture. A native image view cannot do that — its pixels fill its
   * bounds — so an element carrying box chrome splits into CSS's own model:
   * the element box (a view wearing the background, padding, border and
   * radius) with the image view filling its CONTENT box, inset by the
   * padding. The common chrome-less image keeps the single-view fast path.
   */
  const imageProps = {
    ...relayed,
    shouldNotifyLoadEvents: wantsLoadEvents,
    source: resolvedSource.length > 0 ? resolvedSource : undefined,
    contentFit: fit.contentFit,
    resizeMode: fit.resizeMode,
  };

  if (!hasBoxChrome(boxStyle)) {
    return (
      // $FlowFixMe[prop-missing] intrinsic
      <element-img
        {...imageProps}
        {...accessibility}
        ref={ref}
        nodeName="img"
        style={
          Object.keys(dimensionHints).length > 0
            ? [dimensionHints, boxStyle]
            : boxStyle
        }
      />
    );
  }

  return (
    // $FlowFixMe[prop-missing] intrinsic
    <div
      {...accessibility}
      ref={ref}
      nodeName="img"
      style={[ELEMENT_BOX_BASE, dimensionHints, boxStyle]}>
      {/* $FlowFixMe[prop-missing] intrinsic */}
      <element-img
        {...imageProps}
        accessible={false}
        accessibilityElementsHidden={true}
        importantForAccessibility="no-hide-descendants"
        style={IMAGE_FILLS_CONTENT_BOX}
      />
    </div>
  );
}


export default Img;
