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
 * Dialog (@radix-ui/react-dialog) — and, structurally, AlertDialog —
 * composed from the shim internals: controllable open state, Portal into
 * the top layer, Presence through the exit window, FocusScope trapping,
 * DismissableLayer for outside-press/escape. Every part carries
 * data-state, which is where shadcn's open/close animations attach.
 */

import {DismissableLayer} from './dismissable-layer';
import {FocusScope} from './focus-scope';
import {dataState, useControllableState} from './internals';
import {Portal as LayerPortal} from './portal';
import {Presence} from './presence';
import {Slot} from './slot';
import * as React from 'react';

type DialogContextValue = {
  open: boolean,
  setOpen: $FlowFixMe => void,
  modal: boolean,
};

const DialogContext: React.Context<DialogContextValue> = React.createContext({
  open: false,
  setOpen: () => {},
  modal: true,
} as $FlowFixMe);

export function Root(props: $FlowFixMe): React.Node {
  const {
    children,
    open,
    defaultOpen = false,
    onOpenChange,
    modal = true,
  } = props;
  const [isOpen, setOpen] = useControllableState({
    prop: open,
    defaultProp: defaultOpen,
    onChange: onOpenChange,
  });
  const context = React.useMemo(
    () => ({open: isOpen === true, setOpen, modal: modal !== false}),
    [isOpen, setOpen, modal],
  );
  return (
    <DialogContext.Provider value={context as $FlowFixMe}>
      {children}
    </DialogContext.Provider>
  );
}

export function Trigger(props: $FlowFixMe): React.Node {
  const {children, asChild, onClick, ...rest} = props;
  const {open, setOpen} = React.useContext(DialogContext);
  const triggerProps: $FlowFixMe = {
    ...rest,
    'data-state': dataState(open),
    onClick: (e: $FlowFixMe) => {
      onClick?.(e);
      setOpen(true);
    },
  };
  if (asChild === true) {
    return <Slot {...triggerProps}>{children}</Slot>;
  }
  return <button {...triggerProps}>{children}</button>;
}

export function Portal(props: $FlowFixMe): React.Node {
  const {children} = props;
  const {open} = React.useContext(DialogContext);
  return (
    <Presence present={open}>
      <LayerPortal>{children}</LayerPortal>
    </Presence>
  );
}

export function Overlay(props: $FlowFixMe): React.Node {
  const {children, asChild: _asChild, ...rest} = props;
  const {open} = React.useContext(DialogContext);
  const overlayProps: $FlowFixMe = {
    ...rest,
    'data-state': dataState(open),
    style: {
      ...rest.style,
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
  };
  return <div {...overlayProps}>{children}</div>;
}

export function Content(props: $FlowFixMe): React.Node {
  const {children, onEscapeKeyDown, onPointerDownOutside, ...rest} = props;
  const {open, setOpen, modal} = React.useContext(DialogContext);
  return (
    <DismissableLayer
      onDismiss={() => setOpen(false)}
      onEscapeKeyDown={onEscapeKeyDown}
      onPointerDownOutside={onPointerDownOutside}>
      <FocusScope trapped={modal}>
        <div
          role="dialog"
          aria-modal={modal ? 'true' : undefined}
          {...rest}
          data-state={dataState(open)}>
          {children}
        </div>
      </FocusScope>
    </DismissableLayer>
  );
}

export function Title(props: $FlowFixMe): React.Node {
  const {children, ...rest} = props;
  return (
    // $FlowFixMe[not-a-component] intrinsic
    <h2 {...rest}>{children}</h2>
  );
}

export function Description(props: $FlowFixMe): React.Node {
  const {children, ...rest} = props;
  return (
    // $FlowFixMe[not-a-component] intrinsic
    <p {...rest}>{children}</p>
  );
}

export function Close(props: $FlowFixMe): React.Node {
  const {children, asChild, onClick, ...rest} = props;
  const {setOpen} = React.useContext(DialogContext);
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
