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
 * The disclosure family: Tabs, Collapsible, Accordion. Show/hide state
 * machines; content visibility is REAL mount/unmount (no height animation —
 * the renderer cannot animate height yet, a documented gap, so expansion is
 * instant while data-state still drives any opacity/transform styling).
 */

import {dataState, useControllableState} from './internals';
import {Slot} from './slot';
import * as React from 'react';

function pressable(
  props: {[string]: $FlowFixMe},
  extra: {[string]: $FlowFixMe},
  children: React.Node,
): React.Node {
  const {asChild, ...rest} = props;
  const merged: $FlowFixMe = {...rest, ...extra};
  if (asChild === true) {
    return <Slot {...merged}>{children}</Slot>;
  }
  return <button {...merged}>{children}</button>;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type TabsContextValue = {value: string | null, select: string => void};
const TabsContext: React.Context<TabsContextValue> = React.createContext({
  value: null,
  select: () => {},
} as $FlowFixMe);

export function TabsRoot(props: $FlowFixMe): React.Node {
  const {children, value, defaultValue = null, onValueChange, ...rest} = props;
  const [current, setValue] = useControllableState({
    prop: value,
    defaultProp: defaultValue,
    onChange: onValueChange,
  });
  const context = React.useMemo(
    () => ({value: current, select: (v: string) => setValue(v)}),
    [current, setValue],
  );
  const {asChild: _a, ...tabsRest} = rest;
  return (
    <TabsContext.Provider value={context as $FlowFixMe}>
      <div {...tabsRest}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList(props: $FlowFixMe): React.Node {
  const {children, ...rest} = props;
  return (
    <div role="tablist" {...rest}>
      {children}
    </div>
  );
}

export function TabsTrigger(props: $FlowFixMe): React.Node {
  const {children, value, onClick, disabled, ...rest} = props;
  const tabs = React.useContext(TabsContext);
  const active = tabs.value === value;
  return pressable(
    rest,
    {
      role: 'tab',
      'aria-selected': String(active),
      'data-state': active ? 'active' : 'inactive',
      'data-disabled': disabled === true ? true : undefined,
      disabled,
      onClick: (e: $FlowFixMe) => {
        onClick?.(e);
        if (disabled !== true) {
          tabs.select(value);
        }
      },
    },
    children,
  );
}

export function TabsContent(props: $FlowFixMe): React.Node {
  const {children, value, forceMount, ...rest} = props;
  const tabs = React.useContext(TabsContext);
  const active = tabs.value === value;
  if (!active && forceMount !== true) {
    return null;
  }
  return (
    <div role="tabpanel" {...rest} data-state={active ? 'active' : 'inactive'}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible
// ---------------------------------------------------------------------------

type CollapsibleContextValue = {open: boolean, toggle: () => void};
const CollapsibleContext: React.Context<CollapsibleContextValue> =
  React.createContext({open: false, toggle: () => {}} as $FlowFixMe);

export function CollapsibleRoot(props: $FlowFixMe): React.Node {
  const {
    children,
    open,
    defaultOpen = false,
    onOpenChange,
    disabled,
    ...rest
  } = props;
  const [isOpen, setOpen] = useControllableState({
    prop: open,
    defaultProp: defaultOpen,
    onChange: onOpenChange,
  });
  const context = React.useMemo(
    () => ({
      open: isOpen === true,
      toggle: () => {
        if (disabled !== true) {
          setOpen((v: boolean) => !v);
        }
      },
    }),
    [isOpen, setOpen, disabled],
  );
  const {asChild: _a, ...collapsibleRest} = rest;
  return (
    <CollapsibleContext.Provider value={context as $FlowFixMe}>
      <div {...collapsibleRest} data-state={dataState(isOpen === true)}>
        {children}
      </div>
    </CollapsibleContext.Provider>
  );
}

export function CollapsibleTrigger(props: $FlowFixMe): React.Node {
  const {children, onClick, ...rest} = props;
  const {open, toggle} = React.useContext(CollapsibleContext);
  return pressable(
    rest,
    {
      'data-state': dataState(open),
      onClick: (e: $FlowFixMe) => {
        onClick?.(e);
        toggle();
      },
    },
    children,
  );
}

export function CollapsibleContent(props: $FlowFixMe): React.Node {
  const {children, forceMount, ...rest} = props;
  const {open} = React.useContext(CollapsibleContext);
  if (!open && forceMount !== true) {
    return null;
  }
  return (
    <div {...rest} data-state={dataState(open)}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accordion
// ---------------------------------------------------------------------------

type AccordionContextValue = {
  isOpen: (item: string) => boolean,
  toggle: (item: string) => void,
};
const AccordionContext: React.Context<AccordionContextValue> =
  React.createContext({isOpen: () => false, toggle: () => {}} as $FlowFixMe);

const AccordionItemContext: React.Context<string> = React.createContext('');

export function AccordionRoot(props: $FlowFixMe): React.Node {
  const {
    children,
    type = 'single',
    collapsible = false,
    value,
    defaultValue,
    onValueChange,
    ...rest
  } = props;
  const [current, setValue] = useControllableState({
    prop: value,
    defaultProp: defaultValue ?? (type === 'multiple' ? [] : ''),
    onChange: onValueChange,
  });
  const context = React.useMemo(
    () => ({
      isOpen: (item: string) =>
        type === 'multiple'
          ? Array.isArray(current) && current.includes(item)
          : current === item,
      toggle: (item: string) => {
        if (type === 'multiple') {
          setValue((prev: Array<string>) =>
            prev.includes(item)
              ? prev.filter(v => v !== item)
              : [...prev, item],
          );
        } else {
          setValue((prev: string) =>
            prev === item ? (collapsible ? '' : prev) : item,
          );
        }
      },
    }),
    [type, collapsible, current, setValue],
  );
  const {asChild: _a, ...accordionRest} = rest;
  return (
    <AccordionContext.Provider value={context as $FlowFixMe}>
      <div {...accordionRest}>{children}</div>
    </AccordionContext.Provider>
  );
}

export function AccordionItem(props: $FlowFixMe): React.Node {
  const {children, value, ...rest} = props;
  const accordion = React.useContext(AccordionContext);
  const open = accordion.isOpen(value);
  const {asChild: _a, ...itemRest} = rest;
  return (
    <AccordionItemContext.Provider value={value}>
      <div {...itemRest} data-state={dataState(open)}>
        {children}
      </div>
    </AccordionItemContext.Provider>
  );
}

export function AccordionHeader(props: $FlowFixMe): React.Node {
  const {children, ...rest} = props;
  return (
    // $FlowFixMe[not-a-component] intrinsic
    <h3 {...rest}>{children}</h3>
  );
}

export function AccordionTrigger(props: $FlowFixMe): React.Node {
  const {children, onClick, ...rest} = props;
  const accordion = React.useContext(AccordionContext);
  const item = React.useContext(AccordionItemContext);
  const open = accordion.isOpen(item);
  return pressable(
    rest,
    {
      'aria-expanded': String(open),
      'data-state': dataState(open),
      onClick: (e: $FlowFixMe) => {
        onClick?.(e);
        accordion.toggle(item);
      },
    },
    children,
  );
}

export function AccordionContent(props: $FlowFixMe): React.Node {
  const {children, forceMount, ...rest} = props;
  const accordion = React.useContext(AccordionContext);
  const item = React.useContext(AccordionItemContext);
  const open = accordion.isOpen(item);
  if (!open && forceMount !== true) {
    return null;
  }
  return (
    <div role="region" {...rest} data-state={dataState(open)}>
      {children}
    </div>
  );
}
