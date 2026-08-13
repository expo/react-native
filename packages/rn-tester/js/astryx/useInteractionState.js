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
 * Interaction state for CSS pseudo-class styling, sourced from **W3C pointer
 * events on the element itself** — no Pressable, no gesture responder, no JS
 * gesture recognizer. This is the RN analog of the browser maintaining
 * `:hover` / `:active` / `:focus-visible` for you, and it is what lets an
 * Astryx-style `<button>` (a `<div>`/`<span>` intrinsic with `onClick`) look
 * and behave like the web original.
 *
 * The returned `handlers` spread straight onto an intrinsic element; pass
 * `state` to `stylex.propsWithState(state, …styles)`.
 *
 * ```js
 * const {state, handlers} = useInteractionState();
 * <button {...handlers} {...stylex.propsWithState(state, styles.button)}
 *         onClick={onPress}>Save</button>
 * ```
 *
 * Requires W3C pointer events (RNTester enables them in its AppDelegate);
 * `onClick` itself is the fork's DOM click, which bubbles like the web.
 */

import type {InteractionState} from './stylex-rn';

import {useCallback, useMemo, useState} from 'react';

type PointerHandlers = {
  onPointerEnter: () => void,
  onPointerLeave: () => void,
  onPointerDown: () => void,
  onPointerUp: () => void,
  onPointerCancel: () => void,
  onFocus: () => void,
  onBlur: () => void,
};

export function useInteractionState(options?: {disabled?: boolean}): {
  state: InteractionState,
  handlers: PointerHandlers,
} {
  const disabled = options?.disabled === true;
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);

  const clearPressed = useCallback(() => setPressed(false), []);

  const handlers = useMemo(
    () => ({
      onPointerEnter: () => setHovered(true),
      // Leaving the element cancels the press too — matching the browser,
      // where dragging off a button drops :active.
      onPointerLeave: () => {
        setHovered(false);
        setPressed(false);
      },
      onPointerDown: () => setPressed(true),
      onPointerUp: clearPressed,
      onPointerCancel: clearPressed,
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    }),
    [clearPressed],
  );

  const state = useMemo(
    () =>
      disabled
        ? {disabled: true}
        : {hovered, pressed, focused, disabled: false},
    [disabled, hovered, pressed, focused],
  );

  return {state, handlers};
}

export type {PointerHandlers};

// Re-exported for convenience so a component needs one import.
export type {InteractionState};

export default useInteractionState;
