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

// `<img>`'s attributes, translated rather than renamed: `src` becomes a source
// list, `alt` an accessibility state, `width`/`height` presentational hints,
// and `object-fit` a prop whose name depends on the backing

// Both backings' fit props are passed and each ignores the one it does not
// declare: expo-image's `contentFit` is CSS's vocabulary; `resizeMode` spells
// `fill` as `stretch`, has no `scale-down`, and `center` is the nearest to
// `none` that does not scale
const RESIZE_MODE: {[string]: string} = {
  contain: 'contain',
  cover: 'cover',
  fill: 'stretch',
  none: 'center',
  'scale-down': 'contain',
};

/**
 * `fill` is `object-fit`'s initial value (css-images-3 §5.5), stated rather
 * than left unset because both backings default to `cover`. An unrecognised
 * value falls back to it for the same reason.
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

// Exported so a test can see the mapping: the mounted props carry only
// `importantForAccessibility`. Fields are named rather than indexed so the
// JSX spread type-checks
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

// The style keys that make an `<img>` need its own element box: what paints
// or insets the box rather than the picture. Margin and layout keys work on
// the single view and keep the fast path
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

// Flex fills the parent's content box, inside the padding. `display: 'block'`
// blockifies the inner image (css-display-3 §2) so it is an ordinary Yoga
// child rather than a text attachment. A wrapper with no height collapses to
// its padding; the dimensions must be stated
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

  // Annotated because destructuring an inferred `{}` fallback seals the type.
  // `width` is a `DimensionValue`, and only a number answers how wide the
  // image will be drawn
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

  // `alt` has three states: text labels the image and gives it the role,
  // `alt=""` marks it decorative and hides it from assistive technology, and
  // absent leaves the platform's default, as a browser does
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

  // Android's image view emits load events only when `shouldNotifyLoadEvents`
  // says handlers exist, the gate React Native's own Image sets from handler
  // presence; iOS emits unconditionally
  const wantsLoadEvents =
    // $FlowFixMe[prop-missing] handlers ride through rest.
    rest.onLoadStart != null ||
    rest.onLoad != null ||
    rest.onLoadEnd != null ||
    rest.onError != null ||
    rest.onProgress != null;

  // `loadend` follows `load` or `error`. The framework's image view emits it
  // natively; expo-image's native view does not (its JS component synthesises
  // it), so it is synthesised here for that backing only
  const expoBacked =
    // $FlowFixMe[prop-missing] the Expo runtime global has no static type here.
    // $FlowFixMe[unclear-type] runtime capability probe.
    (globalThis.expo as any)?.getViewConfig?.('ExpoImage') != null;
  const relayed = withSynthesizedLoadEnd(rest, expoBacked);

  // A replaced element's background shows through its padding
  // (css-backgrounds-3 §2.2) and its radius clips the picture, which a native
  // image view cannot do, so box chrome splits the element into a box view
  // and an image view filling its content box
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
