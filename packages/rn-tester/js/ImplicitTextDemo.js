/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import 'react-native/Libraries/Text/InlineTags';

import * as React from 'react';
import {useEffect, useRef, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {NativeVirtualText} from 'react-native/Libraries/Text/TextNativeComponent';

// T6 hit-testing: tapping the inline <b onPress> fires its own handler (and
// bubbles to the View); tapping bare text fires only the View's handler. The
// counters distinguish them: inline taps bump both; bare-text taps bump only
// the View counter.
function HitTestCase(): React.Node {
  const [inlineTaps, setInlineTaps] = useState(0);
  const [viewTouches, setViewTouches] = useState(0);
  return (
    <View
      onTouchEnd={() => setViewTouches(v => v + 1)}
      style={{padding: 6}}>
      tap the bare text here, or the{' '}
      <NativeVirtualText
        onPress={() => setInlineTaps(v => v + 1)}
        style={{color: '#0a0', fontWeight: 'bold'}}>
        BOLD WORD
      </NativeVirtualText>{' '}
      here.
      {`\ninline handler fired: ${inlineTaps}   view touches: ${viewTouches}`}
    </View>
  );
}

function Case({label, children}: {label: string, children: React.Node}) {
  return (
    <View style={{marginVertical: 6}}>
      <Text style={{fontSize: 11, color: '#888'}}>{label}</Text>
      <View style={{borderWidth: 1, borderColor: '#ccc', padding: 4}}>
        {children}
      </View>
    </View>
  );
}

function Greeting(): React.Node {
  return 'string returned by a user component';
}

export default function ImplicitTextDemo(): React.Node {
  const ref = useRef<?React.ElementRef<typeof View>>(null);
  useEffect(() => {
    // Structured log for native-layout verification.
    setTimeout(() => {
      // $FlowFixMe[prop-missing]
      ref.current?.measureInWindow((x, y, width, height) => {
        const payload = {x, y, width, height};
        // $FlowFixMe[prop-missing] verification hook read by the CDP client
        globalThis.__implicitTextVerify = payload;
        console.log(
          `IMPLICIT-TEXT-VERIFY bare-string-view ${JSON.stringify(payload)}`,
        );
      });
    }, 500);
  }, []);

  return (
    <ScrollView style={{flex: 1, paddingTop: 60, paddingHorizontal: 12}}>
      <Text style={{fontWeight: 'bold', fontSize: 16}}>
        Implicit text demo (enableImplicitTextChildren)
      </Text>

      <Case label="1. bare string under <View> (no <Text>)">
        <View ref={ref}>hello from a bare string</View>
      </Case>

      <Case label="2. runs split around a block child">
        <View>
          before
          <View style={{height: 8, backgroundColor: '#cde'}} />
          after
        </View>
      </Case>

      <Case label="3. flex: a<b>b</b>c blockifies (3 items)">
        <View>
          a{/* $FlowExpectedError[not-a-component] */}
          <b>b</b>c
        </View>
      </Case>

      <Case label="4. display:'block': a<b>b</b>c is one inline flow">
        <View style={{display: 'block'}}>
          a{/* $FlowExpectedError[not-a-component] */}
          <b>bold</b>
          {/* $FlowExpectedError[not-a-component] */}
          <i>italic</i>
          {/* $FlowExpectedError[not-a-component] */}
          <span> span and text flowing inline in one wrapping paragraph, </span>
          just like a web div.
        </View>
      </Case>

      <Case label="5. inheritance: color+fontSize cascade from Views">
        {/* $FlowExpectedError[incompatible-type] */}
        <View style={{color: '#c2185b', fontSize: 18}}>
          <View>inherited pink 18pt bare text</View>
        </View>
      </Case>

      <Case label="6. explicit <Text> unaffected next to inherited bare text">
        {/* $FlowExpectedError[incompatible-type] */}
        <View style={{color: '#c2185b'}}>
          <Text>explicit Text stays default black</Text>
          bare text goes pink
        </View>
      </Case>

      <Case label="7. component-produced string">
        <View>
          <Greeting />
        </View>
      </Case>

      <Case label="8. paint order: left text is authored BEFORE the box (paints under, hidden); right text is authored AFTER (paints over, visible)">
        <View style={{flexDirection: 'row'}}>
          <View style={{width: 120, height: 24, marginRight: 8}}>
            UNDER
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: '#f88',
              }}
            />
          </View>
          <View style={{width: 120, height: 24}}>
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: '#8f8',
              }}
            />
            OVER
          </View>
        </View>
      </Case>

      <Case label="9. hit-testing: tap BOLD (inline handler) vs bare text (View handler)">
        <HitTestCase />
      </Case>

      <Case label="10. inline <img> renders a real image (leans on Image)">
        <View style={{display: 'block'}}>
          {/* $FlowExpectedError[not-a-component] intrinsic <img> tag */}
          <img
            source={{uri: 'https://reactnative.dev/img/tiny_logo.png'}}
            style={{width: 32, height: 32}}
          />
          {' a bare-text caption next to an inline image'}
        </View>
      </Case>
    </ScrollView>
  );
}
