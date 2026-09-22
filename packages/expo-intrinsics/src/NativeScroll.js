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
import {UIManager, View, findNodeHandle} from 'react-native';

/**
 * `<native:scroll>`: a scroll view with its own native view on each platform.
 * Not a configured `ScrollView`, whose Android view is an
 * `android.widget.ScrollView` that speaks none of the nested-scrolling protocol
 * a collapsing toolbar or a bottom sheet needs; this one is a `NestedScrollView`.
 *
 * One child, always: a viewport and the content inside it. `contentContainerStyle`
 * styles the content and `style` the viewport.
 *
 * Room is made automatically for the keyboard and for the safe area on every
 * edge the view runs past, natively in the frame the keyboard moves rather than
 * through layout. `contentInset` is added to that rather than replacing it.
 */
export default function NativeScroll({
  children,
  contentContainerStyle,
  contentRef,
  ref,
  ...props
}: $FlowFixMe): React.Node {
  const hostRef = React.useRef<$FlowFixMe>(null);

  /*
   * `scrollToLatest()` and `scrollToTop()` on the ref, on top of the host
   * instance. Imperative because they are events, not states: `scrollToLatest`
   * is what an app calls when the user sends a message, where `contentAnchor`
   * covers only a message arriving under a reader already at the end. The Proxy
   * keeps the host instance underneath, so the ref can still be measured.
   */
  React.useImperativeHandle(ref, () => {
    const command = (name: string, animated: boolean) => {
      const node = hostRef.current;
      if (node == null) {
        return;
      }
      const tag = findNodeHandle(node);
      if (tag != null) {
        // $FlowFixMe[incompatible-type] the spec types commandID as a number
        UIManager.dispatchViewManagerCommand(tag, name, [animated]);
      }
    };
    const scrollToLatest = (animated: boolean = true) => {
      command('scrollToLatest', animated);
    };
    const scrollToTop = (animated: boolean = true) => {
      command('scrollToTop', animated);
    };
    const node = hostRef.current;
    if (node == null) {
      return {scrollToLatest, scrollToTop};
    }
    return new Proxy(node, {
      get(target: $FlowFixMe, property: string) {
        if (property === 'scrollToLatest') {
          return scrollToLatest;
        }
        if (property === 'scrollToTop') {
          return scrollToTop;
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }, []);

  return (
    // $FlowFixMe[not-a-function] a registered host element is a string tag
    <native-scroll {...props} ref={hostRef}>
      {/*
        `collapsable={false}` is load-bearing, not defensive. A container with
        no style of its own has nothing to draw, so the renderer flattens it
        away and mounts the children straight into the scroll view — which then
        has many children instead of the one a scrolling container is built
        around, and scrolls only the first.
      */}
      <View
        collapsable={false}
        style={contentContainerStyle}
        /*
         * The content container, offered to the caller.
         *
         * It is the one ancestor every row has in common that is NOT moved by
         * scrolling, so a `measureLayout` against it answers in CONTENT
         * coordinates — which is the only space in here that means the same
         * thing from one frame to the next. Against the scroll view or the
         * window, the same row answers differently depending on where the
         * reader is and on what this view has composed for itself; see
         * `contentShift`.
         */
        ref={contentRef}>
        {children}
      </View>
    </native-scroll>
  );
}
