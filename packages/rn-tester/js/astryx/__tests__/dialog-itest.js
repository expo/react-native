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

/**
 * `<dialog>` as HTML has it (§4.11.4): hidden until a method opens it,
 * `showModal()` in the top layer over its `::backdrop`, `show()` in place, and
 * a press on the backdrop a click on the dialog itself. Astryx's Dialog calls
 * the methods on its ref and closes on such a click.
 *
 * Fantom bundles for Android, where the runtime has no native top layer and a
 * modal dialog is shown where it is written, so the top layer's part is
 * rendered here as the runtime renders a modal dialog on iOS: the element in
 * a `TopLayerElement`, over a backdrop.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {jsx} from '../jsx-runtime';
import {InTopLayerContext} from '../native-css/EngineElement';
import TopLayerElement from '../overlay/TopLayerElement';
import * as stylex from '../stylex-rn';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {Dimensions} from 'react-native';
import {getInternalInstanceHandleFromPublicInstance} from 'react-native/react-private-interface';
import {jsx as reactJsx} from 'react/jsx-runtime';

// A ref to an element, which the test calls the DOM's methods of
function elementRef(): {current: $FlowFixMe} {
  return React.createRef();
}

function render(element: unknown): $FlowFixMe {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element as $FlowFixMe);
  });
  return root;
}

function isShown(element: $FlowFixMe): boolean {
  return (
    getComputedStyle(element).display !== 'none' &&
    element.getBoundingClientRect().height > 0
  );
}

// The message of what `run` throws
function errorFrom(run: () => void): string {
  try {
    run();
  } catch (e) {
    return String(e.message);
  }
  return '';
}

describe('a dialog', () => {
  let installedTimers: ?Fantom.TimerMock = null;
  afterEach(() => {
    installedTimers?.uninstall();
    installedTimers = null;
  });

  it('is hidden until showModal(), then shown with its open attribute', () => {
    const dialog = elementRef();
    render(jsx('dialog', {ref: dialog, children: 'Saved'}));
    expect(isShown(dialog.current)).toBe(false);
    expect(dialog.current.open).toBe(false);

    Fantom.runTask(() => {
      dialog.current.showModal();
    });
    expect(isShown(dialog.current)).toBe(true);
    expect(dialog.current.open).toBe(true);
    // What the user agent's `dialog:not([open])` reads
    expect(dialog.current.matches('[open]')).toBe(true);
  });

  it('matches [open] as soon as it is shown or closed', () => {
    const dialog = elementRef();
    render(jsx('dialog', {ref: dialog, children: 'Saved'}));
    const matched: Array<boolean> = [];
    Fantom.runTask(() => {
      dialog.current.showModal();
      // Before the dialog renders its new state
      matched.push(dialog.current.matches('[open]'));
    });
    Fantom.runTask(() => {
      dialog.current.close();
      matched.push(dialog.current.matches('[open]'));
    });
    expect(matched).toEqual([true, false]);
    expect(dialog.current.matches('[open]')).toBe(false);
  });

  it('closes with a return value and fires close after, as a task', () => {
    const timers = Fantom.installTimerMock();
    installedTimers = timers;
    const dialog = elementRef();
    render(jsx('dialog', {ref: dialog, children: 'Saved'}));
    const onClose = jest.fn();
    dialog.current.addEventListener('close', onClose);
    Fantom.runTask(() => {
      dialog.current.showModal();
    });
    Fantom.runTask(() => {
      dialog.current.close('saved');
    });
    expect(isShown(dialog.current)).toBe(false);
    expect(dialog.current.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(0);

    timers.runAllTimers();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog.current.returnValue).toBe('saved');
  });

  it('opens in place with show(), and will not open modally on top of that', () => {
    const dialog = elementRef();
    render(
      jsx('div', {
        children: [
          jsx('div', {style: {height: 10}}, 'above'),
          jsx('dialog', {ref: dialog, children: 'Saved'}, 'dialog'),
        ],
      }),
    );
    Fantom.runTask(() => {
      dialog.current.show();
    });
    expect(isShown(dialog.current)).toBe(true);
    // Under what is above it in the page
    expect(dialog.current.getBoundingClientRect().y).toBe(10);
    expect(errorFrom(() => dialog.current.showModal())).toMatch(
      /^InvalidStateError/,
    );
  });
});

describe('a modal dialog in the top layer', () => {
  /**
   * A modal dialog as the runtime renders one where the top layer is native:
   * in a `TopLayerElement`, under the context its elements provide.
   */
  function modalDialog({
    dialog,
    style,
    onBackdropPress,
    children = 'Saved',
  }: {
    dialog: {current: $FlowFixMe},
    style?: unknown,
    onBackdropPress?: () => void,
    children?: React.Node,
  }): React.Node {
    const props = style == null ? {} : stylex.props(style as $FlowFixMe);
    return reactJsx(InTopLayerContext.Provider, {
      value: true,
      children: reactJsx(TopLayerElement, {
        open: true,
        lightDismiss: false,
        backdrop: {backgroundColor: 'rgba(0, 0, 0, 0.1)'},
        backdropStyleId: props.__cssBackdrop ?? null,
        onBackdropPress: onBackdropPress ?? null,
        centered: true,
        instanceRef: dialog,
        children: reactJsx('dialog', {
          ref: dialog,
          cssEngine: true,
          cssStyle: props.__cssStyle ?? 0,
          cssAttributes: {open: true},
          children,
        }),
      }),
    });
  }

  // The handle's children, the backdrop and the dialog, as drawn
  function topLayerOf(root: $FlowFixMe): $FlowFixMe {
    const output = root
      .getRenderedOutput({props: ['backgroundColor']})
      .toJSON();
    expect(output.type).toBe('native-toplayer');
    return output.children;
  }

  it('is drawn over a backdrop in the html.css colour, covering the window', () => {
    const dialog = elementRef();
    const root = render(modalDialog({dialog}));
    const [backdrop, drawn] = topLayerOf(root);
    expect(backdrop.props.backgroundColor).toMatch(/^rgba\(0, 0, 0, 0\.1/);
    expect(JSON.stringify(drawn)).toContain('Saved');

    // The backdrop is the dialog's sibling as the DOM sees it, before it
    const [backdropNode] = dialog.current.parentNode.childNodes;
    const {width, height} = Dimensions.get('window');
    const rect = backdropNode.getBoundingClientRect();
    expect([rect.width, rect.height]).toEqual([width, height]);
    // The only content the accessibility tree offers
    expect(
      (
        getInternalInstanceHandleFromPublicInstance(
          dialog.current,
        ) as $FlowFixMe
      )?.memoizedProps['aria-modal'],
    ).toBe(true);
  });

  it('takes a press on its backdrop', () => {
    const dialog = elementRef();
    const onBackdropPress = jest.fn();
    render(modalDialog({dialog, onBackdropPress}));
    const [backdropNode] = dialog.current.parentNode.childNodes;
    Fantom.dispatchNativeEvent(backdropNode, 'click');
    expect(onBackdropPress).toHaveBeenCalledTimes(1);
  });

  it('draws the ::backdrop of its styles', () => {
    const styles = stylex.create({
      dialog: {'::backdrop': {backgroundColor: 'red'}},
    });
    const dialog = elementRef();
    const root = render(modalDialog({dialog, style: styles.dialog}));
    const [backdrop] = topLayerOf(root);
    // The author's backdrop, in place of the user agent's
    expect(backdrop.props.backgroundColor).toBeUndefined();
    expect(JSON.stringify(backdrop)).toContain('rgba(255, 0, 0, 1)');
  });

  it('resolves a theme token in its ::backdrop', () => {
    // As Astryx's Dialog writes its overlay colour
    const colors = stylex.defineVars({'--dialog-overlay': 'rgb(1, 2, 3)'});
    const styles = stylex.create({
      dialog: {'::backdrop': {backgroundColor: colors['--dialog-overlay']}},
    });
    const dialog = elementRef();
    const root = render(modalDialog({dialog, style: styles.dialog}));
    const [backdrop] = topLayerOf(root);
    expect(JSON.stringify(backdrop)).toContain('rgba(1, 2, 3, 1)');
  });

  it('scrolls a region in it in the block axis, which grows in the page', () => {
    const region = jsx('div', {
      style: {overflowY: 'auto', maxHeight: 100},
      children: jsx('p', {children: 'text'}),
    });
    const scrollViewsIn = (element: unknown) =>
      JSON.stringify(
        render(element).getRenderedOutput({props: []}).toJSON(),
      ).split('"ScrollView"').length - 1;
    expect(scrollViewsIn(region)).toBe(0);
    const dialog = elementRef();
    expect(scrollViewsIn(modalDialog({dialog, children: region}))).toBe(1);
  });

  it('scrolls a region that scrolls in both axes in the block axis, at its width', () => {
    // A bottom sheet's body: `overflow: auto` in both axes, sharing a column
    // of fixed height with the sheet's handle
    const region = elementRef();
    const block = elementRef();
    const dialog = elementRef();
    render(
      modalDialog({
        dialog,
        children: jsx('div', {
          // What the runtime declares on an element it draws in the top layer
          style: {
            '--astryx-in-top-layer': '1',
            display: 'flex',
            flexDirection: 'column',
            width: 300,
            height: 300,
          },
          children: jsx('div', {
            ref: region,
            style: {
              flexGrow: 1,
              minHeight: 0,
              overflowX: 'auto',
              overflowY: 'auto',
            },
            children: jsx('div', {
              ref: block,
              children: jsx('div', {style: {width: 500, height: 1000}}),
            }),
          }),
        }),
      }),
    );
    expect(region.current.getBoundingClientRect().height).toBe(300);
    // The block is as wide as the region, as the web lays it out, not as its
    // widest content; the platform's horizontal scroll view laid it out at
    // max-content and stretched it to the region's height, so the block axis,
    // where the content flows, did not scroll
    expect(block.current.getBoundingClientRect().width).toBe(300);
    const [scrollView] = region.current.childNodes;
    const [scrollContent] = scrollView.childNodes;
    expect(scrollContent.getBoundingClientRect().height).toBe(1000);
  });

  it("answers a scrolling region's offsets and sizes from its scroll view", () => {
    // What a bottom sheet reads to hand a pull to the sheet only at the top of
    // its content
    const region = elementRef();
    const dialog = elementRef();
    render(
      modalDialog({
        dialog,
        children: jsx('div', {
          style: {
            '--astryx-in-top-layer': '1',
            display: 'flex',
            flexDirection: 'column',
            height: 300,
          },
          children: jsx('div', {
            ref: region,
            style: {flexGrow: 1, minHeight: 0, overflowY: 'auto'},
            children: jsx('div', {style: {height: 1000}}),
          }),
        }),
      }),
    );
    const scrolls = jest.fn();
    region.current.addEventListener('scroll', scrolls);
    expect(region.current.scrollTop).toBe(0);
    expect(region.current.scrollHeight).toBe(1000);
    expect(region.current.clientHeight).toBe(300);

    const [scrollView] = region.current.childNodes;
    Fantom.scrollTo(scrollView, {x: 0, y: 200});
    expect(region.current.scrollTop).toBe(200);
    expect(scrolls).toHaveBeenCalledTimes(1);
    // An element that is not a scroll container answers as its box does
    expect(dialog.current.scrollTop).toBe(0);
  });
});
