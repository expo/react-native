/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

/**
 * Who answers a press: the author or the platform, never both. A styled
 * `<button>` gets the platform's dim only when nothing else responds; with
 * both, the two arrive on different clocks and the button goes one colour on
 * press and another on hold. The element tells the button's native view
 * through `authorStatesPressFeedback`, read here off the props its host was
 * given. A finger drives `:hover` and `:active`, read by the button's styles,
 * a stylesheet's rules, or a `when.*` condition through the button's marker.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {installStylesheet} from '../css';
import {jsx} from '../jsx-runtime';
import * as stylex from '../stylex-rn';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {getInternalInstanceHandleFromPublicInstance} from 'react-native/react-private-interface';

// A ref to an element, which the test calls the DOM's methods of
function elementRef(): {current: $FlowFixMe} {
  return React.createRef();
}

const styles = stylex.create({
  pressed: {
    backgroundColor: {default: '#3b40a0', ':active': '#2a2f70'},
  },
  hovered: {
    opacity: {default: 1, ':hover': 0.8},
  },
  focusedOrDisabled: {
    backgroundColor: '#fff',
    borderColor: {default: null, ':focus': '#0a84ff'},
    opacity: {default: null, ':disabled': 0.5},
  },
  plain: {
    backgroundColor: '#0a84ff',
  },
  pressedBlock: {
    backgroundColor: '#3b40a0',
    ':active': {backgroundColor: '#2a2f70'},
  },
});

// A marker whose element's press a `when.*` condition reads, as Astryx's tabs
// paint their pressed overlay, and one whose element's place only is read, as
// its steppers hide a rail
const pressedScope = stylex.defineMarker();
const placedScope = stylex.defineMarker();
stylex.create({
  overlay: {
    opacity: Object.fromEntries([
      ['default', 0],
      [stylex.when.ancestor(':active', pressedScope), 1],
    ]),
  },
  rail: {
    opacity: Object.fromEntries([
      ['default', 1],
      [stylex.when.ancestor(':first-child', placedScope), 0],
    ]),
  },
});

/**
 * The props the button's host was given: one with a label, as most are, or
 * an icon button with none, which something holds a ref to.
 */
function buttonHostProps(
  style: unknown,
  labelled: boolean,
  className?: string,
): {[string]: unknown} {
  const button = elementRef();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      jsx('button', {
        ref: button,
        className,
        ...stylex.props(style as $FlowFixMe),
        children: labelled ? 'Press and hold me' : undefined,
      }) as $FlowFixMe,
    );
  });
  const handle: $FlowFixMe = getInternalInstanceHandleFromPublicInstance(
    button.current,
  );
  const props = handle?.memoizedProps;
  if (props == null) {
    throw new Error('The button rendered no host.');
  }
  return props;
}

// Each kind of button: one with a label, which renders as a bare host node,
// and an icon button, which renders through the element component
for (const [kind, labelled] of [
  ['a labelled button', true],
  ['an icon button', false],
] as Array<[string, boolean]>) {
  describe(`${kind} whose author styles the press`, () => {
    it('claims the press when its styles answer :active', () => {
      expect(
        buttonHostProps(styles.pressed, labelled).authorStatesPressFeedback,
      ).toBe(true);
    });

    it('claims it when a block answers :active', () => {
      expect(
        buttonHostProps(styles.pressedBlock, labelled)
          .authorStatesPressFeedback,
      ).toBe(true);
    });

    it('claims it for :hover too', () => {
      // A touch reports as a hover on the way to a press, so a hover style
      // answers the finger
      expect(
        buttonHostProps(styles.hovered, labelled).authorStatesPressFeedback,
      ).toBe(true);
    });

    it('claims it when a stylesheet rule answers :active', () => {
      installStylesheet('.pressable:active { opacity: 0.5; }');
      expect(
        buttonHostProps(styles.plain, labelled, 'pressable')
          .authorStatesPressFeedback,
      ).toBe(true);
    });

    it('claims it when a condition reads its press through its marker', () => {
      expect(
        buttonHostProps(pressedScope, labelled).authorStatesPressFeedback,
      ).toBe(true);
    });

    it('does not claim it for :focus or :disabled, which no finger drives', () => {
      expect(
        buttonHostProps(styles.focusedOrDisabled, labelled)
          .authorStatesPressFeedback ?? false,
      ).toBe(false);
    });

    it('does not claim it for a marker whose element’s place is all that is read', () => {
      expect(
        buttonHostProps(placedScope, labelled).authorStatesPressFeedback ??
          false,
      ).toBe(false);
    });

    it('leaves the press to the platform when the author states none', () => {
      // With nobody answering, the platform must
      expect(
        buttonHostProps(styles.plain, labelled).authorStatesPressFeedback ??
          false,
      ).toBe(false);
    });

    it('passes the host no key of StyleX’s', () => {
      // `props()` hands the element its inputs under `__css*` keys; the host
      // gets them as the engine's props
      const keys = Object.keys(buttonHostProps(styles.pressed, labelled));
      expect(keys.filter(key => key.startsWith('__'))).toEqual([]);
      expect(keys).toContain('cssStyle');
    });
  });
}
