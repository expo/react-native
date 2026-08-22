/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * `<label for>` activation, and which controls opt into it.
 *
 * A `<label>` names its control; in HTML, clicking one also *acts* on it. That
 * second half is implemented for radios only, and this file pins the exclusion
 * as firmly as the inclusion — the difference is a deliberate deviation, and a
 * deviation nobody tested is indistinguishable from a bug.
 *
 * ## How exclusivity is asserted
 *
 * Through what the form SUBMITS, not through `checked`. Fantom's rendered
 * output carries only layout props, so `checked` cannot be read back at all —
 * a first attempt at this file asserted against it and failed with `Array []`
 * on every case, comparing nothing.
 *
 * Submission is the better target anyway: "one value per group" is the actual
 * guarantee. A group that draws two selected radios but submits one is still
 * broken, and so is the reverse.
 */

import FormContext from '../src/FormContext';
import {activateLabelTarget} from '../src/Label';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

describe('label activation is radio-only, deliberately', () => {
  test('a radio registers itself as activatable by its label', () => {
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[not-a-component] intrinsic tags */}
          <label htmlFor="pick">Pick me</label>
          {/* $FlowExpectedError[not-a-component] */}
          <input type="radio" name="g" id="pick" value="pick" />
        </>,
      );
    });

    // A target exists for this id: the label has something to act on.
    Fantom.runTask(() => {
      expect(activateLabelTarget('pick')).toBe(true);
    });
  });

  test('a checkbox does NOT — the platform rule wins over HTML', () => {
    /*
     * DOM-CSS-LIMITATION(label-activation-is-radio-only).
     *
     * HTML would toggle it. iOS would not: a `UISwitch` is the only tap target
     * for itself, and Settings does not toggle one from its label. Our checkbox
     * IS a real switch, so it keeps the platform's behaviour; our radio is
     * drawn by us — UIKit has no radio — so it has no platform behaviour to
     * keep and takes HTML's instead.
     *
     * Pinned so the difference cannot become an accident: a later change that
     * "fixes" checkboxes to match HTML has to delete this test and say why.
     */
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[not-a-component] */}
          <label htmlFor="subscribe">Subscribe</label>
          {/* $FlowExpectedError[not-a-component] */}
          <input type="checkbox" id="subscribe" />
        </>,
      );
    });

    Fantom.runTask(() => {
      expect(activateLabelTarget('subscribe')).toBe(false);
    });
  });

  test('a disabled radio does not respond to its label', () => {
    const root = Fantom.createRoot();

    Fantom.runTask(() => {
      root.render(
        <>
          {/* $FlowExpectedError[not-a-component] */}
          <label htmlFor="off">Unavailable</label>
          {/* $FlowExpectedError[not-a-component] */}
          <input type="radio" name="g2" id="off" value="off" disabled />
        </>,
      );
    });

    Fantom.runTask(() => {
      expect(activateLabelTarget('off')).toBe(false);
    });
  });

  test('an id with no control behind it activates nothing', () => {
    // What a `<label for>` pointing at nothing does in a browser: an ordinary
    // click on some text.
    Fantom.runTask(() => {
      expect(activateLabelTarget('nothing-here')).toBe(false);
      expect(activateLabelTarget(null)).toBe(false);
      expect(activateLabelTarget('')).toBe(false);
    });
  });
});

describe('a radio group submits exactly one value', () => {
  /**
   * Renders a form of uncontrolled radios and returns a submit trigger plus
   * the entries of the most recent submission.
   */
  function mountGroup(radios: React.Node) {
    // The element type is FormData's own entry type; `unknown` here made the
    // `push` below a Flow error on a value that is always a string or a File.
    const submissions: Array<Array<[string, string | File]>> = [];
    let submit: (() => void) | null = null;

    function Trigger() {
      const form = React.useContext(FormContext);
      submit = form?.submit ?? null;
      return null;
    }

    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        // $FlowExpectedError[not-a-component] intrinsic tag
        <form
          action={(formData: FormData) => {
            submissions.push([...formData.entries()]);
          }}>
          {radios}
          <Trigger />
        </form>,
      );
    });
    return {
      submit: () => Fantom.runTask(() => submit?.()),
      last: () => submissions[submissions.length - 1],
    };
  }

  test('choosing one uncontrolled radio deselects its siblings', () => {
    const g = mountGroup(
      <>
        {/* $FlowExpectedError[not-a-component] */}
        <input
          type="radio"
          name="tier"
          id="monthly"
          value="monthly"
          defaultChecked
        />
        {/* $FlowExpectedError[not-a-component] */}
        <input type="radio" name="tier" id="yearly" value="yearly" />
      </>,
    );

    g.submit();
    expect(g.last()).toEqual([['tier', 'monthly']]);

    Fantom.runTask(() => {
      activateLabelTarget('yearly');
    });
    g.submit();

    /*
     * ONE entry, and the new one. This is the bug that was reported from the
     * device: both radios could be on at once, and the form then offered two
     * values for a field HTML permits one of. Before the group registry this
     * read [['tier','monthly'], ['tier','yearly']].
     */
    expect(g.last()).toEqual([['tier', 'yearly']]);
  });

  test('groups with different names do not deselect each other', () => {
    const g = mountGroup(
      <>
        {/* $FlowExpectedError[not-a-component] */}
        <input type="radio" name="tier" id="t1" value="1" defaultChecked />
        {/* $FlowExpectedError[not-a-component] */}
        <input
          type="radio"
          name="delivery"
          id="d1"
          value="slow"
          defaultChecked
        />
        {/* $FlowExpectedError[not-a-component] */}
        <input type="radio" name="delivery" id="d2" value="fast" />
      </>,
    );

    Fantom.runTask(() => {
      activateLabelTarget('d2');
    });
    g.submit();

    // `tier` is untouched; only `delivery` moved.
    expect(g.last()).toEqual([
      ['tier', '1'],
      ['delivery', 'fast'],
    ]);
  });

  test('choosing the already-chosen radio leaves it chosen', () => {
    const g = mountGroup(
      <>
        {/* $FlowExpectedError[not-a-component] */}
        <input type="radio" name="one" id="a" value="a" defaultChecked />
        {/* $FlowExpectedError[not-a-component] */}
        <input type="radio" name="one" id="b" value="b" />
      </>,
    );

    Fantom.runTask(() => {
      activateLabelTarget('a');
    });
    g.submit();

    // HTML's rule: a radio cannot be unchecked by choosing it. The registry
    // turns off every *other* member for exactly this reason.
    expect(g.last()).toEqual([['one', 'a']]);
  });
});
