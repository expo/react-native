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

function state(root: $FlowFixMe, selector: string): ?string {
  return query(root, selector).getAttribute('data-state');
}

describe('Toggle', () => {
  it('flips data-state and aria-pressed', () => {
    const root = render(<Toggle className="t">B</Toggle>);
    expect(state(root, '.t')).toBe('off');
    press(root, '.t');
    expect(state(root, '.t')).toBe('on');
    expect(query(root, '.t').getAttribute('aria-pressed')).toBe('true');
  });

  it('does not toggle when disabled', () => {
    const root = render(<Toggle className="t" disabled={true} />);
    press(root, '.t');
    expect(state(root, '.t')).toBe('off');
  });
});

describe('ToggleGroup', () => {
  it('single type is exclusive and deselects on re-press', () => {
    const root = render(
      <ToggleGroupRoot type="single" defaultValue="a">
        <ToggleGroupItem className="a" value="a" />
        <ToggleGroupItem className="b" value="b" />
      </ToggleGroupRoot>,
    );
    expect(state(root, '.a')).toBe('on');
    press(root, '.b');
    expect(state(root, '.a')).toBe('off');
    expect(state(root, '.b')).toBe('on');
    press(root, '.b');
    expect(state(root, '.b')).toBe('off');
  });

  it('multiple type accumulates', () => {
    const root = render(
      <ToggleGroupRoot type="multiple">
        <ToggleGroupItem className="a" value="a" />
        <ToggleGroupItem className="b" value="b" />
      </ToggleGroupRoot>,
    );
    press(root, '.a');
    press(root, '.b');
    expect(state(root, '.a')).toBe('on');
    expect(state(root, '.b')).toBe('on');
  });
});

describe('Checkbox', () => {
  it('checks, unchecks, and gates the indicator', () => {
    const onCheckedChange = jest.fn();
    const root = render(
      <CheckboxRoot className="cb" onCheckedChange={onCheckedChange}>
        <CheckboxIndicator className="ind" />
      </CheckboxRoot>,
    );
    expect(state(root, '.cb')).toBe('unchecked');
    // The indicator renders only when checked
    expect(query(root, '.ind')).toBeNull();
    press(root, '.cb');
    expect(state(root, '.cb')).toBe('checked');
    expect(query(root, '.cb').getAttribute('aria-checked')).toBe('true');
    expect(query(root, '.ind')).not.toBeNull();
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe('Switch', () => {
  it('flips role=switch state', () => {
    const root = render(<SwitchRoot className="sw" />);
    expect(query(root, '.sw').getAttribute('role')).toBe('switch');
    press(root, '.sw');
    expect(state(root, '.sw')).toBe('checked');
  });
});

describe('RadioGroup', () => {
  it('selection is exclusive and sticky', () => {
    const root = render(
      <RadioGroupRoot defaultValue="x">
        <RadioGroupItem className="x" value="x" />
        <RadioGroupItem className="y" value="y" />
      </RadioGroupRoot>,
    );
    expect(state(root, '.x')).toBe('checked');
    press(root, '.y');
    expect(state(root, '.x')).toBe('unchecked');
    expect(state(root, '.y')).toBe('checked');
    // Re-pressing the selected radio keeps it selected (radio semantics)
    press(root, '.y');
    expect(state(root, '.y')).toBe('checked');
  });
});
