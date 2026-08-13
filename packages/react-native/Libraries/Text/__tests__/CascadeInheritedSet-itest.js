/**
 * @fantom_flags enableStringChildren:true
 * @flow strict-local
 * @format
 */
import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {View} from 'react-native';

/*
 * Every property the cascade inherits, asked the same question: does a bare
 * string child two levels down carry the value an ancestor stated?
 *
 * Asking them one at a time is how a property gets left out — `fontVariant`
 * and `whiteSpace` had no cascade test of their own, and the set the Astryx
 * shim mirrors had drifted from this one in both directions.
 *
 * `textTransform` and `whiteSpace` are absent because this runner cannot see
 * them: the mounted output carries the ORIGINAL string, so an uppercased
 * fragment is indistinguishable from an untransformed one — `<Text>` with
 * `textTransform` reports exactly the same, which is what rules out the
 * cascade rather than the instrument. They need a device to assert.
 */

function mountedWith(prop: string, style: {[string]: unknown}): string {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // The table below is one row per property, so its value type is the
      // union of them all rather than an exact style object.
      // $FlowExpectedError[incompatible-type]
      <View style={style}>
        <View>{'text'}</View>
      </View>,
    );
  });
  const out = JSON.stringify(root.getRenderedOutput({props: [prop]}).toJSX());
  root.destroy();
  return out ?? '';
}

// `prop` is the name the MOUNTED output reports, which is not always the style
// name — the text attributes are serialised under their own names.
const INHERITED: Array<[string, {[string]: unknown}, string]> = [
  ['foregroundColor', {color: 'rgb(255, 0, 0)'}, '255, 0, 0'],
  ['fontSize', {fontSize: 33}, '33'],
  ['fontWeight', {fontWeight: 'bold'}, '700'],
  ['fontStyle', {fontStyle: 'italic'}, 'talic'],
  ['fontVariant', {fontVariant: ['small-caps']}, 'mall-caps'],
  ['letterSpacing', {letterSpacing: 7}, '7'],
  ['lineHeight', {lineHeight: 41}, '41'],
  ['alignment', {textAlign: 'right'}, 'ight'],
];

describe('the inherited set reaches a bare string', () => {
  for (const [prop, style, expected] of INHERITED) {
    it(`${Object.keys(style)[0]} inherits through a View`, () => {
      expect(mountedWith(prop, style)).toContain(expected);
    });
  }
});
