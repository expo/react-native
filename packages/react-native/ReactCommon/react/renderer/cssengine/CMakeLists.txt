# Copyright (c) Meta Platforms, Inc. and affiliates.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.

cmake_minimum_required(VERSION 3.13)
set(CMAKE_VERBOSE_MAKEFILE on)

include(${REACT_COMMON_DIR}/cmake-utils/react-native-flags.cmake)

file(GLOB react_renderer_cssengine_SRC CONFIGURE_DEPENDS *.cpp)
add_library(react_renderer_cssengine OBJECT ${react_renderer_cssengine_SRC})

target_include_directories(react_renderer_cssengine PUBLIC ${REACT_COMMON_DIR})

target_link_libraries(react_renderer_cssengine
        folly_runtime
        glog
        jsi
        react_cxxstableapi
        react_debug
        react_renderer_bridging
        react_renderer_core
        react_renderer_css
        react_renderer_graphics
        react_renderer_mounting
        react_renderer_uimanager
        rrc_root
)
target_compile_reactnative_options(react_renderer_cssengine PRIVATE)
target_compile_options(react_renderer_cssengine PRIVATE -Wpedantic)
