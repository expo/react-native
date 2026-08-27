/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import {Animated} from '../Animated/Animated';
import {ImageResizeMode} from '../Image/ImageResizeMode';
import {ColorValue} from './StyleSheet';

// `start` and `end` are the css-align-3 keywords CSS Grid is specified in
// terms of. They differ from flex-start/flex-end in resolving against the
// writing mode rather than the flex direction.
type FlexAlignType =
  | 'flex-start'
  | 'flex-end'
  | 'start'
  | 'end'
  | 'center'
  | 'stretch'
  | 'baseline';

export type DimensionValue =
  number | 'auto' | `${number}%` | Animated.AnimatedNode | null;
type AnimatableNumericValue = number | Animated.AnimatedNode;
type AnimatableStringValue = string | Animated.AnimatedNode;

export type CursorValue = 'auto' | 'pointer';

/**
 * Flex Prop Types
 * @see https://reactnative.dev/docs/flexbox
 * @see https://reactnative.dev/docs/layout-props
 */
export interface FlexStyle {
  alignContent?:
    | 'flex-start'
    | 'flex-end'
    | 'start'
    | 'end'
    | 'center'
    | 'stretch'
    | 'space-between'
    | 'space-around'
    | 'space-evenly'
    | undefined;
  alignItems?: FlexAlignType | undefined;
  alignSelf?: 'auto' | FlexAlignType | undefined;
  aspectRatio?: number | string | undefined;
  borderBottomWidth?: number | undefined;
  borderEndWidth?: number | undefined;
  borderLeftWidth?: number | undefined;
  borderRightWidth?: number | undefined;
  borderStartWidth?: number | undefined;
  borderTopWidth?: number | undefined;
  borderWidth?: number | undefined;
  bottom?: DimensionValue | undefined;
  boxSizing?: 'border-box' | 'content-box' | undefined;
  display?:
    | 'none'
    | 'flex'
    | 'block'
    | 'inline'
    | 'contents'
    // CSS Grid (css-grid-2). `grid` is block-level, `inline-grid` the
    // inline-level form; the inner display is grid either way.
    | 'grid'
    | 'inline-grid'
    // css-grid-3: tracks in one axis, a flowed stacking axis. `grid-lanes` is
    // block-level, `inline-grid-lanes` the inline-level form.
    | 'grid-lanes'
    | 'inline-grid-lanes'
    | undefined;
  float?: 'none' | 'left' | 'right' | 'inline-start' | 'inline-end' | undefined;
  verticalAlign?: 'auto' | 'top' | 'bottom' | 'middle' | undefined;
  clear?:
    | 'none'
    | 'left'
    | 'right'
    | 'both'
    | 'inline-start'
    | 'inline-end'
    | undefined;
  end?: DimensionValue | undefined;
  flex?: number | undefined;
  flexBasis?: DimensionValue | undefined;
  flexDirection?:
    'row' | 'column' | 'row-reverse' | 'column-reverse' | undefined;
  /**
   * CSS Grid track lists (css-grid-2 §7), written as CSS:
   *
   *   gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))'
   *
   * Supports <length>, <percentage>, fr, auto, max-content, minmax(),
   * fit-content(), and repeat() including auto-fill and auto-fit. Named
   * lines and grid-template-areas are not implemented; min-content as a
   * MAXIMUM behaves as auto.
   */
  gridTemplateColumns?: number | string | undefined;
  gridTemplateRows?: number | string | undefined;
  /**
   * How auto-placed items flow (css-grid-2 §8.5). `column` fills down a
   * column before moving to the next; `dense` lets a later item backfill a
   * hole an earlier spanning item left behind.
   */
  /**
   * Named areas (css-grid-2 §7.3), written as the CSS rows:
   *
   *   gridTemplateAreas: '"header header" "sidebar main"'
   *
   * A `.` is a null cell. A ragged template, or a name that does not form a
   * rectangle, makes the whole declaration invalid and is ignored.
   */
  gridTemplateAreas?: string | undefined;
  /**
   * Places this item into a named area of its parent's template. A name the
   * template does not define falls back to automatic placement.
   */
  gridArea?: string | undefined;
  /**
   * The tie threshold for grid lanes placement (css-grid-3 §4.2). Candidate
   * positions within this distance of the shortest one count as equally good,
   * and tied positions fill in document order — which stops lanes that differ
   * by a pixel or two from filling out of order.
   *
   *   'normal'    1em (the initial value)
   *   16          a length in points
   *   '10%'       relative to the grid-axis content box
   *   'infinite'  every position ties, so items fill strictly in order
   */
  flowTolerance?: number | string | undefined;
  gridAutoFlow?: 'row' | 'row dense' | 'column' | 'column dense' | undefined;
  /** Sizes for implicit tracks (css-grid-2 §7.5). */
  gridAutoColumns?: number | string | undefined;
  gridAutoRows?: number | string | undefined;
  /**
   * Grid item placement (css-grid-2 §8): a line number, negative to count
   * from the end, or `span <n>`. Line 0 behaves as `auto`.
   */
  gridColumnStart?: number | string | undefined;
  gridColumnEnd?: number | string | undefined;
  gridRowStart?: number | string | undefined;
  gridRowEnd?: number | string | undefined;
  /** Default in-track alignment on the inline axis (css-align-3). */
  justifyItems?: 'start' | 'end' | 'center' | 'stretch' | undefined;
  justifySelf?: 'start' | 'end' | 'center' | 'stretch' | undefined;
  rowGap?: number | string | undefined;
  gap?: number | string | undefined;
  columnGap?: number | string | undefined;
  flexGrow?: number | undefined;
  flexShrink?: number | undefined;
  flexWrap?: 'wrap' | 'nowrap' | 'wrap-reverse' | undefined;
  height?: DimensionValue | undefined;
  justifyContent?:
    | 'flex-start'
    | 'flex-end'
    | 'start'
    | 'end'
    | 'center'
    | 'stretch'
    | 'space-between'
    | 'space-around'
    | 'space-evenly'
    | undefined;
  left?: DimensionValue | undefined;
  margin?: DimensionValue | undefined;
  marginBottom?: DimensionValue | undefined;
  marginEnd?: DimensionValue | undefined;
  marginHorizontal?: DimensionValue | undefined;
  marginLeft?: DimensionValue | undefined;
  marginRight?: DimensionValue | undefined;
  marginStart?: DimensionValue | undefined;
  marginTop?: DimensionValue | undefined;
  marginVertical?: DimensionValue | undefined;
  maxHeight?: DimensionValue | undefined;
  maxWidth?: DimensionValue | undefined;
  minHeight?: DimensionValue | undefined;
  minWidth?: DimensionValue | undefined;
  overflow?: 'visible' | 'hidden' | 'scroll' | undefined;
  padding?: DimensionValue | undefined;
  paddingBottom?: DimensionValue | undefined;
  paddingEnd?: DimensionValue | undefined;
  paddingHorizontal?: DimensionValue | undefined;
  paddingLeft?: DimensionValue | undefined;
  paddingRight?: DimensionValue | undefined;
  paddingStart?: DimensionValue | undefined;
  paddingTop?: DimensionValue | undefined;
  paddingVertical?: DimensionValue | undefined;
  position?: 'absolute' | 'relative' | 'static' | undefined;
  right?: DimensionValue | undefined;
  start?: DimensionValue | undefined;
  top?: DimensionValue | undefined;
  width?: DimensionValue | undefined;
  zIndex?: number | undefined;
  direction?: 'inherit' | 'ltr' | 'rtl' | undefined;

  /**
   * Equivalent to `top`, `bottom`, `right` and `left`
   */
  inset?: DimensionValue | undefined;

  /**
   * Equivalent to `top`, `bottom`
   */
  insetBlock?: DimensionValue | undefined;

  /**
   * Equivalent to `bottom`
   */
  insetBlockEnd?: DimensionValue | undefined;

  /**
   * Equivalent to `top`
   */
  insetBlockStart?: DimensionValue | undefined;

  /**
   * Equivalent to `right` and `left`
   */
  insetInline?: DimensionValue | undefined;

  /**
   * Equivalent to `right` or `left`
   */
  insetInlineEnd?: DimensionValue | undefined;

  /**
   * Equivalent to `right` or `left`
   */
  insetInlineStart?: DimensionValue | undefined;

  /**
   * Equivalent to `marginVertical`
   */
  marginBlock?: DimensionValue | undefined;

  /**
   * Equivalent to `marginBottom`
   */
  marginBlockEnd?: DimensionValue | undefined;

  /**
   * Equivalent to `marginTop`
   */
  marginBlockStart?: DimensionValue | undefined;

  /**
   * Equivalent to `marginHorizontal`
   */
  marginInline?: DimensionValue | undefined;

  /**
   * Equivalent to `marginEnd`
   */
  marginInlineEnd?: DimensionValue | undefined;

  /**
   * Equivalent to `marginStart`
   */
  marginInlineStart?: DimensionValue | undefined;

  /**
   * Equivalent to `paddingVertical`
   */
  paddingBlock?: DimensionValue | undefined;

  /**
   * Equivalent to `paddingBottom`
   */
  paddingBlockEnd?: DimensionValue | undefined;

  /**
   * Equivalent to `paddingTop`
   */
  paddingBlockStart?: DimensionValue | undefined;

  /**
   * Equivalent to `paddingHorizontal`
   */
  paddingInline?: DimensionValue | undefined;

  /**
   * Equivalent to `paddingEnd`
   */
  paddingInlineEnd?: DimensionValue | undefined;

  /**
   * Equivalent to `paddingStart`
   */
  paddingInlineStart?: DimensionValue | undefined;
}

export interface ShadowStyleIOS {
  shadowColor?: ColorValue | undefined;
  shadowOffset?: Readonly<{width: number; height: number}> | undefined;
  shadowOpacity?: AnimatableNumericValue | undefined;
  shadowRadius?: number | undefined;
}

interface PerspectiveTransform {
  perspective: AnimatableNumericValue;
}

interface RotateTransform {
  rotate: AnimatableStringValue;
}

interface RotateXTransform {
  rotateX: AnimatableStringValue;
}

interface RotateYTransform {
  rotateY: AnimatableStringValue;
}

interface RotateZTransform {
  rotateZ: AnimatableStringValue;
}

interface ScaleTransform {
  scale: AnimatableNumericValue;
}

interface ScaleXTransform {
  scaleX: AnimatableNumericValue;
}

interface ScaleYTransform {
  scaleY: AnimatableNumericValue;
}

interface TranslateXTransform {
  translateX: AnimatableNumericValue | `${number}%`;
}

interface TranslateYTransform {
  translateY: AnimatableNumericValue | `${number}%`;
}

interface SkewXTransform {
  skewX: AnimatableStringValue;
}

interface SkewYTransform {
  skewY: AnimatableStringValue;
}

interface MatrixTransform {
  matrix: AnimatableNumericValue[];
}

type MaximumOneOf<T, K extends keyof T = keyof T> = K extends keyof T
  ? {[P in K]: T[K]} & {[P in Exclude<keyof T, K>]?: never}
  : never;

export interface TransformsStyle {
  transform?:
    | Readonly<
        MaximumOneOf<
          PerspectiveTransform &
            RotateTransform &
            RotateXTransform &
            RotateYTransform &
            RotateZTransform &
            ScaleTransform &
            ScaleXTransform &
            ScaleYTransform &
            TranslateXTransform &
            TranslateYTransform &
            SkewXTransform &
            SkewYTransform &
            MatrixTransform
        >[]
      >
    | string
    | undefined;
  transformOrigin?: Array<string | number> | string | undefined;

  /**
   * @deprecated Use matrix in transform prop instead.
   */
  transformMatrix?: Array<number> | undefined;
  /**
   * @deprecated Use rotate in transform prop instead.
   */
  rotation?: AnimatableNumericValue | undefined;
  /**
   * @deprecated Use scaleX in transform prop instead.
   */
  scaleX?: AnimatableNumericValue | undefined;
  /**
   * @deprecated Use scaleY in transform prop instead.
   */
  scaleY?: AnimatableNumericValue | undefined;
  /**
   * @deprecated Use translateX in transform prop instead.
   */
  translateX?: AnimatableNumericValue | undefined;
  /**
   * @deprecated Use translateY in transform prop instead.
   */
  translateY?: AnimatableNumericValue | undefined;
}

export type FilterFunction =
  | {brightness: number | string}
  | {blur: number | string}
  | {contrast: number | string}
  | {grayscale: number | string}
  | {hueRotate: number | string}
  | {invert: number | string}
  | {opacity: number | string}
  | {saturate: number | string}
  | {sepia: number | string}
  | {dropShadow: DropShadowValue | string};

export type DropShadowValue = {
  offsetX: number | string;
  offsetY: number | string;
  standardDeviation?: number | string | undefined;
  color?: ColorValue | number | undefined;
};

export type BoxShadowValue = {
  offsetX: number | string;
  offsetY: number | string;
  color?: ColorValue | undefined;
  blurRadius?: string | number | undefined;
  spreadDistance?: number | string | undefined;
  inset?: boolean | undefined;
};

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'plus-lighter';

export type LinearGradientValue = {
  type: 'linear-gradient';
  // Angle or direction enums
  direction?: string | undefined;
  colorStops: ReadonlyArray<{
    color: ColorValue | null;
    positions?: ReadonlyArray<string> | undefined;
  }>;
};

export type GradientValue = LinearGradientValue;

type RadialExtent =
  'closest-corner' | 'closest-side' | 'farthest-corner' | 'farthest-side';
export type RadialGradientPosition =
  | {
      top: number | string;
      left: number | string;
    }
  | {
      top: number | string;
      right: number | string;
    }
  | {
      bottom: number | string;
      left: number | string;
    }
  | {
      bottom: number | string;
      right: number | string;
    };

export type RadialGradientShape = 'circle' | 'ellipse';
export type RadialGradientSize =
  | RadialExtent
  | {
      x: string | number;
      y: string | number;
    };

type RadialGradientValue = {
  type: 'radial-gradient';
  shape: RadialGradientShape;
  size: RadialGradientSize;
  position: RadialGradientPosition;
  colorStops: ReadonlyArray<{
    color: ColorValue | null;
    positions?: ReadonlyArray<string> | undefined;
  }>;
};

export type BackgroundImageValue = LinearGradientValue | RadialGradientValue;

export type BackgroundSizeValue = {
  x: string | number;
  y: string | number;
};

export type BackgroundRepeatKeyword =
  'repeat' | 'space' | 'round' | 'no-repeat';

export type BackgroundPositionValue =
  | {
      top: number | string;
      left: number | string;
    }
  | {
      top: number | string;
      right: number | string;
    }
  | {
      bottom: number | string;
      left: number | string;
    }
  | {
      bottom: number | string;
      right: number | string;
    };

export type BackgroundRepeatValue = {
  x: BackgroundRepeatKeyword;
  y: BackgroundRepeatKeyword;
};

/**
 * @see https://reactnative.dev/docs/view#style
 */
export interface ViewStyle extends FlexStyle, ShadowStyleIOS, TransformsStyle {
  backfaceVisibility?: 'visible' | 'hidden' | undefined;
  /**
   * `transition` (css-transitions-1), as the four longhands. When a declared
   * property's value changes, the renderer animates from the previous value —
   * off the JavaScript thread, driven by the platform display link, gated
   * behind `useSharedAnimatedBackend`. Comma-separated lists zip by index, and
   * shorter lists repeat, exactly as on the web.
   *
   * Transitionable so far: `opacity`, `background-color`, `border-color`,
   * `transform` (and `all`, meaning that set). Other property names are
   * accepted and ignored: the value still applies, immediately.
   */
  transitionProperty?: string | undefined;
  transitionDuration?: string | number | undefined;
  transitionDelay?: string | number | undefined;
  transitionTimingFunction?: string | undefined;
  /**
   * `animation` (css-animations-1), run by the same renderer engine as
   * transitions. `animationKeyframes` is a JSON string of pre-resolved stops
   * (`[{offset, opacity?, backgroundColor?, borderColor?, transform?}, ...]`)
   * — a style layer such as Astryx serializes its `@keyframes` rules into it.
   * Animatable properties match the transitionable set.
   */
  animationKeyframes?: string | undefined;
  animationDuration?: string | number | undefined;
  animationDelay?: string | number | undefined;
  animationTimingFunction?: string | undefined;
  animationIterationCount?: string | number | undefined;
  animationDirection?:
    'normal' | 'reverse' | 'alternate' | 'alternate-reverse' | undefined;
  animationFillMode?: 'none' | 'forwards' | 'backwards' | 'both' | undefined;
  /**
   * `white-space` (css-text-3 §3): how white space and newlines in text
   * children are processed. `normal` collapses runs of spaces and turns
   * newlines into spaces; `pre` and `pre-wrap` preserve both; `pre-line`
   * preserves newlines but collapses spaces; `nowrap` collapses and does not
   * wrap.
   *
   * `break-spaces` is accepted and **behaves as `pre-wrap`**. The two differ
   * only in what happens to a run of preserved spaces sitting at a wrap
   * point: `pre-wrap` lets it hang past the edge, `break-spaces` measures it
   * so it wraps like any other character. Hanging is what both platform text
   * engines do and neither exposes a knob for it — deciding otherwise means
   * participating in line breaking, which TextKit and Android's `Layout` do
   * not expose. The two are identical unless a space run is long enough to
   * outrun the line.
   *
   * Applies to elements — `<pre>`, `<div>` and the rest — and to the text
   * inside them, which is the whitespace model this property comes from. It
   * has NO effect on `<Text>`, on either platform: `<Text>` predates the DOM
   * work, already preserves whitespace and newlines as authored, and never
   * had a collapsing pass for `pre` to turn off. Accepted on a `<Text>` style
   * only because a TextStyle is a ViewStyle; it is ignored.
   */
  whiteSpace?:
    | 'normal'
    | 'pre'
    | 'pre-wrap'
    | 'pre-line'
    | 'nowrap'
    | 'break-spaces'
    | undefined;
  backgroundColor?: ColorValue | undefined;
  borderBlockColor?: ColorValue | undefined;
  borderBlockEndColor?: ColorValue | undefined;
  borderBlockStartColor?: ColorValue | undefined;
  borderBottomColor?: ColorValue | undefined;
  borderBottomEndRadius?: AnimatableNumericValue | string | undefined;
  borderBottomLeftRadius?: AnimatableNumericValue | string | undefined;
  borderBottomRightRadius?: AnimatableNumericValue | string | undefined;
  borderBottomStartRadius?: AnimatableNumericValue | string | undefined;
  borderColor?: ColorValue | undefined;
  /**
   * On iOS 13+, it is possible to change the corner curve of borders.
   * @platform ios
   */
  borderCurve?: 'circular' | 'continuous' | undefined;
  borderEndColor?: ColorValue | undefined;
  borderEndEndRadius?: AnimatableNumericValue | string | undefined;
  borderEndStartRadius?: AnimatableNumericValue | string | undefined;
  borderLeftColor?: ColorValue | undefined;
  borderRadius?: AnimatableNumericValue | string | undefined;
  borderRightColor?: ColorValue | undefined;
  borderStartColor?: ColorValue | undefined;
  borderStartEndRadius?: AnimatableNumericValue | string | undefined;
  borderStartStartRadius?: AnimatableNumericValue | string | undefined;
  borderStyle?: 'solid' | 'dotted' | 'dashed' | undefined;
  borderTopColor?: ColorValue | undefined;
  borderTopEndRadius?: AnimatableNumericValue | string | undefined;
  borderTopLeftRadius?: AnimatableNumericValue | string | undefined;
  borderTopRightRadius?: AnimatableNumericValue | string | undefined;
  borderTopStartRadius?: AnimatableNumericValue | string | undefined;
  outlineColor?: ColorValue | undefined;
  outlineOffset?: AnimatableNumericValue | undefined;
  outlineStyle?: 'solid' | 'dotted' | 'dashed' | undefined;
  outlineWidth?: AnimatableNumericValue | undefined;
  opacity?: AnimatableNumericValue | undefined;
  /**
   * Sets the elevation of a view, using Android's underlying
   * [elevation API](https://developer.android.com/training/material/shadows-clipping.html#Elevation).
   * This adds a drop shadow to the item and affects z-order for overlapping views.
   * Only supported on Android 5.0+, has no effect on earlier versions.
   *
   * @platform android
   */
  elevation?: number | undefined;
  /**
   * Controls whether the View can be the target of touch events.
   */
  pointerEvents?: 'box-none' | 'none' | 'box-only' | 'auto' | undefined;
  isolation?: 'auto' | 'isolate' | undefined;
  cursor?: CursorValue | undefined;
  boxShadow?: ReadonlyArray<BoxShadowValue> | string | undefined;
  filter?: ReadonlyArray<FilterFunction> | string | undefined;

  mixBlendMode?: BlendMode | undefined;
  backgroundImage?: ReadonlyArray<BackgroundImageValue> | string | undefined;
  experimental_backgroundImage?:
    ReadonlyArray<BackgroundImageValue> | string | undefined;
  experimental_backgroundSize?:
    ReadonlyArray<BackgroundSizeValue> | string | undefined;
  experimental_backgroundPosition?:
    ReadonlyArray<BackgroundPositionValue> | string | undefined;
  experimental_backgroundRepeat?:
    ReadonlyArray<BackgroundRepeatValue> | string | undefined;
}

export type FontVariant =
  | 'small-caps'
  | 'oldstyle-nums'
  | 'lining-nums'
  | 'tabular-nums'
  | 'common-ligatures'
  | 'no-common-ligatures'
  | 'discretionary-ligatures'
  | 'no-discretionary-ligatures'
  | 'historical-ligatures'
  | 'no-historical-ligatures'
  | 'contextual'
  | 'no-contextual'
  | 'proportional-nums'
  | 'stylistic-one'
  | 'stylistic-two'
  | 'stylistic-three'
  | 'stylistic-four'
  | 'stylistic-five'
  | 'stylistic-six'
  | 'stylistic-seven'
  | 'stylistic-eight'
  | 'stylistic-nine'
  | 'stylistic-ten'
  | 'stylistic-eleven'
  | 'stylistic-twelve'
  | 'stylistic-thirteen'
  | 'stylistic-fourteen'
  | 'stylistic-fifteen'
  | 'stylistic-sixteen'
  | 'stylistic-seventeen'
  | 'stylistic-eighteen'
  | 'stylistic-nineteen'
  | 'stylistic-twenty';
export interface TextStyleIOS extends ViewStyle {
  fontVariant?: FontVariant[] | undefined;
  textDecorationColor?: ColorValue | undefined;
  textDecorationStyle?:
    'solid' | 'double' | 'dotted' | 'dashed' | 'wavy' | undefined;
  writingDirection?: 'auto' | 'ltr' | 'rtl' | undefined;
}

export interface TextStyleAndroid extends ViewStyle {
  textAlignVertical?: 'auto' | 'top' | 'bottom' | 'center' | undefined;
  includeFontPadding?: boolean | undefined;
}

// @see https://reactnative.dev/docs/text#style
export interface TextStyle extends TextStyleIOS, TextStyleAndroid, ViewStyle {
  color?: ColorValue | undefined;
  fontFamily?: string | undefined;
  fontSize?: number | undefined;
  fontStyle?: 'normal' | 'italic' | undefined;
  /**
   * Specifies font weight. The values 'normal' and 'bold' are supported
   * for most fonts. Not all fonts have a variant for each of the numeric
   * values, in that case the closest one is chosen.
   */
  fontWeight?:
    | 'normal'
    | 'bold'
    | '100'
    | '200'
    | '300'
    | '400'
    | '500'
    | '600'
    | '700'
    | '800'
    | '900'
    | 100
    | 200
    | 300
    | 400
    | 500
    | 600
    | 700
    | 800
    | 900
    | 'ultralight'
    | 'thin'
    | 'light'
    | 'medium'
    | 'regular'
    | 'semibold'
    | 'condensedBold'
    | 'condensed'
    | 'heavy'
    | 'black'
    | undefined;
  letterSpacing?: number | undefined;
  lineHeight?: number | undefined;
  textAlign?:
    | 'auto'
    | 'left'
    | 'right'
    | 'center'
    | 'justify'
    | 'start'
    | 'end'
    | undefined;
  textDecorationLine?:
    | 'none'
    | 'underline'
    | 'line-through'
    | 'underline line-through'
    | undefined;
  textDecorationStyle?:
    'solid' | 'double' | 'dotted' | 'dashed' | 'wavy' | undefined;
  textDecorationColor?: ColorValue | undefined;
  textShadowColor?: ColorValue | undefined;
  textShadowOffset?: {width: number; height: number} | undefined;
  textShadowRadius?: number | undefined;
  textTransform?: 'none' | 'capitalize' | 'uppercase' | 'lowercase' | undefined;
  userSelect?: 'auto' | 'none' | 'text' | 'contain' | 'all' | undefined;
}

/**
 * Image style
 * @see https://reactnative.dev/docs/image#style
 */
export interface ImageStyle extends FlexStyle, ShadowStyleIOS, TransformsStyle {
  resizeMode?: ImageResizeMode | undefined;
  backfaceVisibility?: 'visible' | 'hidden' | undefined;
  borderBottomLeftRadius?: AnimatableNumericValue | string | undefined;
  borderBottomRightRadius?: AnimatableNumericValue | string | undefined;
  backgroundColor?: ColorValue | undefined;
  borderColor?: ColorValue | undefined;
  borderRadius?: AnimatableNumericValue | string | undefined;
  borderTopLeftRadius?: AnimatableNumericValue | string | undefined;
  borderTopRightRadius?: AnimatableNumericValue | string | undefined;
  overflow?: 'visible' | 'hidden' | undefined;
  overlayColor?: ColorValue | undefined;
  tintColor?: ColorValue | undefined;
  opacity?: AnimatableNumericValue | undefined;
  objectFit?: 'cover' | 'contain' | 'fill' | 'scale-down' | 'none' | undefined;
  cursor?: CursorValue | undefined;
}
