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
  measureAnchor: () => void,
};

export const PopperContext: React.Context<PopperContextValue | null> =
  React.createContext<PopperContextValue | null>(null);

export function PopperRoot({children}: {children: React.Node}): React.Node {
  const anchorRef = React.useRef<$FlowFixMe>(null);
  const [anchorRect, setAnchorRect] = React.useState<Rect | null>(null);
  // Measuring only on the anchor's own layout is not enough: no layout event
  // fires when the PAGE scrolls, so by the time an overlay opened, the stored
  // rect was stale by exactly the scroll distance and the content landed near
  // the bottom of the screen. Re-measure at open — which is when the web's
  // positioners measure too.
  const measureAnchor = React.useCallback(() => {
    const node = anchorRef.current;
    if (node != null && typeof node.measureInWindow === 'function') {
      node.measureInWindow((x: number, y: number, w: number, h: number) => {
        setAnchorRect(previous =>
          previous != null &&
          previous.x === x &&
          previous.y === y &&
          previous.width === w &&
          previous.height === h
            ? previous
            : {x, y, width: w, height: h},
        );
      });
    }
  }, []);
  const context: PopperContextValue = React.useMemo(
    () => ({anchorRef, anchorRect, setAnchorRect, measureAnchor}) as $FlowFixMe,
    [anchorRect, measureAnchor],
  );
  return (
    <PopperContext.Provider value={context}>{children}</PopperContext.Provider>
  );
}

/**
 * Wraps the trigger and measures it: on its own layout, and again whenever
 * content opens (see PopperRoot.measureAnchor).
 */
export function PopperAnchor(props: $FlowFixMe): React.Node {
  const {children, ...rest} = props;
  const context = React.useContext(PopperContext);
  const measure = context?.measureAnchor;
  const contentProps: $FlowFixMe = {
    ...rest,
    ref: composeRefs(context?.anchorRef, rest.ref),
    onLayout: (e: $FlowFixMe) => {
      rest.onLayout?.(e);
      measure?.();
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
    // Radix's own prop (floating-ui's `autoUpdate`): 'optimized' measures on
    // the events that usually move an anchor, 'always' re-measures every
    // animation frame. On the web 'optimized' can listen to scroll and resize
    // on every ancestor; React Native broadcasts no such event, so there is
    // nothing for the optimized strategy to listen TO — an anchor inside a
    // ScrollView moves with no notification whatsoever. Hence 'always' is the
    // default here, which is the same choice floating-ui documents for
    // elements that move for reasons it cannot observe.
    updatePositionStrategy = 'always',
    style,
    ...rest
  } = props;
  const context = React.useContext(PopperContext);
  const [size, setSize] = React.useState<{
    width: number,
    height: number,
  } | null>(null);
  // Mounting IS opening for popper content, so this fires at exactly the
  // moment the web's positioners measure.
  const measureAnchor = context?.measureAnchor;
  React.useEffect(() => {
    measureAnchor?.();
  }, [measureAnchor]);

  // Then keep following it for as long as the content is open. The loop is
  // bounded by the overlay's lifetime — an open menu is a held interaction —
  // and each tick is one measureInWindow whose result usually matches, so
  // state only changes when the anchor actually moved.
  React.useEffect(() => {
    if (measureAnchor == null || updatePositionStrategy !== 'always') {
      return;
    }
    let frame: ?AnimationFrameID = null;
    const tick = () => {
      measureAnchor();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      if (frame != null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [measureAnchor, updatePositionStrategy]);

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
