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
 * DismissableLayer — outside-press and escape dismissal.
 *
 * The web listens on document; here the layer renders its own full-screen
 * backdrop UNDER the content inside the top layer, so any press outside the
 * content lands on it. Escape maps to the platform's dismiss gesture: the
 * Android hardware back. Both route through onDismiss after the
 * corresponding cancelable callback (onPointerDownOutside/onEscapeKeyDown),
 * honoring preventDefault exactly as Radix does.
 */

import * as React from 'react';
import {BackHandler, Platform} from 'react-native';

export function DismissableLayer(props: $FlowFixMe): React.Node {
  const {
    children,
    onDismiss,
    onPointerDownOutside,
    onEscapeKeyDown,
    disableOutsidePointerEvents: _unused,
    ...rest
  } = props;

  React.useEffect(() => {
    if (Platform.OS !== 'android' || onDismiss == null) {
      return;
    }
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        const event: $FlowFixMe = {defaultPrevented: false};
        event.preventDefault = () => {
          event.defaultPrevented = true;
        };
        onEscapeKeyDown?.(event);
        if (!event.defaultPrevented) {
          onDismiss();
        }
        return true;
      },
    );
    return () => subscription.remove();
  }, [onDismiss, onEscapeKeyDown]);

  const outsidePress = (e: $FlowFixMe) => {
    const event: $FlowFixMe = {
      defaultPrevented: false,
      detail: {originalEvent: e},
    };
    event.preventDefault = () => {
      event.defaultPrevented = true;
    };
    onPointerDownOutside?.(event);
    if (!event.defaultPrevented) {
      onDismiss?.();
    }
  };

  const contentProps: $FlowFixMe = {
    ...rest,
    // Same viewport-filling pass-through as FocusScope: absolutely
    // positioned children (dialog panels, popper content) position against
    // the top-layer entry through this box.
    style: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      pointerEvents: 'box-none',
      // Above sibling overlays (shadcn's carries z-50): the layer's content
      // and backdrop must win hit-testing over a decorative overlay that
      // renders before them.
      zIndex: 10000,
      ...rest.style,
    },
  };
  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9999,
        }}
        onPointerDown={outsidePress}
      />
      <div {...contentProps}>{children}</div>
    </>
  );
}
