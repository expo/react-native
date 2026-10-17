/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 * @oncall react_native
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

/**
 * `<input type="checkbox">` and `<input type="radio">` with the activation
 * behavior HTML gives them (§4.10.5.1.15–16). A text field had stood in for
 * them: a press focused it and raised the keyboard, and the box never filled,
 * and Astryx's list rows, which forward a press to their input with a click,
 * recursed until the stack overflowed, because the field matched no `input`.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {jsx} from '../jsx-runtime';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

function elementRef(): {current: $FlowFixMe} {
  return React.createRef<$FlowFixMe>();
}

function render(element: $FlowFixMe): void {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
}

// A press on the element, as the platform reports one
function press(element: $FlowFixMe): void {
  Fantom.dispatchNativeEvent(element, 'click', {});
}

describe('a checkbox', () => {
  it('is an <input> of its type', () => {
    const input = elementRef();
    render(jsx('input', {ref: input, type: 'checkbox'}));
    expect(input.current instanceof global.HTMLInputElement).toBe(true);
    expect(input.current.type).toBe('checkbox');
    expect(input.current.matches('input[type="checkbox"]')).toBe(true);
  });

  it('is checked by a press before its click listeners run, then fires input and change', () => {
    const input = elementRef();
    const events: Array<string> = [];
    render(
      jsx('input', {
        ref: input,
        type: 'checkbox',
        onClick: (event: $FlowFixMe) => {
          events.push(`click ${String(event.target.checked)}`);
        },
        onInput: (event: $FlowFixMe) => {
          events.push(`input ${String(event.target.checked)}`);
        },
        onChange: (event: $FlowFixMe) => {
          events.push(`change ${String(event.target.checked)}`);
        },
      }),
    );
    expect(input.current.checked).toBe(false);

    press(input.current);
    expect(events).toEqual(['click true', 'input true', 'change true']);
    expect(input.current.checked).toBe(true);

    press(input.current);
    expect(input.current.checked).toBe(false);
  });

  it('is toggled by click() from script', () => {
    const input = elementRef();
    const onChange = jest.fn();
    render(
      jsx('input', {
        ref: input,
        type: 'checkbox',
        defaultChecked: true,
        onChange,
      }),
    );
    Fantom.runTask(() => {
      input.current.click();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(input.current.checked).toBe(false);
  });

  it('keeps its value when a listener cancels the click', () => {
    const input = elementRef();
    const onChange = jest.fn();
    render(
      jsx('input', {
        ref: input,
        type: 'checkbox',
        onClick: (event: $FlowFixMe) => event.preventDefault(),
        onChange,
      }),
    );
    press(input.current);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.current.checked).toBe(false);
  });

  it('ignores a press while disabled', () => {
    const input = elementRef();
    const onChange = jest.fn();
    render(
      jsx('input', {ref: input, type: 'checkbox', disabled: true, onChange}),
    );
    press(input.current);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.current.checked).toBe(false);
  });

  it('shows the value its owner gives it when controlled', () => {
    const input = elementRef();
    const onChange = jest.fn();
    function Controlled() {
      const [checked, setChecked] = React.useState(false);
      return jsx('input', {
        ref: input,
        type: 'checkbox',
        checked,
        onChange: (event: $FlowFixMe) => {
          onChange(event.target.checked);
          setChecked(event.target.checked);
        },
      });
    }
    render(jsx(Controlled, {}));
    press(input.current);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(input.current.checked).toBe(true);
  });
});

describe('a radio', () => {
  it('is checked by a press and stays checked when pressed again', () => {
    const input = elementRef();
    const onChange = jest.fn();
    render(jsx('input', {ref: input, type: 'radio', onChange}));
    press(input.current);
    expect(input.current.checked).toBe(true);
    press(input.current);
    expect(input.current.checked).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("Astryx's CheckboxList", () => {
  it('toggles an item pressed on its row or on its box', () => {
    (globalThis as $FlowFixMe).Intl ??= {};
    // $FlowFixMe[cannot-resolve-module]
    const {CheckboxList, CheckboxListItem} = require('../vendor/CheckboxList');
    const page = elementRef();
    const changes: Array<Array<string>> = [];
    function Page() {
      const [value, setValue] = React.useState(['a']);
      return jsx('div', {
        ref: page,
        children: jsx(CheckboxList, {
          label: 'Sections',
          value,
          onChange: (next: Array<string>) => {
            changes.push(next);
            setValue(next);
          },
          children: [
            jsx(CheckboxListItem, {value: 'a', label: 'A'}, 'a'),
            jsx(CheckboxListItem, {value: 'b', label: 'B'}, 'b'),
          ],
        }),
      });
    }
    render(jsx(Page, {}));
    const boxes = Array.from(
      page.current.querySelectorAll('input[type="checkbox"]'),
    );
    const rows = Array.from(page.current.querySelectorAll('li'));
    expect(boxes.map(box => box.checked)).toEqual([true, false]);

    press(boxes[1]);
    expect(changes).toEqual([['a', 'b']]);
    expect(boxes.map(box => box.checked)).toEqual([true, true]);

    press(rows[0]);
    expect(changes).toEqual([['a', 'b'], ['b']]);
    expect(boxes.map(box => box.checked)).toEqual([false, true]);
  });
});
