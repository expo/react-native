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
 * class-variance-authority's `cva`, the subset shadcn uses: a base class
 * list, named variant groups, defaultVariants, compoundVariants, and a
 * props.className passthrough appended last.
 */

import {clsx} from './utils';

export function cva(
  base: $FlowFixMe,
  config?: {
    variants?: {[string]: {[string]: $FlowFixMe}},
    defaultVariants?: {[string]: $FlowFixMe},
    compoundVariants?: Array<{[string]: $FlowFixMe}>,
  },
): (props?: {[string]: $FlowFixMe}) => string {
  return (props?: {[string]: $FlowFixMe}) => {
    const out = [clsx(base)];
    const variants: {[string]: {[string]: $FlowFixMe}} =
      config?.variants ?? ({} as $FlowFixMe);
    const resolved: {[string]: $FlowFixMe} = {};
    for (const name of Object.keys(variants)) {
      const fromProps = props?.[name];
      const value = fromProps ?? config?.defaultVariants?.[name];
      resolved[name] = value;
      const cls = value != null ? variants[name][String(value)] : null;
      if (cls != null) {
        out.push(clsx(cls));
      }
    }
    for (const compound of config?.compoundVariants ?? []) {
      const {class: cls, className, ...conditions} = compound;
      const matches = Object.keys(conditions).every(name => {
        const want = conditions[name];
        return Array.isArray(want)
          ? want.includes(resolved[name])
          : resolved[name] === want;
      });
      if (matches) {
        out.push(clsx(cls ?? className));
      }
    }
    if (props?.className != null) {
      out.push(String(props.className));
    }
    if (props?.class != null) {
      out.push(String(props.class));
    }
    return out.filter(Boolean).join(' ');
  };
}

// `import { type VariantProps }` is erased by the TypeScript strip; nothing
// to provide at runtime.
