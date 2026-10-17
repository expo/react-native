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
 * Astryx's entire SVG surface is `<path>`, `<circle>`, `<rect>`, `<line>` and
 * `<text>`, with no gradients, masks, clip paths, groups or transforms, so
 * this implements exactly that and says so where it does not.
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

import {computedStyleForInstance} from '../native-css/engine';
import EngineElement from '../native-css/EngineElement';
import AstryxVectorShape from './AstryxVectorShapeNativeComponent';
import {
  circleCommands,
  lineCommands,
  parsePathData,
  rectCommands,
  scaleCommands,
} from './pathData';
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
  let paint = processedPaints.get(resolved);
  if (paint == null) {
    const processed = processColor(resolved);
    paint = typeof processed === 'number' ? processed : 0;
    remember(processedPaints, resolved, paint);
  }
  return paint;
}

/*
 * What every shape drawing the same thing shares: an icon is drawn once per
 * row of a list, from the same path string in the same colours, so a path is
 * parsed and scaled, and a colour processed, once rather than per copy. Every
 * copy gets the same objects, which also leaves a shape's props unchanged from
 * one render to the next.
 */
const processedPaints: Map<string, number> = new Map();
const parsedPaths: Map<string, PathCommands> = new Map();
const scaledPaths: WeakMap<
  PathCommands,
  Map<number, PathCommands>,
> = new WeakMap();

// Bounded, since the strings come from the page: the cache is emptied rather
// than grown past what an app's icon set needs
const MAX_SHARED = 1024;

function remember<V>(cache: Map<string, V>, key: string, value: V): void {
  if (cache.size >= MAX_SHARED) {
    cache.clear();
  }
  cache.set(key, value);
}

function parsedPath(d: string): PathCommands {
  let commands = parsedPaths.get(d);
  if (commands == null) {
    commands = parsePathData(d);
    remember(parsedPaths, d, commands);
  }
  return commands;
}

function scaledPath(commands: PathCommands, scale: number): PathCommands {
  let byScale = scaledPaths.get(commands);
  if (byScale == null) {
    byScale = new Map();
    scaledPaths.set(commands, byScale);
  }
  let scaled = byScale.get(scale);
  if (scaled == null) {
    scaled = scaleCommands(commands, scale);
    byScale.set(scale, scaled);
  }
  return scaled;
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
  const scaled = scaledPath(commands, scale);

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
  return <Shape commands={parsedPath(props.d ?? '')} props={props} />;
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

/**
 * `<svg>` where the renderer's style engine styles the page: the box is an
 * element like any other, sized by its styles over its `width` and `height`
 * presentation attributes, and its shapes are drawn at the scale and in the
 * `currentColor` the box resolved to, read once it is laid out.
 *
 * The first frame draws them at the attributes' size in black; the layout
 * effect's update is committed before that frame is shown.
 * DOM-CSS-LIMITATION(svg-paint-read-after-layout): a colour that changes
 * without the `<svg>` rendering again (an ancestor's theme) is not followed.
 */
export function EngineSvg(props: {
  viewBox?: ?string,
  width?: ?(number | string),
  height?: ?(number | string),
  color?: ?string,
  children?: React.Node,
  ref?: unknown,
  [string]: unknown,
}): React.Node {
  const {
    __astryxTag: _tag,
    viewBox,
    width,
    height,
    color,
    children,
    ref: authorRef,
    fill,
    stroke,
    strokeWidth,
    strokeLinecap,
    strokeLinejoin,
    ...rest
  } = props;
  const inherited = useContext(SvgContext);
  const hostRef = React.useRef<$FlowFixMe>(null);
  const setRef = React.useCallback(
    (instance: $FlowFixMe) => {
      hostRef.current = instance;
      const author: $FlowFixMe = authorRef;
      if (typeof author === 'function') {
        author(instance);
      } else if (author != null && typeof author === 'object') {
        author.current = instance;
      }
    },
    [authorRef],
  );
  const [resolved, setResolved] = React.useState<?{
    width: number,
    height: number,
    color: ?string,
  }>(null);
  // Read after every render, once laid out: the engine styles the `<svg>` in
  // the commit that follows its render. The previous answer is kept when
  // nothing changed, which ends the chain of updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useLayoutEffect(() => {
    const host = hostRef.current;
    const rect = host?.getBoundingClientRect?.();
    if (rect == null) {
      return;
    }
    const computed = computedStyleForInstance(host);
    const resolvedColor =
      typeof computed?.color === 'string' ? computed.color : null;
    setResolved(previous =>
      previous != null &&
      previous.width === rect.width &&
      previous.height === rect.height &&
      previous.color === resolvedColor
        ? previous
        : {width: rect.width, height: rect.height, color: resolvedColor},
    );
  });

  const box = parseViewBox(viewBox);
  const drawnWidth = resolved?.width ?? resolveLength(width, 16, 16);
  const drawnHeight = resolved?.height ?? resolveLength(height, 16, 16);
  const scale =
    box == null
      ? 1
      : Math.min(drawnWidth / box.width, drawnHeight / box.height);
  const currentColor = color ?? resolved?.color ?? inherited.currentColor;
  const context = useMemo(() => ({scale, currentColor}), [scale, currentColor]);

  const paint: {[string]: unknown} = {
    fill,
    stroke,
    strokeWidth,
    strokeLinecap,
    strokeLinejoin,
  };
  const childrenWithInheritedPaint = React.Children.map(
    children,
    // $FlowFixMe[incompatible-call] reading and cloning arbitrary elements
    (child: $FlowFixMe) => {
      if (!React.isValidElement(child)) {
        return child;
      }
      const inheritedPaint: {[string]: unknown} = {};
      for (const key of Object.keys(paint)) {
        if (child.props[key] == null && paint[key] != null) {
          inheritedPaint[key] = paint[key];
        }
      }
      return Object.keys(inheritedPaint).length === 0
        ? child
        : React.cloneElement(child, inheritedPaint);
    },
  );

  // `width` and `height` are presentation attributes, under every rule
  const presentational: Array<[string, unknown]> = [];
  if (width != null) {
    presentational.push(['width', width]);
  }
  if (height != null) {
    presentational.push(['height', height]);
  }

  return (
    <SvgContext.Provider value={context}>
      <EngineElement
        {...(rest as $FlowFixMe)}
        __astryxTag="svg"
        __hostTag="div"
        cssPresentational={presentational.length > 0 ? presentational : null}
        ref={setRef}>
        {childrenWithInheritedPaint}
      </EngineElement>
    </SvgContext.Provider>
  );
}
