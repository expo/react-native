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
 * Focus trapping for the top layer — Astryx hard-dependency ④, the piece the
 * overlay work deliberately left out.
 *
 * On the web a modal `<dialog>` traps focus: the background goes inert, focus
 * moves into the dialog, Tab cycles inside it, and closing returns focus to
 * whatever opened it. Astryx builds this with `querySelector` over the DOM.
 *
 * React Native has no DOM and no document-wide focus ring to cycle, so the
 * trap is expressed in the terms RN actually has — which is the accessibility
 * tree, and which is where trapping matters most anyway:
 *
 *  - **The background goes inert.** `accessibilityElementsHidden` (iOS) and
 *    `importantForAccessibility: 'no-hide-descendants'` (Android) remove the
 *    app content behind the overlay from the accessibility tree entirely, so a
 *    screen reader cannot swipe out of the dialog into the page behind it.
 *    That is the actual escape route a trap exists to close.
 *  - **`accessibilityViewIsModal`** tells VoiceOver the same thing from the
 *    other side, which is what iOS itself uses for modals.
 *  - **Focus moves in, and comes back out.** On open, accessibility focus is
 *    sent to the overlay; on close it returns to the element that opened it,
 *    matching the web's restore behaviour.
 *
 * What is NOT modelled, and why: the web's Tab *cycling* has no equivalent
 * here. RN exposes no ordered, queryable focus ring for touch platforms — so
 * rather than fake one, the background is made unreachable, which achieves the
 * containment that cycling exists to guarantee.
 */

import type {HostInstance} from 'react-native';

import {useEffect, useRef} from 'react';
import {AccessibilityInfo, Platform, findNodeHandle} from 'react-native';

/**
 * Props that make a subtree invisible to assistive technology.
 *
 * The two platforms spell this differently and neither understands the other's
 * prop, so both are always set.
 */
export const INERT_PROPS: {
  accessibilityElementsHidden: boolean,
  importantForAccessibility: 'no-hide-descendants',
} = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
};

export const NOT_INERT_PROPS: {
  accessibilityElementsHidden: boolean,
  importantForAccessibility: 'auto',
} = {
  accessibilityElementsHidden: false,
  importantForAccessibility: 'auto',
};

/**
 * The props an overlay container spreads to declare itself a modal to
 * assistive technology. `accessibilityViewIsModal` is iOS-only; on Android the
 * containment comes from the background being hidden instead.
 */
export function modalContainerProps(
  isModal: boolean,
  // Taken as a parameter rather than read from the global so the branch is
  // testable without mutating `Platform.OS`, which Flow rejects outright.
  platform: string = Platform.OS,
): {
  accessibilityViewIsModal?: boolean,
  accessibilityLiveRegion?: 'polite',
} {
  if (!isModal) {
    return {};
  }
  return platform === 'ios'
    ? {accessibilityViewIsModal: true}
    : {accessibilityLiveRegion: 'polite'};
}

/**
 * Moves accessibility focus to `target`, if the platform can.
 *
 * Returns whether it did, so callers can tell "moved" from "nothing to move
 * to" rather than assuming success.
 */
export function focusAccessibility(target: ?HostInstance): boolean {
  if (target == null) {
    return false;
  }
  const handle = findNodeHandle(target);
  if (handle == null) {
    return false;
  }
  AccessibilityInfo.setAccessibilityFocus(handle);
  return true;
}

/**
 * Sends accessibility focus into `containerRef` while `active`, and returns it
 * to whatever held it before once `active` goes false.
 *
 * The invoker is captured when the trap activates rather than being passed in,
 * so a caller cannot forget to restore focus — the same guarantee the web's
 * dialog gives for free.
 */
export function useFocusTrap({
  active,
  containerRef,
  restoreTo,
}: {
  active: boolean,
  containerRef: {current: HostInstance | null},
  restoreTo?: ?{current: HostInstance | null},
}): void {
  // Held across the activation so the restore target cannot change underneath
  // us while the overlay is open.
  const restoreTargetRef = useRef<HostInstance | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }

    restoreTargetRef.current = restoreTo?.current ?? null;

    // A frame's grace: the overlay has to be mounted and laid out before it
    // can take accessibility focus. Sending focus in the same tick lands on a
    // view that does not exist yet and is silently dropped.
    const timer = setTimeout(() => {
      focusAccessibility(containerRef.current);
    }, 0);

    return () => {
      clearTimeout(timer);
      const restoreTarget = restoreTargetRef.current;
      restoreTargetRef.current = null;
      if (restoreTarget != null) {
        focusAccessibility(restoreTarget);
      }
    };
  }, [active, containerRef, restoreTo]);
}
