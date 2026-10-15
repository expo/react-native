/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

const written: Array<string> = [];

jest.mock('react-native/Libraries/TurboModule/TurboModuleRegistry', () => {
  const actual = jest.requireActual<$FlowFixMe>(
    'react-native/Libraries/TurboModule/TurboModuleRegistry',
  );
  return {
    ...actual,
    get(name: string): unknown {
      if (name === 'Clipboard') {
        return {
          setString(text: string): void {
            written.push(text);
          },
          getString(): Promise<string> {
            return Promise.resolve(written.at(-1) ?? '');
          },
        };
      }
      return actual.get(name);
    },
  };
});

import {installDocumentShim} from '../document-shim';

// Installed here, over any other file's: Node's own `navigator`, which the
// shim extends, is one object for every test file a worker runs
const navigator: $FlowFixMe = (globalThis as $FlowFixMe).navigator;
delete navigator.clipboard;
installDocumentShim();

describe('navigator.clipboard', () => {
  it('writes text through the clipboard module', async () => {
    await navigator.clipboard.writeText('a prompt');
    expect(written).toEqual(['a prompt']);
  });

  it('reads the text back', async () => {
    await navigator.clipboard.writeText('another');
    expect(await navigator.clipboard.readText()).toBe('another');
  });
});
