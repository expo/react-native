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
 * `aria-activedescendant` for React Native — the other half of Astryx
 * hard-dependency ④.
 *
 * The web pattern: a composite widget (listbox, combobox, menu) keeps DOM
 * focus on its CONTAINER and points `aria-activedescendant` at the option
 * currently active. Focus never moves, so typing keeps working while the
 * screen reader still announces each option as it becomes active. Astryx uses
 * it for its menus and comboboxes.
 *
 * **React Native has no `aria-activedescendant`.** Not unimplemented — absent:
 * there is no prop, no view-config entry, and no mapping to either platform's
 * accessibility API. Neither `UIAccessibility` nor Android's
 * `AccessibilityNodeInfo` has a direct equivalent that RN surfaces.
 *
 * So this expresses the same intent with what RN does have, and the difference
 * is worth being precise about:
 *
 *  - The container carries the active option's label as its
 *    `accessibilityValue.text`, so the container announces what is active —
 *    which is what activedescendant is for.
 *  - The active option carries `accessibilityState.selected`, so it is
 *    identifiable when reached directly.
 *  - Changing the active option optionally announces it, which is the
 *    behaviour a screen reader gives the web pattern for free.
 *
 * What this does NOT do is keep a real focus ring parked on the container
 * while a *different* node is announced — RN has no such split. A caller
 * needing genuine activedescendant semantics needs native work; this is the
 * faithful approximation, not the thing itself.
 * DOM-CSS-LIMITATION(aria-activedescendant-native).
 */

import {useEffect, useRef} from 'react';
import {AccessibilityInfo} from 'react-native';

export type ActiveDescendantOption = {
  readonly id: string,
  readonly label: string,
};

/**
 * Props for the composite widget's container.
 */
export function activeDescendantContainerProps(
  options: ReadonlyArray<ActiveDescendantOption>,
  activeId: ?string,
): {
  accessibilityValue?: {text: string},
  accessibilityRole: 'menu',
} {
  const active = options.find(option => option.id === activeId);
  return active == null
    ? {accessibilityRole: 'menu'}
    : {accessibilityRole: 'menu', accessibilityValue: {text: active.label}};
}

/**
 * Props for one option within the widget.
 */
export function activeDescendantOptionProps(
  option: ActiveDescendantOption,
  activeId: ?string,
): {
  accessibilityRole: 'menuitem',
  accessibilityState: {selected: boolean},
} {
  return {
    accessibilityRole: 'menuitem',
    accessibilityState: {selected: option.id === activeId},
  };
}

/**
 * Announces the active option when it changes.
 *
 * Skips the first run: announcing on mount would speak an option the user has
 * not moved to yet, which the web does not do either — activedescendant only
 * announces on change.
 */
export function useAnnounceActiveDescendant(
  options: ReadonlyArray<ActiveDescendantOption>,
  activeId: ?string,
): void {
  const previousRef = useRef<?string>(undefined);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = activeId;

    if (previous === undefined || previous === activeId) {
      return;
    }
    const active = options.find(option => option.id === activeId);
    if (active != null) {
      AccessibilityInfo.announceForAccessibility(active.label);
    }
  }, [options, activeId]);
}
