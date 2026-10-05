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
import {Button, ScrollView, Text, View, useColorScheme} from 'react-native';

/**
 * CSS transitions (css-transitions-1). Every style below is a pair of static
 * states, and toggling swaps them in one React commit; the renderer produces
 * every frame in between through the shared animation backend. Requires
 * `useSharedAnimatedBackend`.
 */

/**
 * Auto-plays on an interval until the section's Toggle is pressed, which
 * stops the auto-play and toggles immediately, mid-flight included. There is
 * no pause: CSS has no way to freeze a transition (`animation-play-state`
 * belongs to animations).
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
      setAuto(false);
      setOn(v => !v);
    },
  ];
}

function Section({
  title,
  description,
  children,
}: {
  title: string,
  description: string,
  children: React.Node,
}): React.Node {
  const dark = useColorScheme() === 'dark';
  return (
    <View style={{marginBottom: 28}}>
      <Text
        style={{
          fontWeight: '600',
          marginBottom: 2,
          color: dark ? '#f2f2f7' : '#101828',
        }}>
        {title}
      </Text>
      <Text
        style={{
          color: dark ? '#98989f' : '#6b6b70',
          fontSize: 13,
          marginBottom: 10,
        }}>
        {description}
      </Text>
      {children}
    </View>
  );
}

const BOX = {
  width: 100,
  height: 60,
  borderRadius: 10,
  borderWidth: 3,
};

// Each box declares a transition on one property while the toggle changes
// several, so the other properties snap

const PROPERTY_CASES = [
  {property: 'opacity', why: 'the rest snap; only opacity animates'},
  {property: 'background-color', why: 'only the fill animates'},
  {property: 'border-color', why: 'only the border animates'},
  {property: 'transform', why: 'only the position animates'},
  {property: 'all', why: 'every supported property animates'},
];

function PropertiesCase(): React.Node {
  const [on, toggleAuto] = useAutoToggle(2600);
  return (
    <Section
      title="transition-property"
      description="One toggle changes opacity, colors, and transform on every box; each box animates only what it declares.">
      {PROPERTY_CASES.map(({property, why}) => (
        <View
          key={property}
          style={{flexDirection: 'row', alignItems: 'center', marginBottom: 8}}>
          <View
            style={{
              ...BOX,
              opacity: on ? 1 : 0.35,
              backgroundColor: on ? '#d92d20' : '#1570ef',
              borderColor: on ? '#7a271a' : '#00329c',
              transform: on ? [{translateX: 60}] : [{translateX: 0}],
              transitionProperty: property,
              transitionDuration: '1200ms',
              transitionTimingFunction: 'linear',
            }}
          />
          <Text style={{marginLeft: 76, fontSize: 12, color: '#6b6b70'}}>
            {property}
            {'\n'}
            {why}
          </Text>
        </View>
      ))}
      <Button title="Toggle" onPress={toggleAuto} />
    </Section>
  );
}

// Identical property, duration and distance; only the curve differs.
// cubic-bezier(.3,1.5,.6,1) overshoots the target, which needs y > 1.

const TIMING_FUNCTIONS = [
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'cubic-bezier(.3,1.5,.6,1)',
  'step-start',
  'step-end',
];

function TimingCase(): React.Node {
  const [on, toggleAuto] = useAutoToggle(3200);
  return (
    <Section
      title="transition-timing-function"
      description="The same 1.6s translate under every curve. Watch ease-in trail at the start, ease-out trail at the end, the bezier overshoot, and the steps jump.">
      {TIMING_FUNCTIONS.map(tf => (
        <View key={tf} style={{marginBottom: 6}}>
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              backgroundColor: '#7f56d9',
              transform: on ? [{translateX: 180}] : [{translateX: 0}],
              transitionProperty: 'transform',
              transitionDuration: '1600ms',
              transitionTimingFunction: tf,
            }}
          />
          <Text
            style={{
              position: 'absolute',
              left: 220,
              top: 5,
              fontSize: 11,
              color: '#6b6b70',
            }}>
            {tf}
          </Text>
        </View>
      ))}
      <Button title="Toggle" onPress={toggleAuto} />
    </Section>
  );
}

// Comma lists zip by index, and shorter lists repeat

function ListsCase(): React.Node {
  const [on, toggleAuto] = useAutoToggle(3600);
  return (
    <Section
      title="per-property lists"
      description="transition-property: opacity, transform with durations 400ms, 2400ms: the fade finishes six times sooner than the slide. One timing function, unlisted, repeats onto both.">
      <View
        style={{
          ...BOX,
          backgroundColor: '#12b76a',
          borderColor: '#054f31',
          opacity: on ? 1 : 0.25,
          transform: on ? [{translateX: 140}] : [{translateX: 0}],
          transitionProperty: 'opacity, transform',
          transitionDuration: '400ms, 2400ms',
          transitionTimingFunction: 'ease-in-out',
        }}
      />
      <Button title="Toggle" onPress={toggleAuto} />
    </Section>
  );
}

// A stagger built from delays alone

function DelayCase(): React.Node {
  const [on, toggleAuto] = useAutoToggle(3600);
  return (
    <Section
      title="transition-delay"
      description="Four dots, one commit, delays of 0/150/300/450ms. The wave is the renderer holding each start; nothing re-renders between dots.">
      <View style={{flexDirection: 'row', gap: 12, marginBottom: 8}}>
        {[0, 150, 300, 450].map(delay => (
          <View
            key={delay}
            style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              backgroundColor: '#f79009',
              transform: on ? [{translateY: 40}] : [{translateY: 0}],
              transitionProperty: 'transform',
              transitionDuration: '500ms',
              transitionDelay: `${delay}ms`,
              transitionTimingFunction: 'ease-in-out',
            }}
          />
        ))}
      </View>
      <View style={{height: 44}} />
      <Button title="Toggle" onPress={toggleAuto} />
    </Section>
  );
}

// The toggle period is shorter than the duration, so every leg is interrupted
// before it lands; css-transitions-1 §3 has it continue from where it is

function InterruptionCase(): React.Node {
  const [on, toggleAuto] = useAutoToggle(1400);
  return (
    <Section
      title="interruption"
      description="A 2.4s slide re-targeted every 1.4s: it never arrives, and every reversal starts from exactly where the box is. A naive implementation snaps back to an endpoint here.">
      <View
        style={{
          ...BOX,
          backgroundColor: on ? '#d92d20' : '#1570ef',
          borderColor: '#101828',
          transform: on ? [{translateX: 180}] : [{translateX: 0}],
          transitionProperty: 'transform, background-color',
          transitionDuration: '2400ms',
          transitionTimingFunction: 'ease-in-out',
        }}
      />
      <Button title="Toggle" onPress={toggleAuto} />
    </Section>
  );
}

// An unsupported property and a missing declaration both snap

function IgnoredCase(): React.Node {
  const [on, toggleAuto] = useAutoToggle(2600);
  return (
    <Section
      title="not everything animates"
      description="Left: width isn't a supported transition property, so declaring it does nothing — the size snaps while the declared background still animates. Right: no transition declared at all; everything snaps.">
      <View style={{flexDirection: 'row', gap: 16}}>
        <View
          style={{
            height: 60,
            borderRadius: 10,
            width: on ? 160 : 80,
            backgroundColor: on ? '#d92d20' : '#1570ef',
            transitionProperty: 'width, background-color',
            transitionDuration: '1200ms',
          }}
        />
        <View
          style={{
            ...BOX,
            backgroundColor: on ? '#d92d20' : '#1570ef',
            borderColor: '#101828',
            transform: on ? [{translateX: 20}] : [{translateX: 0}],
          }}
        />
      </View>
      <Button title="Toggle" onPress={toggleAuto} />
    </Section>
  );
}

// The transition keeps moving while JavaScript is blocked

function BlockedJsCase(): React.Node {
  const [on, toggleAuto] = useAutoToggle(3000);
  const first = useRef(true);

  // Block after the commit, in an effect, since in the state update's callback
  // the transition would not have started yet
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const until = Date.now() + 1000;
    while (Date.now() < until) {}
  }, [on]);

  return (
    <Section
      title="…while JavaScript is blocked"
      description="Each toggle spins the JS thread solid for 1s of the 2s transition. A JS-driven animation freezes here; this one keeps moving, because the frames come from the display link, not from JavaScript.">
      <View
        style={{
          ...BOX,
          backgroundColor: on ? '#12b76a' : '#f79009',
          borderColor: '#053321',
          transform: on ? [{translateX: 150}] : [{translateX: 0}],
          transitionProperty: 'transform, background-color',
          transitionDuration: '2000ms',
          transitionTimingFunction: 'linear',
        }}
      />
      <Button title="Toggle" onPress={toggleAuto} />
    </Section>
  );
}

function CSSTransitionsExample(): React.Node {
  return (
    // Its own scroll container, since the example page provides none and this
    // screen is several viewports tall
    <ScrollView contentInsetAdjustmentBehavior="automatic">
      <View style={{padding: 16}}>
        <PropertiesCase />
        <TimingCase />
        <ListsCase />
        <DelayCase />
        <InterruptionCase />
        <IgnoredCase />
        <BlockedJsCase />
      </View>
    </ScrollView>
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
