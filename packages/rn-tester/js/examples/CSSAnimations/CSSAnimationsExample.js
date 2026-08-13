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
import {useState} from 'react';
import {
  Button,
  ScrollView,
  Text,
  View,
  processColor,
  useColorScheme,
} from 'react-native';

/**
 * CSS animations (css-animations-1), run entirely in the renderer.
 *
 * Where a transition needs a state CHANGE to animate, an animation runs
 * because the element carries it: everything below animates from the moment
 * it mounts, with React committing exactly once. Every frame is produced in
 * C++, off the JavaScript thread, by the shared animation backend (a display
 * link on iOS, the Choreographer on Android). Requires
 * `useSharedAnimatedBackend`.
 *
 * `animationKeyframes` is the wire format — a JSON string of pre-resolved
 * stops. A style layer (see the Astryx demo's `stylex.keyframes`) compiles
 * `@keyframes` rules down to it; these examples write it directly.
 */

function keyframes(
  stops: Array<{
    offset: number,
    opacity?: number,
    backgroundColor?: string,
    borderColor?: string,
    transform?: string,
  }>,
): string {
  return JSON.stringify(
    stops.map(stop => {
      const out: {[string]: unknown} = {...stop};
      if (stop.backgroundColor != null) {
        out.backgroundColor = processColor(stop.backgroundColor);
      }
      if (stop.borderColor != null) {
        out.borderColor = processColor(stop.borderColor);
      }
      return out;
    }),
  );
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
  width: 56,
  height: 56,
  borderRadius: 10,
};

// ---------------------------------------------------------------------------
// 1. The animatable properties, one infinite animation each.
// ---------------------------------------------------------------------------

const SPIN = keyframes([
  {offset: 0, transform: 'rotate(0deg)'},
  {offset: 1, transform: 'rotate(360deg)'},
]);

const PULSE = keyframes([
  {offset: 0, opacity: 1},
  {offset: 1, opacity: 0.15},
]);

const COLOR_CYCLE = keyframes([
  {offset: 0, backgroundColor: '#1570ef'},
  {offset: 0.5, backgroundColor: '#d92d20'},
  {offset: 1, backgroundColor: '#1570ef'},
]);

const BORDER_BLINK = keyframes([
  {offset: 0, borderColor: '#00329c'},
  {offset: 1, borderColor: '#7a271a'},
]);

function PropertiesCase(): React.Node {
  return (
    <Section
      title="The animatable properties"
      description="Nothing here ever re-renders: each box mounted once, carrying its animation. transform / opacity / background-color / border-color.">
      <View style={{flexDirection: 'row', gap: 16}}>
        <View
          style={{
            ...BOX,
            backgroundColor: '#1570ef',
            animationKeyframes: SPIN,
            animationDuration: '1600ms',
            animationTimingFunction: 'linear',
            animationIterationCount: 'infinite',
          }}
        />
        <View
          style={{
            ...BOX,
            backgroundColor: '#1570ef',
            animationKeyframes: PULSE,
            animationDuration: '900ms',
            animationTimingFunction: 'ease-in-out',
            animationDirection: 'alternate',
            animationIterationCount: 'infinite',
          }}
        />
        <View
          style={{
            ...BOX,
            backgroundColor: '#1570ef',
            animationKeyframes: COLOR_CYCLE,
            animationDuration: '2400ms',
            animationTimingFunction: 'linear',
            animationIterationCount: 'infinite',
          }}
        />
        <View
          style={{
            ...BOX,
            borderWidth: 4,
            borderColor: '#00329c',
            animationKeyframes: BORDER_BLINK,
            animationDuration: '700ms',
            animationDirection: 'alternate',
            animationIterationCount: 'infinite',
          }}
        />
      </View>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 2. Percent transforms: the classic indeterminate bar. -100% → 250% of the
// element's OWN width, resolved after layout, exactly as on the web.
// ---------------------------------------------------------------------------

const SLIDE = keyframes([
  {offset: 0, transform: 'translateX(-100%)'},
  {offset: 1, transform: 'translateX(250%)'},
]);

function PercentCase(): React.Node {
  return (
    <Section
      title="Percent transforms"
      description="translateX(-100%) → translateX(250%), resolved against the bar's own width.">
      <View
        style={{
          height: 8,
          borderRadius: 4,
          backgroundColor: '#e4e7ec',
          overflow: 'hidden',
        }}>
        <View
          style={{
            width: '40%',
            height: '100%',
            borderRadius: 4,
            backgroundColor: '#1570ef',
            animationKeyframes: SLIDE,
            animationDuration: '1400ms',
            animationTimingFunction: 'ease-in-out',
            animationIterationCount: 'infinite',
          }}
        />
      </View>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 3. Fill modes. A finite animation ends somewhere: `forwards` holds its last
// keyframe, `none` reverts to the committed style. Remount to replay.
// ---------------------------------------------------------------------------

const ARRIVE = keyframes([
  {offset: 0, opacity: 0, transform: 'translateX(0px)'},
  {offset: 1, opacity: 1, transform: 'translateX(160px)'},
]);

function FillModesCase(): React.Node {
  const [generation, setGeneration] = useState(0);
  return (
    <Section
      title="animation-fill-mode"
      description="Both run once (1200ms). `forwards` stays where it landed; `none` snaps back to its committed style — committed trees never carry animated values.">
      <View key={generation}>
        {(['forwards', 'none'] as Array<'forwards' | 'none'>).map(fillMode => (
          <View
            key={fillMode}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 8,
            }}>
            <View
              style={{
                ...BOX,
                width: 72,
                backgroundColor: '#12b76a',
                opacity: 0.25,
                animationKeyframes: ARRIVE,
                animationDuration: '1200ms',
                animationTimingFunction: 'ease-out',
                animationFillMode: fillMode,
              }}
            />
            <Text style={{marginLeft: 12, fontSize: 12, color: '#6b6b70'}}>
              {fillMode}
            </Text>
          </View>
        ))}
      </View>
      <Button title="Replay" onPress={() => setGeneration(g => g + 1)} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 4. Direction and iteration count: the same keyframes, played four ways,
// three times each.
// ---------------------------------------------------------------------------

const MARCH = keyframes([
  {offset: 0, transform: 'translateX(0px)'},
  {offset: 1, transform: 'translateX(140px)'},
]);

const DIRECTIONS = [
  'normal',
  'reverse',
  'alternate',
  'alternate-reverse',
] as const;

function DirectionCase(): React.Node {
  const [generation, setGeneration] = useState(0);
  return (
    <Section
      title="animation-direction"
      description="One set of keyframes, iterated 3 times in each direction mode.">
      <View key={generation}>
        {DIRECTIONS.map(direction => (
          <View
            key={direction}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 8,
            }}>
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                backgroundColor: '#7f56d9',
                animationKeyframes: MARCH,
                animationDuration: '1100ms',
                animationTimingFunction: 'ease-in-out',
                animationIterationCount: 3,
                animationDirection: direction,
              }}
            />
            <Text style={{marginLeft: 152, fontSize: 12, color: '#6b6b70'}}>
              {direction}
            </Text>
          </View>
        ))}
      </View>
      <Button title="Replay" onPress={() => setGeneration(g => g + 1)} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 5. Delay + backwards fill: the stagger. Each bar waits its turn; while
// waiting, `backwards` shows the FIRST keyframe instead of the committed
// style, which is what makes staggered entrances not flash.
// ---------------------------------------------------------------------------

const RISE = keyframes([
  {offset: 0, opacity: 0, transform: 'translateY(14px)'},
  {offset: 1, opacity: 1, transform: 'translateY(0px)'},
]);

function StaggerCase(): React.Node {
  const [generation, setGeneration] = useState(0);
  return (
    <Section
      title="animation-delay + backwards fill"
      description="Five bars, one animation, delays 0–800ms. `both` fills backwards during the wait (invisible, displaced) and forwards after.">
      <View
        key={generation}
        style={{flexDirection: 'row', gap: 10, alignItems: 'flex-end'}}>
        {[0, 1, 2, 3, 4].map(i => (
          <View
            key={i}
            style={{
              width: 32,
              height: 24 + i * 14,
              borderRadius: 6,
              backgroundColor: '#dc6803',
              animationKeyframes: RISE,
              animationDuration: '500ms',
              animationDelay: `${i * 200}ms`,
              animationTimingFunction: 'ease-out',
              animationFillMode: 'both',
            }}
          />
        ))}
      </View>
      <Button title="Replay" onPress={() => setGeneration(g => g + 1)} />
    </Section>
  );
}

function CSSAnimationsExample(): React.Node {
  return (
    <ScrollView
      style={{flex: 1}}
      contentContainerStyle={{padding: 16, paddingBottom: 48}}>
      <PropertiesCase />
      <PercentCase />
      <FillModesCase />
      <DirectionCase />
      <StaggerCase />
    </ScrollView>
  );
}

export default {
  title: 'CSS Animations',
  category: 'UI',
  description:
    'Keyframe animations (css-animations-1) run by the renderer, off the JavaScript thread.',
  examples: [
    {
      title: 'CSS Animations',
      render(): React.Node {
        return <CSSAnimationsExample />;
      },
    },
  ],
} as RNTesterModule;
