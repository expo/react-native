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
 * Slider (@radix-ui/react-slider) — single-thumb value dragging.
 *
 * The value comes from the pointer's position across the measured track
 * (W3C pointer events; the root captures the drag). Range and Thumb are
 * styled by the stylesheet through inline percentages the shadcn classes
 * expect (the web version positions them identically). Multi-thumb ranges
 * are not modeled.
 */

import {useControllableState} from './internals';
import * as React from 'react';

type SliderContextValue = {
  value: number,
  min: number,
  max: number,
  disabled: boolean,
};

const SliderContext: React.Context<SliderContextValue> = React.createContext({
  value: 0,
  min: 0,
  max: 100,
  disabled: false,
} as $FlowFixMe);

export function Root(props: $FlowFixMe): React.Node {
  const {
    children,
    value,
    defaultValue,
    onValueChange,
    min = 0,
    max = 100,
    step = 1,
    disabled = false,
    ...rest
  } = props;
  const [current, setValue] = useControllableState({
    prop: Array.isArray(value) ? value[0] : value,
    defaultProp: Array.isArray(defaultValue)
      ? defaultValue[0]
      : (defaultValue ?? min),
    onChange: (v: number) => onValueChange?.([v]),
  });

  const trackRect = React.useRef<$FlowFixMe>(null);
  const rootRef = React.useRef<$FlowFixMe>(null);

  const valueFromPointer = (e: $FlowFixMe) => {
    const rect = trackRect.current;
    if (rect == null || rect.width === 0) {
      return null;
    }
    const x = e?.nativeEvent?.pageX ?? e?.pageX;
    if (typeof x !== 'number') {
      return null;
    }
    const ratio = Math.min(1, Math.max(0, (x - rect.x) / rect.width));
    const raw = min + ratio * (max - min);
    const stepped = Math.round(raw / step) * step;
    return Math.min(max, Math.max(min, stepped));
  };

  const drag = (e: $FlowFixMe) => {
    if (disabled) {
      return;
    }
    const next = valueFromPointer(e);
    if (next != null) {
      setValue(next);
    }
  };

  const context = React.useMemo(
    () => ({value: current ?? min, min, max, disabled}),
    [current, min, max, disabled],
  );

  const rootProps: $FlowFixMe = {
    role: 'slider',
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': current ?? min,
    'data-disabled': disabled ? true : undefined,
    ...rest,
    onLayout: (e: $FlowFixMe) => {
      rest.onLayout?.(e);
      const node = rootRef.current;
      if (node != null && typeof node.measureInWindow === 'function') {
        node.measureInWindow((x: number, y: number, w: number, h: number) => {
          trackRect.current = {x, y, width: w, height: h};
        });
      }
    },
    onPointerDown: (e: $FlowFixMe) => {
      rest.onPointerDown?.(e);
      drag(e);
    },
    onPointerMove: (e: $FlowFixMe) => {
      rest.onPointerMove?.(e);
      if (e?.nativeEvent?.buttons !== 0) {
        drag(e);
      }
    },
    ref: rootRef,
  };
  return (
    <SliderContext.Provider value={context as $FlowFixMe}>
      <div {...rootProps}>{children}</div>
    </SliderContext.Provider>
  );
}

export function Track(props: $FlowFixMe): React.Node {
  const {children, ...rest} = props;
  return <div {...rest}>{children}</div>;
}

export function Range(props: $FlowFixMe): React.Node {
  const {style, ...rest} = props;
  const {value, min, max} = React.useContext(SliderContext);
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return <div {...rest} style={{...style, width: `${pct}%`}} />;
}

export function Thumb(props: $FlowFixMe): React.Node {
  const {style, ...rest} = props;
  const {value, min, max} = React.useContext(SliderContext);
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div {...rest} style={{...style, position: 'absolute', left: `${pct}%`}} />
  );
}
