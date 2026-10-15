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

import '../dom-compat';

import {installStylesheet, resetStylesheets} from '../css';
import {jsx} from '../jsx-runtime';
import {StyleSheet} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';
import TestRenderer from 'react-test-renderer';

/**
 * HTML's user-agent rules hide `[hidden]` and a popover until it is shown
 * (§15.3.1), under every author style, and the popover methods show and hide
 * it (§6.12.2). Astryx's menus, tooltips and selectors are popovers; without
 * this every closed one laid out in the page.
 */
describe('hidden elements and popovers', () => {
  const mounted: Array<$FlowFixMe> = [];
  afterEach(() => {
    TestRenderer.act(() => {
      for (const renderer of mounted.splice(0)) {
        renderer.unmount();
      }
    });
    resetStylesheets();
    jest.useRealTimers();
  });

  function render(element: unknown): {
    renderer: $FlowFixMe,
    node: {dispatchEvent: JestMockFn<$FlowFixMe, unknown>},
  } {
    const node = {dispatchEvent: jest.fn()};
    let renderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(element as $FlowFixMe, {
        createNodeMock: () => node,
      });
    });
    mounted.push(renderer);
    return {renderer, node};
  }

  function displayOf(renderer: $FlowFixMe, testID: string): unknown {
    const host = renderer.root.findAll(
      (n: $FlowFixMe) =>
        typeof n.type === 'string' && n.props.testID === testID,
    )[0];
    return StyleSheet.flatten(host.props.style)?.display;
  }

  it('renders [hidden] as display: none, but not hidden=until-found', () => {
    const {renderer} = render(
      jsx('div', {
        children: [
          jsx('div', {hidden: true, testID: 'hidden'}, 'a'),
          jsx('div', {hidden: 'until-found', testID: 'found'}, 'b'),
          jsx('div', {testID: 'shown'}, 'c'),
        ],
      }),
    );
    expect(displayOf(renderer, 'hidden')).toBe('none');
    expect(displayOf(renderer, 'found')).not.toBe('none');
    expect(displayOf(renderer, 'shown')).not.toBe('none');
  });

  it('lets an author display beat the user agent, as on the web', () => {
    const {renderer} = render(
      jsx('div', {popover: 'manual', style: {display: 'flex'}, testID: 'p'}),
    );
    expect(displayOf(renderer, 'p')).toBe('flex');
  });

  it('draws a shown popover in the top layer, and an outside press hides an auto one', () => {
    jest.useFakeTimers();
    const {renderer, node} = render(jsx('div', {popover: 'auto', testID: 'p'}));
    const layer = () =>
      renderer.root.findAll((n: $FlowFixMe) => n.type === 'native-toplayer')[0];
    const prototype: $FlowFixMe = ReactNativeElement.prototype;
    // The handle is there while the popover is closed, so showing it does not
    // remount the element
    expect(layer().props.active).toBe(false);
    TestRenderer.act(() => {
      prototype.showPopover.call(node);
    });
    expect(layer().props.active).toBe(true);
    const host = renderer.root.findAll(
      (n: $FlowFixMe) => typeof n.type === 'string' && n.props.testID === 'p',
    )[0];
    expect(StyleSheet.flatten(host.props.style)?.position).toBe('absolute');

    (node as $FlowFixMe).hidePopover = () => prototype.hidePopover.call(node);
    TestRenderer.act(() => {
      layer().props.onOutsidePress({nativeEvent: {x: 5, y: 5}});
      jest.runAllTimers();
    });
    expect(layer().props.active).toBe(false);
    expect(displayOf(renderer, 'p')).toBe('none');
  });

  it('leaves a manual popover up on an outside press', () => {
    jest.useFakeTimers();
    const {renderer, node} = render(
      jsx('div', {popover: 'manual', testID: 'p'}),
    );
    const layer = () =>
      renderer.root.findAll((n: $FlowFixMe) => n.type === 'native-toplayer')[0];
    const prototype: $FlowFixMe = ReactNativeElement.prototype;
    TestRenderer.act(() => {
      prototype.showPopover.call(node);
    });
    (node as $FlowFixMe).hidePopover = () => prototype.hidePopover.call(node);
    TestRenderer.act(() => {
      layer().props.onOutsidePress({nativeEvent: {x: 5, y: 5}});
      jest.runAllTimers();
    });
    expect(layer().props.active).toBe(true);
  });

  it('hides a popover until showPopover(), then matches :popover-open', () => {
    jest.useFakeTimers();
    installStylesheet('.menu:popover-open { opacity: 0.5; }');
    const {renderer, node} = render(
      jsx('div', {popover: 'auto', className: 'menu', testID: 'p'}),
    );
    expect(displayOf(renderer, 'p')).toBe('none');

    const prototype: $FlowFixMe = ReactNativeElement.prototype;
    TestRenderer.act(() => {
      prototype.showPopover.call(node);
      // Before React renders the element with its new state
      expect(prototype.matches.call(node, ':popover-open')).toBe(true);
    });
    expect(displayOf(renderer, 'p')).not.toBe('none');
    const host = renderer.root.findAll(
      (n: $FlowFixMe) => typeof n.type === 'string' && n.props.testID === 'p',
    )[0];
    expect(StyleSheet.flatten(host.props.style)?.opacity).toBe(0.5);

    // `beforetoggle` comes first, synchronously; `toggle` after, as a task
    const typesOf = () =>
      node.dispatchEvent.mock.calls.map(([event]) => event.type);
    expect(typesOf()).toEqual(['beforetoggle']);
    jest.runAllTimers();
    expect(typesOf()).toEqual(['beforetoggle', 'toggle']);
    const event = node.dispatchEvent.mock.calls[1][0];
    expect([event.type, event.oldState, event.newState]).toEqual([
      'toggle',
      'closed',
      'open',
    ]);

    TestRenderer.act(() => {
      expect(prototype.togglePopover.call(node)).toBe(false);
    });
    expect(displayOf(renderer, 'p')).toBe('none');
  });

  it('refuses to show an element that is not a popover', () => {
    const {node} = render(jsx('div', {testID: 'p'}));
    const prototype: $FlowFixMe = ReactNativeElement.prototype;
    expect(() => prototype.showPopover.call(node)).toThrow('NotSupportedError');
  });

  it('lets beforetoggle cancel a show, fires one toggle per task, and takes force only as a boolean', () => {
    jest.useFakeTimers();
    const {renderer, node} = render(
      jsx('div', {popover: 'manual', testID: 'p'}),
    );
    const prototype: $FlowFixMe = ReactNativeElement.prototype;
    node.dispatchEvent.mockImplementation((event: $FlowFixMe) => {
      if (event.type === 'beforetoggle') {
        event.preventDefault();
      }
    });
    TestRenderer.act(() => {
      prototype.showPopover.call(node);
    });
    expect(displayOf(renderer, 'p')).toBe('none');

    node.dispatchEvent.mockReset();
    TestRenderer.act(() => {
      prototype.showPopover.call(node);
      prototype.hidePopover.call(node);
      prototype.showPopover.call(node);
    });
    jest.runAllTimers();
    const toggles = node.dispatchEvent.mock.calls
      .map(([event]) => event)
      .filter(event => event.type === 'toggle');
    expect(toggles.map(e => [e.oldState, e.newState])).toEqual([
      ['closed', 'open'],
    ]);

    TestRenderer.act(() => {
      expect(prototype.togglePopover.call(node, {force: undefined})).toBe(
        false,
      );
    });
    expect(displayOf(renderer, 'p')).toBe('none');
  });
});
