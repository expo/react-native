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
 * Popper — Radix's floating-content positioning over the fork's anchor
 * positioning (overlay/anchorPosition.js, the CSS Anchor Positioning
 * model).
 *
 * Radix positions with floating-ui and inline styles; here the anchor is
 * measured with measureInWindow, the content self-measures via onLayout,
 * and `resolveAnchorPosition` picks the placement with the same
 * flip/clamp behavior the Astryx overlays use. Radix's side/align map onto
 * position-area terms; sideOffset becomes `offset`.
 */

import {resolveAnchorPosition} from '../overlay/anchorPosition';
import {composeRefs} from './internals';
import * as React from 'react';
import {Dimensions} from 'react-native';

type Rect = {x: number, y: number, width: number, height: number};

type PopperContextValue = {
  anchorRef: $FlowFixMe,
  anchorRect: Rect | null,
  setAnchorRect: Rect => void,
};

const PopperContext: React.Context<PopperContextValue | null> =
  React.createContext<PopperContextValue | null>(null);

export function PopperRoot({children}: {children: React.Node}): React.Node {
  const anchorRef = React.useRef<$FlowFixMe>(null);
  const [anchorRect, setAnchorRect] = React.useState<Rect | null>(null);
  const context: PopperContextValue = React.useMemo(
    () => ({anchorRef, anchorRect, setAnchorRect}) as $FlowFixMe,
    [anchorRect],
  );
  return (
    <PopperContext.Provider value={context}>{children}</PopperContext.Provider>
  );
}

/**
 * Measures the wrapped trigger. Content opening reads the LAST measured
 * rect; measurement re-runs on every layout of the anchor.
 */
export function PopperAnchor(props: $FlowFixMe): React.Node {
  const {children, ...rest} = props;
  const context = React.useContext(PopperContext);
  const measure = React.useCallback(() => {
    const node = context?.anchorRef.current;
    if (node != null && typeof node.measureInWindow === 'function') {
      node.measureInWindow((x: number, y: number, w: number, h: number) => {
        context?.setAnchorRect({x, y, width: w, height: h});
      });
    }
  }, [context]);
  const contentProps: $FlowFixMe = {
    ...rest,
    ref: composeRefs(context?.anchorRef, rest.ref),
    onLayout: (e: $FlowFixMe) => {
      rest.onLayout?.(e);
      measure();
    },
  };
  return <div {...contentProps}>{children}</div>;
}

function areaFor(side: string, align: string): string {
  const spanFor = (axis: 'inline' | 'block') =>
    align === 'start'
      ? ` span-${axis}-end`
      : align === 'end'
        ? ` span-${axis}-start`
        : '';
  switch (side) {
    case 'top':
      return 'block-start' + spanFor('inline');
    case 'left':
      return 'inline-start' + spanFor('block');
    case 'right':
      return 'inline-end' + spanFor('block');
    case 'bottom':
    default:
      return 'block-end' + spanFor('inline');
  }
}

/**
 * The floating box. Renders invisibly (opacity 0 at the viewport origin)
 * until both the anchor rect and its own size are known, then positions
 * absolutely — one frame of settling, the same dance the web's floating-ui
 * does before paint.
 */
export function PopperContent(props: $FlowFixMe): React.Node {
  const {
    children,
    side = 'bottom',
    align = 'center',
    sideOffset = 0,
    style,
    ...rest
  } = props;
  const context = React.useContext(PopperContext);
  const [size, setSize] = React.useState<{
    width: number,
    height: number,
  } | null>(null);

  const anchorRect = context?.anchorRect ?? null;
  let position = null;
  if (anchorRect != null && size != null) {
    const window = Dimensions.get('window');
    const resolved = resolveAnchorPosition({
      anchor: anchorRect,
      overlay: size,
      viewport: {width: window.width, height: window.height},
      area: areaFor(side, align) as $FlowFixMe,
      fallbacks: [
        areaFor(side === 'top' ? 'bottom' : 'top', align),
      ] as $FlowFixMe,
      offset: sideOffset,
    });
    position = {x: resolved.x, y: resolved.y};
  }

  const contentProps: $FlowFixMe = {
    ...rest,
    onLayout: (e: $FlowFixMe) => {
      rest.onLayout?.(e);
      const layout = e?.nativeEvent?.layout;
      if (
        layout != null &&
        (size == null ||
          size.width !== layout.width ||
          size.height !== layout.height)
      ) {
        setSize({width: layout.width, height: layout.height});
      }
    },
    style: {
      ...style,
      position: 'absolute',
      left: position?.x ?? 0,
      top: position?.y ?? 0,
      opacity: position == null ? 0 : (style?.opacity ?? 1),
    },
  };
  return <div {...contentProps}>{children}</div>;
}
