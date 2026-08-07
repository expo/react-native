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
 * Popover (@radix-ui/react-popover) — and, with hover/delay triggers,
 * Tooltip and HoverCard — anchored floating content: Popper for placement,
 * Portal + Presence for the layer, DismissableLayer for outside-press.
 * Non-modal: no focus trap.
 */

import {DismissableLayer} from './dismissable-layer';
import {dataState, useControllableState} from './internals';
import {Portal as LayerPortal} from './portal';
import {PopperAnchor, PopperContent, PopperRoot} from './popper';
import {Presence} from './presence';
import {Slot} from './slot';
import * as React from 'react';

type PopoverContextValue = {
  open: boolean,
  setOpen: $FlowFixMe => void,
};

const PopoverContext: React.Context<PopoverContextValue> = React.createContext({
  open: false,
  setOpen: () => {},
} as $FlowFixMe);

export function Root(props: $FlowFixMe): React.Node {
  const {children, open, defaultOpen = false, onOpenChange} = props;
  const [isOpen, setOpen] = useControllableState({
    prop: open,
    defaultProp: defaultOpen,
    onChange: onOpenChange,
  });
  const context = React.useMemo(
    () => ({open: isOpen === true, setOpen}),
    [isOpen, setOpen],
  );
  return (
    <PopoverContext.Provider value={context as $FlowFixMe}>
      <PopperRoot>{children}</PopperRoot>
    </PopoverContext.Provider>
  );
}

export function Anchor(props: $FlowFixMe): React.Node {
  return <PopperAnchor {...props} />;
}

export function Trigger(props: $FlowFixMe): React.Node {
  const {children, asChild, onClick, ...rest} = props;
  const {open, setOpen} = React.useContext(PopoverContext);
  const triggerProps: $FlowFixMe = {
    ...rest,
    'data-state': dataState(open),
    onClick: (e: $FlowFixMe) => {
      onClick?.(e);
      setOpen((v: boolean) => !v);
    },
  };
  // The trigger IS the anchor, so it always wraps in PopperAnchor.
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
  const {open} = React.useContext(PopoverContext);
  return (
    <Presence present={open}>
      <LayerPortal>{children}</LayerPortal>
    </Presence>
  );
}

export function Content(props: $FlowFixMe): React.Node {
  const {
    children,
    side,
    align,
    sideOffset,
    onEscapeKeyDown,
    onPointerDownOutside,
    ...rest
  } = props;
  const {open, setOpen} = React.useContext(PopoverContext);
  return (
    <DismissableLayer
      onDismiss={() => setOpen(false)}
      onEscapeKeyDown={onEscapeKeyDown}
      onPointerDownOutside={onPointerDownOutside}>
      <PopperContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        role="dialog"
        {...rest}
        data-state={dataState(open)}>
        {children}
      </PopperContent>
    </DismissableLayer>
  );
}

export function Close(props: $FlowFixMe): React.Node {
  const {children, asChild, onClick, ...rest} = props;
  const {setOpen} = React.useContext(PopoverContext);
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
