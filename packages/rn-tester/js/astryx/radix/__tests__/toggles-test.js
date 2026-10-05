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
  CheckboxIndicator,
  CheckboxRoot,
  RadioGroupItem,
  RadioGroupRoot,
  SwitchRoot,
  Toggle,
  ToggleGroupItem,
  ToggleGroupRoot,
} from '../toggles';
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

function deep(r: $FlowFixMe, predicate: $FlowFixMe => boolean): $FlowFixMe {
  const all = r.root.findAll(predicate);
  return all[all.length - 1];
}

function byClass(r: $FlowFixMe, cls: string): $FlowFixMe {
  return deep(r, (n: $FlowFixMe) => n.props?.className === cls);
}

describe('Toggle', () => {
  it('flips data-state and aria-pressed', () => {
    const r = render(<Toggle className="t">B</Toggle>);
    expect(byClass(r, 't').props['data-state']).toBe('off');
    TestRenderer.act(() => byClass(r, 't').props.onClick({}));
    const on = byClass(r, 't');
    expect(on.props['data-state']).toBe('on');
    expect(on.props['aria-pressed']).toBe('true');
  });

  it('does not toggle when disabled', () => {
    const r = render(<Toggle className="t" disabled={true} />);
    TestRenderer.act(() => byClass(r, 't').props.onClick({}));
    expect(byClass(r, 't').props['data-state']).toBe('off');
  });
});

describe('ToggleGroup', () => {
  it('single type is exclusive and deselects on re-press', () => {
    const r = render(
      <ToggleGroupRoot type="single" defaultValue="a">
        <ToggleGroupItem className="a" value="a" />
        <ToggleGroupItem className="b" value="b" />
      </ToggleGroupRoot>,
    );
    expect(byClass(r, 'a').props['data-state']).toBe('on');
    TestRenderer.act(() => byClass(r, 'b').props.onClick({}));
    expect(byClass(r, 'a').props['data-state']).toBe('off');
    expect(byClass(r, 'b').props['data-state']).toBe('on');
    TestRenderer.act(() => byClass(r, 'b').props.onClick({}));
    expect(byClass(r, 'b').props['data-state']).toBe('off');
  });

  it('multiple type accumulates', () => {
    const r = render(
      <ToggleGroupRoot type="multiple">
        <ToggleGroupItem className="a" value="a" />
        <ToggleGroupItem className="b" value="b" />
      </ToggleGroupRoot>,
    );
    TestRenderer.act(() => byClass(r, 'a').props.onClick({}));
    TestRenderer.act(() => byClass(r, 'b').props.onClick({}));
    expect(byClass(r, 'a').props['data-state']).toBe('on');
    expect(byClass(r, 'b').props['data-state']).toBe('on');
  });
});

describe('Checkbox', () => {
  it('checks, unchecks, and gates the indicator', () => {
    const onCheckedChange = jest.fn();
    const r = render(
      <CheckboxRoot className="cb" onCheckedChange={onCheckedChange}>
        <CheckboxIndicator className="ind" />
      </CheckboxRoot>,
    );
    expect(byClass(r, 'cb').props['data-state']).toBe('unchecked');
    // The composite CheckboxIndicator fiber always matches; the intrinsic
    // wrapper appears only when it actually renders.
    expect(
      r.root.findAll((n: $FlowFixMe) => n.props?.className === 'ind'),
    ).toHaveLength(1);
    TestRenderer.act(() => byClass(r, 'cb').props.onClick({}));
    expect(byClass(r, 'cb').props['data-state']).toBe('checked');
    expect(byClass(r, 'cb').props['aria-checked']).toBe('true');
    expect(
      r.root.findAll((n: $FlowFixMe) => n.props?.className === 'ind').length,
    ).toBeGreaterThan(1);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe('Switch', () => {
  it('flips role=switch state', () => {
    const r = render(<SwitchRoot className="sw" />);
    expect(byClass(r, 'sw').props.role).toBe('switch');
    TestRenderer.act(() => byClass(r, 'sw').props.onClick({}));
    expect(byClass(r, 'sw').props['data-state']).toBe('checked');
  });
});

describe('RadioGroup', () => {
  it('selection is exclusive and sticky', () => {
    const r = render(
      <RadioGroupRoot defaultValue="x">
        <RadioGroupItem className="x" value="x" />
        <RadioGroupItem className="y" value="y" />
      </RadioGroupRoot>,
    );
    expect(byClass(r, 'x').props['data-state']).toBe('checked');
    TestRenderer.act(() => byClass(r, 'y').props.onClick({}));
    expect(byClass(r, 'x').props['data-state']).toBe('unchecked');
    expect(byClass(r, 'y').props['data-state']).toBe('checked');
    // Re-pressing the selected radio keeps it selected (radio semantics).
    TestRenderer.act(() => byClass(r, 'y').props.onClick({}));
    expect(byClass(r, 'y').props['data-state']).toBe('checked');
  });
});
