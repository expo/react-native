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

/**
 * A `background-image: url()` is drawn by an image filling the box behind the
 * element's children. The image is the box's size whatever its source says:
 * a resolved asset carries its own width and height, which an image takes as
 * its size over its four edges, and Login SSO's 1200pt photo drew from the
 * page's corner and made the page scroll sideways.
 */

import {jsx} from '../jsx-runtime';
import {setRootRelativeSourceResolver} from '@react-native/expo-intrinsics-poc/src/rootRelativeSources';
import {StyleSheet} from 'react-native';
import TestRenderer from 'react-test-renderer';

function renderTree(element: $FlowFixMe): $FlowFixMe {
  let renderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(element);
  });
  if (renderer == null) {
    throw new Error('nothing rendered');
  }
  return renderer.toJSON();
}

function find(node: $FlowFixMe, type: $FlowFixMe): $FlowFixMe {
  if (node == null || typeof node !== 'object') {
    return null;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, type);
      if (found != null) {
        return found;
      }
    }
    return null;
  }
  if (node.type === type) {
    return node;
  }
  return find(node.children, type);
}

describe('a block with a background image', () => {
  beforeAll(() => {
    // An app's bundled copy, resolved with its size as an asset is
    setRootRelativeSourceResolver(path =>
      path === '/photo.png'
        ? {uri: 'file:///bundle/photo.jpg', width: 1200, height: 800}
        : null,
    );
  });

  const page = jsx('div', {
    style: {
      minHeight: 200,
      backgroundImage: 'url(/photo.png)',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    },
    children: jsx('p', {children: 'over the photo'}),
  });

  it('draws the image over the whole box, covering it', () => {
    const image = find(renderTree(page), 'Image');
    expect(image).not.toBeNull();
    const style: $FlowFixMe = StyleSheet.flatten(image.props.style);
    expect(style).toMatchObject({
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    });
    expect(style.width).toBe(undefined);
    expect(style.height).toBe(undefined);
    expect(image.props.resizeMode).toBe('cover');
  });

  it('leaves the asset size off the image', () => {
    const image = find(renderTree(page), 'Image');
    const source = Array.isArray(image.props.source)
      ? image.props.source[0]
      : image.props.source;
    expect(source.uri).toBe('file:///bundle/photo.jpg');
    expect(source.width).toBe(undefined);
    expect(source.height).toBe(undefined);
  });

  it('takes the background properties off the element', () => {
    const div = find(renderTree(page), 'div');
    const style: $FlowFixMe = StyleSheet.flatten(div.props.style);
    expect(style.backgroundImage).toBe(undefined);
    expect(style.backgroundSize).toBe(undefined);
    expect(style.minHeight).toBe(200);
  });
});
