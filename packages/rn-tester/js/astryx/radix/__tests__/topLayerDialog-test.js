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

import {TopLayerHost} from '../../overlay/TopLayer';
import * as Dialog from '../dialog';
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

test('Dialog works through a real TopLayerHost', () => {
  const r = render(
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
  expect(countByClass(r, 'content')).toBe(0);
  TestRenderer.act(() => byClass(r, 'trig').props.onClick({}));
  expect(countByClass(r, 'content')).toBeGreaterThan(0);
  // The presented Close lives under the HOST subtree now; its context must
  // still reach the Root's setOpen through the portal bridge.
  TestRenderer.act(() => byClass(r, 'close').props.onClick({}));
  TestRenderer.act(() => {
    jest.advanceTimersByTime(300);
  });
  expect(countByClass(r, 'content')).toBe(0);
});
