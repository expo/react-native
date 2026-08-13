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

import {jsx} from '../../jsx-runtime';
import {useControllableState} from '../internals';
import {Slot} from '../slot';
import {
  AvatarFallback,
  AvatarRoot,
  LabelRoot,
  ProgressIndicator,
  ProgressRoot,
  SeparatorRoot,
} from '../trivial';
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

describe('Slot', () => {
  it('merges props onto its child, child props winning', () => {
    const r = render(
      <Slot className="from-slot" data-x="slot">
        {jsx('div', {className: 'from-child', 'data-y': 'child'})}
      </Slot>,
    );
    // The intrinsic wrapper consumes className for the stylesheet engine, so
    // the merge is asserted on the wrapper's received props.
    const merged = r.root.findAll(
      (n: $FlowFixMe) => n.props.className === 'from-slot from-child',
    );
    expect(merged.length).toBeGreaterThan(0);
    const div = r.root.findAll((n: $FlowFixMe) => n.type === 'div')[0];
    expect(div.props['data-x']).toBe('slot');
    expect(div.props['data-y']).toBe('child');
  });

  it('composes handlers: child first, then slot', () => {
    const calls: Array<string> = [];
    const r = render(
      <Slot onClick={() => calls.push('slot')}>
        {jsx('div', {onClick: () => calls.push('child')})}
      </Slot>,
    );
    const div = r.root.findAll((n: $FlowFixMe) => n.type === 'div')[0];
    div.props.onClick({});
    expect(calls).toEqual(['child', 'slot']);
  });
});

describe('useControllableState', () => {
  function Harness({prop, onChange}: $FlowFixMe): React.Node {
    const [value, setValue] = useControllableState({
      prop,
      defaultProp: 'a',
      onChange,
    });
    return jsx('div', {'data-value': value, onClick: () => setValue('b')});
  }

  it('runs uncontrolled from defaultProp', () => {
    const onChange = jest.fn();
    const r = render(<Harness onChange={onChange} />);
    const div = () => r.root.findAll((n: $FlowFixMe) => n.type === 'div')[0];
    expect(div().props['data-value']).toBe('a');
    TestRenderer.act(() => div().props.onClick());
    expect(div().props['data-value']).toBe('b');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('defers to the controlled prop and still reports changes', () => {
    const onChange = jest.fn();
    const r = render(<Harness prop="x" onChange={onChange} />);
    const div = () => r.root.findAll((n: $FlowFixMe) => n.type === 'div')[0];
    TestRenderer.act(() => div().props.onClick());
    expect(div().props['data-value']).toBe('x');
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('trivial tier', () => {
  it('Label renders a label element', () => {
    const r = render(<LabelRoot className="l">Name</LabelRoot>);
    expect(r.root.findAll((n: $FlowFixMe) => n.type === 'label')).toHaveLength(
      1,
    );
  });

  it('Separator carries orientation and role', () => {
    const r = render(<SeparatorRoot decorative={true} />);
    const div = r.root.findAll((n: $FlowFixMe) => n.type === 'div')[0];
    expect(div.props['data-orientation']).toBe('horizontal');
    expect(div.props.role).toBe('none');
  });

  it('Progress exposes state and value as data attributes', () => {
    const r = render(
      <ProgressRoot value={60}>
        <ProgressIndicator className="fill" />
      </ProgressRoot>,
    );
    const nodes = r.root.findAll(
      (n: $FlowFixMe) => n.type === 'div' && n.props['data-state'] != null,
    );
    expect(nodes[0].props['data-state']).toBe('loading');
    expect(nodes[0].props.role).toBe('progressbar');
    expect(nodes[1].props['data-value']).toBe(60);
    const done = render(<ProgressRoot value={100} />);
    expect(
      done.root.findAll((n: $FlowFixMe) => n.type === 'div')[0].props[
        'data-state'
      ],
    ).toBe('complete');
  });

  it('Avatar shows the fallback until an image loads', () => {
    const r = render(
      <AvatarRoot>
        <AvatarFallback>AB</AvatarFallback>
      </AvatarRoot>,
    );
    const spans = r.root.findAll((n: $FlowFixMe) => n.type === 'span');
    expect(spans.length).toBeGreaterThan(0);
  });
});
