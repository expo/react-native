# Copyright (c) Meta Platforms, Inc. and affiliates.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.

cmake_minimum_required(VERSION 3.13)
set(CMAKE_VERBOSE_MAKEFILE on)

add_compile_options(-fvisibility=hidden -fexceptions -frtti)

file(GLOB jscexecutor_SRC CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/*.cpp)
add_library(jscexecutor SHARED ${jscexecutor_SRC})

target_include_directories(jscexecutor PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

# explicitly link libgcc.a to prevent undefined `_Unwind_Resume` symbol and crash from throwing c++ exceptions even someone tries to catch the exceptions.
# according to https://android.googlesource.com/platform/ndk/+/master/docs/BuildSystemMaintainers.md#unwinding,
# we should put the unwinder between static libs and shared libs.
#
# TODO: we don't need this patch anymore after upgrading to ndk r23 (AGP 7.3 default side-by-side ndk, or react-native 0.71)
if(ANDROID_NDK_REVISION VERSION_LESS "23.0.0")
  set(LIB_UNWIND gcc)
else()
  set(LIB_UNWIND)
endif()

target_link_libraries(jscexecutor
        jsireact
        jscruntime
        ${LIB_UNWIND}
        fb
        fbjni
        folly_runtime
        jsi
        reactnativejni)
