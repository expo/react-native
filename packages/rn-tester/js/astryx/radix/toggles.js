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
 * The pressed/checked family: Toggle, ToggleGroup, Checkbox, Switch,
 * RadioGroup. Small state machines whose whole styling surface is data
 * attributes and aria state — exactly what the stylesheet engine matches.
 */

import {useControllableState} from './internals';
import {Slot} from './slot';
import * as React from 'react';

type AnyProps = {[string]: $FlowFixMe};

function pressable(
  props: AnyProps,
  extra: AnyProps,
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
// Toggle
// ---------------------------------------------------------------------------

export function Toggle(props: $FlowFixMe): React.Node {
  const {
    children,
    pressed,
    defaultPressed = false,
    onPressedChange,
    onClick,
    disabled,
    ...rest
  } = props;
  const [isPressed, setPressed] = useControllableState({
    prop: pressed,
    defaultProp: defaultPressed,
    onChange: onPressedChange,
  });
  return pressable(
    rest,
    {
      'data-state': isPressed === true ? 'on' : 'off',
      'data-disabled': disabled === true ? true : undefined,
      disabled,
      'aria-pressed': isPressed === true ? 'true' : 'false',
      onClick: (e: $FlowFixMe) => {
        onClick?.(e);
        if (disabled !== true) {
          setPressed((v: boolean) => !v);
        }
      },
    },
    children,
  );
}

// ---------------------------------------------------------------------------
// ToggleGroup
// ---------------------------------------------------------------------------

type ToggleGroupContextValue = {
  type: 'single' | 'multiple',
  value: $FlowFixMe,
  toggle: (item: string) => void,
};

const ToggleGroupContext: React.Context<ToggleGroupContextValue> =
  React.createContext({
    type: 'single',
    value: '',
    toggle: () => {},
  } as $FlowFixMe);

export function ToggleGroupRoot(props: $FlowFixMe): React.Node {
  const {
    children,
    type = 'single',
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
      type,
      value: current,
      toggle: (item: string) => {
        if (type === 'multiple') {
          setValue((prev: Array<string>) =>
            prev.includes(item)
              ? prev.filter(v => v !== item)
              : [...prev, item],
          );
        } else {
          setValue((prev: string) => (prev === item ? '' : item));
        }
      },
    }),
    [type, current, setValue],
  );
  const {asChild: _a, ...groupRest} = rest;
  return (
    <ToggleGroupContext.Provider value={context as $FlowFixMe}>
      <div role="group" {...groupRest}>
        {children}
      </div>
    </ToggleGroupContext.Provider>
  );
}

export function ToggleGroupItem(props: $FlowFixMe): React.Node {
  const {children, value, onClick, disabled, ...rest} = props;
  const group = React.useContext(ToggleGroupContext);
  const isOn =
    group.type === 'multiple'
      ? Array.isArray(group.value) && group.value.includes(value)
      : group.value === value;
  return pressable(
    rest,
    {
      'data-state': isOn ? 'on' : 'off',
      'data-disabled': disabled === true ? true : undefined,
      disabled,
      'aria-pressed': isOn ? 'true' : 'false',
      onClick: (e: $FlowFixMe) => {
        onClick?.(e);
        if (disabled !== true) {
          group.toggle(value);
        }
      },
    },
    children,
  );
}

// ---------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------

const CheckedContext: React.Context<$FlowFixMe> = React.createContext(false);

export function CheckboxRoot(props: $FlowFixMe): React.Node {
  const {
    children,
    checked,
    defaultChecked = false,
    onCheckedChange,
    onClick,
    disabled,
    ...rest
  } = props;
  const [isChecked, setChecked] = useControllableState({
    prop: checked,
    defaultProp: defaultChecked,
    onChange: onCheckedChange,
  });
  const state =
    isChecked === 'indeterminate'
      ? 'indeterminate'
      : isChecked === true
        ? 'checked'
        : 'unchecked';
  return (
    <CheckedContext.Provider value={isChecked as $FlowFixMe}>
      {pressable(
        rest,
        {
          role: 'checkbox',
          'aria-checked':
            state === 'indeterminate' ? 'mixed' : String(isChecked === true),
          'data-state': state,
          'data-disabled': disabled === true ? true : undefined,
          disabled,
          onClick: (e: $FlowFixMe) => {
            onClick?.(e);
            if (disabled !== true) {
              setChecked((v: $FlowFixMe) => (v === true ? false : true));
            }
          },
        },
        children,
      )}
    </CheckedContext.Provider>
  );
}

export function CheckboxIndicator(props: $FlowFixMe): React.Node {
  const {children, ...rest} = props;
  const checked = React.useContext(CheckedContext);
  if (checked !== true && checked !== 'indeterminate') {
    return null;
  }
  const state = checked === 'indeterminate' ? 'indeterminate' : 'checked';
  // A <div>, not a <span>: shadcn styles the indicator as a flex box
  // (`flex items-center justify-center`), and an inline text element cannot
  // BE a box — it joins the parent's text run, putting the checkmark on the
  // text baseline instead of centring it.
  // DOM-CSS-LIMITATION(display-on-inline-text-elements)
  return (
    <div data-state={state} {...rest}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

export function SwitchRoot(props: $FlowFixMe): React.Node {
  const {
    children,
    checked,
    defaultChecked = false,
    onCheckedChange,
    onClick,
    disabled,
    ...rest
  } = props;
  const [isChecked, setChecked] = useControllableState({
    prop: checked,
    defaultProp: defaultChecked,
    onChange: onCheckedChange,
  });
  const state = isChecked === true ? 'checked' : 'unchecked';
  return (
    <CheckedContext.Provider value={isChecked as $FlowFixMe}>
      {pressable(
        rest,
        {
          role: 'switch',
          'aria-checked': String(isChecked === true),
          'data-state': state,
          'data-disabled': disabled === true ? true : undefined,
          disabled,
          onClick: (e: $FlowFixMe) => {
            onClick?.(e);
            if (disabled !== true) {
              setChecked((v: boolean) => !v);
            }
          },
        },
        children,
      )}
    </CheckedContext.Provider>
  );
}

export function SwitchThumb(props: $FlowFixMe): React.Node {
  const {children, ...rest} = props;
  const checked = React.useContext(CheckedContext);
  // A box, not inline text (see CheckboxIndicator).
  return (
    <div data-state={checked === true ? 'checked' : 'unchecked'} {...rest}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RadioGroup
// ---------------------------------------------------------------------------

type RadioGroupContextValue = {
  value: string | null,
  select: (item: string) => void,
};

const RadioGroupContext: React.Context<RadioGroupContextValue> =
  React.createContext({value: null, select: () => {}} as $FlowFixMe);

export function RadioGroupRoot(props: $FlowFixMe): React.Node {
  const {children, value, defaultValue = null, onValueChange, ...rest} = props;
  const [current, setValue] = useControllableState({
    prop: value,
    defaultProp: defaultValue,
    onChange: onValueChange,
  });
  const context = React.useMemo(
    () => ({value: current, select: (item: string) => setValue(item)}),
    [current, setValue],
  );
  const {asChild: _a, ...groupRest} = rest;
  return (
    <RadioGroupContext.Provider value={context as $FlowFixMe}>
      <div role="radiogroup" {...groupRest}>
        {children}
      </div>
    </RadioGroupContext.Provider>
  );
}

export function RadioGroupItem(props: $FlowFixMe): React.Node {
  const {children, value, onClick, disabled, style, ...rest} = props;
  const group = React.useContext(RadioGroupContext);
  const isOn = group.value === value;
  return (
    <RadioItemContext.Provider value={isOn}>
      {pressable(
        rest,
        {
          style,
          role: 'radio',
          'aria-checked': String(isOn),
          'data-state': isOn ? 'checked' : 'unchecked',
          'data-disabled': disabled === true ? true : undefined,
          disabled,
          onClick: (e: $FlowFixMe) => {
            onClick?.(e);
            if (disabled !== true) {
              group.select(value);
            }
          },
        },
        children,
      )}
    </RadioItemContext.Provider>
  );
}

const RadioItemContext: React.Context<boolean> = React.createContext(false);

export function RadioGroupIndicator(props: $FlowFixMe): React.Node {
  const {children, ...rest} = props;
  const isOn = React.useContext(RadioItemContext);
  if (!isOn) {
    return null;
  }
  return (
    <div data-state="checked" {...rest}>
      {children}
    </div>
  );
}
