/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true
 * @fantom_flags enableYogaDisplayBlock:true
 * @flow strict-local
 * @format
 */

/**
 * A state update driven by an image event must relayout without crashing.
 *
 * The image-events demo aborted the whole app on Android the moment
 * `shouldNotifyLoadEvents` made its events real: `Attempt to mutate a sealed
 * object` inside `YogaLayoutableShadowNode::layout`, from the commit the
 * `onLoadStart` handler's `setState` produced. The abort is in shared C++, so
 * the crash is reproducible — and therefore pinned — here, where an iteration
 * is seconds rather than a five-minute install.
 *
 * The tree deliberately mirrors the demo's shape: an `<img>` inside a case
 * card next to a text readout that CHANGES when the event lands, with sibling
 * cards that do not change — the sealed node the layout pass trips on is in
 * the unchanged part of the tree.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {useState} from 'react';

import '@react-native/expo-intrinsics-poc';

function Demo({label}: {label: string}) {
  return (
    // $FlowFixMe[prop-missing] intrinsic
    <div style={{padding: 12, marginBottom: 8}}>
      {/* $FlowFixMe[prop-missing] intrinsic */}
      <p>{label}</p>
      {/* $FlowFixMe[prop-missing] intrinsic */}
      <div style={{width: 100, height: 20}} />
    </div>
  );
}

function Loading({events}: {events: ReadonlyArray<string>}) {
  return (
    // $FlowFixMe[prop-missing] intrinsic
    <div style={{width: 360}}>
      <Demo label="an unchanged sibling card before" />
      {/* $FlowFixMe[prop-missing] intrinsic */}
      <div style={{padding: 12}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <img src="https://e.com/a.png" style={{width: 200, height: 60}} />
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <p>{events.length === 0 ? 'waiting…' : events.join(' → ')}</p>
      </div>
      <Demo label="an unchanged sibling card after" />
    </div>
  );
}

test('an event-driven setState after mount relayouts cleanly', () => {
  const root = Fantom.createRoot();
  let record: (name: string) => void = () => {};

  function Harness() {
    const [events, setEvents] = useState<ReadonlyArray<string>>([]);
    record = name => setEvents(e => [...e, name]);
    return <Loading events={events} />;
  }

  Fantom.runTask(() => {
    root.render(<Harness />);
  });

  // The demo's `onLoadStart` → `onLoad` → `onLoadEnd` sequence, as three
  // separate commits the way three separate events produce them.
  Fantom.runTask(() => record('loadstart'));
  Fantom.runTask(() => record('load'));
  Fantom.runTask(() => record('loadend'));

  expect(root.getRenderedOutput().toJSX()).toBeTruthy();
});
