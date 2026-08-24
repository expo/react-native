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
 * The **top layer** — the second half of Astryx's overlay story, alongside
 * anchor positioning.
 *
 * On the web, `<dialog>.showModal()` and `popover` promote an element out of
 * the normal painting order into the browser's top layer, so it escapes every
 * ancestor's `overflow`, `z-index` and stacking context. React Native has no
 * such concept, and no `createPortal` for host components — so the layer is
 * modelled the way RN can express it: a host mounted once near the root, and
 * a registry that lets any descendant render into it.
 *
 * Semantics kept from the platform:
 *  - **Escapes ancestors.** Content renders at the root, so a popover inside a
 *    clipped, scrolled card is not clipped by it.
 *  - **Stacking order is insertion order**, as the top layer is a stack; the
 *    most recently opened overlay paints last.
 *  - **Light dismiss** for `popover="auto"`: a press on the backdrop closes
 *    the top-most auto overlay. `manual` overlays and modal dialogs ignore it.
 *  - **A modal renders a backdrop** (`::backdrop`); non-modal popovers do not.
 *
 *  - **A modal traps focus**: the app content behind it leaves the
 *    accessibility tree, so a screen reader cannot swipe out of the dialog
 *    into the page behind it. See `focusTrap.js`.
 *
 * Not modelled: `@starting-style` entry animations.
 */

import {INERT_PROPS, NOT_INERT_PROPS, modalContainerProps} from './focusTrap';
import * as React from 'react';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

export type OverlayMode = 'modal' | 'auto' | 'manual';

type OverlayEntry = {
  readonly id: number,
  readonly mode: OverlayMode,
  readonly content: React.Node,
};

type TopLayerApi = {
  readonly present: (
    id: number,
    mode: OverlayMode,
    content: React.Node,
  ) => void,
  readonly dismiss: (id: number) => void,
};

const TopLayerContext: React.Context<?TopLayerApi> = React.createContext(null);

let nextOverlayId = 1;
export function allocateOverlayId(): number {
  return nextOverlayId++;
}

/**
 * Mount once, wrapping the app (or the screen under test). Children render
 * normally; overlays render above them in insertion order.
 */
export function TopLayerHost({children}: {children: React.Node}): React.Node {
  const [entries, setEntries] = useState<ReadonlyArray<OverlayEntry>>([]);
  // Where this host's (0,0) actually sits in the WINDOW. Overlays position in
  // window coordinates (measureInWindow / getBoundingClientRect), but the
  // app-root view is not the window origin everywhere: on Android the
  // activity's content starts below the status bar, so every overlay rendered
  // in host coordinates landed exactly that far low. The host itself never
  // scrolls, so one measurement per layout is stable — unlike the earlier
  // per-open measurement of a NESTED host, which drifted with scroll.
  const rootRef = useRef<$FlowFixMe>(null);
  const [windowOffset, setWindowOffset] = useState({x: 0, y: 0});
  const measureRoot = useCallback(() => {
    const node = rootRef.current;
    if (node != null && typeof node.measureInWindow === 'function') {
      node.measureInWindow((x: number, y: number) => {
        setWindowOffset(previous =>
          previous.x === x && previous.y === y ? previous : {x, y},
        );
      });
    }
  }, []);
  const present = useCallback(
    (id: number, mode: OverlayMode, content: React.Node) => {
      setEntries(current => {
        const without = current.filter(entry => entry.id !== id);
        // Re-presenting raises the overlay to the top, as the platform does.
        return [...without, {id, mode, content}];
      });
    },
    [],
  );

  const dismiss = useCallback((id: number) => {
    setEntries(current => current.filter(entry => entry.id !== id));
  }, []);

  const api = useMemo(() => ({present, dismiss}), [present, dismiss]);

  // Light dismiss targets the top-most `auto` overlay only.
  const topMostAuto = [...entries].reverse().find(e => e.mode === 'auto');
  const hasModal = entries.some(entry => entry.mode === 'modal');

  return (
    <TopLayerContext.Provider value={api}>
      <View ref={rootRef} onLayout={measureRoot} style={styles.root}>
        {/* While a modal is open the page behind it is inert to assistive
            technology — the containment half of a focus trap, and the escape
            route that actually matters on a touch platform. Non-modal
            popovers leave it alone, exactly as `popover="auto"` does. */}
        <View
          style={styles.root}
          {...(hasModal ? INERT_PROPS : NOT_INERT_PROPS)}>
          {children}
        </View>
        {/* Mounted at the app root, the layer below IS the viewport, so an
            overlay positions in viewport coordinates directly — the same frame
            `getBoundingClientRect()` reports an anchor in. An earlier version
            measured the host and shifted the layer to compensate, which was
            needed only while the host was nested; left in place it made an
            overlay's position drift with whatever scroll offset the
            measurement happened to catch. */}
        {entries.length > 0 ? (
          // Its (0,0) IS the window origin — overlays then position in
          // window coordinates directly. The negative edges (not a
          // transform, which would shift the far edges too and leave the
          // backdrop short of the window bottom) grow the box so it covers
          // the whole window; views don't clip, so hanging past the host is
          // fine.
          <View
            style={[
              StyleSheet.absoluteFill,
              windowOffset.x !== 0 || windowOffset.y !== 0
                ? {left: -windowOffset.x, top: -windowOffset.y}
                : null,
            ]}
            pointerEvents="box-none">
            {/* The backdrop: painted for modals (the ::backdrop analogue) and
                used as the light-dismiss surface for auto popovers. */}
            {hasModal || topMostAuto != null ? (
              <Pressable
                style={[
                  StyleSheet.absoluteFill,
                  hasModal ? styles.modalBackdrop : null,
                ]}
                onPress={
                  topMostAuto != null
                    ? () => dismiss(topMostAuto.id)
                    : undefined
                }
                // A modal's backdrop swallows presses; an auto popover's
                // backdrop only dismisses.
                pointerEvents={
                  hasModal || topMostAuto != null ? 'auto' : 'none'
                }
              />
            ) : null}
            {entries.map(entry => (
              <View
                key={entry.id}
                style={StyleSheet.absoluteFill}
                pointerEvents="box-none"
                {...modalContainerProps(entry.mode === 'modal')}>
                {entry.content}
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </TopLayerContext.Provider>
  );
}

/**
 * Presents `content` in the top layer while `open` is true. Returns whether a
 * host was found, so callers can fall back to rendering inline.
 */
export function useTopLayer(
  open: boolean,
  mode: OverlayMode,
  content: React.Node,
): boolean {
  const api = useContext(TopLayerContext);
  const id = useMemo(() => allocateOverlayId(), []);

  useEffect(() => {
    if (api == null) {
      return;
    }
    if (open) {
      api.present(id, mode, content);
    } else {
      api.dismiss(id);
    }
    return () => api.dismiss(id);
  }, [api, id, open, mode, content]);

  return api != null;
}

const styles = StyleSheet.create({
  // Fills its parent, because this is mounted at the app root: the top layer
  // is document-level on the web, so the box it positions overlays against has
  // to be the screen. (Nested inside a scrolling page it measured zero height
  // instead, and everything in it rendered outside its bounds — visible, since
  // RN does not clip by default, but untouchable, since hit-testing respects
  // bounds. Mounting at the root is what removes that hazard, not a style.)
  root: {flex: 1},
  // The web's default ::backdrop for a modal dialog.
  modalBackdrop: {backgroundColor: 'rgba(0, 0, 0, 0.35)'},
});

export {TopLayerContext};
