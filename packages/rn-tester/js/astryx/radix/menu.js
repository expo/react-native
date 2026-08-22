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
 * DropdownMenu (@radix-ui/react-dropdown-menu) — and, as thin variants,
 * ContextMenu and Menubar — on the Popover composition: anchored floating
 * content, items that select-and-close, checkbox/radio items with gated
 * indicators, and submenus as nested anchored panels. Typeahead and roving
 * keyboard focus are not modeled (touch-first); dismissal and selection
 * carry the tier.
 */

import {DismissableLayer} from './dismissable-layer';
import {dataState, useControllableState} from './internals';
import {PopperAnchor, PopperContent, PopperContext, PopperRoot} from './popper';
import {Portal as LayerPortal} from './portal';
import {Presence} from './presence';
import {Slot} from './slot';
import * as React from 'react';

type MenuContextValue = {
  open: boolean,
  setOpen: $FlowFixMe => void,
  close: () => void,
};

const MenuContext: React.Context<MenuContextValue> = React.createContext({
  open: false,
  setOpen: () => {},
  close: () => {},
} as $FlowFixMe);

// The root menu's close, reachable from any depth: selecting inside a
// submenu closes the WHOLE menu, per menu semantics.
const RootCloseContext: React.Context<() => void> = React.createContext(
  () => {},
);

export function Root(props: $FlowFixMe): React.Node {
  const {children, open, defaultOpen = false, onOpenChange} = props;
  const [isOpen, setOpen] = useControllableState({
    prop: open,
    defaultProp: defaultOpen,
    onChange: onOpenChange,
  });
  const close = React.useCallback(() => setOpen(false), [setOpen]);
  const context = React.useMemo(
    () => ({open: isOpen === true, setOpen, close}),
    [isOpen, setOpen, close],
  );
  return (
    <MenuContext.Provider value={context as $FlowFixMe}>
      <RootCloseContext.Provider value={close}>
        <PopperRoot>{children}</PopperRoot>
      </RootCloseContext.Provider>
    </MenuContext.Provider>
  );
}

function triggerFor(
  openOn: 'press' | 'longPress',
): (props: $FlowFixMe) => React.Node {
  return function Trigger(props: $FlowFixMe): React.Node {
    const {children, asChild, ...rest} = props;
    const {open, setOpen} = React.useContext(MenuContext);
    const timerRef = React.useRef<$FlowFixMe>(null);
    const triggerProps: $FlowFixMe = {
      ...rest,
      'data-state': dataState(open),
    };
    if (openOn === 'press') {
      triggerProps.onClick = (e: $FlowFixMe) => {
        rest.onClick?.(e);
        setOpen((v: boolean) => !v);
      };
    } else {
      // Context menus open on long-press, the platform's context gesture.
      triggerProps.onPointerDown = (e: $FlowFixMe) => {
        rest.onPointerDown?.(e);
        timerRef.current = setTimeout(() => setOpen(true), 500);
      };
      triggerProps.onPointerUp = (e: $FlowFixMe) => {
        rest.onPointerUp?.(e);
        clearTimeout(timerRef.current);
      };
      triggerProps.onPointerLeave = (e: $FlowFixMe) => {
        rest.onPointerLeave?.(e);
        clearTimeout(timerRef.current);
      };
    }
    const inner =
      asChild === true ? (
        <Slot {...triggerProps}>{children}</Slot>
      ) : (
        <button {...triggerProps}>{children}</button>
      );
    return <PopperAnchor>{inner}</PopperAnchor>;
  };
}

export const Trigger: (props: $FlowFixMe) => React.Node = triggerFor('press');
export const ContextTrigger: (props: $FlowFixMe) => React.Node =
  triggerFor('longPress');

export function Portal(props: $FlowFixMe): React.Node {
  const {children} = props;
  const context = React.useContext(MenuContext);
  const closeRoot = React.useContext(RootCloseContext);
  const popper = React.useContext(PopperContext);
  // Context does not flow into top-layer content; re-provide (see dialog).
  return (
    <Presence present={context.open}>
      <LayerPortal>
        <MenuContext.Provider value={context}>
          <RootCloseContext.Provider value={closeRoot}>
            <PopperContext.Provider value={popper}>
              {children}
            </PopperContext.Provider>
          </RootCloseContext.Provider>
        </MenuContext.Provider>
      </LayerPortal>
    </Presence>
  );
}

export function Content(props: $FlowFixMe): React.Node {
  const {
    children,
    side = 'bottom',
    align = 'start',
    sideOffset = 4,
    ...rest
  } = props;
  const {open, setOpen} = React.useContext(MenuContext);
  return (
    <DismissableLayer onDismiss={() => setOpen(false)}>
      <PopperContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        role="menu"
        {...rest}
        data-state={dataState(open)}>
        {children}
      </PopperContent>
    </DismissableLayer>
  );
}

export function Item(props: $FlowFixMe): React.Node {
  const {children, onSelect, onClick, disabled, ...rest} = props;
  const closeRoot = React.useContext(RootCloseContext);
  const itemProps: $FlowFixMe = {
    role: 'menuitem',
    ...rest,
    'data-disabled': disabled === true ? true : undefined,
    onClick: (e: $FlowFixMe) => {
      onClick?.(e);
      if (disabled === true) {
        return;
      }
      const event: $FlowFixMe = {defaultPrevented: false};
      event.preventDefault = () => {
        event.defaultPrevented = true;
      };
      onSelect?.(event);
      if (!event.defaultPrevented) {
        closeRoot();
      }
    },
  };
  return <div {...itemProps}>{children}</div>;
}

export function CheckboxItem(props: $FlowFixMe): React.Node {
  const {children, checked = false, onCheckedChange, onClick, ...rest} = props;
  const itemProps: $FlowFixMe = {
    role: 'menuitemcheckbox',
    'aria-checked': String(checked === true),
    'data-state': checked === true ? 'checked' : 'unchecked',
    ...rest,
    onClick: (e: $FlowFixMe) => {
      onClick?.(e);
      // Checkbox items stay open — toggling is the interaction.
      onCheckedChange?.(checked !== true);
    },
  };
  return (
    <ItemIndicatorContext.Provider value={checked === true}>
      <div {...itemProps}>{children}</div>
    </ItemIndicatorContext.Provider>
  );
}

type RadioContextValue = {value: string | null, select: string => void};
const MenuRadioContext: React.Context<RadioContextValue> = React.createContext({
  value: null,
  select: () => {},
} as $FlowFixMe);

export function RadioGroup(props: $FlowFixMe): React.Node {
  const {children, value = null, onValueChange, ...rest} = props;
  const context = React.useMemo(
    () => ({value, select: (v: string) => onValueChange?.(v)}),
    [value, onValueChange],
  );
  return (
    <MenuRadioContext.Provider value={context as $FlowFixMe}>
      <div role="group" {...rest}>
        {children}
      </div>
    </MenuRadioContext.Provider>
  );
}

export function RadioItem(props: $FlowFixMe): React.Node {
  const {children, value, onClick, ...rest} = props;
  const group = React.useContext(MenuRadioContext);
  const checked = group.value === value;
  const itemProps: $FlowFixMe = {
    role: 'menuitemradio',
    'aria-checked': String(checked),
    'data-state': checked ? 'checked' : 'unchecked',
    ...rest,
    onClick: (e: $FlowFixMe) => {
      onClick?.(e);
      group.select(value);
    },
  };
  return (
    <ItemIndicatorContext.Provider value={checked}>
      <div {...itemProps}>{children}</div>
    </ItemIndicatorContext.Provider>
  );
}

const ItemIndicatorContext: React.Context<boolean> = React.createContext(false);

export function ItemIndicator(props: $FlowFixMe): React.Node {
  const {children, forceMount, ...rest} = props;
  const on = React.useContext(ItemIndicatorContext);
  if (!on && forceMount !== true) {
    return null;
  }
  return (
    <div data-state={on ? 'checked' : 'unchecked'} {...rest}>
      {children}
    </div>
  );
}

export function Label(props: $FlowFixMe): React.Node {
  const {children, ...rest} = props;
  return <div {...rest}>{children}</div>;
}

export function Separator(props: $FlowFixMe): React.Node {
  const rest: $FlowFixMe = props;
  return <div role="separator" {...rest} />;
}

export function Group(props: $FlowFixMe): React.Node {
  const {children, ...rest} = props;
  return (
    <div role="group" {...rest}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Submenus: a nested menu context anchored to its SubTrigger, opening on
// press (hover intent adds nothing on touch), closing with the root.
// ---------------------------------------------------------------------------

export function Sub(props: $FlowFixMe): React.Node {
  const {children, open, defaultOpen = false, onOpenChange} = props;
  const [isOpen, setOpen] = useControllableState({
    prop: open,
    defaultProp: defaultOpen,
    onChange: onOpenChange,
  });
  const close = React.useCallback(() => setOpen(false), [setOpen]);
  const context = React.useMemo(
    () => ({open: isOpen === true, setOpen, close}),
    [isOpen, setOpen, close],
  );
  // RootCloseContext is NOT overridden: selecting in the submenu closes the
  // whole menu through the root's close.
  return (
    <MenuContext.Provider value={context as $FlowFixMe}>
      <PopperRoot>{children}</PopperRoot>
    </MenuContext.Provider>
  );
}

export function SubTrigger(props: $FlowFixMe): React.Node {
  const {children, ...rest} = props;
  const {open, setOpen} = React.useContext(MenuContext);
  const triggerProps: $FlowFixMe = {
    role: 'menuitem',
    'aria-haspopup': 'menu',
    ...rest,
    'data-state': dataState(open),
    onClick: (e: $FlowFixMe) => {
      rest.onClick?.(e);
      setOpen((v: boolean) => !v);
    },
  };
  return (
    <PopperAnchor>
      <div {...triggerProps}>{children}</div>
    </PopperAnchor>
  );
}

export function SubContent(props: $FlowFixMe): React.Node {
  const {children, sideOffset = 2, ...rest} = props;
  const context = React.useContext(MenuContext);
  const closeRoot = React.useContext(RootCloseContext);
  const popper = React.useContext(PopperContext);
  const {open, setOpen} = context;
  return (
    <Presence present={open}>
      <LayerPortal>
        <MenuContext.Provider value={context}>
          <RootCloseContext.Provider value={closeRoot}>
            <PopperContext.Provider value={popper}>
              <DismissableLayer onDismiss={() => setOpen(false)}>
                <PopperContent
                  side="right"
                  align="start"
                  sideOffset={sideOffset}
                  role="menu"
                  {...rest}
                  data-state={dataState(open)}>
                  {children}
                </PopperContent>
              </DismissableLayer>
            </PopperContext.Provider>
          </RootCloseContext.Provider>
        </MenuContext.Provider>
      </LayerPortal>
    </Presence>
  );
}
