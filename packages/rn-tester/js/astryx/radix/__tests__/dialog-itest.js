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

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../../document-shim';
import '../../dom-compat';

import type {TimerMock} from '@react-native/fantom';

import * as Dialog from '../dialog';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

function render(element: React.MixedElement): $FlowFixMe {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
  return root;
}

// The rendered element a selector matches, null when none does
function query(root: $FlowFixMe, selector: string): $FlowFixMe {
  return root.document.querySelector(selector);
}

function press(root: $FlowFixMe, selector: string): void {
  Fantom.dispatchNativeEvent(query(root, selector), 'click');
}

function App({defaultOpen = false}: {defaultOpen?: boolean}): React.Node {
  return (
    <Dialog.Root defaultOpen={defaultOpen}>
      <Dialog.Trigger className="trigger">Open</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="content">
          <Dialog.Title>Hello</Dialog.Title>
          <Dialog.Description>World</Dialog.Description>
          <Dialog.Close className="close">Dismiss</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

let timers: TimerMock;

beforeEach(() => {
  timers = Fantom.installTimerMock();
});

afterEach(() => {
  timers.uninstall();
});

describe('Dialog', () => {
  it('is closed until the trigger opens it', () => {
    const root = render(<App />);
    expect(query(root, '.content')).toBeNull();
    expect(query(root, '.trigger').getAttribute('data-state')).toBe('closed');
    press(root, '.trigger');
    expect(query(root, '.content')).not.toBeNull();
    expect(query(root, '.trigger').getAttribute('data-state')).toBe('open');
  });

  it('Close dismisses after the exit window', () => {
    const root = render(<App defaultOpen={true} />);
    expect(query(root, '.content')).not.toBeNull();
    press(root, '.close');
    // Presence holds the subtree through the (synthesized) exit window…
    expect(query(root, '.content')).not.toBeNull();
    timers.advanceTimersByTime(200);
    // …then unmounts it
    expect(query(root, '.content')).toBeNull();
  });

  it('outside press dismisses through the cancelable callback', () => {
    const onPointerDownOutside = jest.fn((e: $FlowFixMe) => e.preventDefault());
    const root = render(
      <Dialog.Root defaultOpen={true}>
        <Dialog.Portal>
          <Dialog.Content
            className="content"
            onPointerDownOutside={onPointerDownOutside}
          />
        </Dialog.Portal>
      </Dialog.Root>,
    );
    // The DismissableLayer's backdrop: the absolutely positioned element that
    // takes the presses outside the content
    const backdrop = root.document
      .querySelectorAll('div')
      .find(
        (element: $FlowFixMe) =>
          window.getComputedStyle(element).position === 'absolute' &&
          Fantom.getDefinedEventHandlers(element).includes('onPointerDown'),
      );
    expect(backdrop).not.toBeUndefined();
    Fantom.dispatchNativeEvent(backdrop, 'pointerDown');
    // preventDefault() cancelled the dismissal
    expect(onPointerDownOutside).toHaveBeenCalled();
    expect(query(root, '.content')).not.toBeNull();
  });
});
