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

import * as Menu from '../menu';
import * as React from 'react';
import TestRenderer from 'react-test-renderer';

function render(element: $FlowFixMe): $FlowFixMe {
  let renderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(element);
  });
  if (renderer == null) {
    throw new Error('nothing rendered');
  }
  return renderer;
}

function byClass(r: $FlowFixMe, cls: string): $FlowFixMe {
  const all = r.root.findAll((n: $FlowFixMe) => n.props?.className === cls);
  return all[all.length - 1];
}

function countByClass(r: $FlowFixMe, cls: string): number {
  return r.root.findAll((n: $FlowFixMe) => n.props?.className === cls).length;
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

describe('DropdownMenu', () => {
  it('opens on trigger press and closes on item select', () => {
    const onSelect = jest.fn();
    const r = render(<App onSelect={onSelect} />);
    expect(countByClass(r, 'content')).toBe(0);
    TestRenderer.act(() => byClass(r, 'trig').props.onClick({}));
    expect(countByClass(r, 'content')).toBeGreaterThan(0);
    TestRenderer.act(() => byClass(r, 'item').props.onClick({}));
    expect(onSelect).toHaveBeenCalled();
    TestRenderer.act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(countByClass(r, 'content')).toBe(0);
  });

  it('select preventDefault keeps the menu open', () => {
    const onSelect = jest.fn((e: $FlowFixMe) => e.preventDefault());
    const r = render(<App onSelect={onSelect} />);
    TestRenderer.act(() => byClass(r, 'trig').props.onClick({}));
    TestRenderer.act(() => byClass(r, 'item').props.onClick({}));
    TestRenderer.act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(countByClass(r, 'content')).toBeGreaterThan(0);
  });

  it('checkbox items expose checked state and show the indicator', () => {
    const r = render(<App onSelect={jest.fn()} />);
    TestRenderer.act(() => byClass(r, 'trig').props.onClick({}));
    const check = byClass(r, 'check');
    expect(check.props['data-state']).toBe('checked');
    expect(check.props.role).toBe('menuitemcheckbox');
    expect(countByClass(r, 'ind')).toBeGreaterThan(1);
  });
});
