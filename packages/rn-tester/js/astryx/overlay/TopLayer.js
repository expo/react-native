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
 * Not modelled: focus trapping and `@starting-style` entry animations. Both
 * are listed as follow-ups rather than faked — see the Astryx notes.
 */

import * as React from 'react';
import {useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
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
  const rootRef = useRef<React.ElementRef<typeof View> | null>(null);
  // Where this host sits in the viewport, so the overlay layer below can undo
  // it. The web's top layer is a sibling of the document, so overlays position
  // against the viewport; here the host is an ordinary view somewhere down a
  // scrolled page, and without this correction anything positioned from a
  // viewport rect — an anchor's `getBoundingClientRect()`, say — lands that
  // far off. That is what put the demo's popover below the fold.
  const [hostOrigin, setHostOrigin] = useState<{x: number, y: number}>({
    x: 0,
    y: 0,
  });
  const measureHostRef = useRef<?() => void>(null);

  const present = useCallback(
    (id: number, mode: OverlayMode, content: React.Node) => {
      // Measure now, not at layout: the page scrolls between mount and the
      // moment an overlay opens, so a layout-time origin is stale by exactly
      // the scroll distance — which put the popover far below the fold.
      measureHostRef.current?.();
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

  // Re-read on every presentation: the page may have scrolled since the last.
  const measureHost = useCallback(() => {
    const node = rootRef.current;
    if (node == null) {
      return;
    }
    const rect = (node as $FlowFixMe).getBoundingClientRect();
    setHostOrigin(current =>
      current.x === rect.x && current.y === rect.y
        ? current
        : {x: rect.x, y: rect.y},
    );
  }, []);

  measureHostRef.current = measureHost;

  return (
    <TopLayerContext.Provider value={api}>
      <View ref={rootRef} style={styles.root} onLayout={measureHost}>
        {children}
        {entries.length > 0 ? (
          <View
            style={[
              StyleSheet.absoluteFill,
              // Shift the layer back to the viewport origin so overlays can be
              // positioned in viewport coordinates, as on the web.
              {left: -hostOrigin.x, top: -hostOrigin.y},
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
                pointerEvents="box-none">
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
