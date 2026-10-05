/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "RCTBoxShadow.h"

#import <CoreImage/CoreImage.h>

#import <React/RCTConversions.h>

#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/renderer/graphics/Color.h>
#import <react/renderer/graphics/HostPlatformColor.h>

#import <math.h>

using namespace facebook::react;
// See https://drafts.csswg.org/css-backgrounds/#shadow-shape
static CGFloat adjustedCornerRadius(CGFloat cornerRadius, CGFloat spreadDistance)
{
  CGFloat adjustment = spreadDistance;
  (void)adjustment;
  if (cornerRadius < abs(spreadDistance)) {
    const CGFloat r = cornerRadius / (CGFloat)abs(spreadDistance);
    const CGFloat p = (CGFloat)pow(r - 1.0, 3.0);
    adjustment *= 1.0 + p;
  }

  return fmax(cornerRadius + adjustment, 0);
}

static RCTCornerRadii cornerRadiiForBoxShadow(RCTCornerRadii cornerRadii, CGFloat spreadDistance)
{
  return {
      adjustedCornerRadius(cornerRadii.topLeftHorizontal, spreadDistance),
      adjustedCornerRadius(cornerRadii.topLeftVertical, spreadDistance),
      adjustedCornerRadius(cornerRadii.topRightHorizontal, spreadDistance),
      adjustedCornerRadius(cornerRadii.topRightVertical, spreadDistance),
      adjustedCornerRadius(cornerRadii.bottomLeftHorizontal, spreadDistance),
      adjustedCornerRadius(cornerRadii.bottomLeftVertical, spreadDistance),
      adjustedCornerRadius(cornerRadii.bottomRightHorizontal, spreadDistance),
      adjustedCornerRadius(cornerRadii.bottomRightVertical, spreadDistance)};
}

static CGRect insetRect(CGRect rect, CGFloat left, CGFloat top, CGFloat right, CGFloat bottom)
{
  return CGRectMake(
      rect.origin.x + left, rect.origin.y + top, rect.size.width - right - left, rect.size.height - bottom - top);
}

static CGColorRef colorRefFromSharedColor(const SharedColor &color)
{
  CGColorRef colorRef = RCTUIColorFromSharedColor(color).CGColor;
  return (colorRef != nullptr) ? colorRef : [UIColor blackColor].CGColor;
}

static CALayer *initBoxShadowLayer(const BoxShadow &shadow, CGSize layerSize)
{
  CALayer *shadowLayer = [CALayer layer];
  shadowLayer.frame = CGRectMake(0, 0, layerSize.width, layerSize.height);
  shadowLayer.shadowColor = colorRefFromSharedColor(shadow.color);
  // Default is (0, -3) believe it or not
  shadowLayer.shadowOffset = CGSizeMake(0, 0);
  shadowLayer.shadowOpacity = 1;
  // Apple's blur is not quite what we want and seems to be a bit overbearing
  // with the radius. This is an eyeballed adjustment that has the blur looking
  // more like the web.
  shadowLayer.shadowRadius = shadow.blurRadius / 2;
  shadowLayer.contentsScale = [UIScreen mainScreen].scale;

  return shadowLayer;
}

static CALayer *
RCTGetOutsetBoxShadowLayer(const facebook::react::BoxShadow &shadow, RCTCornerRadii cornerRadii, CGSize layerSize)
{
  CALayer *shadowLayer = initBoxShadowLayer(shadow, layerSize);

  const RCTCornerInsets shadowRectCornerInsets =
      RCTGetCornerInsets(cornerRadiiForBoxShadow(cornerRadii, shadow.spreadDistance), UIEdgeInsetsZero);

  CGRect shadowRect = CGRectInset(shadowLayer.bounds, -shadow.spreadDistance, -shadow.spreadDistance);
  shadowRect = CGRectOffset(shadowRect, shadow.offsetX, shadow.offsetY);
  CGPathRef shadowRectPath = RCTPathCreateWithRoundedRect(shadowRect, shadowRectCornerInsets, nil, NO);
  shadowLayer.shadowPath = shadowRectPath;

  CAShapeLayer *mask = [CAShapeLayer new];
  [mask setContentsScale:[UIScreen mainScreen].scale];
  CGMutablePathRef path = CGPathCreateMutable();
  CGPathRef layerPath =
      RCTPathCreateWithRoundedRect(shadowLayer.bounds, RCTGetCornerInsets(cornerRadii, UIEdgeInsetsZero), nil, NO);
  CGPathAddPath(path, NULL, layerPath);
  CGPathRef paddedShadowRectPath = RCTPathCreateWithRoundedRect(
      CGRectInset(shadowRect, -2 * (shadow.blurRadius + 1), -2 * (shadow.blurRadius + 1)),
      shadowRectCornerInsets,
      nil,
      NO);
  CGPathAddPath(path, NULL, paddedShadowRectPath);
  mask.fillRule = kCAFillRuleEvenOdd;
  mask.path = path;
  shadowLayer.mask = mask;

  CGPathRelease(path);
  CGPathRelease(shadowRectPath);
  CGPathRelease(layerPath);
  CGPathRelease(paddedShadowRectPath);

  return shadowLayer;
}

static CALayer *RCTGetInsetBoxShadowLayer(
    const facebook::react::BoxShadow &shadow,
    RCTCornerRadii cornerRadii,
    UIEdgeInsets edgeInsets,
    CGSize layerSize)
{
  CALayer *shadowLayer = initBoxShadowLayer(shadow, layerSize);

  CGMutablePathRef path = CGPathCreateMutable();
  // This shadow is padded by the blur to make sure blur artifacts can be cast
  // if the clear region is right on the border of the layer
  CGRect shadowRect =
      insetRect(shadowLayer.bounds, edgeInsets.left, edgeInsets.top, edgeInsets.right, edgeInsets.bottom);
  if (CGRectIsNull(shadowRect)) {
    shadowRect = CGRectMake(0, 0, 0, 0);
  }
  CGPathRef shadowPath =
      RCTPathCreateWithRoundedRect(CGRectInset(shadowRect, -shadow.blurRadius, -shadow.blurRadius), {}, nil, NO);

  CGPathRef layerPath = RCTPathCreateWithRoundedRect(shadowRect, RCTGetCornerInsets(cornerRadii, edgeInsets), nil, NO);
  CGPathAddPath(path, NULL, shadowPath);

  CGRect clearRegionRect = CGRectOffset(shadowRect, shadow.offsetX, shadow.offsetY);
  clearRegionRect = CGRectInset(clearRegionRect, shadow.spreadDistance, shadow.spreadDistance);
  if (CGRectIsNull(clearRegionRect)) {
    clearRegionRect = CGRectMake(0, 0, 0, 0);
  }
  CGPathRef clearRegionPath = RCTPathCreateWithRoundedRect(
      clearRegionRect,
      RCTGetCornerInsets(cornerRadiiForBoxShadow(cornerRadii, -shadow.spreadDistance), edgeInsets),
      nil,
      YES);
  CGPathAddPath(path, NULL, clearRegionPath);

  shadowLayer.shadowPath = path;

  CAShapeLayer *mask = [CAShapeLayer new];
  mask.path = layerPath;
  shadowLayer.mask = mask;

  CGPathRelease(path);
  CGPathRelease(layerPath);
  CGPathRelease(shadowPath);
  CGPathRelease(clearRegionPath);

  return shadowLayer;
}

// Core Animation never maps a layer shadow's color to the layer's range, so an outer shadow past SDR white is
// drawn here into a half-float store, which Core Animation does map: the offset shape is filled in the shadow's
// color, blurred, and kept outside the border box
static CALayer *RCTGetDrawnOutsetBoxShadowLayer(const BoxShadow &shadow, RCTCornerRadii cornerRadii, CGSize layerSize)
{
  // How far past the box the shadow reaches: its offset, spread and three deviations of blur
  const CGFloat reach = ceil(
      fmax(fabs(shadow.offsetX), fabs(shadow.offsetY)) + fabs(shadow.spreadDistance) + 1.5 * shadow.blurRadius + 1);
  CALayer *shadowLayer = [CALayer layer];
  shadowLayer.frame = CGRectMake(-reach, -reach, layerSize.width + 2 * reach, layerSize.height + 2 * reach);
  shadowLayer.contentsScale = [UIScreen mainScreen].scale;

  const CGFloat scale = shadowLayer.contentsScale;
  const size_t width = (size_t)ceil(shadowLayer.bounds.size.width * scale);
  const size_t height = (size_t)ceil(shadowLayer.bounds.size.height * scale);
  if (width == 0 || height == 0) {
    return shadowLayer;
  }
  static CGColorSpaceRef extendedLinear = CGColorSpaceCreateWithName(kCGColorSpaceExtendedLinearSRGB);
  CGContextRef context = CGBitmapContextCreate(
      nullptr,
      width,
      height,
      16,
      0,
      extendedLinear,
      kCGImageAlphaPremultipliedLast | kCGBitmapFloatComponents | kCGBitmapByteOrder16Little);
  if (context == nullptr) {
    return RCTGetOutsetBoxShadowLayer(shadow, cornerRadii, layerSize);
  }
  CGContextScaleCTM(context, scale, scale);
  // Flip to UIKit's coordinates, with the box at (reach, reach)
  CGContextTranslateCTM(context, 0, shadowLayer.bounds.size.height);
  CGContextScaleCTM(context, 1, -1);
  CGContextTranslateCTM(context, reach, reach);

  const CGRect bounds = CGRectMake(0, 0, layerSize.width, layerSize.height);
  CGPathRef boxPath = RCTPathCreateWithRoundedRect(bounds, RCTGetCornerInsets(cornerRadii, UIEdgeInsetsZero), nil, NO);
  CGMutablePathRef outside = CGPathCreateMutable();
  CGPathAddRect(outside, nullptr, CGRectInfinite);
  CGPathAddPath(outside, nullptr, boxPath);
  CGContextAddPath(context, outside);
  CGContextEOClip(context);

  const RCTCornerInsets shadowCornerInsets =
      RCTGetCornerInsets(cornerRadiiForBoxShadow(cornerRadii, shadow.spreadDistance), UIEdgeInsetsZero);
  CGRect shadowRect = CGRectInset(bounds, -shadow.spreadDistance, -shadow.spreadDistance);
  shadowRect = CGRectOffset(shadowRect, shadow.offsetX, shadow.offsetY);
  CGPathRef shapePath = RCTPathCreateWithRoundedRect(shadowRect, shadowCornerInsets, nil, NO);
  // Outside the border box only the shadow shows, so the shape is filled in the shadow's color
  CGContextSetFillColorWithColor(context, colorRefFromSharedColor(shadow.color));
  CGContextAddPath(context, shapePath);
  CGContextFillPath(context);

  CGImageRef image = CGBitmapContextCreateImage(context);
  if (shadow.blurRadius > 0) {
    // A Core Image blur keeps the half-float values, where a Core Graphics shadow would clip them
    static CIContext *blurContext = [CIContext contextWithOptions:@{
      kCIContextWorkingFormat : @(kCIFormatRGBAh),
      kCIContextWorkingColorSpace : (__bridge id)extendedLinear,
    }];
    CIImage *source = [CIImage imageWithCGImage:image];
    CIImage *blurred = [[source imageByClampingToExtent] imageByApplyingGaussianBlurWithSigma:shadow.blurRadius / 2];
    CGImageRef blurredImage = [blurContext createCGImage:[blurred imageByCroppingToRect:source.extent]
                                                fromRect:source.extent
                                                  format:kCIFormatRGBAh
                                              colorSpace:extendedLinear];
    if (blurredImage != nullptr) {
      // The blur spreads into the border box, where only the box shows, so the blurred shadow is drawn back
      // through the same clip. The clip lives in device space, so the image is drawn with an identity CTM.
      CGContextClearRect(context, CGRectInset(bounds, -reach, -reach));
      CGContextConcatCTM(context, CGAffineTransformInvert(CGContextGetCTM(context)));
      CGContextDrawImage(context, CGRectMake(0, 0, width, height), blurredImage);
      CGImageRelease(blurredImage);
      CGImageRelease(image);
      image = CGBitmapContextCreateImage(context);
    }
  }
  shadowLayer.contents = (__bridge id)image;
  CGImageRelease(image);
  CGContextRelease(context);
  CGPathRelease(shapePath);
  CGPathRelease(outside);
  CGPathRelease(boxPath);
  return shadowLayer;
}

CALayer *RCTGetBoxShadowLayer(
    const facebook::react::BoxShadow &shadow,
    RCTCornerRadii cornerRadii,
    UIEdgeInsets edgeInsets,
    CGSize layerSize)
{
  if (shadow.inset) {
    return RCTGetInsetBoxShadowLayer(shadow, cornerRadii, edgeInsets, layerSize);
  } else if (ReactNativeFeatureFlags::enableColorSpaces() && shadow.color && isHighDynamicRangeColor(*shadow.color)) {
    return RCTGetDrawnOutsetBoxShadowLayer(shadow, cornerRadii, layerSize);
  } else {
    return RCTGetOutsetBoxShadowLayer(shadow, cornerRadii, layerSize);
  }
}
