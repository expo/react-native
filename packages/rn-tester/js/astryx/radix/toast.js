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
 * Toast (@radix-ui/react-toast) — timed, dismissable notifications.
 *
 * Provider carries the duration; Viewport is the stacking region (portaled
 * to the top layer, bottom-aligned like shadcn's); each Root runs its own
 * open state with an auto-dismiss timer, pausable per spec on hover.
 * Swipe-to-dismiss is not modeled; Close and the timer cover dismissal.
 */

import {dataState, useControllableState} from './internals';
import {Portal as LayerPortal} from './portal';
import {Presence} from './presence';
import {Slot} from './slot';
import * as React from 'react';

const DurationContext: React.Context<number> = React.createContext(5000);

export function Provider(props: $FlowFixMe): React.Node {
  const {children, duration = 5000} = props;
  return (
    <DurationContext.Provider value={duration}>
      {children}
    </DurationContext.Provider>
  );
}

export function Viewport(props: $FlowFixMe): React.Node {
  const {children, ...rest} = props;
  const viewportProps: $FlowFixMe = {
    role: 'region',
    ...rest,
    style: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      ...rest.style,
    },
  };
  return (
    <LayerPortal>
      <div {...viewportProps}>{children}</div>
    </LayerPortal>
  );
}

export function Root(props: $FlowFixMe): React.Node {
  const {
    children,
    open,
    defaultOpen = true,
    onOpenChange,
    duration,
    ...rest
  } = props;
  const contextDuration = React.useContext(DurationContext);
  const [isOpen, setOpen] = useControllableState({
    prop: open,
    defaultProp: defaultOpen,
    onChange: onOpenChange,
  });
  const timerRef = React.useRef<$FlowFixMe>(null);
  const totalMs = duration ?? contextDuration;

  const start = React.useCallback(() => {
    clearTimeout(timerRef.current);
    if (totalMs !== Infinity) {
      timerRef.current = setTimeout(() => setOpen(false), totalMs);
    }
  }, [totalMs, setOpen]);

  React.useEffect(() => {
    if (isOpen === true) {
      start();
    }
    return () => clearTimeout(timerRef.current);
  }, [isOpen, start]);

  const rootProps: $FlowFixMe = {
    role: 'status',
    ...rest,
    'data-state': dataState(isOpen === true),
    // Hover pauses the timer (css-toast semantics); leaving restarts it.
    onPointerEnter: (e: $FlowFixMe) => {
      rest.onPointerEnter?.(e);
      clearTimeout(timerRef.current);
    },
    onPointerLeave: (e: $FlowFixMe) => {
      rest.onPointerLeave?.(e);
      start();
    },
  };
  return (
    <ToastContext.Provider value={setOpen as $FlowFixMe}>
      <Presence present={isOpen === true}>
        <div {...rootProps}>{children}</div>
      </Presence>
    </ToastContext.Provider>
  );
}

const ToastContext: React.Context<$FlowFixMe> = React.createContext(() => {});

export function Title(props: $FlowFixMe): React.Node {
  const {children, ...rest} = props;
  return <div {...rest}>{children}</div>;
}

export function Description(props: $FlowFixMe): React.Node {
  const {children, ...rest} = props;
  return <div {...rest}>{children}</div>;
}

export function Action(props: $FlowFixMe): React.Node {
  const {children, altText: _altText, asChild, ...rest} = props;
  if (asChild === true) {
    return <Slot {...rest}>{children}</Slot>;
  }
  return <button {...rest}>{children}</button>;
}

export function Close(props: $FlowFixMe): React.Node {
  const {children, asChild, onClick, ...rest} = props;
  const setOpen = React.useContext(ToastContext);
  const closeProps: $FlowFixMe = {
    ...rest,
    onClick: (e: $FlowFixMe) => {
      onClick?.(e);
      setOpen(false);
    },
  };
  if (asChild === true) {
    return <Slot {...closeProps}>{children}</Slot>;
  }
  return <button {...closeProps}>{children}</button>;
}
