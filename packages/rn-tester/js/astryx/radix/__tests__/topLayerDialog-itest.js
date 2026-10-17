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

import {TopLayerHost} from '../../overlay/TopLayer';
import * as Dialog from '../dialog';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

// The rendered element a selector matches, null when none does
function query(root: $FlowFixMe, selector: string): $FlowFixMe {
  return root.document.querySelector(selector);
}

function press(root: $FlowFixMe, selector: string): void {
  Fantom.dispatchNativeEvent(query(root, selector), 'click');
}

let timers: TimerMock;

beforeEach(() => {
  timers = Fantom.installTimerMock();
});

afterEach(() => {
  timers.uninstall();
});

test('Dialog works through a real TopLayerHost', () => {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <TopLayerHost>
        <Dialog.Root>
          <Dialog.Trigger className="trig">Open</Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Content className="content">
              <Dialog.Close className="close">Dismiss</Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </TopLayerHost>,
    );
  });
  expect(query(root, '.content')).toBeNull();
  press(root, '.trig');
  expect(query(root, '.content')).not.toBeNull();
  // The presented Close lives under the HOST subtree now; its context must
  // still reach the Root's setOpen through the portal bridge.
  press(root, '.close');
  timers.advanceTimersByTime(300);
  expect(query(root, '.content')).toBeNull();
});
