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

import {
  activeDescendantContainerProps,
  activeDescendantOptionProps,
} from '../overlay/activeDescendant';
import {
  INERT_PROPS,
  NOT_INERT_PROPS,
  modalContainerProps,
} from '../overlay/focusTrap';

describe('making the background inert', () => {
  // The two platforms spell this differently and neither understands the
  // other's prop, so a trap that sets only one leaks on the other.
  it('sets both platforms’ props, not just one', () => {
    expect(INERT_PROPS.accessibilityElementsHidden).toBe(true);
    expect(INERT_PROPS.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('has an explicit non-inert state rather than dropping the props', () => {
    // Spreading `{}` when a modal closes leaves React with no instruction to
    // undo the previous value on some paths; an explicit opposite always does.
    expect(NOT_INERT_PROPS.accessibilityElementsHidden).toBe(false);
    expect(NOT_INERT_PROPS.importantForAccessibility).toBe('auto');
  });
});

describe('the modal container', () => {
  it('declares itself modal to VoiceOver on iOS', () => {
    expect(modalContainerProps(true, 'ios').accessibilityViewIsModal).toBe(
      true,
    );
  });

  it('does not put an iOS-only prop on Android', () => {
    // `accessibilityViewIsModal` is silently ignored on Android; the
    // containment there comes from the background being hidden instead.
    expect(
      modalContainerProps(true, 'android').accessibilityViewIsModal,
    ).toBeUndefined();
  });

  it('claims nothing for a non-modal popover', () => {
    expect(modalContainerProps(false, 'ios')).toEqual({});
  });
});

describe('aria-activedescendant, as RN can express it', () => {
  const options = [
    {id: 'a', label: 'Alpha'},
    {id: 'b', label: 'Beta'},
  ];

  it('announces the active option from the container', () => {
    const props = activeDescendantContainerProps(options, 'b');
    expect(props.accessibilityValue).toEqual({text: 'Beta'});
  });

  it('says nothing when no option is active', () => {
    const props = activeDescendantContainerProps(options, null);
    expect(props.accessibilityValue).toBeUndefined();
  });

  it('ignores an id that matches no option', () => {
    const props = activeDescendantContainerProps(options, 'nope');
    expect(props.accessibilityValue).toBeUndefined();
  });

  it('marks only the active option selected', () => {
    expect(
      activeDescendantOptionProps(options[0], 'b').accessibilityState,
    ).toEqual({selected: false});
    expect(
      activeDescendantOptionProps(options[1], 'b').accessibilityState,
    ).toEqual({selected: true});
  });
});
