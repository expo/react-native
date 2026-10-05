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
 * The `<dialog>` element — Astryx's modal foundation (Dialog, AlertDialog,
 * Lightbox, CommandPalette and MobileNav all render one).
 *
 * On the web a dialog is inert until opened, and `showModal()` promotes it
 * into the top layer with a `::backdrop`. Here `open` renders it into the
 * RN top layer (see ../overlay/TopLayer.js) and `modal` selects whether that
 * layer paints a backdrop and swallows presses. `onClose` fires on dismissal
 * so the `open`-prop contract matches the platform's.
 */

import type {ViewProps} from 'react-native';

import {VarScopeContext} from '../jsx-runtime';
import {useTopLayer} from '../overlay/TopLayer';
import {resolveInherited} from '../stylex-rn';
import * as React from 'react';
import {StyleSheet, View} from 'react-native';

export type DialogProps = {
  ...ViewProps,
  /** Present the dialog. Mirrors the platform's `open` attribute. */
  open?: boolean,
  /**
   * `true` (the default for a dialog) is `showModal()`: backdrop, and presses
   * outside do not reach the content. `false` is the non-modal `show()`.
   */
  modal?: boolean,
  /** Dismissed by a backdrop press (auto popovers) or programmatically. */
  onClose?: () => void,
  children?: React.Node,
  style?: {[string]: unknown},
};

function Dialog({
  open = false,
  modal = true,
  onClose,
  children,
  style,
  ...rest
}: DialogProps): React.Node {
  /*
   * The dialog's box is a plain `View`, so nothing else will finish its style.
   *
   * Every intrinsic element gets a FINAL resolution pass on its way to the
   * host — the one that turns `var(--border-width)` into a number, or drops
   * the declaration when the property is undefined, as CSS requires of a value
   * that is invalid at computed-value time. A `View` gets no such pass, so an
   * unresolved `var()` would reach the platform as a literal string.
   */
  const scope = React.useContext(VarScopeContext);
  const resolvedStyle = React.useMemo(
    // Flattened first: the resolver walks a style OBJECT, and a caller that
    // merges its own layer passes an ARRAY, whose keys are indices.
    () =>
      resolveInherited(
        // The cast belongs on the ARGUMENT: `flatten`'s type parameter is a
        // style prop, and the style reaching a dialog carries values the
        // resolver has not finished with yet.
        StyleSheet.flatten(style as $FlowFixMe),
        null,
        scope,
      ).style,
    [style, scope],
  );

  const content = React.useMemo(
    () =>
      open ? (
        // $FlowFixMe[incompatible-type] the StyleX runtime yields a plain style
        <View {...rest} style={resolvedStyle}>
          {children}
        </View>
      ) : null,
    [open, rest, resolvedStyle, children],
  );

  const hasHost = useTopLayer(open, modal ? 'modal' : 'auto', content);

  React.useEffect(() => {
    if (!open) {
      onClose?.();
    }
    // Fires on the open -> closed transition only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Without a TopLayerHost above it there is nowhere to promote to, so the
  // dialog renders inline rather than disappearing — the same graceful
  // degradation as a browser without top-layer support.
  if (!hasHost && open) {
    return content;
  }
  return null;
}

Dialog.displayName = 'dialog';

export default Dialog;
