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
import {useEffect, useRef} from 'react';
import {ScrollView, Text, View} from 'react-native';

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
    </ScrollView>
  );
}
