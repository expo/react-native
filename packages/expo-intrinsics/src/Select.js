/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {LabelableProps} from './Label';

import {useFormControl} from './FormContext';
import {useControlLabel} from './Label';
import * as React from 'react';

/**
 * `<select>`, as HTML actually writes it — with `<option>` children.
 *
 * This is the element that has to be a component rather than a box. A native
 * `<select>` is not a container that lays its children out: it is a control
 * that is *handed* a list and presents it in a menu the app does not draw.
 * There is nothing for child shadow nodes to lay out, and mounting them would
 * make views that are never on screen. So the children are read here and passed
 * down as one prop, and the host element below draws the control.
 *
 * The reconciler is what routes the tag here — see `registerFrameworkComponent`
 * and the resolver seam it installs. Doing it there rather than in a JSX
 * transform is what makes `React.createElement('select', …)` and a cloned
 * element behave the same as JSX.
 *
 * `<option>` itself is never mounted, which is why it needs no view config and
 * no native counterpart: it exists to be read.
 */

type OptionDescriptor = {
  value: string,
  label: string,
  disabled: boolean,
};

/**
 * Flattens `<option>` and `<optgroup>` children into the list the control
 * takes.
 *
 * `<optgroup>` is descended into rather than represented: neither platform's
 * control draws group headers in a way that survives being handed a flat list,
 * so its options are kept and its grouping is dropped. Losing the heading is
 * better than losing the options.
 */
export function collectOptions(children: React.Node): Array<OptionDescriptor> {
  const options: Array<OptionDescriptor> = [];

  React.Children.forEach(children, child => {
    if (child == null || typeof child !== 'object') {
      return;
    }
    // Read structurally rather than typed: these are elements of tags Flow has
    // no component type for, and the shape is checked field by field below.
    const element: $FlowFixMe = child;
    const type = element.type;
    const props: {[string]: $FlowFixMe} = element.props ?? {};

    if (type === 'optgroup') {
      options.push(...collectOptions(props.children));
      return;
    }
    if (type !== 'option') {
      return;
    }

    // An `<option>`'s text is its children, the way HTML writes it. Anything
    // that is not a string is ignored rather than coerced: a nested element in
    // an option has no meaning to a platform menu, which takes a plain string.
    const text = React.Children.toArray<$FlowFixMe>(props.children)
      .filter(node => typeof node === 'string' || typeof node === 'number')
      .join('');

    const label =
      typeof props.label === 'string' && props.label !== ''
        ? props.label
        : text;
    // HTML's rule: an `<option>` with no `value` takes its text as its value.
    const value = typeof props.value === 'string' ? props.value : label;

    options.push({value, label, disabled: props.disabled === true});
  });

  return options;
}

type SelectProps = {
  ...LabelableProps,
  children?: React.Node,
  name?: string,
  value?: string,
  defaultValue?: string,
  onChange?: (event: $FlowFixMe) => unknown,
  ...
};

function Select({
  children,
  name = '',
  onChange,
  ...rest
}: SelectProps): React.Node {
  // See Input.js: a control's accessible name comes from its <label>.
  const accessibilityLabel = useControlLabel(rest.accessibilityLabel, rest.id);
  const options = React.useMemo(() => collectOptions(children), [children]);

  /*
   * What this select would submit. Tracked here rather than read from props so
   * an *uncontrolled* select submits correctly, and seeded to what the control
   * itself would show: a select with no matching value selects its first
   * option, so that is what an untouched one submits — as in a browser.
   */
  const initial = rest.value ?? rest.defaultValue ?? options[0]?.value ?? '';
  const latest = React.useRef<string>(initial);
  // See Input.js: a reset has to reach the control, not just this memory.
  const [resetToken, setResetToken] = React.useState(0);
  if (rest.value != null) {
    latest.current = rest.value;
  }

  const isControlled = rest.value != null;

  useFormControl({
    name,
    getValue: () => latest.current,
    reset: () => {
      if (isControlled) {
        return;
      }
      latest.current = initial;
      setResetToken(token => token + 1);
    },
  });

  const handleChange = React.useCallback(
    (event: $FlowFixMe) => {
      if (event?.nativeEvent?.value !== undefined) {
        latest.current = event.nativeEvent.value;
      }
      onChange?.(event);
    },
    [onChange],
  );

  // `defaultValue` selects an option once, without making the element
  // controlled — the same split as `<input>`. The control already falls back to
  // the first option when nothing matches, which is what a browser shows for an
  // untouched `<select>`.
  const {defaultValue, value, ...forwarded} = rest;

  return (
    /* See Input.js: the key is on a fragment so a reset still recreates the
       native view without placing a `key` beside a props spread. */
    <React.Fragment key={resetToken}>
      {/* $FlowFixMe[prop-missing] intrinsic */}
      <element-select
        {...forwarded}
        accessibilityLabel={accessibilityLabel}
        // Stated here because the host element is registered as `element-select`
        // and `recordNodeName` would record that. This component is the only
        // place that knows the DOM name is `select`.
        nodeName="select"
        name={name}
        onChange={handleChange}
        options={options}
        value={value !== undefined ? value : defaultValue}
      />
    </React.Fragment>
  );
}

export default Select;
