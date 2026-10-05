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

import {TopLayerHost, useTopLayer} from '../overlay/TopLayer';
import * as React from 'react';
import {Text, View} from 'react-native';
import TestRenderer from 'react-test-renderer';

function Overlay({open, mode}: {open: boolean, mode: 'modal' | 'auto'}) {
  useTopLayer(open, mode, <Text>overlay content</Text>);
  return null;
}

function render(open: boolean, mode: 'modal' | 'auto') {
  let tree = null;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <TopLayerHost>
        <View testID="page">
          <Text>page content</Text>
        </View>
        <Overlay open={open} mode={mode} />
      </TopLayerHost>,
    );
  });
  if (tree == null) {
    throw new Error('the renderer produced nothing');
  }
  return tree;
}

/**
 * Finds the wrapper the host puts around the app content — the one that has to
 * go inert while a modal is open. It is the ancestor of the page content that
 * carries the accessibility props.
 */
function pageWrapper(tree: $FlowFixMe) {
  const page = tree.root.findByProps({testID: 'page'});
  let node = page.parent;
  while (node != null) {
    if (
      node.props != null &&
      node.props.accessibilityElementsHidden !== undefined
    ) {
      return node;
    }
    node = node.parent;
  }
  throw new Error('no wrapper carrying accessibility props was found');
}

describe('a modal traps focus by making the page inert', () => {
  it('hides the page from assistive technology while a modal is open', () => {
    const wrapper = pageWrapper(render(true, 'modal'));
    expect(wrapper.props.accessibilityElementsHidden).toBe(true);
    expect(wrapper.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('leaves the page reachable when nothing is open', () => {
    const wrapper = pageWrapper(render(false, 'modal'));
    expect(wrapper.props.accessibilityElementsHidden).toBe(false);
    expect(wrapper.props.importantForAccessibility).toBe('auto');
  });

  // A non-modal popover must NOT trap: on the web `popover="auto"` leaves the
  // page fully interactive, and trapping there would strand a screen-reader
  // user inside a tooltip.
  it('does not trap for a non-modal popover', () => {
    const wrapper = pageWrapper(render(true, 'auto'));
    expect(wrapper.props.accessibilityElementsHidden).toBe(false);
  });

  it('releases the page again when the modal closes', () => {
    const tree = render(true, 'modal');
    expect(pageWrapper(tree).props.accessibilityElementsHidden).toBe(true);

    TestRenderer.act(() => {
      tree.update(
        <TopLayerHost>
          <View testID="page">
            <Text>page content</Text>
          </View>
          <Overlay open={false} mode="modal" />
        </TopLayerHost>,
      );
    });

    expect(pageWrapper(tree).props.accessibilityElementsHidden).toBe(false);
  });
});
