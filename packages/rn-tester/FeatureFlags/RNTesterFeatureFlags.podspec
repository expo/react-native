# Copyright (c) Meta Platforms, Inc. and affiliates.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.

require "json"
package = JSON.parse(File.read(File.join(__dir__, "../package.json")))

Pod::Spec.new do |s|
  s.name = "RNTesterFeatureFlags"
  s.version = package["version"]
  s.summary = "React Native's internal RNTester feature-flag bootstrap"
  s.homepage = "https://github.com/facebook/react-native"
  s.license = "MIT"
  s.author = "Meta Platforms, Inc. and its affiliates"
  s.source = { :git => "https://github.com/facebook/react-native.git", :tag => s.version.to_s }
  s.platforms = min_supported_versions
  s.source_files = "*.{h,cpp}"
  s.pod_target_xcconfig = { "CLANG_CXX_LANGUAGE_STANDARD" => rct_cxx_language_standard() }
  s.dependency "React-featureflags"

  # Core-owned test support may configure private experimental flags. The
  # tester app and third-party SDKs keep consuming the public API.
  mark_as_react_native_build(s)
end
