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

import {anchorElement} from './anchorNames';
import {registerTopLayerHandle} from './topLayerHandles';
import {MARGIN_KEYS, placeInTopLayer} from './topLayerPlacement';
import * as React from 'react';
import {Dimensions, Pressable, StyleSheet} from 'react-native';
import {jsx as reactJsx} from 'react/jsx-runtime';

/**
 * An element that can be in the top layer (a popover), rendered in
 * `<native:toplayer>`: an empty handle where the element is written, whose
 * child the platform draws above everything on the screen while it is shown.
 * The handle is there whether or not the element is shown, so showing it moves
 * nothing in the tree and the element keeps its state and its listeners.
 *
 * While shown, the element is placed by CSS anchor positioning against the
 * element its `position-anchor` names (see topLayerPlacement.js), measured and
 * placed before its first frame is drawn. A press outside it light-dismisses
 * it, `popover="auto"` as HTML has it, unless the press is on its anchor, whose
 * click toggles it instead.
 */
export default function TopLayerElement({
  open,
  lightDismiss,
  backdrop = null,
  onBackdropPress = null,
  centered = false,
  viewport = null,
  instanceRef,
  children: element,
}: {
  open: boolean,
  lightDismiss: boolean,
  // A modal dialog's `::backdrop`: the style of a box under it that covers the
  // window and takes every press outside it
  backdrop?: ?{readonly [string]: unknown},
  onBackdropPress?: ?() => void,
  // Whether the element is placed as a modal dialog is, by the user agent's
  // `inset: 0` and its `margin: auto`: centred in the viewport
  centered?: boolean,
  // The page's viewport where its host declares one (a screen's, below the
  // navigation bar and down to the window's bottom edge), else the window
  viewport?: ?{readonly width: number, readonly height: number},
  // The element's host instance, which `hidePopover()` is asked of
  instanceRef: {current: $FlowFixMe},
  children: React.Node,
}): React.Node {
  const handleRef = React.useRef<$FlowFixMe>(null);
  const setHandle = React.useCallback((instance: $FlowFixMe) => {
    handleRef.current = instance;
    if (instance != null && typeof instance === 'object') {
      registerTopLayerHandle(instance);
    }
  }, []);
  const [placement, setPlacement] = React.useState<?{
    left: number,
    top: number,
    // The handle's place in the window, which the backdrop starts from
    originX: number,
    originY: number,
  }>(null);
  // Bumped by the element's layout, so a change in its size places it again
  const [layouts, setLayouts] = React.useState(0);
  const authored: $FlowFixMe = React.isValidElement(element)
    ? (element as $FlowFixMe).props
    : null;
  const style = authored?.style;

  React.useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const host = instanceRef.current;
    const handle = handleRef.current;
    // A renderer without layout (a test's) has nothing to place it by
    if (
      typeof host?.getBoundingClientRect !== 'function' ||
      typeof handle?.getBoundingClientRect !== 'function'
    ) {
      return;
    }
    const own = host.getBoundingClientRect();
    const origin = handle.getBoundingClientRect();
    const flat = flatStyle(style);
    const anchorRect = anchorRectOf(flat);
    // An element placed by its anchor is placed in the window, which the
    // anchor's rect is in; one placed by its insets, as a fixed element is, in
    // the page's viewport, which its viewport units measure
    const area = anchorRect == null ? pageViewport(viewport) : windowViewport();
    const at = placeInTopLayer({
      style: flat,
      size: {width: own.width, height: own.height},
      anchor: anchorRect,
      viewport: {width: area.width, height: area.height},
      defaultInset: centered ? 0 : null,
    });
    // The platform draws the element from the handle's place in the window
    const next = {
      left: area.x + at.x - origin.x,
      top: area.y + at.y - origin.y,
      originX: origin.x,
      originY: origin.y,
    };
    setPlacement(previous =>
      previous != null &&
      Math.abs(previous.left - next.left) < 0.5 &&
      Math.abs(previous.top - next.top) < 0.5 &&
      Math.abs(previous.originX - next.originX) < 0.5 &&
      Math.abs(previous.originY - next.originY) < 0.5
        ? previous
        : next,
    );
    // Placed when it opens and when its own layout changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, layouts]);

  let placed: React.Node = element;
  if (
    open &&
    authored != null &&
    typeof (element as $FlowFixMe).type === 'string'
  ) {
    const authoredLayout = authored.onLayout;
    placed = React.cloneElement(element as $FlowFixMe, {
      style: placedStyle(style, placement),
      // A modal dialog is the only content the accessibility tree offers
      ...(backdrop != null ? {'aria-modal': true} : null),
      onLayout: (event: $FlowFixMe) => {
        if (typeof authoredLayout === 'function') {
          authoredLayout(event);
        }
        setLayouts(count => count + 1);
      },
    });
  }

  // Under the element, covering the window from the handle's place in it; the
  // slot is held while closed, so opening does not move the element in the
  // handle's children
  let backdropBox: React.Node = null;
  if (open && backdrop != null) {
    const window = Dimensions.get('window');
    backdropBox = reactJsx(Pressable, {
      accessible: false,
      onPress: () => onBackdropPress?.(),
      style: [
        backdrop,
        {
          position: 'absolute',
          left: -(placement?.originX ?? 0),
          top: -(placement?.originY ?? 0),
          width: window.width,
          height: window.height,
        },
      ],
    });
  }

  // Through React's own runtime: this module's JSX would make the handle an
  // HTML element of the Astryx runtime's
  return reactJsx('native-toplayer', {
    ref: setHandle,
    active: open,
    style: HANDLE_STYLE,
    collapsable: false,
    onOutsidePress: (event: $FlowFixMe) => {
      if (!open || !lightDismiss) {
        return;
      }
      const {x, y} = event.nativeEvent;
      const rect = anchorRectOf(flatStyle(style));
      if (
        rect != null &&
        x >= rect.x &&
        x <= rect.x + rect.width &&
        y >= rect.y &&
        y <= rect.y + rect.height
      ) {
        return;
      }
      instanceRef.current?.hidePopover?.();
    },
    children: [
      reactJsx(React.Fragment, {children: backdropBox}, 'backdrop'),
      reactJsx(React.Fragment, {children: placed}, 'element'),
    ],
  });
}

type Area = {x: number, y: number, width: number, height: number};

function windowViewport(): Area {
  const window = Dimensions.get('window');
  return {x: 0, y: 0, width: window.width, height: window.height};
}

// The page's viewport in the window: as wide as the window and ending at its
// bottom edge, which is where a host's viewport ends (the screen's scroll view
// runs to the window's bottom edge, under the home indicator)
function pageViewport(
  viewport: ?{readonly width: number, readonly height: number},
): Area {
  const window = windowViewport();
  if (viewport == null || viewport.height > window.height) {
    return window;
  }
  return {
    x: 0,
    y: window.height - viewport.height,
    width: Math.min(viewport.width, window.width),
    height: viewport.height,
  };
}

// An empty box out of the flow: it adds nothing to its parent's size or to a
// scroll view's content, and the element in it sizes to its own content, as a
// fixed element does in the viewport
const HANDLE_STYLE = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  overflow: 'hidden',
};

function flatStyle(style: unknown): {[string]: unknown} {
  return (StyleSheet.flatten(style as $FlowFixMe) as $FlowFixMe) ?? {};
}

function anchorRectOf(flat: {readonly [string]: unknown}): ?{
  x: number,
  y: number,
  width: number,
  height: number,
} {
  const name = flat.positionAnchor;
  const anchor = typeof name === 'string' ? anchorElement(name) : null;
  const rect = anchor?.getBoundingClientRect?.();
  return rect == null
    ? null
    : {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
}

// The element's style in the top layer: at its placement, without the margins
// and insets its placement took in. The first placement is made in a layout
// effect, whose update the renderer commits before the element is first drawn.
function placedStyle(
  style: unknown,
  placement: ?{readonly left: number, readonly top: number, ...},
): {[string]: unknown} {
  const placed = {...flatStyle(style)};
  for (const key of [...MARGIN_KEYS, ...INSET_KEYS]) {
    delete placed[key];
  }
  placed.position = 'absolute';
  placed.left = placement?.left ?? 0;
  placed.top = placement?.top ?? 0;
  return placed;
}

const INSET_KEYS: ReadonlyArray<string> = [
  'inset',
  'insetBlock',
  'insetBlockStart',
  'insetBlockEnd',
  'insetInline',
  'insetInlineStart',
  'insetInlineEnd',
  'start',
  'end',
  'left',
  'right',
  'top',
  'bottom',
];
