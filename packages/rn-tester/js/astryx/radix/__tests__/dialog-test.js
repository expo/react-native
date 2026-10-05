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

function findByClass(r: $FlowFixMe, cls: string): Array<$FlowFixMe> {
  return r.root.findAll((n: $FlowFixMe) => n.props?.className === cls);
}

// The DEEPEST match: className appears on the composite part and again on
// the intrinsic wrapper, which is where the merged props (data-state,
// composed onClick) live.
function deepByClass(r: $FlowFixMe, cls: string): $FlowFixMe {
  const all = findByClass(r, cls);
  return all[all.length - 1];
}

describe('Dialog', () => {
  it('is closed until the trigger opens it', () => {
    const r = render(<App />);
    expect(findByClass(r, 'content')).toHaveLength(0);
    const trigger = deepByClass(r, 'trigger');
    expect(trigger.props['data-state']).toBe('closed');
    TestRenderer.act(() => trigger.props.onClick({}));
    expect(findByClass(r, 'content').length).toBeGreaterThan(0);
    expect(deepByClass(r, 'trigger').props['data-state']).toBe('open');
  });

  it('Close dismisses after the exit window', () => {
    const r = render(<App defaultOpen={true} />);
    expect(findByClass(r, 'content').length).toBeGreaterThan(0);
    const close = deepByClass(r, 'close');
    TestRenderer.act(() => close.props.onClick({}));
    // Presence holds the subtree through the (synthesized) exit window…
    expect(findByClass(r, 'content').length).toBeGreaterThan(0);
    TestRenderer.act(() => {
      jest.advanceTimersByTime(200);
    });
    // …then unmounts it.
    expect(findByClass(r, 'content')).toHaveLength(0);
  });

  it('outside press dismisses through the cancelable callback', () => {
    const onPointerDownOutside = jest.fn((e: $FlowFixMe) => e.preventDefault());
    const r = render(
      <Dialog.Root defaultOpen={true}>
        <Dialog.Portal>
          <Dialog.Content
            className="content"
            onPointerDownOutside={onPointerDownOutside}
          />
        </Dialog.Portal>
      </Dialog.Root>,
    );
    // The DismissableLayer's backdrop is the absolutely-filled div.
    const backdrop = r.root.findAll(
      (n: $FlowFixMe) =>
        n.type === 'div' &&
        n.props.style?.position === 'absolute' &&
        n.props.onPointerDown != null,
    )[0];
    TestRenderer.act(() => backdrop.props.onPointerDown({}));
    // preventDefault() cancelled the dismissal.
    expect(onPointerDownOutside).toHaveBeenCalled();
    expect(findByClass(r, 'content').length).toBeGreaterThan(0);
  });
});
