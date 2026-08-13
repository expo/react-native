/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

import * as React from 'react';

/**
 * The inherited `color`, as SVG's `currentColor` means it.
 *
 * Icon sets are built on it: lucide draws every glyph with
 * `stroke="currentColor"`, and a component library colours those icons by
 * setting `color` on an ANCESTOR (shadcn's checked checkbox says
 * `text-primary-foreground` on the control, never on the icon). The
 * renderer inherits text colour natively, but nothing hands that value to
 * a component that has to paint with it, so a checkmark rendered dark on a
 * dark box.
 *
 * Intrinsic elements publish their resolved colour here; `<svg>` reads it.
 * A separate module so neither side has to import the other.
 */
export const CurrentColorContext: React.Context<?string> =
  React.createContext<?string>(null);
