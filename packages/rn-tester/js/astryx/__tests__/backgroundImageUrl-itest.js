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
 * A `background-image: url()` is a layer the element's view loads and draws
 * (css-backgrounds-3 §3.3). The runtime resolves the URL as the style reaches
 * the engine, a root-relative one naming what the app's root holds as an
 * `<img src>`'s does, and the engine hands the view the image with the size,
 * position and repeat it is drawn at, from the longhands or the `background`
 * shorthand. Login SSO's photo is one.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {installStylesheet} from '../css';
import {jsx} from '../jsx-runtime';
import {nodeOf} from '../native-css/engine';
import * as stylex from '../stylex-rn';
import {setRootRelativeSourceResolver} from '@react-native/expo-intrinsics-poc/src/rootRelativeSources';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

const BUILDING = 'file:///app/assets/template-assets/building.jpg';

setRootRelativeSourceResolver(path =>
  path === '/template-assets/building.png' ? {uri: BUILDING} : null,
);

function elementRef(): {current: $FlowFixMe} {
  return React.createRef<$FlowFixMe>();
}

// What the engine resolved for an element, and its view's background image
// as the renderer parsed it
function render(props: {[string]: unknown}): {
  element: $FlowFixMe,
  engine: () => {[string]: $FlowFixMe},
  rendered: () => string,
} {
  const root = Fantom.createRoot();
  const ref = elementRef();
  Fantom.runTask(() => {
    root.render(jsx('div', {...props, ref}) as $FlowFixMe);
  });
  return {
    element: ref.current,
    engine: () => global.__cssEngine.explain(nodeOf(ref.current))?.props ?? {},
    rendered: () =>
      JSON.stringify(
        root.getRenderedOutput({props: ['backgroundImage']}).toJSX(),
      ) ?? '',
  };
}

const styles = stylex.create({
  sso: {
    minHeight: 100,
    backgroundImage: 'url(/template-assets/building.png)',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  },
});

describe('a url() background', () => {
  it('names the resolved image, sized and placed, from an inline style', () => {
    const {engine, rendered} = render({
      style: {
        minHeight: 100,
        backgroundImage: 'url(/template-assets/building.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      },
    });
    expect(rendered()).toContain(`url(\\"${BUILDING}\\")`);
    expect(engine().backgroundSize).toEqual(['cover']);
    expect(engine().backgroundPosition).toEqual([{left: '50%', top: '50%'}]);
  });

  it('names it from a StyleX style', () => {
    const {rendered} = render({...stylex.props(styles.sso)});
    expect(rendered()).toContain(`url(\\"${BUILDING}\\")`);
  });

  it('keeps a URL the app does not resolve as written', () => {
    const {rendered} = render({
      style: {
        height: 10,
        backgroundImage:
          "url('https://example.com/a.png'), url(/elsewhere/b.png)",
      },
    });
    expect(rendered()).toContain('url(\\"https://example.com/a.png\\")');
    expect(rendered()).toContain('url(\\"/elsewhere/b.png\\")');
  });

  it('stacks with a gradient, in order', () => {
    const {rendered} = render({
      style: {
        height: 10,
        backgroundImage:
          'url(/template-assets/building.png), linear-gradient(red, blue)',
      },
    });
    const output = rendered();
    expect(output.indexOf('url(')).toBeLessThan(
      output.indexOf('linear-gradient('),
    );
  });

  it('comes from the background shorthand in a sheet', () => {
    installStylesheet(
      '.hero { background: #ffffff url("/template-assets/building.png") right 10px top/50% auto no-repeat }',
    );
    const {engine, rendered} = render({className: 'hero', style: {height: 10}});
    expect(rendered()).toContain(`url(\\"${BUILDING}\\")`);
    expect(engine().backgroundPosition).toEqual([{right: 10, top: '0%'}]);
    expect(engine().backgroundSize).toEqual([{x: '50%', y: 'auto'}]);
    expect(engine().backgroundRepeat).toEqual([
      {x: 'no-repeat', y: 'no-repeat'},
    ]);
    expect(engine().backgroundColor).toBe(-1);
  });

  it('takes each layer of the shorthand', () => {
    const {engine, rendered} = render({
      style: {
        height: 10,
        background:
          'url(/template-assets/building.png) center / cover, linear-gradient(red, blue) repeat-x',
      },
    });
    expect(engine().backgroundImage).toContain(`url(${BUILDING}), linear-`);
    expect(engine().backgroundSize).toEqual(['cover', {x: 'auto', y: 'auto'}]);
    expect(engine().backgroundRepeat).toEqual([
      {x: 'repeat', y: 'repeat'},
      {x: 'repeat', y: 'no-repeat'},
    ]);
    expect(rendered()).toContain('linear-gradient(');
  });

  it('keeps a layer that names no image in its place', () => {
    const {rendered} = render({
      style: {
        height: 10,
        backgroundImage: 'none, url(/template-assets/building.png)',
      },
    });
    expect(rendered()).toContain(`[url(\\"\\"), url(\\"${BUILDING}\\")]`);
  });

  it('is reset by a shorthand that names no image', () => {
    const {engine, rendered} = render({
      style: {
        height: 10,
        backgroundImage: 'url(/template-assets/building.png)',
        backgroundSize: 'contain',
        background: 'red',
      },
    });
    expect(rendered()).not.toContain('url(');
    expect(engine().backgroundSize).toBeUndefined();
  });

  it('follows a script write to element.style', () => {
    const {element, rendered} = render({style: {height: 10}});
    Fantom.runTask(() => {
      element.style.backgroundImage = 'url(/template-assets/building.png)';
    });
    expect(rendered()).toContain(`url(\\"${BUILDING}\\")`);
  });
});

describe('the background longhands', () => {
  function engineFor(style: {[string]: unknown}): {[string]: $FlowFixMe} {
    return render({style: {...style, height: 10}}).engine();
  }

  it('place the image by keywords and offsets', () => {
    expect(engineFor({backgroundPosition: 'top'}).backgroundPosition).toEqual([
      {left: '50%', top: '0%'},
    ]);
    expect(
      engineFor({backgroundPosition: 'bottom left'}).backgroundPosition,
    ).toEqual([{left: '0%', top: '100%'}]);
    expect(
      engineFor({backgroundPosition: '10px 20%'}).backgroundPosition,
    ).toEqual([{left: 10, top: '20%'}]);
    expect(
      engineFor({backgroundPosition: 'left 10px bottom 20%'})
        .backgroundPosition,
    ).toEqual([{left: 10, bottom: '20%'}]);
    expect(
      engineFor({backgroundPosition: 'center bottom 4px'}).backgroundPosition,
    ).toEqual([{bottom: 4, left: '50%'}]);
    expect(
      engineFor({backgroundPosition: 'top 10px'}).backgroundPosition,
    ).toBeUndefined();
  });

  it('size it by keywords, lengths and percentages', () => {
    expect(engineFor({backgroundSize: 'contain'}).backgroundSize).toEqual([
      'contain',
    ]);
    expect(engineFor({backgroundSize: '100px'}).backgroundSize).toEqual([
      {x: 100, y: 'auto'},
    ]);
    expect(engineFor({backgroundSize: '50% 2rem'}).backgroundSize).toEqual([
      {x: '50%', y: 32},
    ]);
    expect(engineFor({backgroundSize: '-1px'}).backgroundSize).toBeUndefined();
    // The initial value is the renderer's default, so it is not handed on
    expect(engineFor({backgroundSize: 'auto'}).backgroundSize).toBeUndefined();
  });

  it('repeat it along either axis', () => {
    expect(engineFor({backgroundRepeat: 'repeat-x'}).backgroundRepeat).toEqual([
      {x: 'repeat', y: 'no-repeat'},
    ]);
    expect(
      engineFor({backgroundRepeat: 'space round, no-repeat'}).backgroundRepeat,
    ).toEqual([
      {x: 'space', y: 'round'},
      {x: 'no-repeat', y: 'no-repeat'},
    ]);
    expect(
      engineFor({backgroundRepeat: 'repeat'}).backgroundRepeat,
    ).toBeUndefined();
  });
});
