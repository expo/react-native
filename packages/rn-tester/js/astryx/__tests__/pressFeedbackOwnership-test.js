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

/**
 * Who answers a press: the author or the platform, never both. A styled
 * `<button>` gets the platform's dim only when nothing else responds; with both,
 * the two arrive on different clocks and the button goes one colour on press
 * and another on hold. Every case goes through `propsWithState`, which applies
 * the pseudo blocks and drops the `:`-prefixed keys, so by the time a style
 * reaches the element `:active` is gone; a test that handed such a style to
 * `jsx()` directly would prove nothing about the pipeline.
 */

import {jsx} from '../jsx-runtime';
import {propsWithState} from '../stylex-rn';
import TestRenderer from 'react-test-renderer';

/** The props the host element was given, for the first `element-button-box`. */
function buttonHostProps(element: $FlowFixMe): {[string]: unknown} | null {
  let renderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(element);
  });
  if (renderer == null) {
    throw new Error('nothing rendered');
  }
  let found: {[string]: unknown} | null = null;
  const walk = (node: $FlowFixMe) => {
    if (node == null || typeof node !== 'object' || found != null) {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.props != null && 'authorStatesPressFeedback' in node.props) {
      found = node.props;
      return;
    }
    walk(node.children);
  };
  walk(renderer.toJSON());
  TestRenderer.act(() => renderer.unmount());
  return found;
}

const RESTING = {
  hovered: false,
  focused: false,
  pressed: false,
  disabled: false,
};

/** A button built the way an Astryx component builds one. */
function buttonStyledWith(style: $FlowFixMe): {[string]: unknown} | null {
  return buttonHostProps(
    jsx('button', {
      ...propsWithState(RESTING, style),
      children: 'Press and hold me',
    }),
  );
}

describe('a button whose author styles the press', () => {
  it('claims the press when the styles carry an :active block', () => {
    const props = buttonStyledWith({
      backgroundColor: '#3b40a0',
      ':active': {backgroundColor: '#2a2f70'},
    });
    expect(props?.authorStatesPressFeedback).toBe(true);
  });

  it('claims it for a :hover block too', () => {
    // A touch reports as a hover on the way to a press, so a hover style
    // answers the finger
    const props = buttonStyledWith({opacity: 1, ':hover': {opacity: 0.8}});
    expect(props?.authorStatesPressFeedback).toBe(true);
  });

  it('does NOT claim it for :focus or :disabled, which no finger drives', () => {
    const props = buttonStyledWith({
      backgroundColor: '#fff',
      ':focus': {borderColor: '#0a84ff'},
      ':disabled': {opacity: 0.5},
    });
    expect(props?.authorStatesPressFeedback ?? false).toBe(false);
  });

  it('leaves the press to the platform when the author states none', () => {
    // With nobody answering, the platform must
    const props = buttonStyledWith({backgroundColor: '#0a84ff'});
    expect(props?.authorStatesPressFeedback ?? false).toBe(false);
  });

  it('never leaks the marker prop to the host element', () => {
    // It is a message to the runtime, not something native should receive.
    const props = buttonStyledWith({':active': {opacity: 0.5}});
    expect(props).not.toHaveProperty('__stylexAnswersPress');
  });

  it('the resolved style really has no :active left in it — the trap itself', () => {
    // Why the signal cannot be read off the element's style
    const resolved = propsWithState(RESTING, {
      backgroundColor: '#3b40a0',
      ':active': {backgroundColor: '#2a2f70'},
    });
    expect(JSON.stringify(resolved.style ?? {})).not.toContain(':active');
    expect(resolved.__stylexAnswersPress).toBe(true);
  });
});
