/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 * @format
 */

'use strict';

/*
TODO:

- ViewConfigs should spread in View's valid attributes
*/
const schemaValidator = require('../SchemaValidator.js');
const generateComponentDescriptorCpp = require('./components/GenerateComponentDescriptorCpp.js');
const generateComponentDescriptorH = require('./components/GenerateComponentDescriptorH.js');
const generateComponentHObjCpp = require('./components/GenerateComponentHObjCpp.js');
const generateEventEmitterCpp = require('./components/GenerateEventEmitterCpp.js');
const generateEventEmitterH = require('./components/GenerateEventEmitterH.js');
const generatePropsCpp = require('./components/GeneratePropsCpp.js');
const generatePropsH = require('./components/GeneratePropsH.js');
const generatePropsJavaDelegate = require('./components/GeneratePropsJavaDelegate.js');
const generatePropsJavaInterface = require('./components/GeneratePropsJavaInterface.js');
const generateShadowNodeCpp = require('./components/GenerateShadowNodeCpp.js');
const generateShadowNodeH = require('./components/GenerateShadowNodeH.js');
const generateStateCpp = require('./components/GenerateStateCpp.js');
const generateStateH = require('./components/GenerateStateH.js');
const generateTests = require('./components/GenerateTests.js');
const generateThirdPartyFabricComponentsProviderH = require('./components/GenerateThirdPartyFabricComponentsProviderH.js');
const generateThirdPartyFabricComponentsProviderObjCpp = require('./components/GenerateThirdPartyFabricComponentsProviderObjCpp.js');
const generateViewConfigJs = require('./components/GenerateViewConfigJs.js');
const generateModuleCpp = require('./modules/GenerateModuleCpp.js');
const generateModuleH = require('./modules/GenerateModuleH.js');
const generateModuleJavaSpec = require('./modules/GenerateModuleJavaSpec.js');
const generateModuleJniCpp = require('./modules/GenerateModuleJniCpp.js');
const generateModuleJniH = require('./modules/GenerateModuleJniH.js');
const generateModuleObjCpp = require('./modules/GenerateModuleObjCpp');
const fs = require('fs');
const path = require('path');
const ALL_GENERATORS = {
  generateComponentDescriptorH: generateComponentDescriptorH.generate,
  generateComponentDescriptorCpp: generateComponentDescriptorCpp.generate,
  generateComponentHObjCpp: generateComponentHObjCpp.generate,
  generateEventEmitterCpp: generateEventEmitterCpp.generate,
  generateEventEmitterH: generateEventEmitterH.generate,
  generatePropsCpp: generatePropsCpp.generate,
  generatePropsH: generatePropsH.generate,
  generateStateCpp: generateStateCpp.generate,
  generateStateH: generateStateH.generate,
  generateModuleH: generateModuleH.generate,
  generateModuleCpp: generateModuleCpp.generate,
  generateModuleObjCpp: generateModuleObjCpp.generate,
  generateModuleJavaSpec: generateModuleJavaSpec.generate,
  generateModuleJniCpp: generateModuleJniCpp.generate,
  generateModuleJniH: generateModuleJniH.generate,
  generatePropsJavaInterface: generatePropsJavaInterface.generate,
  generatePropsJavaDelegate: generatePropsJavaDelegate.generate,
  generateTests: generateTests.generate,
  generateShadowNodeCpp: generateShadowNodeCpp.generate,
  generateShadowNodeH: generateShadowNodeH.generate,
  generateThirdPartyFabricComponentsProviderObjCpp:
    generateThirdPartyFabricComponentsProviderObjCpp.generate,
  generateThirdPartyFabricComponentsProviderH:
    generateThirdPartyFabricComponentsProviderH.generate,
  generateViewConfigJs: generateViewConfigJs.generate,
};
const LIBRARY_GENERATORS = {
  descriptors: [
    generateComponentDescriptorCpp.generate,
    generateComponentDescriptorH.generate,
  ],
  events: [generateEventEmitterCpp.generate, generateEventEmitterH.generate],
  states: [generateStateCpp.generate, generateStateH.generate],
  props: [
    generateComponentHObjCpp.generate,
    generatePropsCpp.generate,
    generatePropsH.generate,
    generatePropsJavaInterface.generate,
    generatePropsJavaDelegate.generate,
  ],
  // TODO: Refactor this to consolidate various C++ output variation instead of forking per platform.
  componentsAndroid: [
    // JNI/C++ files
    generateComponentDescriptorH.generate,
    generateComponentDescriptorCpp.generate,
    generateEventEmitterCpp.generate,
    generateEventEmitterH.generate,
    generatePropsCpp.generate,
    generatePropsH.generate,
    generateStateCpp.generate,
    generateStateH.generate,
    generateShadowNodeCpp.generate,
    generateShadowNodeH.generate,
    // Java files
    generatePropsJavaInterface.generate,
    generatePropsJavaDelegate.generate,
  ],
  componentsIOS: [
    generateComponentDescriptorH.generate,
    generateComponentDescriptorCpp.generate,
    generateEventEmitterCpp.generate,
    generateEventEmitterH.generate,
    generateComponentHObjCpp.generate,
    generatePropsCpp.generate,
    generatePropsH.generate,
    generateStateCpp.generate,
    generateStateH.generate,
    generateShadowNodeCpp.generate,
    generateShadowNodeH.generate,
  ],
  modulesAndroid: [
    generateModuleJniCpp.generate,
    generateModuleJniH.generate,
    generateModuleJavaSpec.generate,
  ],
  modulesCxx: [generateModuleCpp.generate, generateModuleH.generate],
  modulesIOS: [generateModuleObjCpp.generate],
  tests: [generateTests.generate],
  'shadow-nodes': [
    generateShadowNodeCpp.generate,
    generateShadowNodeH.generate,
  ],
};
const SCHEMAS_GENERATORS = {
  providerIOS: [
    generateThirdPartyFabricComponentsProviderObjCpp.generate,
    generateThirdPartyFabricComponentsProviderH.generate,
  ],
};
function writeMapToFiles(map) {
  let success = true;
  map.forEach(file => {
    try {
      const location = path.join(file.outputDir, file.name);
      const dirName = path.dirname(location);
      if (!fs.existsSync(dirName)) {
        fs.mkdirSync(dirName, {
          recursive: true,
        });
      }
      fs.writeFileSync(location, file.content);
    } catch (error) {
      success = false;
      console.error(`Failed to write ${file.name} to ${file.outputDir}`, error);
    }
  });
  return success;
}
function checkFilesForChanges(generated) {
  let hasChanged = false;
  generated.forEach(file => {
    const location = path.join(file.outputDir, file.name);
    const currentContents = fs.readFileSync(location, 'utf8');
    if (currentContents !== file.content) {
      console.error(`- ${file.name} has changed`);
      hasChanged = true;
    }
  });
  return !hasChanged;
}
function checkOrWriteFiles(generatedFiles, test) {
  if (test === true) {
    return checkFilesForChanges(generatedFiles);
  }
  return writeMapToFiles(generatedFiles);
}
module.exports = {
  allGenerators: ALL_GENERATORS,
  generate(
    {
      libraryName,
      schema,
      outputDirectory,
      packageName,
      assumeNonnull,
      useLocalIncludePaths,
      libraryGenerators = LIBRARY_GENERATORS,
    },
    {generators, test},
  ) {
    schemaValidator.validate(schema);
    const defaultHeaderPrefix = 'react/renderer/components';
    const headerPrefix =
      useLocalIncludePaths === true
        ? ''
        : `${defaultHeaderPrefix}/${libraryName}/`;
    function composePath(intermediate) {
      return path.join(outputDirectory, intermediate, libraryName);
    }
    const componentIOSOutput = composePath(
      useLocalIncludePaths === true ? '' : defaultHeaderPrefix,
    );
    const modulesIOSOutput = composePath('./');
    const outputFoldersForGenerators = {
      componentsIOS: componentIOSOutput,
      modulesIOS: modulesIOSOutput,
      descriptors: outputDirectory,
      events: outputDirectory,
      props: outputDirectory,
      states: outputDirectory,
      componentsAndroid: outputDirectory,
      modulesAndroid: outputDirectory,
      modulesCxx: outputDirectory,
      tests: outputDirectory,
      'shadow-nodes': outputDirectory,
    };
    const generatedFiles = [];
    for (const name of generators) {
      for (const generator of libraryGenerators[name]) {
        generator(
          libraryName,
          schema,
          packageName,
          assumeNonnull,
          headerPrefix,
        ).forEach((contents, fileName) => {
          generatedFiles.push({
            name: fileName,
            content: contents,
            outputDir: outputFoldersForGenerators[name],
          });
        });
      }
    }
    return checkOrWriteFiles(generatedFiles, test);
  },
  generateFromSchemas(
    {schemas, outputDirectory, supportedApplePlatforms},
    {generators, test},
  ) {
    Object.keys(schemas).forEach(libraryName =>
      schemaValidator.validate(schemas[libraryName]),
    );
    const generatedFiles = [];
    for (const name of generators) {
      for (const generator of SCHEMAS_GENERATORS[name]) {
        generator(schemas, supportedApplePlatforms).forEach(
          (contents, fileName) => {
            generatedFiles.push({
              name: fileName,
              content: contents,
              outputDir: outputDirectory,
            });
          },
        );
      }
    }
    return checkOrWriteFiles(generatedFiles, test);
  },
  generateViewConfig({libraryName, schema}) {
    schemaValidator.validate(schema);
    const result = generateViewConfigJs
      .generate(libraryName, schema)
      .values()
      .next();
    if (typeof result.value !== 'string') {
      throw new Error(`Failed to generate view config for ${libraryName}`);
    }
    return result.value;
  },
};
