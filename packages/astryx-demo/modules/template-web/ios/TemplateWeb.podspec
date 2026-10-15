require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'TemplateWeb'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = 'Meta Platforms, Inc. and affiliates'
  s.homepage       = 'https://github.com/facebook/react-native'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/facebook/react-native.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,mm,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
    # Fabric's view props include Yoga's private headers.
    'HEADER_SEARCH_PATHS' => '"$(PODS_ROOT)/Headers/Private/Yoga"',
  }
  # The one .mm (ExpoFabricViewObjC+SynchronousEvents) reaches the view's event
  # emitter, which needs the React header environment; this adds to the
  # settings above.
  install_modules_dependencies(s) if defined?(install_modules_dependencies)
end
