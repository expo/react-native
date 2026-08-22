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
 * Proof that @expo/ui is wired into the tester: real native views — SwiftUI on
 * iOS, Jetpack Compose on Android — rendered from React, in this app.
 *
 * This is the install's acceptance test rather than a design demo. It renders
 * the controls the HTML element catalog intends to back `<button>`,
 * `<input type=checkbox>` and `<input type=range>` with, so that "the
 * dependency is installed" and "the dependency renders" are not confused for
 * each other.
 *
 * One file, both platforms: these come from @expo/ui's **universal** layer,
 * which is why there is no `.ios`/`.android` split here. The platform entry
 * points (`@expo/ui/swift-ui`, `@expo/ui/jetpack-compose`) are single-platform
 * and crash on the other one with "Unable to get view config" — the universal
 * root is what makes one tree legal on both, and it is the tier the element
 * catalog targets for exactly that reason.
 *
 * Note the prop names below: Slider's `min`/`max`/`step` are already HTML's
 * `<input type=range>` attributes, spelled identically. That correspondence is
 * the thing being checked here, not a coincidence worth relying on silently.
 */

/*
 * Required rather than imported, so an unlinked platform can be DETECTED.
 *
 * `import {Host} from '@expo/ui'` compiles to a property read on the module
 * object, so when that object is undefined — which is what Android does here,
 * having no Expo autolinking — every reference to `Host` throws, including a
 * `Host != null` guard written to avoid the throw. The first attempt at this
 * check failed on its own null test.
 *
 * A guarded require keeps the failure where it can be answered.
 */
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

/**
 * Whether `@expo/ui`'s native side is actually present.
 *
 * It is not on Android in this checkout: the iOS build autolinks Expo modules
 * through the local expo clone (`use_expo_modules!` in the Podfile), and the
 * Android build has no Expo autolinking configured at all. `Host` therefore
 * arrives `undefined` there and rendering it threw
 * `Cannot read property 'Host' of undefined`.
 *
 * The surface error boundary caught that, which is the boundary doing its job —
 * but an unmet dependency is an EXPECTED condition on this platform, not an
 * exceptional one, and a demo that throws on a condition it can test for is
 * relying on the boundary as control flow. It also made this the one red frame
 * in the cross-platform comparison report, which reads as a product failure
 * rather than a missing build step.
 *
 * Closing it properly means wiring Expo autolinking into
 * `packages/rn-tester/android` the way the Podfile does for iOS. Until then the
 * screen says what is missing instead of failing.
 */
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
