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

import {jsx} from '../jsx-runtime';
import {placeInTopLayer} from '../overlay/topLayerPlacement';
import * as stylex from '../stylex-rn';
import {Dimensions, StyleSheet} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';
import TestRenderer from 'react-test-renderer';

/**
 * `<dialog>` as HTML has it (§4.11.4): hidden until a method opens it,
 * `showModal()` in the top layer over its `::backdrop`, `show()` in place, and
 * a press on the backdrop a click on the dialog itself. Astryx's Dialog calls
 * the methods on its ref and closes on such a click.
 */
describe('dialogs', () => {
  const mounted: Array<$FlowFixMe> = [];
  const prototype: $FlowFixMe = ReactNativeElement.prototype;
  afterEach(() => {
    TestRenderer.act(() => {
      for (const renderer of mounted.splice(0)) {
        renderer.unmount();
      }
    });
    jest.useRealTimers();
  });

  function render(element: unknown): {renderer: $FlowFixMe, node: $FlowFixMe} {
    const node: $FlowFixMe = {dispatchEvent: jest.fn()};
    let renderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(element as $FlowFixMe, {
        createNodeMock: () => node,
      });
    });
    mounted.push(renderer);
    return {renderer, node};
  }

  const hostOf = (renderer: $FlowFixMe) =>
    renderer.root.findAll(
      (n: $FlowFixMe) => typeof n.type === 'string' && n.props.testID === 'd',
    )[0];
  const layerOf = (renderer: $FlowFixMe) =>
    renderer.root.findAll((n: $FlowFixMe) => n.type === 'native-toplayer')[0];

  it('is hidden until showModal(), then drawn in the top layer over a backdrop', () => {
    const {renderer, node} = render(jsx('dialog', {testID: 'd'}));
    expect(StyleSheet.flatten(hostOf(renderer).props.style)?.display).toBe(
      'none',
    );
    expect(layerOf(renderer).props.active).toBe(false);
    expect(prototype.open ?? false).toBe(false);

    TestRenderer.act(() => {
      prototype.showModal.call(node);
    });
    expect(layerOf(renderer).props.active).toBe(true);
    expect(StyleSheet.flatten(hostOf(renderer).props.style)?.display).not.toBe(
      'none',
    );
    expect(hostOf(renderer).props['aria-modal']).toBe(true);
    // The backdrop: the html.css colour, under the dialog
    const backdrop = renderer.root.findAll(
      (n: $FlowFixMe) =>
        typeof n.props.onPress === 'function' &&
        StyleSheet.flatten(n.props.style)?.backgroundColor ===
          'rgba(0, 0, 0, 0.1)',
    );
    expect(backdrop.length).toBeGreaterThan(0);
  });

  it('scrolls a region inside it in the block axis, which grows in the page', () => {
    const region = (testID: string) =>
      jsx('div', {
        testID,
        style: {overflowY: 'auto', maxHeight: 100},
        children: jsx('p', {children: 'text'}),
      });
    const {renderer} = render(
      jsx('div', {
        children: [
          region('in-page'),
          jsx('dialog', {testID: 'd', children: region('in-dialog')}, 'd'),
        ],
      }),
    );
    const scrollViewAround = (testID: string) =>
      renderer.root.findAll(
        (n: $FlowFixMe) =>
          n.props.horizontal === false &&
          n.findAll((m: $FlowFixMe) => m.props.testID === testID).length > 0,
      );
    expect(scrollViewAround('in-dialog').length).toBeGreaterThan(0);
    expect(scrollViewAround('in-page').length).toBe(0);
  });

  it('takes a press on its backdrop as a click on the dialog itself', () => {
    const onClick = jest.fn();
    const {renderer, node} = render(jsx('dialog', {testID: 'd', onClick}));
    TestRenderer.act(() => {
      prototype.showModal.call(node);
    });
    const backdrop = renderer.root.findAll(
      (n: $FlowFixMe) =>
        typeof n.props.onPress === 'function' &&
        StyleSheet.flatten(n.props.style)?.position === 'absolute',
    )[0];
    TestRenderer.act(() => {
      backdrop.props.onPress();
    });
    expect(onClick).toHaveBeenCalledTimes(1);
    const event = onClick.mock.calls[0][0];
    expect(event.target).toBe(node);
    expect(event.currentTarget).toBe(node);
  });

  it('closes with a return value and fires close after, as a task', () => {
    jest.useFakeTimers();
    const {renderer, node} = render(jsx('dialog', {testID: 'd'}));
    TestRenderer.act(() => {
      prototype.showModal.call(node);
    });
    TestRenderer.act(() => {
      prototype.close.call(node, 'saved');
    });
    expect(layerOf(renderer).props.active).toBe(false);
    expect(StyleSheet.flatten(hostOf(renderer).props.style)?.display).toBe(
      'none',
    );
    const closeEvents = () =>
      node.dispatchEvent.mock.calls.filter(
        ([event]: [$FlowFixMe]) => event.type === 'close',
      ).length;
    expect(closeEvents()).toBe(0);
    jest.runAllTimers();
    expect(closeEvents()).toBe(1);
    expect(
      Object.getOwnPropertyDescriptor(prototype, 'returnValue')?.get?.call(
        node,
      ),
    ).toBe('saved');
  });

  it('opens in place with show(), and will not open modally on top of that', () => {
    const {renderer, node} = render(jsx('dialog', {testID: 'd'}));
    TestRenderer.act(() => {
      prototype.show.call(node);
    });
    expect(layerOf(renderer).props.active).toBe(false);
    expect(StyleSheet.flatten(hostOf(renderer).props.style)?.display).not.toBe(
      'none',
    );
    expect(() => prototype.showModal.call(node)).toThrow(/InvalidStateError/);
  });

  it('resolves the ::backdrop of its styles', () => {
    const styles = stylex.create({
      dialog: {'::backdrop': {backgroundColor: 'red'}},
    });
    expect(stylex.props(styles.dialog).__stylexBackdrop).toEqual({
      backgroundColor: 'red',
    });
  });

  it('resolves its backdrop’s var()s in its own scope', () => {
    const styles = stylex.create({
      dialog: {
        '--overlay': 'rgba(1, 2, 3, 0.5)',
        '::backdrop': {backgroundColor: 'var(--overlay)'},
      },
    });
    const {renderer, node} = render(
      jsx('dialog', {...stylex.props(styles.dialog), testID: 'd'}),
    );
    TestRenderer.act(() => {
      prototype.showModal.call(node);
    });
    const backdrop = renderer.root.findAll(
      (n: $FlowFixMe) =>
        typeof n.props.onPress === 'function' &&
        StyleSheet.flatten(n.props.style)?.position === 'absolute',
    )[0];
    expect(StyleSheet.flatten(backdrop.props.style)?.backgroundColor).toBe(
      'rgba(1, 2, 3, 0.5)',
    );
  });

  it('takes a fixed element’s percentages against the viewport', () => {
    const {width} = Dimensions.get('window');
    const styles = stylex.create({
      dialog: {position: 'fixed', maxWidth: 'min(100%, calc(100vw - 32px))'},
    });
    const {renderer} = render(
      jsx('div', {...stylex.props(styles.dialog), testID: 'd'}),
    );
    expect(StyleSheet.flatten(hostOf(renderer).props.style)?.maxWidth).toBe(
      width - 32,
    );
  });

  it('is centred in the viewport by its inset: 0 and margin: auto', () => {
    expect(
      placeInTopLayer({
        style: {margin: 'auto'},
        size: {width: 300, height: 200},
        anchor: null,
        viewport: {width: 400, height: 800},
        defaultInset: 0,
      }),
    ).toEqual({x: 50, y: 300});
  });
});
