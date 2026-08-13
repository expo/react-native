#!/bin/zsh
# Struct sizes for a given react-native tree, so upstream `main` and the
# text-children branch can be compared on memory as well as time.
#
#   ./bench-sizes-crosstree.sh <tree-root> [<tree-root> ...]
#
# Prints, per tree, the size of every structure a text-bearing screen
# allocates per node. Multiply by the node counts a workload creates and you
# have its shadow-tree memory exactly, with no sampling and no noise.
#
# The third-party headers (folly, boost, glog, fmt) come from THIS tree in
# both cases. They are the same vendored versions in both — the worktree is of
# the same repository — and only this tree has them unpacked, because only this
# tree has been built. Nothing measured here comes from them; they are needed
# to parse the headers that are being measured.
set -e
cd "$(dirname "$0")"
export PATH=/opt/homebrew/bin:$PATH

THIRD_PARTY_ROOT=$PWD
RN_TP=$THIRD_PARTY_ROOT/packages/react-native

probe_tree() {
  local root=$1
  local rn=$root/packages/react-native
  local probe=/tmp/rn-sizeprobe-$$
  local extra=""

  # Two structures exist under different names either side of the change: the
  # branch replaced RawText with a first-class #text node. Printing whichever
  # is present keeps the comparison honest about what each tree actually
  # allocates for a piece of character data.
  if [[ -f $rn/ReactCommon/react/renderer/components/text/RawTextShadowNode.h ]]; then
    extra="$extra -DHAS_RAW_TEXT=1"
  fi
  if [[ -f $rn/ReactCommon/react/renderer/components/text/TextNodeShadowNode.h ]]; then
    extra="$extra -DHAS_TEXT_NODE=1"
  fi
  if [[ -f $rn/ReactCommon/react/renderer/components/text/InlineContentShadowNode.h ]]; then
    extra="$extra -DHAS_INLINE_CONTENT=1"
  fi

  cat > $probe.cpp <<'EOF'
#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/attributedstring/TextAttributes.h>
#include <react/renderer/components/text/ParagraphProps.h>
#include <react/renderer/components/text/ParagraphShadowNode.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/components/view/ViewShadowNode.h>
#include <react/renderer/components/view/YogaLayoutableShadowNode.h>
#if HAS_RAW_TEXT
#include <react/renderer/components/text/RawTextProps.h>
#include <react/renderer/components/text/RawTextShadowNode.h>
#endif
#if HAS_TEXT_NODE
#include <react/renderer/components/text/TextNodeShadowNode.h>
#endif
#if HAS_INLINE_CONTENT
#include <react/renderer/components/text/InlineContentShadowNode.h>
#endif
#include <cstdio>
using namespace facebook::react;
int main() {
  printf("%-34s %5zu\n", "ViewShadowNode", sizeof(ViewShadowNode));
  printf("%-34s %5zu\n", "ViewProps", sizeof(ViewProps));
  printf("%-34s %5zu\n", "YogaLayoutableShadowNode", sizeof(YogaLayoutableShadowNode));
  printf("%-34s %5zu\n", "ParagraphShadowNode", sizeof(ParagraphShadowNode));
  printf("%-34s %5zu\n", "ParagraphProps", sizeof(ParagraphProps));
  printf("%-34s %5zu\n", "TextAttributes", sizeof(TextAttributes));
  printf("%-34s %5zu\n", "AttributedString::Fragment", sizeof(AttributedString::Fragment));
  printf("%-34s %5zu\n", "AttributedString", sizeof(AttributedString));
#if HAS_RAW_TEXT
  printf("%-34s %5zu\n", "RawTextShadowNode", sizeof(RawTextShadowNode));
  printf("%-34s %5zu\n", "RawTextProps", sizeof(RawTextProps));
#endif
#if HAS_TEXT_NODE
  printf("%-34s %5zu\n", "TextNodeShadowNode", sizeof(TextNodeShadowNode));
  printf("%-34s %5zu\n", "TextNodeProps", sizeof(TextNodeProps));
#endif
#if HAS_INLINE_CONTENT
  printf("%-34s %5zu\n", "InlineContentShadowNode", sizeof(InlineContentShadowNode));
#endif
  return 0;
}
EOF

  c++ -std=c++20 -arch arm64 -O1 -fexceptions -frtti \
    -DFOLLY_NO_CONFIG=1 -DFOLLY_USE_LIBCPP=1 -DFOLLY_CFG_NO_COROUTINES=1 -DFOLLY_MOBILE=0 \
    ${=extra} \
    -I$rn/ReactCommon -I$rn/ReactCommon/jsi -I$rn/ReactCommon/runtimeexecutor \
    -I$rn/ReactCommon/oscompat/. -I$rn/ReactCommon/react/utils/platform/cxx \
    -I$rn/ReactCommon/react/renderer/graphics/platform/cxx \
    -I$rn/ReactCommon/react/renderer/textlayoutmanager/platform/cxx \
    -I$rn/ReactCommon/react/renderer/components/view/platform/cxx \
    -I$rn/ReactCommon/react/renderer/components/text/platform/cxx \
    -I$rn/ReactCommon/yoga \
    -I$THIRD_PARTY_ROOT/private/react-native-fantom/build/third-party/folly/. \
    -I$RN_TP/ReactAndroid/build/third-party-ndk/glog/exported \
    -I$RN_TP/ReactAndroid/build/third-party-ndk/double-conversion/. \
    -I$RN_TP/ReactAndroid/build/third-party-ndk/boost/boost_1_83_0 \
    -I$RN_TP/ReactAndroid/build/third-party-ndk/fmt/include \
    -I$RN_TP/ReactAndroid/build/third-party-ndk/fast_float/include \
    $probe.cpp -o $probe -Wl,-undefined,dynamic_lookup
  $probe
  rm -f $probe $probe.cpp
}

for tree in "$@"; do
  echo "== $tree =="
  probe_tree "$tree"
  echo
done
