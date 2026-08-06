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

import type {RNTesterModule} from '../../types/RNTesterTypes';

import * as React from 'react';
import {useEffect, useRef, useState} from 'react';
import {Button, Text, View} from 'react-native';

/**
 * CSS transitions (css-transitions-1), run entirely in the renderer.
 *
 * Nothing here animates anything: the styles below are two static states, and
 * pressing the button swaps between them in a single React commit. Everything
 * in between is produced in C++, off the JavaScript thread, by the shared
 * animation backend.
 *
 * That is also what the last case demonstrates. It blocks the JavaScript
 * thread solid for a second immediately after the swap — if the box keeps
 * moving while nothing can run in JavaScript, the animation is not in
 * JavaScript. It is the one test that cannot be faked by a well-written hook.
 */

/**
 * Flips state on an interval so the transitions can be observed — and sampled
 * by a test — without anyone pressing anything.
 */
function useAutoToggle(periodMs: number): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) {
      return;
    }
    const id = setInterval(() => setOn(v => !v), periodMs);
    return () => clearInterval(id);
  }, [auto, periodMs]);
  return [
    on,
    () => {
      setAuto(a => !a);
    },
  ];
}

const BOX = {
  width: 120,
  height: 120,
  borderRadius: 12,
  borderWidth: 4,
};

function Case({
  title,
  description,
  style,
  children,
}: {
  title: string,
  description: string,
  style: $FlowFixMe,
  children?: React.Node,
}): React.Node {
  return (
    <View style={{marginBottom: 24}}>
      <Text style={{fontWeight: '600', marginBottom: 2}}>{title}</Text>
      <Text style={{color: '#6b6b70', fontSize: 13, marginBottom: 8}}>
        {description}
      </Text>
      <View style={style} />
      {children}
    </View>
  );
}

function OpacityAndColor(): React.Node {
  const [on, toggleAuto] = useAutoToggle(2500);
  return (
    <Case
      title="opacity and background-color"
      description="One commit swaps both; the renderer fills in the frames."
      style={{
        ...BOX,
        opacity: on ? 1 : 0.25,
        backgroundColor: on ? '#d92d20' : '#1570ef',
        borderColor: on ? '#7a271a' : '#00329c',
        transitionProperty: 'opacity, background-color, border-color',
        transitionDuration: '900ms',
        transitionTimingFunction: 'linear',
      }}>
      <Button
        testID="toggle-opacity"
        title="Pause/resume"
        onPress={toggleAuto}
      />
    </Case>
  );
}

function TransformCase(): React.Node {
  const [on, toggleAuto] = useAutoToggle(2500);
  return (
    <Case
      title="transform"
      description="Translate and scale, interpolated natively."
      style={{
        ...BOX,
        backgroundColor: '#7f56d9',
        borderColor: '#4a1fb8',
        transform: on
          ? [{translateX: 120}, {scale: 1.3}]
          : [{translateX: 0}, {scale: 1}],
        transitionProperty: 'transform',
        transitionDuration: '900ms',
        transitionTimingFunction: 'ease-in-out',
      }}>
      <Button
        testID="toggle-transform"
        title="Pause/resume"
        onPress={toggleAuto}
      />
    </Case>
  );
}

function BlockedJsCase(): React.Node {
  const [on, toggleAuto] = useAutoToggle(3000);
  const first = useRef(true);

  // The block has to happen AFTER the commit, not in the same callback as the
  // state update: React would still be holding the update, so the transition
  // would not have started yet and the freeze would prove nothing. An effect
  // runs once the tree is committed, which is exactly when the renderer has
  // begun animating and JavaScript being unavailable becomes meaningful.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const until = Date.now() + 1000;
    while (Date.now() < until) {}
  }, [on]);

  return (
    <Case
      title="…while JavaScript is blocked"
      description="Swaps the style, then spins the JS thread for 1s. A JS-driven animation would freeze here; this one does not."
      style={{
        ...BOX,
        backgroundColor: on ? '#12b76a' : '#f79009',
        borderColor: '#053321',
        transform: on ? [{translateX: 150}] : [{translateX: 0}],
        transitionProperty: 'transform, background-color',
        transitionDuration: '2000ms',
        transitionTimingFunction: 'linear',
      }}>
      <Button
        testID="toggle-blocked"
        title="Pause/resume"
        onPress={toggleAuto}
      />
    </Case>
  );
}

function CSSTransitionsExample(): React.Node {
  return (
    <View style={{padding: 16}}>
      <OpacityAndColor />
      <TransformCase />
      <BlockedJsCase />
    </View>
  );
}

export default {
  framework: 'React',
  title: 'CSS Transitions',
  category: 'UI',
  documentationURL: 'https://drafts.csswg.org/css-transitions-1/',
  description:
    'transition-property/duration/delay/timing-function, interpolated in the renderer off the JS thread.',
  examples: [
    {
      title: 'CSS Transitions',
      name: 'cssTransitions',
      render: (): React.Node => <CSSTransitionsExample />,
    },
  ],
} as RNTesterModule;
