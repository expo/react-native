/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

'use strict';

/**
 * The `<svg>` subset `packages/core` actually uses.
 *
 * Measured rather than guessed: across Astryx's 106 components the entire SVG
 * surface is `<path>` (38), `<circle>` (7), `<rect>` (3), `<line>` (1) and
 * `<text>` (1) — no gradients, masks, clip paths, groups or transforms. So
 * this implements exactly that, and says so where it does not.
 *
 * Every shape becomes a path in JavaScript and is drawn by one native view.
 * That keeps the platform code to "replay these primitives" and means an icon
 * cannot render differently on iOS and Android because of two parsers.
 *
 * DOM-CSS-LIMITATION(svg-subset): `<g>`, transforms, gradients, masks,
 * clip paths, patterns and `<text>` are not implemented. A shape using them
 * draws without them rather than failing.
 */

import type {PathCommands} from './pathData';

import AstryxVectorShape from './AstryxVectorShapeNativeComponent';
import {
  circleCommands,
  lineCommands,
  parsePathData,
  rectCommands,
  scaleCommands,
} from './pathData';
import {CurrentColorContext} from './CurrentColor';
import * as React from 'react';
import {createContext, useContext, useMemo} from 'react';
import {StyleSheet, processColor} from 'react-native';

type SvgContextValue = {
  // Multiplies viewBox units to rendered points.
  scale: number,
  // What `currentColor` resolves to inside this <svg>.
  currentColor: ?string,
};

const SvgContext: React.Context<SvgContextValue> = createContext({
  scale: 1,
  currentColor: null,
});

function parseViewBox(viewBox: ?string): ?{width: number, height: number} {
  if (viewBox == null) {
    return null;
  }
  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) {
    return null;
  }
  // min-x/min-y are ignored: every icon in the subset uses a zero origin, and
  // honouring them would mean translating too. DOM-CSS-LIMITATION(svg-subset).
  return {width: parts[2], height: parts[3]};
}

/**
 * Resolves a paint value to an ARGB int, or 0 for "do not paint".
 *
 * `none` and a missing value are both "no paint", which is why the native side
 * treats 0 as transparent rather than black — SVG's default fill is black, but
 * only when the attribute is absent AND nothing inherits, and Astryx always
 * states it.
 */
function resolvePaint(value: ?string, currentColor: ?string): number {
  if (value == null || value === 'none' || value === 'transparent') {
    return 0;
  }
  const resolved =
    value === 'currentColor' ? (currentColor ?? '#000000') : value;
  const processed = processColor(resolved);
  return typeof processed === 'number' ? processed : 0;
}

// Inexact on purpose: each shape adds its own geometry props (`d`, `cx`,
// `width`…) and passes the whole object through to `Shape`, which reads only
// the paint attributes.
type ShapeProps = {
  fill?: ?string,
  stroke?: ?string,
  strokeWidth?: ?(number | string),
  strokeLinecap?: ?string,
  strokeLinejoin?: ?string,
  fillRule?: ?string,
  clipRule?: ?string,
};

/**
 * One shape, drawn by the native view.
 *
 * Absolutely positioned and filling its `<svg>` so several shapes overlay
 * correctly — SVG has no layout, it paints in document order into a shared
 * coordinate system, which is exactly what stacked absolute views give.
 */
function Shape({
  commands,
  props,
}: {
  commands: PathCommands,
  // Each shape passes its own props straight through — geometry included —
  // and only the paint attributes are read here.
  props: $FlowFixMe,
}): React.Node {
  const {scale, currentColor} = useContext(SvgContext);
  const scaled = useMemo(
    () => scaleCommands(commands, scale),
    [commands, scale],
  );

  if (scaled.length === 0) {
    return null;
  }

  const strokeWidth =
    props.strokeWidth == null ? 1 : parseFloat(String(props.strokeWidth));

  return (
    <AstryxVectorShape
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      commands={scaled}
      fillColor={resolvePaint(props.fill, currentColor)}
      strokeColor={resolvePaint(props.stroke, currentColor)}
      // Stroke width is in viewBox units too, so it scales with the geometry.
      strokeWidth={Number.isFinite(strokeWidth) ? strokeWidth * scale : scale}
      strokeLinecap={props.strokeLinecap ?? 'butt'}
      strokeLinejoin={props.strokeLinejoin ?? 'miter'}
      // SVG spells the even-odd rule on `fill-rule`, and `clip-rule` carries it
      // for clipped content; Astryx uses both interchangeably on plain shapes.
      fillRule={props.fillRule ?? props.clipRule ?? 'nonzero'}
    />
  );
}

export function SvgPath(props: {d?: ?string, ...ShapeProps}): React.Node {
  const commands = useMemo(() => parsePathData(props.d ?? ''), [props.d]);
  return <Shape commands={commands} props={props} />;
}

export function SvgCircle(props: {
  cx?: ?(number | string),
  cy?: ?(number | string),
  r?: ?(number | string),
  ...ShapeProps,
}): React.Node {
  const commands = useMemo(
    () =>
      circleCommands(
        parseFloat(String(props.cx ?? 0)),
        parseFloat(String(props.cy ?? 0)),
        parseFloat(String(props.r ?? 0)),
      ),
    [props.cx, props.cy, props.r],
  );
  return <Shape commands={commands} props={props} />;
}

export function SvgRect(props: {
  x?: ?(number | string),
  y?: ?(number | string),
  width?: ?(number | string),
  height?: ?(number | string),
  rx?: ?(number | string),
  ry?: ?(number | string),
  ...ShapeProps,
}): React.Node {
  const commands = useMemo(
    () =>
      rectCommands(
        parseFloat(String(props.x ?? 0)),
        parseFloat(String(props.y ?? 0)),
        parseFloat(String(props.width ?? 0)),
        parseFloat(String(props.height ?? 0)),
        parseFloat(String(props.rx ?? 0)),
        parseFloat(String(props.ry ?? 0)),
      ),
    [props.x, props.y, props.width, props.height, props.rx, props.ry],
  );
  return <Shape commands={commands} props={props} />;
}

export function SvgLine(props: {
  x1?: ?(number | string),
  y1?: ?(number | string),
  x2?: ?(number | string),
  y2?: ?(number | string),
  ...ShapeProps,
}): React.Node {
  const commands = useMemo(
    () =>
      lineCommands(
        parseFloat(String(props.x1 ?? 0)),
        parseFloat(String(props.y1 ?? 0)),
        parseFloat(String(props.x2 ?? 0)),
        parseFloat(String(props.y2 ?? 0)),
      ),
    [props.x1, props.y1, props.x2, props.y2],
  );
  return <Shape commands={commands} props={props} />;
}

/**
 * Resolves an SVG length to points.
 *
 * `1em` is the size Astryx's icons are authored at, and it means the inherited
 * font size — which is the whole reason an icon tracks the text around it.
 */
function resolveLength(
  value: ?(number | string),
  fontSize: number,
  fallback: number,
): number {
  if (value == null) {
    return fallback;
  }
  if (typeof value === 'number') {
    return value;
  }
  const text = value.trim();
  if (text.endsWith('em')) {
    const n = parseFloat(text);
    return Number.isFinite(n) ? n * fontSize : fallback;
  }
  const n = parseFloat(text);
  return Number.isFinite(n) ? n : fallback;
}

export function Svg(props: {
  viewBox?: ?string,
  width?: ?(number | string),
  height?: ?(number | string),
  color?: ?string,
  fontSize?: ?number,
  style?: unknown,
  children?: React.Node,
  ...ShapeProps,
}): React.Node {
  const inherited = useContext(SvgContext);
  const inheritedColor = useContext(CurrentColorContext);
  const fontSize = props.fontSize ?? 16;
  // `width`/`height` are presentation ATTRIBUTES: any CSS that sizes the
  // element outranks them (that is how `<svg class="h-4 w-4">` draws at 16px
  // from markup whose attributes say 24). The resolved style therefore wins,
  // and the attributes are the fallback — without this an icon sized only by
  // a class had no size to scale its viewBox against.
  const styleSize: $FlowFixMe = props.style;
  const width = resolveLength(
    styleSize?.width ?? props.width,
    fontSize,
    fontSize,
  );
  const height = resolveLength(
    styleSize?.height ?? props.height,
    fontSize,
    fontSize,
  );
  const viewBox = parseViewBox(props.viewBox);

  // Uniform scale only: `preserveAspectRatio` defaults to `xMidYMid meet`, and
  // the subset has no case that needs anything else.
  const scale =
    viewBox == null
      ? 1
      : Math.min(width / viewBox.width, height / viewBox.height);

  // `currentColor` is the inherited text colour: an explicit `color` prop
  // wins, then whatever an ancestor element resolved (see CurrentColor.js),
  // then the enclosing <svg>'s own paint context.
  const currentColor =
    props.color ?? styleSize?.color ?? inheritedColor ?? inherited.currentColor;
  const context = useMemo(() => ({scale, currentColor}), [scale, currentColor]);

  // Paint attributes on <svg> inherit to shapes that do not state their own,
  // which is how Astryx's icons set stroke once on the root.
  const childrenWithInheritedPaint = React.Children.map(
    props.children,
    // $FlowFixMe[incompatible-call] reading and cloning arbitrary elements is
    // not expressible here: the children are shapes whose props Flow only
    // knows as `unknown`.
    (child: $FlowFixMe) => {
      if (!React.isValidElement(child)) {
        return child;
      }
      const inheritedPaint: {[string]: unknown} = {};
      for (const key of [
        'fill',
        'stroke',
        'strokeWidth',
        'strokeLinecap',
        'strokeLinejoin',
      ]) {
        if (child.props[key] == null && (props as $FlowFixMe)[key] != null) {
          inheritedPaint[key] = (props as $FlowFixMe)[key];
        }
      }
      return Object.keys(inheritedPaint).length === 0
        ? child
        : React.cloneElement(child, inheritedPaint);
    },
  );

  return (
    <SvgContext.Provider value={context}>
      {/* $FlowFixMe[not-a-component] intrinsic <div> tag */}
      <div style={[{width, height}, props.style]}>
        {childrenWithInheritedPaint}
      </div>
    </SvgContext.Provider>
  );
}
