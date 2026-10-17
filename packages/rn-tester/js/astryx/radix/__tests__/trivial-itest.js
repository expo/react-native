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
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

function render(element: React.MixedElement): $FlowFixMe {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
  return root;
}

// The rendered elements a selector matches
function queryAll(root: $FlowFixMe, selector: string): Array<$FlowFixMe> {
  return root.document.querySelectorAll(selector);
}

function query(root: $FlowFixMe, selector: string): $FlowFixMe {
  return queryAll(root, selector)[0] ?? null;
}

describe('Slot', () => {
  it('merges props onto its child, child props winning', () => {
    const root = render(
      <Slot className="from-slot" data-x="slot">
        {jsx('div', {className: 'from-child', 'data-y': 'child'})}
      </Slot>,
    );
    const div = query(root, 'div');
    expect(div.getAttribute('class')).toBe('from-slot from-child');
    expect(div.getAttribute('data-x')).toBe('slot');
    expect(div.getAttribute('data-y')).toBe('child');
  });

  it('composes handlers: child first, then slot', () => {
    const calls: Array<string> = [];
    const root = render(
      <Slot onClick={() => calls.push('slot')}>
        {jsx('div', {onClick: () => calls.push('child')})}
      </Slot>,
    );
    Fantom.dispatchNativeEvent(query(root, 'div'), 'click');
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
    const root = render(<Harness onChange={onChange} />);
    expect(query(root, 'div').getAttribute('data-value')).toBe('a');
    Fantom.dispatchNativeEvent(query(root, 'div'), 'click');
    expect(query(root, 'div').getAttribute('data-value')).toBe('b');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('defers to the controlled prop and still reports changes', () => {
    const onChange = jest.fn();
    const root = render(<Harness prop="x" onChange={onChange} />);
    Fantom.dispatchNativeEvent(query(root, 'div'), 'click');
    expect(query(root, 'div').getAttribute('data-value')).toBe('x');
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('trivial tier', () => {
  it('Label renders a label element', () => {
    const root = render(<LabelRoot className="l">Name</LabelRoot>);
    expect(queryAll(root, 'label')).toHaveLength(1);
  });

  it('Separator carries orientation and role', () => {
    const root = render(<SeparatorRoot decorative={true} />);
    const div = query(root, 'div');
    expect(div.getAttribute('data-orientation')).toBe('horizontal');
    expect(div.getAttribute('role')).toBe('none');
  });

  it('Progress exposes state and value as data attributes', () => {
    const root = render(
      <ProgressRoot value={60}>
        <ProgressIndicator className="fill" />
      </ProgressRoot>,
    );
    const nodes = queryAll(root, 'div[data-state]');
    expect(nodes[0].getAttribute('data-state')).toBe('loading');
    expect(nodes[0].getAttribute('role')).toBe('progressbar');
    expect(nodes[1].getAttribute('data-value')).toBe('60');
    const done = render(<ProgressRoot value={100} />);
    expect(query(done, 'div').getAttribute('data-state')).toBe('complete');
  });

  it('Avatar shows the fallback until an image loads', () => {
    const root = render(
      <AvatarRoot>
        <AvatarFallback>AB</AvatarFallback>
      </AvatarRoot>,
    );
    // The root's span and the fallback's
    expect(queryAll(root, 'span')).toHaveLength(2);
  });
});
