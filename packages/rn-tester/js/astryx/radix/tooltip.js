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
 * Tooltip (@radix-ui/react-tooltip) and HoverCard — hover/focus-driven
 * anchored content on the Popover composition. Hover exists here (the fork
 * has W3C pointer events; mice and trackpads are real on iPad/desktop);
 * on pure touch the trigger's press still shows the tooltip, matching
 * mobile-web behavior closely enough to be useful rather than absent.
 */

import {dataState, useControllableState} from './internals';
import {Portal as LayerPortal} from './portal';
import {PopperAnchor, PopperContent, PopperRoot} from './popper';
import {Presence} from './presence';
import {Slot} from './slot';
import * as React from 'react';

const DelayContext: React.Context<number> = React.createContext(700);

export function Provider(props: $FlowFixMe): React.Node {
  const {children, delayDuration = 700} = props;
  return (
    <DelayContext.Provider value={delayDuration}>
      {children}
    </DelayContext.Provider>
  );
}

type TooltipContextValue = {
  open: boolean,
  show: () => void,
  hide: () => void,
};

const TooltipContext: React.Context<TooltipContextValue> = React.createContext({
  open: false,
  show: () => {},
  hide: () => {},
} as $FlowFixMe);

function makeRoot(defaultDelay: number): (props: $FlowFixMe) => React.Node {
  return function Root(props: $FlowFixMe): React.Node {
    const {
      children,
      open,
      defaultOpen = false,
      onOpenChange,
      delayDuration,
      openDelay,
      closeDelay = 0,
    } = props;
    const contextDelay = React.useContext(DelayContext);
    const delay = openDelay ?? delayDuration ?? contextDelay ?? defaultDelay;
    const [isOpen, setOpen] = useControllableState({
      prop: open,
      defaultProp: defaultOpen,
      onChange: onOpenChange,
    });
    const timerRef = React.useRef<$FlowFixMe>(null);
    const schedule = React.useCallback(
      (next: boolean, afterMs: number) => {
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setOpen(next), afterMs);
      },
      [setOpen],
    );
    React.useEffect(() => () => clearTimeout(timerRef.current), []);
    const context = React.useMemo(
      () => ({
        open: isOpen === true,
        show: () => schedule(true, delay),
        hide: () => schedule(false, closeDelay),
      }),
      [isOpen, schedule, delay, closeDelay],
    );
    return (
      <TooltipContext.Provider value={context as $FlowFixMe}>
        <PopperRoot>{children}</PopperRoot>
      </TooltipContext.Provider>
    );
  };
}

export const Root: (props: $FlowFixMe) => React.Node = makeRoot(700);
export const HoverCardRoot: (props: $FlowFixMe) => React.Node = makeRoot(700);

export function Trigger(props: $FlowFixMe): React.Node {
  const {children, asChild, ...rest} = props;
  const {open, show, hide} = React.useContext(TooltipContext);
  const triggerProps: $FlowFixMe = {
    ...rest,
    'data-state': dataState(open),
    onPointerEnter: (e: $FlowFixMe) => {
      rest.onPointerEnter?.(e);
      show();
    },
    onPointerLeave: (e: $FlowFixMe) => {
      rest.onPointerLeave?.(e);
      hide();
    },
    onPointerDown: (e: $FlowFixMe) => {
      rest.onPointerDown?.(e);
      show();
    },
    onFocus: (e: $FlowFixMe) => {
      rest.onFocus?.(e);
      show();
    },
    onBlur: (e: $FlowFixMe) => {
      rest.onBlur?.(e);
      hide();
    },
  };
  const inner =
    asChild === true ? (
      <Slot {...triggerProps}>{children}</Slot>
    ) : (
      <button {...triggerProps}>{children}</button>
    );
  return <PopperAnchor>{inner}</PopperAnchor>;
}

export function Portal(props: $FlowFixMe): React.Node {
  const {children} = props;
  const {open} = React.useContext(TooltipContext);
  return (
    <Presence present={open}>
      <LayerPortal>{children}</LayerPortal>
    </Presence>
  );
}

export function Content(props: $FlowFixMe): React.Node {
  const {children, side = 'top', align, sideOffset = 4, ...rest} = props;
  const {open} = React.useContext(TooltipContext);
  // Tooltip content renders through its own Portal part in shadcn markup;
  // when authored WITHOUT one (older shadcn), portal it here.
  const content = (
    <PopperContent
      side={side}
      align={align}
      sideOffset={sideOffset}
      role="tooltip"
      {...rest}
      data-state={dataState(open)}>
      {children}
    </PopperContent>
  );
  return (
    <Presence present={open}>
      <LayerPortal>{content}</LayerPortal>
    </Presence>
  );
}

export function Arrow(_props: $FlowFixMe): React.Node {
  // Decorative; anchor positioning has no arrow model yet.
  return null;
}
