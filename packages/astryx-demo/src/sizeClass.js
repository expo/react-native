/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

import * as React from 'react';
import {PlatformColor, useWindowDimensions} from 'react-native';

export type HorizontalSizeClass = 'compact' | 'regular';

const WindowLayoutContext = React.createContext(null);

/**
 * The split controller's latest report, kept outside React state so that a
 * report re-renders only the components whose part of it changed: a fold that
 * moves the hinge updates the gallery's tracks and leaves the navigation, the
 * screens and their headers as they are.
 */
function createModeStore() {
  let mode = null;
  const listeners = new Set();
  return {
    get: (): $FlowFixMe => mode,
    set(next: $FlowFixMe) {
      if (next === mode) {
        return;
      }
      mode = next;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const NO_MODE = createModeStore();

/** The native split controller owns collapse, expansion and fold transitions. */
export function WindowLayoutProvider({
  children,
}: {
  children: React.Node,
}): React.Node {
  const [store] = React.useState(createModeStore);
  const policyRef = React.useRef(null);
  const toggleSidebar = React.useCallback(
    () => policyRef.current?.toggleSidebar(),
    [],
  );
  const onModeChange = React.useCallback(
    event => store.set(event.nativeEvent),
    [store],
  );
  const onDisplayModeWillChange = React.useCallback(
    event => {
      const current = store.get();
      if (current != null) {
        store.set({
          ...current,
          sidebarShown: event.nativeEvent.nextDisplayMode !== 'secondaryOnly',
        });
      }
    },
    [store],
  );
  const value = React.useMemo(
    () => ({
      store,
      onModeChange,
      onDisplayModeWillChange,
      policyRef,
      toggleSidebar,
    }),
    [store, onModeChange, onDisplayModeWillChange, toggleSidebar],
  );
  return <WindowLayoutContext value={value}>{children}</WindowLayoutContext>;
}

/** One part of the latest report, re-rendering when that part changes. */
function useMode<T>(select: (mode: $FlowFixMe) => T): T {
  const store = React.useContext(WindowLayoutContext)?.store ?? NO_MODE;
  return React.useSyncExternalStore(store.subscribe, () => select(store.get()));
}

/** The callbacks the native split policy reports through; they never change. */
export function useWindowLayoutActions(): $FlowFixMe {
  return React.useContext(WindowLayoutContext);
}

export function useHorizontalSizeClass(): HorizontalSizeClass {
  const {width} = useWindowDimensions();
  // Keep width traits independent of the sidebar visibility.
  const reported = useMode(mode => mode?.horizontalSizeClass ?? null);
  return reported ?? fallbackSizeClass(width);
}

export function useSidebarState(): {
  canToggleSidebar: boolean,
  sidebarShown: boolean,
} {
  const canToggleSidebar = useMode(mode => mode?.canToggleSidebar ?? false);
  const sidebarShown = useMode(mode => mode?.sidebarShown ?? false);
  return React.useMemo(
    () => ({canToggleSidebar, sidebarShown}),
    [canToggleSidebar, sidebarShown],
  );
}

/** The hinge region the gallery lays its tracks around, while it has one. */
export function useGalleryDivision(): ?{x: number, width: number} {
  const x = useMode(mode => (mode?.galleryFold ? mode.divisionStart : null));
  const width = useMode(mode =>
    mode?.galleryFold ? mode.divisionWidth : null,
  );
  return React.useMemo(
    () => (x == null || width == null ? null : {x, width}),
    [x, width],
  );
}

/** Everything at once, for a component that wants every report. */
export function useWindowLayout(): $FlowFixMe {
  const actions = useWindowLayoutActions();
  const sizeClass = useHorizontalSizeClass();
  const {canToggleSidebar, sidebarShown} = useSidebarState();
  const galleryDivision = useGalleryDivision();
  return React.useMemo(
    () => ({
      ...actions,
      sizeClass,
      canToggleSidebar,
      sidebarShown,
      galleryDivision,
    }),
    [actions, sizeClass, canToggleSidebar, sidebarShown, galleryDivision],
  );
}

function fallbackSizeClass(width: number): HorizontalSizeClass {
  return width >= 600 ? 'regular' : 'compact';
}

/** Toggle the native sidebar without replacing the screen's back button. */
export function useSidebarItems(): $FlowFixMe {
  const {canToggleSidebar, sidebarShown} = useSidebarState();
  const toggleSidebar = useWindowLayoutActions()?.toggleSidebar;
  return React.useMemo(
    () =>
      canToggleSidebar
        ? [
            {
              type: 'button',
              label: sidebarShown ? 'Hide sidebar' : 'Show sidebar',
              icon: {
                type: 'sfSymbol',
                name: sidebarShown
                  ? 'rectangle.lefthalf.inset.filled'
                  : 'sidebar.left',
              },
              tintColor: sidebarShown ? PlatformColor('systemBlue') : undefined,
              variant: 'plain',
              onPress: toggleSidebar,
            },
          ]
        : [],
    [canToggleSidebar, sidebarShown, toggleSidebar],
  );
}
