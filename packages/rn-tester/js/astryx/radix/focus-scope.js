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
 * FocusScope — Radix's focus containment over the fork's focus trap.
 *
 * `trapped` maps to the modal focus trap (overlay/focusTrap.js): focus is
 * held inside the subtree and restored on unmount. Non-trapped scopes are
 * pass-through — on a touch-first platform, loop/auto-focus semantics
 * beyond containment add nothing observable.
 */

import {modalContainerProps, useFocusTrap} from '../overlay/focusTrap';
import * as React from 'react';

export function FocusScope(props: $FlowFixMe): React.Node {
  const {trapped = false, children, ...rest} = props;
  const containerRef = React.useRef<$FlowFixMe>(null);
  useFocusTrap({active: trapped, containerRef});
  if (!trapped) {
    return children;
  }
  const containerProps: $FlowFixMe = {
    ...rest,
    ...modalContainerProps(true),
  };
  return (
    <div ref={containerRef} {...containerProps}>
      {children}
    </div>
  );
}
