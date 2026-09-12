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
 * `focus()` and `blur()` on top of the host instance, which a ref to an element
 * is and which callers measure. The instance's own `focus` and `blur` are inert
 * for these elements (`ReactNativeElement.focus` needs `TextInputState` or
 * `enableImperativeFocus`), so they are supplied as view-manager commands, the
 * calls the elements' native side listens for.
 *
 * A Proxy rather than a copy: a host instance is a class with private fields, so
 * `Reflect.get` takes the target as its receiver and methods are bound to it.
 * Commands go through `UIManager` and a node handle because the renderer's
 * `dispatchCommand` is reachable only by a deep import, which warns.
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
        // Fabric commands are named; the declaration's `number` is behind
        // $FlowFixMe[incompatible-type] the spec types commandID as a number
        UIManager.dispatchViewManagerCommand(tag, commandName, []);
      }
    },
    [hostRef],
  );

  React.useImperativeHandle(ref, () => {
    const focus = () => {
      command('focus');
    };
    const blur = () => {
      command('blur');
    };
    const node = hostRef.current;
    if (node == null) {
      // Before the view exists there is nothing to extend
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
  }, [command, hostRef]);
}
