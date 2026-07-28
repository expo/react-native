const APPLE_PLATFORMS_MACRO_MAP = {
  ios: 'TARGET_OS_IOS',
  macos: 'TARGET_OS_OSX',
  tvos: 'TARGET_OS_TV',
  visionos: 'TARGET_OS_VISION'
};
function generateSupportedApplePlatformsMacro(fileTemplate, supportedPlatformsMap) {
  if (!supportedPlatformsMap) {
    return fileTemplate;
  }
  const everyPlatformIsUnsupported = Object.keys(supportedPlatformsMap).every(platform => supportedPlatformsMap[platform] === false);
  if (everyPlatformIsUnsupported) {
    return fileTemplate;
  }
  const compilerMacroString = Object.keys(supportedPlatformsMap).reduce((acc, platform) => {
    if (!supportedPlatformsMap[platform]) {
      return [...acc, `!${APPLE_PLATFORMS_MACRO_MAP[platform]}`];
    }
    return acc;
  }, []).join(' && ');
  if (!compilerMacroString) {
    return fileTemplate;
  }
  return `#if ${compilerMacroString}
${fileTemplate}
#endif
`;
}
module.exports = {
  generateSupportedApplePlatformsMacro
};