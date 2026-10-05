/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/cxxstableapi/UmbrellaGuard.h>

namespace facebook::react {

// CSS's names, and standards' names for the spaces CSS doesn't predefine
// (ColorSpaceValue.h); sRGB and DisplayP3 keep the values 0 and 1
enum class ColorSpace {
  sRGB,
  DisplayP3,
  SRGBLinear,
  DisplayP3Linear,
  A98RGB,
  ProPhotoRGB,
  Rec2020,
  Rec2100PQ,
  Rec2100HLG,
  Rec2100Linear,
  XYZD50,
  XYZD65,
  Lab,
  LCH,
  OKLab,
  OKLCH,
  DCIP3,
  Rec709,
  Rec2020SRGBTransfer,
  Rec2020Linear,
  DisplayP3PQ,
  DisplayP3HLG,
  Rec709PQ,
  Rec709HLG,
  ACES,
  ACEScg,
  NTSC1953,
  SMPTEC,
  GrayGamma22,
  GrayLinear,
};

ColorSpace getDefaultColorSpace();
void setDefaultColorSpace(ColorSpace newColorSpace);

struct ColorComponents {
  float red{0};
  float green{0};
  float blue{0};
  float alpha{0};
  ColorSpace colorSpace{getDefaultColorSpace()};
};

} // namespace facebook::react
