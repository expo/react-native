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

import {computedStyleForInstance} from '../native-css/engine';
import {anchorElement} from './anchorNames';
import {registerTopLayerHandle} from './topLayerHandles';
import {placeInTopLayer} from './topLayerPlacement';
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
/**
 * The page's viewport, for a host whose elements do not hand one to each
 * element: a screen below a navigation bar declares its size here, and an
 * element placed by its insets (a fixed drawer, a modal dialog) is placed in
 * it rather than in the window, as a browser places one below its own chrome.
 */
export const PageViewportContext: React.Context<?{
  readonly width: number,
  readonly height: number,
}> = React.createContext(null);

export default function TopLayerElement({
  open,
  lightDismiss,
  backdrop = null,
  backdropStyleId = null,
  onBackdropPress = null,
  centered = false,
  instanceRef,
  children: element,
}: {
  open: boolean,
  lightDismiss: boolean,
  // A modal dialog's `::backdrop`: the style of a box under it that covers the
  // window and takes every press outside it
  backdrop?: ?{readonly [string]: unknown},
  // The `::backdrop` as a style the renderer's style engine resolves, where
  // it styles the page; drawn over `backdrop`
  backdropStyleId?: ?number,
  onBackdropPress?: ?() => void,
  // Whether the element is placed as a modal dialog is, by the user agent's
  // `inset: 0` and its `margin: auto`: centred in the viewport
  centered?: boolean,
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
  // The style the element resolved before it was placed, read once it is laid
  // out. Once placed, its inline entries (`top`, `left`, `margin: 0`) win
  // every rule, so its computed style no longer says where the author put it:
  // a placement read from it would take the previous placement as the
  // element's inset and move it again on every layout, without end
  const authoredRef = React.useRef<?{[string]: unknown}>(null);
  const pageArea = React.useContext(PageViewportContext);

  React.useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      authoredRef.current = null;
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
    // Before the first placement the element carries no placement entries,
    // so this is the author's style; every placement after reads that
    authoredRef.current ??= computedStyleForInstance(instanceRef.current) ?? {};
    const flat = authoredRef.current;
    const anchorRect = anchorRectOf(flat);
    // An element placed by its anchor is placed in the window, which the
    // anchor's rect is in; one placed by its insets, as a fixed element is, in
    // the page's viewport, which its viewport units measure
    const area = anchorRect == null ? pageViewport(pageArea) : windowViewport();
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
  }, [open, layouts, pageArea?.width, pageArea?.height]);

  let placed: React.Node = element;
  if (
    open &&
    authored != null &&
    typeof (element as $FlowFixMe).type === 'string'
  ) {
    const authoredLayout = authored.onLayout;
    // The element is placed once a placement exists: its first render, which
    // the renderer does not draw, keeps the author's insets for the placement
    // effect to read. It is out of the flow from that render on, as an
    // element in the top layer is (its position computes to absolute unless
    // it is fixed, css-position-4 §3.1), so the size the effect measures is
    // the size it is placed at. Laid out in the handle's flow instead, a menu
    // measured the handle's width and no height, was placed for that width
    // against the viewport's far edge, and moved under its anchor a frame
    // later, once its own layout came in.
    const placedProps: {[string]: unknown} = {
      cssInline: [
        ...(authored.cssInline ?? []),
        ...(placement == null ? OUT_OF_FLOW_ENTRIES : placedEntries(placement)),
      ],
    };
    placed = React.cloneElement(element as $FlowFixMe, {
      ...placedProps,
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
  if (open && (backdrop != null || backdropStyleId != null)) {
    // Over the page's viewport, which the dialog is placed in, as a browser's
    // `::backdrop` covers its viewport and not its own chrome
    const area = pageViewport(pageArea);
    backdropBox = reactJsx(Pressable, {
      accessible: false,
      onPress: () => onBackdropPress?.(),
      style: [
        backdropStyleId == null ? backdrop : null,
        {
          position: 'absolute',
          left: area.x - (placement?.originX ?? 0),
          top: area.y - (placement?.originY ?? 0),
          width: area.width,
          height: area.height,
        },
      ],
      children:
        backdropStyleId != null
          ? reactJsx('div', {
              cssEngine: true,
              cssStyle: backdropStyleId,
              style: StyleSheet.absoluteFill,
            })
          : null,
    });
  }

  // While the element is in the top layer, the handle offers the window's
  // width as the space the element is laid out in: an absolutely positioned
  // element with no width shrinks to fit the space its parent offers, and a
  // 0-wide handle wrapped a menu's every word onto its own line. It stays 0
  // tall, so no point is inside it and it takes no touch from the page; its
  // size reaches no parent, being out of the flow, and the platform draws
  // what is in it in the top layer. While the element is not in the top layer
  // the handle generates no box, and the element is in the flow where it is
  // written, as a popover that is not shown is when its author displays it,
  // and a dialog shown with `show()`.
  const handleStyle = open
    ? {...HANDLE_STYLE, width: Dimensions.get('window').width}
    : NO_BOX_STYLE;
  // Through React's own runtime: this module's JSX would make the handle an
  // HTML element of the Astryx runtime's
  return reactJsx('native-toplayer', {
    ref: setHandle,
    active: open,
    style: handleStyle,
    collapsable: false,
    onOutsidePress: (event: $FlowFixMe) => {
      if (!open || !lightDismiss) {
        return;
      }
      const {x, y} = event.nativeEvent;
      const rect = anchorRectOf(
        computedStyleForInstance(instanceRef.current) ?? {},
      );
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

// The handle of an element that is not in the top layer, which leaves the
// element in its parent's flow
const NO_BOX_STYLE = {display: 'contents'};

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

// The element's position before it is placed: the top layer's, over the
// author's insets and margins, which the placement reads
const OUT_OF_FLOW_ENTRIES: Array<[string, unknown]> = [
  ['position', 'absolute'],
];

// The element's placement as inline declarations, which it takes over every
// rule. The first placement is made in a layout effect, whose update the
// renderer commits before the element is first drawn.
function placedEntries(
  placement: ?{readonly left: number, readonly top: number, ...},
): Array<[string, unknown]> {
  return [
    ['position', 'absolute'],
    ['margin', '0px'],
    ['right', 'auto'],
    ['bottom', 'auto'],
    ['left', `${placement?.left ?? 0}px`],
    ['top', `${placement?.top ?? 0}px`],
  ];
}
