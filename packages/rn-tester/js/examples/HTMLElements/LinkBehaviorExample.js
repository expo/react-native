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

import {LABEL_COLOR, SECONDARY_COLOR} from './themed';
import * as React from 'react';
import {useEffect, useRef, useState} from 'react';
import {Animated, Easing, Platform, ScrollView, Text} from 'react-native';

import '@react-native/expo-intrinsics-poc';

/*
 * `<a href>` on each platform's terms.
 *
 * This screen lives on the RNTester side rather than in the shared document,
 * because everything it demonstrates is an INTERACTION — and the web-comparison
 * report renders the shared document in a browser, where it would be pretending
 * that a long press had happened.
 *
 * The three cases are the three shapes an anchor takes. They are not variations
 * on a theme: each is a different thing to hit-test, and each was broken
 * separately at some point.
 */

function Note({children}: {children: React.Node}): React.Node {
  return (
    <Text style={{fontSize: 13, color: SECONDARY_COLOR, marginBottom: 12}}>
      {children}
    </Text>
  );
}

function Screen({children}: {children: React.Node}): React.Node {
  return (
    /*
     * Symmetric padding, unlike the other HTML screens' `paddingBottom: 48`.
     *
     * That 48 is scroll clearance for long documents, and these cases are
     * short — so it never scrolls and the space is simply lopsided: the last
     * paragraph's own bottom margin lands on top of it (a container with
     * padding stops a child's margin collapsing out), making the gap under the
     * text about 65pt against 16 above it.
     */
    <ScrollView contentContainerStyle={{padding: 16}}>
      {/*
       * The text colour is stated ONCE, here, and inherited — which is both how
       * a browser does it (`html { color: CanvasText }`) and the only way that
       * works. Putting it on every element instead gives each one its own
       * declaration, which then outranks the value it should have inherited:
       * `<div style={{color:'red'}}><b>x</b></div>` drew the `<b>` in the
       * canvas colour. That was tried and reverted;
       * DOM-CSS-LIMITATION(themed-default-colour-needs-a-root) is the record.
       *
       * Until the renderer has a themed DEFAULT foreground colour — a default,
       * not a declaration — a document root has to say this, or prose renders
       * in React Native's black and a dark surface shows nothing at all.
       */}
      {/* $FlowFixMe[not-a-component] intrinsic */}
      <div style={{color: LABEL_COLOR}}>{children}</div>
    </ScrollView>
  );
}

function InlineLink(): React.Node {
  return (
    <Screen>
      <Note>
        {Platform.OS === 'ios'
          ? 'Tap to open. Press and hold: the glyphs lift out of the sentence into the system link menu.'
          : 'Tap to open. Links take the theme’s colour and Android’s underline.'}
      </Note>
      <p>
        A paragraph with {/* $FlowExpectedError[not-a-component] intrinsic */}
        <a href="https://reactnative.dev/">a link inside it</a> and ordinary
        text after, so the link has to be found among the glyphs rather than by
        hit-testing a view.
      </p>
      <p>
        A link long enough to{' '}
        {/* $FlowExpectedError[not-a-component] intrinsic */}
        <a href="https://reactnative.dev/docs/getting-started">
          wrap across lines, each lifting as its own shape
        </a>{' '}
        — the lift hugs the link's glyphs on each line and leaves the words
        around it alone.
      </p>
    </Screen>
  );
}

function LinkedImage(): React.Node {
  return (
    <Screen>
      <Note>
        An anchor can wrap content, not just text. The image is the link.
      </Note>
      {/* $FlowExpectedError[not-a-component] intrinsic */}
      <a href="https://reactnative.dev/">
        {/* $FlowExpectedError[not-a-component] intrinsic */}
        <img
          src="https://reactnative.dev/img/tiny_logo.png"
          width={72}
          height={72}
        />
      </a>
      <Note>
        The anchor stays inline, so the image rides in the text as an attachment
        and carries the link with it.
      </Note>
    </Screen>
  );
}

function LiveLink(): React.Node {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1600,
        easing: Easing.linear,
        // Driven natively, so the square keeps turning even while JavaScript is
        // idle and while a menu is up.
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  return (
    <Screen>
      <Note>
        The square keeps turning under the menu. The lift is rendered once, so
        the chip is a still of the moment you pressed.
      </Note>
      {/* $FlowExpectedError[not-a-component] intrinsic */}
      <a href="https://reactnative.dev/">
        <Animated.View
          style={{
            width: 72,
            height: 72,
            borderRadius: 10,
            backgroundColor: '#2563eb',
            transform: [
              {
                rotate: spin.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0deg', '360deg'],
                }),
              },
            ],
          }}
        />
      </a>
    </Screen>
  );
}

function BlockLink(): React.Node {
  return (
    <Screen>
      <Note>
        {Platform.OS === 'ios'
          ? 'With display:block the anchor is a box, so holding lifts the whole box — the way iOS lifts a row.'
          : 'With display:block the anchor is a box rather than a run of glyphs. Tapping it still follows the link.'}
      </Note>
      {/* $FlowExpectedError[not-a-component] intrinsic */}
      <a
        href="https://reactnative.dev/blog"
        style={{
          display: 'block',
          padding: 16,
          borderRadius: 12,
          backgroundColor: '#00000010',
        }}>
        A whole block that is a link
      </a>
    </Screen>
  );
}

function CancellingLink(): React.Node {
  const [count, setCount] = useState(0);
  return (
    <Screen>
      <Note>
        preventDefault() cancels the navigation, exactly as on the web — this
        one counts taps instead of opening.
      </Note>
      <p>
        {/* $FlowExpectedError[not-a-component] intrinsic */}
        <a
          href="https://reactnative.dev/"
          onClick={(event: $FlowFixMe) => {
            event.preventDefault();
            setCount(c => c + 1);
          }}>
          Handled in JavaScript
        </a>{' '}
        — tapped {count} {count === 1 ? 'time' : 'times'}, and Safari never
        opened.
      </p>
    </Screen>
  );
}

export default {
  title: 'HTML: links',
  category: 'UI',
  description:
    'How <a href> behaves on each platform: the system tint, the platform’s own ' +
    'underline convention, and press-and-hold through the OS’s own link menu.',
  examples: [
    {
      name: 'inline',
      title: 'A link inside a sentence',
      render: (): React.Node => <InlineLink />,
    },
    {
      name: 'image',
      title: 'A link wrapping an image',
      render: (): React.Node => <LinkedImage />,
    },
    {
      name: 'live',
      title: 'A link wrapping a moving view',
      description: 'What the OS lifts when the content is animating.',
      render: (): React.Node => <LiveLink />,
    },
    {
      name: 'block',
      title: 'A link that is a block',
      render: (): React.Node => <BlockLink />,
    },
    {
      name: 'cancel',
      title: 'Cancelling the navigation',
      render: (): React.Node => <CancellingLink />,
    },
  ],
} as RNTesterModule;
