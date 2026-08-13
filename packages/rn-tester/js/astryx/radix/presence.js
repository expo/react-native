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
 * Presence — Radix's mount-until-exit-animation primitive.
 *
 * On the web, Presence keeps a closing part mounted until its exit
 * animation's `animationend`/`transitionend` fires. The fork's renderer does
 * not emit those events (documented gap), so completion is SYNTHESIZED: the
 * caller passes the exit duration (defaulting to the 150ms shadcn's
 * animate-out utilities use) and unmount happens on a timer. Exact-duration
 * unmount is observably equivalent for time-driven exits; interruptions
 * (reopen while closing) cancel the timer, exactly like the web.
 */

import * as React from 'react';

export function usePresence(
  present: boolean,
  exitDurationMs: number = 150,
): boolean {
  const [mounted, setMounted] = React.useState(present);
  React.useEffect(() => {
    if (present) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), exitDurationMs);
    return () => clearTimeout(timer);
  }, [present, exitDurationMs]);
  return present || mounted;
}

/**
 * Component form, mirroring Radix: children stay mounted through the exit
 * window while `data-state="closed"` styles (and the closing animation the
 * stylesheet attaches to them) play.
 */
export function Presence({
  present,
  exitDurationMs,
  children,
}: {
  present: boolean,
  exitDurationMs?: number,
  children: React.Node,
}): React.Node {
  const mounted = usePresence(present, exitDurationMs);
  return mounted ? children : null;
}
