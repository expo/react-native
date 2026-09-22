/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {SafeAreaInsetsChangeEvent} from 'react-native/Libraries/Types/CoreEventTypes';

import env from './env';
import NativeScroll from './NativeScroll';
import * as React from 'react';
import {View} from 'react-native';

type Insets = Readonly<{
  top: number,
  right: number,
  bottom: number,
  left: number,
}>;

export type PageViewport = Readonly<{
  x: number,
  y: number,
  width: number,
  height: number,
  // The unsafe area's overlap with the declared document viewport.
  safeAreaInsets: Insets,
  // The host's insets before the page reserves any edges. A sibling keyboard
  // accessory is hosted there, outside the document's safe column.
  hostSafeAreaInsets: Insets,
}>;

function sameInsets(a: Insets, b: Insets): boolean {
  return (
    a.left === b.left &&
    a.right === b.right &&
    a.top === b.top &&
    a.bottom === b.bottom
  );
}

function sameViewport(a: ?PageViewport, b: PageViewport): boolean {
  return (
    a != null &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    sameInsets(a.safeAreaInsets, b.safeAreaInsets) &&
    sameInsets(a.hostSafeAreaInsets, b.hostSafeAreaInsets)
  );
}

export function usePageViewport(): [
  ?PageViewport,
  (viewport: PageViewport) => void,
] {
  const [viewport, setViewport] = React.useState<?PageViewport>(null);
  const update = React.useCallback((next: PageViewport) => {
    setViewport(previous => (sameViewport(previous, next) ? previous : next));
  }, []);
  return [viewport, update];
}

/**
 * A vertically scrolling page. Native scrolling reserves the top/bottom;
 * side reservations narrow the content's layout, rather than extending its
 * horizontal scroll range. Authored content padding is inside that column.
 *
 * The document rectangle and its env() values describe the same viewport:
 * an edge already excluded from the rectangle has no remaining unsafe area.
 */
export default function NativePageScroll({
  children,
  contentContainerStyle,
  automaticInsets = true,
  onContentViewportChange,
  style,
  ref,
  ...props
}: $FlowFixMe): React.Node {
  const viewportRef = React.useRef<React.ElementRef<typeof View> | null>(null);
  const insetsRef = React.useRef<?Insets>(null);
  const publishedRef = React.useRef<?PageViewport>(null);
  const callbackRef = React.useRef(onContentViewportChange);
  callbackRef.current = onContentViewportChange;
  // Only the sides affect this component's React layout. A collapsing title
  // or keyboard must not re-render it just because a vertical inset changed.
  const [sides, setSides] =
    React.useState<?{left: number, right: number}>(null);
  const enabled = (edge: 'top' | 'right' | 'bottom' | 'left') =>
    typeof automaticInsets === 'boolean'
      ? automaticInsets
      : automaticInsets?.[edge] !== false;
  const topEnabled = enabled('top');
  const bottomEnabled = enabled('bottom');
  const leftEnabled = enabled('left');
  const rightEnabled = enabled('right');
  const publish = React.useCallback(() => {
    const node = viewportRef.current;
    const insets = insetsRef.current;
    if (callbackRef.current == null || node == null || insets == null) {
      return;
    }
    const frame = node.getBoundingClientRect();
    if (frame.width === 0 || frame.height === 0) {
      return;
    }
    const reserved = {
      left: leftEnabled ? insets.left : 0,
      right: rightEnabled ? insets.right : 0,
      top: topEnabled ? insets.top : 0,
      bottom: bottomEnabled ? insets.bottom : 0,
    };
    const next: PageViewport = {
      x: frame.x + reserved.left,
      y: frame.y + reserved.top,
      width: Math.max(0, frame.width - reserved.left - reserved.right),
      height: Math.max(0, frame.height - reserved.top - reserved.bottom),
      safeAreaInsets: {
        left: insets.left - reserved.left,
        right: insets.right - reserved.right,
        top: insets.top - reserved.top,
        bottom: insets.bottom - reserved.bottom,
      },
      hostSafeAreaInsets: insets,
    };
    if (!sameViewport(publishedRef.current, next)) {
      publishedRef.current = next;
      callbackRef.current(next);
    }
  }, [topEnabled, bottomEnabled, leftEnabled, rightEnabled]);
  const onSafeAreaInsetsChange = React.useCallback(
    (event: SafeAreaInsetsChangeEvent) => {
      const next = event.nativeEvent.insets;
      insetsRef.current = next;
      setSides(previous =>
        previous?.left === next.left && previous?.right === next.right
          ? previous
          : {left: next.left, right: next.right},
      );
      publish();
    },
    [publish],
  );
  React.useLayoutEffect(publish, [publish, onContentViewportChange]);
  const nativeInsets = React.useMemo(
    () => ({
      top: topEnabled,
      bottom: bottomEnabled,
      left: false,
      right: false,
    }),
    [topEnabled, bottomEnabled],
  );
  const left = leftEnabled ? sides?.left : 0;
  const right = rightEnabled ? sides?.right : 0;
  const padding = React.useMemo(
    () => ({
      paddingLeft: left ?? env('safe-area-inset-left'),
      paddingRight: right ?? env('safe-area-inset-right'),
    }),
    [left, right],
  );
  return (
    <View
      ref={viewportRef}
      style={FILL}
      onLayout={publish}
      experimental_onSafeAreaInsetsChange={onSafeAreaInsetsChange}>
      <NativeScroll
        {...props}
        ref={ref}
        style={[FILL, style]}
        automaticInsets={nativeInsets}
        contentContainerStyle={padding}>
        <View style={[COLUMN, contentContainerStyle]}>{children}</View>
      </NativeScroll>
    </View>
  );
}

const FILL = {flex: 1, minWidth: 0, minHeight: 0};
const COLUMN = {minWidth: 0};
