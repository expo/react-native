/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

'use strict';

/**
 * The install's acceptance test for @expo/ui: its universal layer rendering
 * SwiftUI on iOS and Jetpack Compose on Android from one tree. The platform
 * entry points (`@expo/ui/swift-ui`, `@expo/ui/jetpack-compose`) crash on the
 * other platform with "Unable to get view config". Slider's `min`/`max`/`step`
 * are HTML's `<input type=range>` attributes, spelled identically.
 */

// Required rather than imported so an unlinked platform can be detected: an
// import compiles to a property read on a module object that is undefined
// where there is no Expo autolinking, so even a `Host != null` guard throws
// $FlowFixMe[cannot-resolve-module] @expo/ui ships TypeScript source
const ExpoUI = (() => {
  try {
    // $FlowFixMe[cannot-resolve-module]
    return require('@expo/ui');
  } catch {
    return null;
  }
})();
const {Button, Host, Slider, Switch} = ExpoUI ?? {};
import * as React from 'react';
import {useState} from 'react';
import {Text, View} from 'react-native';

function Row({label, children}) {
  return (
    <View style={{paddingVertical: 8}}>
      <Text style={{fontSize: 13, color: '#6b6b70', marginBottom: 4}}>
        {label}
      </Text>
      {children}
    </View>
  );
}

// Whether `@expo/ui`'s native side is present. The iOS build autolinks Expo
// modules through the Podfile's `use_expo_modules!`; the Android build has no
// Expo autolinking, so the screen says what is missing rather than throwing
function expoUIIsAvailable(): boolean {
  return (
    ExpoUI != null &&
    Host != null &&
    Button != null &&
    Switch != null &&
    Slider != null
  );
}

function Unavailable() {
  return (
    <View style={{padding: 16}}>
      <Text style={{fontSize: 15, fontWeight: '600', marginBottom: 8}}>
        @expo/ui is not linked on this platform
      </Text>
      <Text style={{fontSize: 13, color: '#6b6b70', lineHeight: 18}}>
        The iOS build autolinks Expo modules through the local expo checkout
        (see `use_expo_modules!` in the Podfile). The Android build has no Expo
        autolinking configured, so the native views these controls need are not
        in the app and `Host` is undefined.
        {'\n\n'}
        This screen is the acceptance test for that install, so it reports the
        gap rather than rendering something that would suggest the dependency is
        present.
      </Text>
    </View>
  );
}

function SmokeTest() {
  const [on, setOn] = useState(true);
  const [value, setValue] = useState(0.4);
  const [presses, setPresses] = useState(0);

  if (!expoUIIsAvailable()) {
    return <Unavailable />;
  }

  return (
    <View style={{padding: 16}}>
      <Row label="Button — the intended backing for <button>">
        <Host matchContents>
          {/* `label`, not a string child: `children` is forwarded into the
              native view as an element, so a bare string arrives as a `#text`
              node under a SwiftUI host and the mount fails with
              "ComponentView with componentHandle ... (`#text`) not found". */}
          <Button
            label={`Pressed ${presses}×`}
            onPress={() => setPresses(p => p + 1)}
          />
        </Host>
      </Row>

      <Row label="Switch — the intended backing for <input type=checkbox>">
        <Host matchContents>
          <Switch value={on} onValueChange={setOn} label={on ? 'On' : 'Off'} />
        </Host>
      </Row>

      <Row label="Slider — the intended backing for <input type=range>">
        {/* Sized rather than `matchContents`: a SwiftUI Slider has no
            intrinsic width, so sizing the host to its content collapses it. */}
        <Host style={{width: '100%', height: 40}}>
          <Slider
            value={value}
            onValueChange={setValue}
            min={0}
            max={1}
            step={0.05}
          />
        </Host>
      </Row>

      <Row label="Slider value, read back through React state">
        <Text style={{fontSize: 15}}>{value.toFixed(2)}</Text>
      </Row>
    </View>
  );
}

export default {
  title: 'Expo UI smoke test',
  category: 'UI',
  description:
    'Real native controls rendered from React through @expo/ui’s ' +
    'universal layer, proving the dependency is installed and working. ' +
    'These are the controls the HTML element catalog will be backed by.',
  examples: [
    {
      name: 'smoke',
      title: 'Universal native controls',
      render: () => <SmokeTest />,
    },
  ],
};
