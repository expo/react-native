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
 * `<native:scroll>` — the scroll view an app should reach for.
 *
 * ## Why it is not a configured `ScrollView`
 *
 * It began as one: the same view with four props set. That is worth having —
 * most scroll views in most apps put a focused field behind the keyboard purely
 * because nobody found the props — but it inherits the problem underneath.
 *
 * `ScrollView` on Android is an `android.widget.ScrollView`, which implements
 * none of the platform's nested-scrolling protocol. Not badly: not at all. That
 * protocol is how scrolling containers cooperate — it is what lets a list drive
 * a collapsing toolbar, hand a fling to a bottom sheet when it reaches its top,
 * or live inside anything built on `CoordinatorLayout`. A container that does
 * not speak it cannot take part in those interfaces, and no amount of prop
 * setting adds it.
 *
 * So this is its own element with its own view on each platform, built on the
 * container the platform itself provides — `NestedScrollView` on Android — which
 * is also what makes its gestures arbitrate with everything else's rather than
 * competing with them.
 *
 * ## The content container
 *
 * One child, always, because that is the shape a scrolling container has: a
 * viewport and a thing inside it that is bigger. `contentContainerStyle` styles
 * that inner thing — padding, alignment, `flexGrow` to fill a short screen —
 * and `style` styles the viewport.
 *
 * ## Insets
 *
 * Room is made automatically for the keyboard and for whatever safe area this
 * view actually runs past, on every edge it runs past. `contentInset` is ADDED
 * to that rather than replacing it: asking for eight points of breathing room at
 * the bottom means eight more than the keyboard needs.
 *
 * The composition happens natively, in the frame the keyboard moves, and never
 * passes through layout — so the content tracks the keyboard exactly rather than
 * chasing it with a second animation.
 */
export default function NativeScroll({
  children,
  contentContainerStyle,
  ref,
  ...props
}: $FlowFixMe): React.Node {
  const hostRef = React.useRef<$FlowFixMe>(null);

  /*
   * `scrollToLatest()` and `scrollToTop()` on the ref, on top of the host instance.
   *
   * Imperative because they are events rather than states: "go there now", not "be there". A prop
   * would need a token to change so the same request could be made twice, which is the shape of
   * every `scrollToIndex` API that nobody enjoys using.
   *
   * `scrollToLatest` is what an app calls when the user SENDS a message. `contentAnchor` covers
   * the passive case — a message arriving while the reader is at the end — and deliberately does
   * not cover this one, because a reader who has scrolled up should not be moved by someone
   * else's message but should be moved by their own.
   *
   * The Proxy keeps the host instance underneath, for the same reason as controlHandle.js: a ref
   * to an element has always been the thing you can measure, and replacing it with a bare object
   * takes that away silently.
   */
  React.useImperativeHandle(
    ref,
    () => {
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
    },
    [],
  );

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
      <View collapsable={false} style={contentContainerStyle}>
        {children}
      </View>
    </native-scroll>
  );
}
