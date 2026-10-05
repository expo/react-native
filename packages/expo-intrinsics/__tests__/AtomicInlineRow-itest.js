/**
 * @flow strict-local
 * @format
 */
import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

const B = {display: 'inline-block', verticalAlign: 'top'};

function rect(ref: {current: HostInstance | null}) {
  const r = ref.current?.getBoundingClientRect();
  if (r == null) {
    throw new Error('no render');
  }
  return `x=${r.x} y=${r.y} w=${r.width} h=${r.height}`;
}

test('three sized atomic inlines with no text', () => {
  const a = createRef<HostInstance>();
  const b = createRef<HostInstance>();
  const c = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing]
      <div style={{width: 300, lineHeight: 20, fontSize: 16}}>
        <span ref={a} style={{...B, width: 40, height: 20}} />
        <span ref={b} style={{...B, width: 60, height: 20}} />
        <span ref={c} style={{...B, width: 30, height: 20}} />
      </div>,
    );
  });
  console.log(
    'SAFARI  a x=0 y=0 w=40 h=20 | b x=40 y=0 w=60 h=20 | c x=100 y=0 w=30 h=20',
  );
  console.log('FANTOM  a', rect(a), '| b', rect(b), '| c', rect(c));
});

test('same row written with div instead of span', () => {
  const a = createRef<HostInstance>();
  const b = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing]
      <div style={{width: 300, lineHeight: 20, fontSize: 16}}>
        {/* $FlowFixMe[prop-missing] */}
        <div ref={a} style={{...B, width: 40, height: 20}} />
        {/* $FlowFixMe[prop-missing] */}
        <div ref={b} style={{...B, width: 60, height: 20}} />
      </div>,
    );
  });
  console.log('DIV     a', rect(a), '| b', rect(b));
});

test('row WITH a text node between the boxes', () => {
  const a = createRef<HostInstance>();
  const b = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing]
      <div style={{width: 300, lineHeight: 20, fontSize: 16}}>
        <span ref={a} style={{...B, width: 40, height: 20}} />{' '}
        <span ref={b} style={{...B, width: 60, height: 20}} />
      </div>,
    );
  });
  console.log('WITHTXT a', rect(a), '| b', rect(b));
});

test('span with display inline (not inline-block), sized', () => {
  const a = createRef<HostInstance>();
  const b = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing]
      <div style={{width: 300, lineHeight: 20, fontSize: 16}}>
        <span ref={a} style={{display: 'inline', width: 40, height: 20}} />
        <span ref={b} style={{display: 'inline', width: 60, height: 20}} />
      </div>,
    );
  });
  console.log('INLINE  a', rect(a), '| b', rect(b));
});
