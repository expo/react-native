#!/bin/zsh
# Reproducible string-children benchmarks (string-children-perf-plan.md).
#
# Every performance claim in the plan should be re-checkable with:
#
#   ./bench-string-children.sh            # benchmark suites, release tester
#   ./bench-string-children.sh --sizes    # struct-size probe only
#
# Debug-build numbers are misleading (they overstated cascade costs 3-10x and
# hid the real hot spots), so this builds and swaps in a RELEASE (-O3) tester,
# runs the suites, and restores the debug tester afterwards.
set -e
cd "$(dirname "$0")"
export PATH=/opt/homebrew/bin:$PATH

RN=packages/react-native
TESTER=private/react-native-fantom/build/tester
RELEASE=private/react-native-fantom/build/tester-release

probe_sizes() {
  local probe=/tmp/string-children-sizeprobe
  cat > $probe.cpp <<'EOF'
#include <react/renderer/attributedstring/TextAttributes.h>
#include <react/renderer/components/view/YogaLayoutableShadowNode.h>
#include <react/renderer/components/view/ViewShadowNode.h>
#include <cstdio>
using namespace facebook::react;
int main() {
  printf("TextAttributes:            %4zu bytes\n", sizeof(TextAttributes));
  printf("YogaLayoutableShadowNode:  %4zu bytes\n", sizeof(YogaLayoutableShadowNode));
  printf("ViewShadowNode:            %4zu bytes\n", sizeof(ViewShadowNode));
  return 0;
}
EOF
  c++ -std=c++20 -arch arm64 -O1 -fexceptions -frtti \
    -DFOLLY_NO_CONFIG=1 -DFOLLY_USE_LIBCPP=1 -DFOLLY_CFG_NO_COROUTINES=1 -DFOLLY_MOBILE=0 \
    -I$RN/ReactCommon -I$RN/ReactCommon/jsi -I$RN/ReactCommon/runtimeexecutor \
    -I$RN/ReactCommon/oscompat/. -I$RN/ReactCommon/react/utils/platform/cxx \
    -I$RN/ReactCommon/react/renderer/graphics/platform/cxx \
    -I$RN/ReactCommon/react/renderer/textlayoutmanager/platform/cxx \
    -I$RN/ReactCommon/react/renderer/components/view/platform/cxx \
    -I$RN/ReactCommon/react/renderer/components/text/platform/cxx \
    -Iprivate/react-native-fantom/build/third-party/folly/. \
    -I$RN/ReactAndroid/build/third-party-ndk/glog/exported \
    -I$RN/ReactAndroid/build/third-party-ndk/double-conversion/. \
    -I$RN/ReactAndroid/build/third-party-ndk/boost/boost_1_83_0 \
    -I$RN/ReactAndroid/build/third-party-ndk/fmt/include \
    -I$RN/ReactAndroid/build/third-party-ndk/fast_float/include \
    -I$RN/ReactCommon/yoga \
    $probe.cpp -o $probe -Wl,-undefined,dynamic_lookup
  $probe
}

if [[ "$1" == "--sizes" ]]; then
  probe_sizes
  exit 0
fi

echo "== Building release tester (first run takes a while) =="
if [[ ! -d $RELEASE ]]; then
  cmake private/react-native-fantom/tester -B $RELEASE \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_FLAGS="-Wno-deprecated-literal-operator" \
    -DREACT_ANDROID_DIR=$PWD/$RN/ReactAndroid \
    -DREACT_COMMON_DIR=$PWD/$RN/ReactCommon \
    -DREACT_CXX_PLATFORM_DIR=$PWD/$RN/ReactCxxPlatform \
    -DREACT_THIRD_PARTY_NDK_DIR=$PWD/$RN/ReactAndroid/build/third-party-ndk \
    -DFANTOM_THIRD_PARTY_DIR=$PWD/private/react-native-fantom/build/third-party \
    -DFANTOM_CODEGEN_DIR=$PWD/private/react-native-fantom/build/codegen \
    -DHERMES_V1_ENABLED=1
fi
cmake --build $RELEASE --target fantom_tester -j 10

echo "== Swapping in the release tester =="
cp $TESTER/fantom_tester /tmp/fantom_tester_debug_backup.$$
cp $RELEASE/fantom_tester $TESTER/fantom_tester
restore() { cp /tmp/fantom_tester_debug_backup.$$ $TESTER/fantom_tester; rm -f /tmp/fantom_tester_debug_backup.$$; }
trap restore EXIT

echo "== Struct sizes =="
probe_sizes

echo "== Benchmarks (release, both flag values) =="
FANTOM_FORCE_OSS_BUILD=1 FANTOM_RUN_BENCHMARKS=1 \
  node node_modules/jest/bin/jest.js \
  --config private/react-native-fantom/config/jest.config.js \
  StringChildrenOverhead InlineAppendScaling 2>&1 \
  | grep -vE "Deep imports|Jest did not|asynchronous"
