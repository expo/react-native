/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import * as React from 'react';

/**
 * `<label>` — the element that gives a control its name.
 *
 * This is the accessibility one. A checkbox with a `<label>` beside it looks
 * labelled and is not: the text is a separate run in the paragraph, so a screen
 * reader lands on the control and announces "switch, off" with no indication of
 * what it switches. That is one of the most common real accessibility failures
 * in a form, and it is invisible in a screenshot — which is why it survived this
 * long here.
 *
 * HTML associates a label with a control two ways, and both are supported:
 *
 *   <label htmlFor="terms">Accept</label> <input id="terms" type="checkbox" />
 *   <label><input type="checkbox" /> Accept</label>
 *
 * The wrapping form is a context: the label knows its own text and offers it
 * downwards. The `for`/`id` form cannot be, because the two elements are
 * siblings and neither is an ancestor of the other — so it goes through a small
 * registry that labels write to and controls subscribe to, which is what a
 * document's id map is.
 *
 * ## What this does and does not do
 *
 * It sets the control's **name**. Tapping a label does not focus or toggle
 * its control — HTML's other half of the association — because that needs the
 * control's imperative handle, and the element controls do not expose one yet.
 * The naming is the part that matters for accessibility; the tap target is
 * convenience, and it is recorded in `__docs__/SpecDeviations.md`.
 */

/*
 * The id map.
 *
 * Module-level rather than a context because `for`/`id` reaches across the tree
 * — a label and its control are siblings, and requiring a provider above them
 * would make the plain HTML form of this stop working. HTML's ids are
 * document-global for exactly the same reason, and carry the same caveat: two
 * controls with one id is invalid there and ambiguous here.
 */
const labelText: Map<string, string> = new Map();
const listeners: Map<string, Set<() => void>> = new Map();

function publish(id: string) {
  const set = listeners.get(id);
  if (set != null) {
    for (const listener of set) {
      listener();
    }
  }
}

function setLabelText(id: string, text: string | null) {
  if (text == null) {
    labelText.delete(id);
  } else {
    labelText.set(id, text);
  }
  publish(id);
}

/*
 * The activation map — the other half of the association.
 *
 * Separate from `labelText` and deliberately sparse: a control opts in by
 * registering, so "does tapping my label activate me?" is a decision each
 * control type makes rather than something the label assumes. That is what
 * lets radios take HTML's behaviour while switches keep the platform's — see
 * `useLabelActivation` and `__docs__/SpecDeviations.md`.
 */
const activators: Map<string, () => void> = new Map();

/**
 * Register this control as activatable by a `<label for>` pointing at `id`.
 *
 * Controls that should NOT respond to a label tap simply never call this, and
 * `activateLabelTarget` then does nothing for that id.
 */
export function useLabelActivation(id: ?string, activate: () => void): void {
  const latest = React.useRef(activate);
  latest.current = activate;

  React.useEffect(() => {
    if (id == null || id === '') {
      return;
    }
    const run = () => latest.current();
    activators.set(id, run);
    return () => {
      // Only clear the entry if it is still ours: a control remounting under
      // the same id would otherwise delete its own successor's registration.
      if (activators.get(id) === run) {
        activators.delete(id);
      }
    };
  }, [id]);
}

/**
 * Activate the control registered for `id`, if any. Returns whether one was.
 */
export function activateLabelTarget(id: ?string): boolean {
  if (id == null || id === '') {
    return false;
  }
  const run = activators.get(id);
  if (run == null) {
    return false;
  }
  run();
  return true;
}

/**
 * The label text for a control with this `id`, kept current if the label's own
 * text changes.
 */
export function useLabelFor(id: ?string): string | null {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      if (id == null) {
        return () => {};
      }
      let set = listeners.get(id);
      if (set == null) {
        set = new Set();
        listeners.set(id, set);
      }
      set.add(onChange);
      return () => {
        set?.delete(onChange);
        if (set != null && set.size === 0) {
          listeners.delete(id);
        }
      };
    },
    [id],
  );

  const getSnapshot = React.useCallback(
    () => (id == null ? null : (labelText.get(id) ?? null)),
    [id],
  );

  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * The text of an enclosing `<label>`, for the wrapping form of the association.
 */
export const LabelTextContext: React.Context<string | null> =
  React.createContext<string | null>(null);

/**
 * What a labelable control must accept for `useControlLabel` to work.
 *
 * Declared next to the hook that reads it rather than repeated in each control:
 * these two props are not incidental extras, they ARE the association contract.
 * `id` is what a `<label for>` binds to, and `accessibilityLabel` is the
 * author's override of whatever that association produces.
 */
export type LabelableProps = {
  id?: ?string,
  accessibilityLabel?: ?string,
};

/**
 * The accessible name a control should use: its own beats a label's, and a
 * `for`/`id` label beats a wrapping one — which is HTML's precedence, where an
 * explicit association is the more specific statement.
 */
export function useControlLabel(ownLabel: ?string, id: ?string): string | void {
  const explicit = useLabelFor(id);
  const wrapping = React.useContext(LabelTextContext);
  return ownLabel ?? explicit ?? wrapping ?? undefined;
}

/**
 * The label's own text, read out of its children.
 *
 * Nested elements are descended into — `<label>Accept <strong>now</strong></label>`
 * names the control "Accept now" — because a browser's accessible-name
 * computation uses the label's whole text content, not just its direct strings.
 * A nested control contributes nothing, which is also the spec's rule and stops
 * a wrapped `<input>` from naming itself.
 */
export function textOf(children: React.Node): string {
  const parts: Array<string> = [];
  const walk = (node: React.Node) => {
    React.Children.forEach(node, child => {
      if (typeof child === 'string' || typeof child === 'number') {
        parts.push(String(child));
        return;
      }
      if (child == null || typeof child !== 'object') {
        return;
      }
      const element: $FlowFixMe = child;
      // A control inside the label is what is being named; its own value is not
      // part of the name.
      if (
        element.type === 'input' ||
        element.type === 'select' ||
        element.type === 'textarea'
      ) {
        return;
      }
      walk(element.props?.children);
    });
  };
  walk(children);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

type LabelProps = {
  htmlFor?: ?string,
  children?: React.Node,
  ...
};

function Label({htmlFor, children, ...rest}: LabelProps): React.Node {
  const text = React.useMemo(() => textOf(children), [children]);

  React.useEffect(() => {
    if (htmlFor == null || htmlFor === '') {
      return;
    }
    setLabelText(htmlFor, text);
    return () => {
      setLabelText(htmlFor, null);
    };
  }, [htmlFor, text]);

  /*
   * HTML's other half: a click on the label acts on the control.
   *
   * Routed through the activation map rather than applied here, because whether
   * it *should* happen is the control's decision, not the label's. Nothing is
   * registered for most controls, in which case this is an ordinary tap on some
   * text and does nothing — which is also what a `<label>` with no matching
   * `for` does in a browser.
   */
  const onPress = React.useCallback(() => {
    activateLabelTarget(htmlFor);
  }, [htmlFor]);

  return (
    <LabelTextContext.Provider value={text === '' ? null : text}>
      {/* $FlowFixMe[prop-missing] intrinsic */}
      <element-label {...rest} nodeName="label" onClick={onPress}>
        {children}
      </element-label>
    </LabelTextContext.Provider>
  );
}

export default Label;
