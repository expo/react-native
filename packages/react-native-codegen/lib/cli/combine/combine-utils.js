'use strict';

const path = require('path');
function filterJSFile(originalFilePath, currentPlatform, excludeRegExp) {
  const filePath = originalFilePath.replace(/\.fb(\.|$)/, '$1');
  const basename = path.basename(filePath);
  const isSpecFile = /^(Native.+|.+NativeComponent)/.test(basename);
  const isNotNativeUIManager = !filePath.endsWith('NativeUIManager.js');
  const isNotTest = !filePath.includes('__tests');
  const isNotExcluded = excludeRegExp == null || !excludeRegExp.test(filePath);
  const isNotTSTypeDefinition = !filePath.endsWith('.d.ts');
  const isValidCandidate = isSpecFile && isNotNativeUIManager && isNotExcluded && isNotTest && isNotTSTypeDefinition;
  const filenameComponents = basename.split('.');
  const isPlatformAgnostic = filenameComponents.length === 2;
  if (currentPlatform == null) {
    return isValidCandidate && isPlatformAgnostic;
  }
  if (isPlatformAgnostic) {
    return isValidCandidate;
  }
  const filePlatform = filenameComponents.length > 2 ? filenameComponents[1] : 'unknown';
  return isValidCandidate && currentPlatform === filePlatform;
}
module.exports = {
  filterJSFile
};