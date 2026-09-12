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
import {UIManager, findNodeHandle} from 'react-native';

/**
 * `focus()` and `blur()` ON TOP OF the host instance, not instead of it.
 *
 * A ref to an element has always been the host instance — the thing a caller
 * measures, or hands to `getBoundingClientRect`. Returning a bare
 * `{focus, blur}` from `useImperativeHandle` silently takes all of that away,
 * and the failure does not look like a ref problem: it cost a Fantom test that
 * measures an `<input>` inside a `<label>`, where it read as a layout bug.
 *
 * The host instance HAS `focus` and `blur` already, and both are inert for these
 * elements. `ReactNativeElement.focus` works either for a view registered with
 * `TextInputState`, which these are not, or behind `enableImperativeFocus`,
 * which is off by default. So they are supplied here as view-manager commands,
 * which is what the elements' native side listens for.
 *
 * A Proxy rather than a copy, because a host instance is a class with private
 * fields: anything that reads one has to run with the instance as `this`. So
 * `Reflect.get` is given the target as its receiver and methods are bound to it.
 * Spreading, or `Object.create(node)`, would produce an object whose methods
 * throw the moment they touch a private field.
 *
 * Commands go through `UIManager` and a node handle rather than the renderer's
 * `dispatchCommand`, which is only reachable by a deep import — and deep imports
 * warn, which the test preset turns into a failure in suites that have nothing
 * to do with focus.
 */
export function useControlHandle(
  ref: $FlowFixMe,
  hostRef: {current: $FlowFixMe},
): void {
  const command = React.useCallback(
    (commandName: string) => {
      const node = hostRef.current;
      if (node == null) {
        return;
      }
      const tag = findNodeHandle(node);
      if (tag != null) {
        // The declaration says `commandID: number`, with a comment beside it
        // saying "number || string". Fabric commands are named, so the string is
        // the correct call and the type is the one that is behind.
        // $FlowFixMe[incompatible-type] the spec types commandID as a number
        UIManager.dispatchViewManagerCommand(tag, commandName, []);
      }
    },
    [hostRef],
  );

  React.useImperativeHandle(
    ref,
    () => {
      const focus = () => {
        command('focus');
      };
      const blur = () => {
        command('blur');
      };
      const node = hostRef.current;
      if (node == null) {
        // Before the view exists there is nothing to extend. The caller still
        // gets the two methods, which is the state a ref is in for one commit.
        return {focus, blur};
      }
      return new Proxy(node, {
        get(target: $FlowFixMe, property: string) {
          if (property === 'focus') {
            return focus;
          }
          if (property === 'blur') {
            return blur;
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
    [command, hostRef],
  );
}
