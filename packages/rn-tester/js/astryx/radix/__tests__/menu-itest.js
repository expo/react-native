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

import * as Menu from '../menu';
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

function App({onSelect}: $FlowFixMe): React.Node {
  return (
    <Menu.Root>
      <Menu.Trigger className="trig">Menu</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="content">
          <Menu.Item className="item" onSelect={onSelect}>
            Do it
          </Menu.Item>
          <Menu.CheckboxItem className="check" checked={true}>
            <Menu.ItemIndicator className="ind" />
            Option
          </Menu.CheckboxItem>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

let timers: TimerMock;

beforeEach(() => {
  timers = Fantom.installTimerMock();
});

afterEach(() => {
  timers.uninstall();
});

describe('DropdownMenu', () => {
  it('opens on trigger press and closes on item select', () => {
    const onSelect = jest.fn();
    const root = render(<App onSelect={onSelect} />);
    expect(query(root, '.content')).toBeNull();
    press(root, '.trig');
    expect(query(root, '.content')).not.toBeNull();
    press(root, '.item');
    expect(onSelect).toHaveBeenCalled();
    timers.advanceTimersByTime(200);
    expect(query(root, '.content')).toBeNull();
  });

  it('select preventDefault keeps the menu open', () => {
    const onSelect = jest.fn((e: $FlowFixMe) => e.preventDefault());
    const root = render(<App onSelect={onSelect} />);
    press(root, '.trig');
    press(root, '.item');
    timers.advanceTimersByTime(200);
    expect(query(root, '.content')).not.toBeNull();
  });

  it('checkbox items expose checked state and show the indicator', () => {
    const root = render(<App onSelect={jest.fn()} />);
    press(root, '.trig');
    const check = query(root, '.check');
    expect(check.getAttribute('data-state')).toBe('checked');
    expect(check.getAttribute('role')).toBe('menuitemcheckbox');
    expect(query(root, '.ind')).not.toBeNull();
  });
});
