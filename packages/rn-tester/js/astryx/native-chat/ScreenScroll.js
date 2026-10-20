/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import * as React from 'react';

/**
 * The screen's own scroll view, as a page sees it. On the web a chat layout
 * is its own scroll container; here a page is laid out inside the screen's
 * `<native:scroll>`, which is the one scroll view a screen has
 * (DOM-CSS-LIMITATION(no-nested-vertical-scroll)), so a layout that needs to
 * hold the newest content or return to it asks the screen.
 */
export type ScreenScroll = {
  hostSafeAreaInsets?: ?{readonly left: number, readonly right: number},
  // Holds the END of the content in view as it grows (`contentAnchor`
  // 'bottom') until the returned function releases it
  holdEnd: () => () => void,
  // Scrolls to the newest content
  scrollToEnd: (animated?: boolean) => void,
  // Calls `listener` whenever the reader reaches the end or leaves it, and
  // once with where they are now; returns the unsubscribe
  subscribeAtEnd: (listener: (atEnd: boolean) => void) => () => void,
  // The composer belongs to the screen, outside the transcript it obstructs.
  presentAccessory: (id: string, content: React.Node) => void,
  dismissAccessory: (id: string) => void,
};

// How long the reader has to stay away from the end before it counts
const LEAVING_THE_END_MS = 250;

export const ScreenScrollContext: React.Context<?ScreenScroll> =
  React.createContext(null);

type AccessoryStore = {
  getSnapshot: () => ReadonlyMap<string, React.Node>,
  subscribe: (() => void) => () => void,
  set: (ReadonlyMap<string, React.Node>) => void,
};

function createAccessoryStore(): AccessoryStore {
  let snapshot: ReadonlyMap<string, React.Node> = new Map();
  const listeners: Set<() => void> = new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: next => {
      snapshot = next;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

function ScreenAccessories({store}: {store: AccessoryStore}): React.Node {
  const accessories = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
  );
  return Array.from(accessories, ([id, content]) => (
    <React.Fragment key={id}>{content}</React.Fragment>
  ));
}

/** Keeps a screen's accessory mounted while its content changes. */
export function useScreenAccessory(content: React.Node): React.Node {
  const screen = React.useContext(ScreenScrollContext);
  const id = React.useId();
  React.useLayoutEffect(() => {
    screen?.presentAccessory(id, content);
  }, [screen, id, content]);
  React.useLayoutEffect(() => () => screen?.dismissAccessory(id), [screen, id]);
  return screen == null ? content : null;
}

/**
 * Whether the reader is at the end of the screen's content, and a function
 * that takes them there; `atEnd` is true where no screen scroll is provided.
 */
export function useScreenScrollEnd(): {
  atEnd: boolean,
  scrollToEnd: (animated?: boolean) => void,
} {
  const screen = React.useContext(ScreenScrollContext);
  const [atEnd, setAtEnd] = React.useState(true);
  React.useEffect(() => {
    if (screen == null) {
      return;
    }
    const release = screen.holdEnd();
    // A conversation opens at its newest message, as the web's chat layout
    // does; from here the end is held as the content grows
    screen.scrollToEnd(false);
    // Leaving the end counts once it lasts: the web lays a page out at its
    // end before it paints, where the screen's scroll view reports the
    // content's growth and its own catching up as separate scrolls, so the
    // way back down would flash in for a frame as a page loads
    let leaving: ?TimeoutID = null;
    const unsubscribe = screen.subscribeAtEnd(next => {
      if (leaving != null) {
        clearTimeout(leaving);
        leaving = null;
      }
      if (next) {
        setAtEnd(true);
      } else {
        leaving = setTimeout(() => {
          leaving = null;
          setAtEnd(false);
        }, LEAVING_THE_END_MS);
      }
    });
    return () => {
      if (leaving != null) {
        clearTimeout(leaving);
      }
      unsubscribe();
      release();
    };
  }, [screen]);
  const scrollToEnd = React.useCallback(
    (animated?: boolean) => screen?.scrollToEnd(animated),
    [screen],
  );
  return {atEnd, scrollToEnd};
}

/**
 * The screen's side: what its `<native:scroll>` needs to provide the context,
 * from its ref and its scroll events. `contentAnchor` is 'bottom' while any
 * page holds the end.
 */
export function useScreenScrollProvider(
  scrollRef: {
    readonly current: ?{
      readonly scrollToLatest: (animated?: boolean) => void,
      ...
    },
  },
  hostInsets?: ?{readonly left: number, readonly right: number, ...},
): {
  value: ScreenScroll,
  accessories: React.Node,
  hasAccessory: boolean,
  contentAnchor: 'top' | 'bottom',
  onScroll: (event: ScrollPayloadEvent) => void,
} {
  const [holders, setHolders] = React.useState(0);
  const [store] = React.useState(createAccessoryStore);
  const [hasAccessory, setHasAccessory] = React.useState(false);
  const present = React.useRef(false);
  const presentAccessory = React.useCallback(
    (id: string, content: React.Node) => {
      const current = store.getSnapshot();
      if (current.get(id) === content) {
        return;
      }
      store.set(new Map(current).set(id, content));
      if (!present.current) {
        present.current = true;
        setHasAccessory(true);
      }
    },
    [store],
  );
  const dismissAccessory = React.useCallback(
    (id: string) => {
      const current = store.getSnapshot();
      if (!current.has(id)) {
        return;
      }
      const next = new Map(current);
      next.delete(id);
      store.set(next);
      if (next.size === 0 && present.current) {
        present.current = false;
        setHasAccessory(false);
      }
    },
    [store],
  );
  const listeners = React.useRef<Set<(atEnd: boolean) => void>>(new Set());
  const atEndRef = React.useRef(true);
  const left = hostInsets?.left;
  const right = hostInsets?.right;
  const value = React.useMemo<ScreenScroll>(
    () => ({
      hostSafeAreaInsets: left == null || right == null ? null : {left, right},
      holdEnd: () => {
        setHolders(count => count + 1);
        return () => setHolders(count => count - 1);
      },
      scrollToEnd: animated => scrollRef.current?.scrollToLatest(animated),
      subscribeAtEnd: listener => {
        listeners.current.add(listener);
        listener(atEndRef.current);
        return () => {
          listeners.current.delete(listener);
        };
      },
      presentAccessory,
      dismissAccessory,
    }),
    [scrollRef, presentAccessory, dismissAccessory, left, right],
  );
  const onScroll = React.useCallback((event: ScrollPayloadEvent) => {
    const {contentOffset, contentSize, containerSize, inset} =
      event.nativeEvent;
    // At the end when the last point of the content is within a point of the
    // bottom of the visible area: the offset of a view scrolled to its end is
    // `contentSize - height + inset.bottom` (NativeScroll.md)
    const end = contentSize.height - containerSize.height + inset.bottom;
    const atEnd = contentOffset.y >= end - 1;
    if (atEnd !== atEndRef.current) {
      atEndRef.current = atEnd;
      for (const listener of listeners.current) {
        listener(atEnd);
      }
    }
  }, []);
  return {
    value,
    accessories: <ScreenAccessories store={store} />,
    hasAccessory,
    contentAnchor: holders > 0 ? 'bottom' : 'top',
    onScroll,
  };
}

export type ScrollPayloadEvent = {
  readonly nativeEvent: {
    readonly contentOffset: {readonly x: number, readonly y: number},
    readonly contentSize: {readonly width: number, readonly height: number},
    readonly containerSize: {readonly width: number, readonly height: number},
    readonly inset: {
      readonly top: number,
      readonly left: number,
      readonly bottom: number,
      readonly right: number,
    },
    ...
  },
  ...
};
