/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

const {combineSchemasInFileList} = require('../combine-js-to-schema');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

it('generates a dependency installed in node_modules without absorbing its nested dependencies', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codegen-library-'));
  try {
    const library = path.join(temporary, 'node_modules', 'owner');
    const nested = path.join(library, 'node_modules', 'dependency');
    fs.mkdirSync(nested, {recursive: true});
    const spec = (name: string) => `
      import type {TurboModule} from 'react-native';
      import {TurboModuleRegistry} from 'react-native';
      export interface Spec extends TurboModule { ping(): void; }
      export default TurboModuleRegistry.getEnforcing<Spec>('${name}');
    `;
    fs.writeFileSync(path.join(library, 'NativeOwner.js'), spec('Owner'));
    fs.writeFileSync(
      path.join(nested, 'NativeDependency.js'),
      spec('Dependency'),
    );
    expect(
      Object.keys(
        combineSchemasInFileList([library], 'ios', null, 'OwnerLibrary')
          .modules,
      ),
    ).toEqual(['NativeOwner']);
    expect(
      Object.keys(
        combineSchemasInFileList([nested], 'ios', null, 'DependencyLibrary')
          .modules,
      ),
    ).toEqual(['NativeDependency']);
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
});
