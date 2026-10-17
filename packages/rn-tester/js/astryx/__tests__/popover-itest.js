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
 * HTML's user-agent rules hide `[hidden]` and a popover until it is shown
 * (§15.3.1), under every author style, and the popover methods show and hide
 * it (§6.12.2). Astryx's menus, tooltips and selectors are popovers; without
 * this every closed one laid out in the page.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {installStylesheet} from '../css';
import {jsx} from '../jsx-runtime';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

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

// The toggle events an element fires, as [type, oldState, newState]
function recordToggles(element: $FlowFixMe): Array<[string, string, string]> {
  const events: Array<[string, string, string]> = [];
  for (const type of ['beforetoggle', 'toggle']) {
    element.addEventListener(type, (event: $FlowFixMe) => {
      events.push([event.type, event.oldState, event.newState]);
    });
  }
  return events;
}

describe('hidden elements and popovers', () => {
  let installedTimers: ?Fantom.TimerMock = null;
  afterEach(() => {
    installedTimers?.uninstall();
    installedTimers = null;
  });

  it('renders [hidden] as display: none, but not hidden=until-found', () => {
    const hidden = elementRef();
    const found = elementRef();
    const shown = elementRef();
    render(
      jsx('div', {
        children: [
          jsx('div', {ref: hidden, hidden: true, children: 'a'}, 'a'),
          jsx('div', {ref: found, hidden: 'until-found', children: 'b'}, 'b'),
          jsx('div', {ref: shown, children: 'c'}, 'c'),
        ],
      }),
    );
    expect(getComputedStyle(hidden.current).display).toBe('none');
    expect(isShown(hidden.current)).toBe(false);
    expect(isShown(found.current)).toBe(true);
    expect(isShown(shown.current)).toBe(true);
  });

  it('lets an author display beat the user agent, as on the web', () => {
    const popover = elementRef();
    render(
      jsx('div', {
        ref: popover,
        popover: 'manual',
        style: {display: 'flex'},
        children: 'Menu',
      }),
    );
    expect(getComputedStyle(popover.current).display).toBe('flex');
    expect(isShown(popover.current)).toBe(true);
  });

  it('hides a popover until showPopover(), then matches :popover-open', () => {
    const timers = Fantom.installTimerMock();
    installedTimers = timers;
    installStylesheet('.menu:popover-open { opacity: 0.5; }');
    const popover = elementRef();
    const root = render(
      jsx('div', {
        ref: popover,
        popover: 'auto',
        className: 'menu',
        children: 'Menu',
      }),
    );
    expect(isShown(popover.current)).toBe(false);
    const events = recordToggles(popover.current);

    Fantom.runTask(() => {
      popover.current.showPopover();
    });
    expect(isShown(popover.current)).toBe(true);
    expect(popover.current.matches(':popover-open')).toBe(true);
    // The sheet's rule for an open popover
    expect(
      JSON.stringify(root.getRenderedOutput({props: ['opacity']}).toJSON()),
    ).toContain('"opacity":"0.5"');

    // `beforetoggle` comes first, synchronously; `toggle` after, as a task
    expect(events).toEqual([['beforetoggle', 'closed', 'open']]);
    timers.runAllTimers();
    expect(events).toEqual([
      ['beforetoggle', 'closed', 'open'],
      ['toggle', 'closed', 'open'],
    ]);

    let toggled: ?boolean = null;
    Fantom.runTask(() => {
      toggled = popover.current.togglePopover();
    });
    expect(toggled).toBe(false);
    expect(isShown(popover.current)).toBe(false);
    expect(popover.current.matches(':popover-open')).toBe(false);
  });

  it('matches :popover-open as soon as it is shown or hidden', () => {
    const popover = elementRef();
    render(jsx('div', {ref: popover, popover: 'auto', children: 'Menu'}));
    const matched: Array<boolean> = [];
    Fantom.runTask(() => {
      popover.current.showPopover();
      // Before the element renders its new state
      matched.push(popover.current.matches(':popover-open'));
    });
    Fantom.runTask(() => {
      popover.current.hidePopover();
      matched.push(popover.current.matches(':popover-open'));
    });
    expect(matched).toEqual([true, false]);
    expect(popover.current.matches(':popover-open')).toBe(false);
  });

  it('refuses to show an element that is not a popover', () => {
    const element = elementRef();
    render(jsx('div', {ref: element, children: 'Menu'}));
    expect(errorFrom(() => element.current.showPopover())).toMatch(
      /^NotSupportedError/,
    );
  });

  it('lets beforetoggle cancel a show, fires one toggle per task, and takes force only as a boolean', () => {
    const timers = Fantom.installTimerMock();
    installedTimers = timers;
    const popover = elementRef();
    render(jsx('div', {ref: popover, popover: 'manual', children: 'Menu'}));
    const cancel = (event: $FlowFixMe) => event.preventDefault();
    popover.current.addEventListener('beforetoggle', cancel);
    Fantom.runTask(() => {
      popover.current.showPopover();
    });
    expect(isShown(popover.current)).toBe(false);
    popover.current.removeEventListener('beforetoggle', cancel);

    const events = recordToggles(popover.current);
    Fantom.runTask(() => {
      popover.current.showPopover();
      popover.current.hidePopover();
      popover.current.showPopover();
    });
    timers.runAllTimers();
    expect(events.filter(([type]) => type === 'toggle')).toEqual([
      ['toggle', 'closed', 'open'],
    ]);

    let toggled: ?boolean = null;
    Fantom.runTask(() => {
      toggled = popover.current.togglePopover({force: undefined});
    });
    expect(toggled).toBe(false);
    expect(isShown(popover.current)).toBe(false);
  });
});
