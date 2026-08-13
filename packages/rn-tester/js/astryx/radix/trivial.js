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
 * The trivial tier: @radix-ui/react-label, -separator, -aspect-ratio,
 * -progress, -avatar. Each implements the public parts shadcn imports,
 * rendering intrinsic elements whose data attributes the stylesheet engine
 * styles.
 */

import {Slot} from './slot';
import * as React from 'react';

type AnyProps = {[string]: $FlowFixMe};

function element(
  tag: string,
  {asChild, ...props}: AnyProps,
  children?: React.Node,
): React.Node {
  if (asChild === true) {
    return <Slot {...props}>{children}</Slot>;
  }
  const Tag = tag;
  // $FlowFixMe[not-a-component] intrinsic tags resolve via the jsx runtime
  return <Tag {...props}>{children}</Tag>;
}

// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------

export function LabelRoot({children, ...props}: AnyProps): React.Node {
  return element('label', props, children);
}

// ---------------------------------------------------------------------------
// Separator
// ---------------------------------------------------------------------------

export function SeparatorRoot({
  orientation = 'horizontal',
  decorative,
  children,
  ...props
}: AnyProps): React.Node {
  return element('div', {
    ...props,
    'data-orientation': orientation,
    role: decorative === true ? 'none' : 'separator',
  });
}

// ---------------------------------------------------------------------------
// AspectRatio
// ---------------------------------------------------------------------------

export function AspectRatioRoot({
  ratio = 1,
  style,
  children,
  ...props
}: AnyProps): React.Node {
  return (
    <div style={{position: 'relative', width: '100%', aspectRatio: ratio}}>
      {element(
        'div',
        {
          ...props,
          style: {
            ...style,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          },
        },
        children,
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

const ProgressContext: React.Context<{value: number | null, max: number}> =
  React.createContext({value: null, max: 100});

function progressState(value: number | null, max: number): string {
  return value == null
    ? 'indeterminate'
    : value >= max
      ? 'complete'
      : 'loading';
}

export function ProgressRoot({
  value = null,
  max = 100,
  children,
  ...props
}: AnyProps): React.Node {
  const context = React.useMemo(() => ({value, max}), [value, max]);
  return (
    <ProgressContext.Provider value={context}>
      {element(
        'div',
        {
          ...props,
          role: 'progressbar',
          'aria-valuemin': 0,
          'aria-valuemax': max,
          'aria-valuenow': value ?? undefined,
          'data-state': progressState(value, max),
          'data-value': value ?? undefined,
          'data-max': max,
        },
        children,
      )}
    </ProgressContext.Provider>
  );
}

export function ProgressIndicator({children, ...props}: AnyProps): React.Node {
  const {value, max} = React.useContext(ProgressContext);
  return element(
    'div',
    {
      ...props,
      'data-state': progressState(value, max),
      'data-value': value ?? undefined,
      'data-max': max,
    },
    children,
  );
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

type AvatarStatus = 'idle' | 'loading' | 'loaded' | 'error';
type AvatarContextValue = {
  status: AvatarStatus,
  setStatus: $FlowFixMe,
};
const AvatarContext: React.Context<AvatarContextValue> = React.createContext({
  status: 'idle',
  setStatus: () => {},
} as $FlowFixMe);

export function AvatarRoot({children, ...props}: AnyProps): React.Node {
  const [status, setStatus] = React.useState<AvatarStatus>('idle');
  const context = React.useMemo(() => ({status, setStatus}), [status]);
  return (
    <AvatarContext.Provider value={context}>
      {element('span', props, children)}
    </AvatarContext.Provider>
  );
}

export function AvatarImage({
  src,
  onLoad,
  onError,
  ...props
}: AnyProps): React.Node {
  const {status, setStatus} = React.useContext(AvatarContext);
  React.useEffect(() => {
    setStatus(src != null ? 'loading' : 'error');
  }, [src, setStatus]);
  if (src == null || status === 'error') {
    return null;
  }
  return (
    // $FlowFixMe[not-a-component] intrinsic <img>
    <img
      {...props}
      src={src}
      onLoad={(e: $FlowFixMe) => {
        setStatus('loaded');
        onLoad?.(e);
      }}
      onError={(e: $FlowFixMe) => {
        setStatus('error');
        onError?.(e);
      }}
    />
  );
}

export function AvatarFallback({
  delayMs,
  children,
  ...props
}: AnyProps): React.Node {
  const {status} = React.useContext(AvatarContext);
  const [delayed, setDelayed] = React.useState(delayMs != null);
  React.useEffect(() => {
    if (delayMs != null) {
      const timer = setTimeout(() => setDelayed(false), delayMs);
      return () => clearTimeout(timer);
    }
  }, [delayMs]);
  if (status === 'loaded' || delayed) {
    return null;
  }
  return element('span', props, children);
}
