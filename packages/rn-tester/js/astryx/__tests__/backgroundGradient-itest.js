/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

/**
 * A gradient `background-image` (css-images-3 §3) is drawn by the renderer's
 * own `backgroundImage`, under the element's children. Astryx tints a
 * composer's attachment drawer with a one-colour gradient over the surface
 * colour, written with theme variables that resolve through `light-dark()`.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {installStylesheet} from '../css';
import {jsx} from '../jsx-runtime';
import * as stylex from '../stylex-rn';
import * as Fantom from '@react-native/fantom';

const MUTED = 'rgba(241, 241, 241, 1)';

const styles = stylex.create({
  tinted: {
    width: 100,
    height: 40,
    backgroundColor: 'white',
    backgroundImage: 'linear-gradient(var(--muted), var(--muted))',
  },
  gradientOnly: {
    width: 100,
    height: 40,
    backgroundImage: 'linear-gradient(to right, #f1f1f1, transparent)',
  },
  none: {
    width: 100,
    height: 40,
    backgroundColor: 'white',
    backgroundImage: 'none',
  },
});

function rendered(style: unknown): string {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      jsx('div', {...stylex.props(style as $FlowFixMe)}) as $FlowFixMe,
    );
  });
  return (
    JSON.stringify(
      root
        .getRenderedOutput({props: ['backgroundImage', 'backgroundColor']})
        .toJSX(),
    ) ?? ''
  );
}

describe('a gradient background', () => {
  it('draws through theme variables and light-dark()', () => {
    installStylesheet(':root { --muted: light-dark(#f1f1f1, #1b1b1b) }');
    const output = rendered(styles.tinted);
    expect(output).toContain(`linear-gradient(180deg, ${MUTED}, ${MUTED})`);
    expect(output).toContain('rgba(255, 255, 255, 1)');
  });

  it('keeps an element that paints nothing else', () => {
    expect(rendered(styles.gradientOnly)).toContain('linear-gradient(90deg');
  });

  it('draws nothing for none', () => {
    expect(rendered(styles.none)).not.toContain('gradient');
  });
});
