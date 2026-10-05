/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "Screenshot.h"

#import <React/RCTUIManager.h>

@implementation ScreenshotManager

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(
    takeScreenshot : (id /* NSString or NSNumber */)target withOptions : (NSDictionary *)
        options resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  [self.bridge.uiManager addUIBlock:^(
                             __unused RCTUIManager *uiManager, NSDictionary<NSNumber *, UIView *> *viewRegistry) {
    // Get view
    UIView *view;
    if (target == nil || [target isEqual:@"window"]) {
      view = RCTKeyWindow();
    } else if ([target isKindOfClass:[NSNumber class]]) {
      view = viewRegistry[target];
      if (!view) {
        RCTLogError(@"No view found with reactTag: %@", target);
        return;
      }
    }

    // Get options
    CGSize size = [RCTConvert CGSize:options];
    NSString *format = [RCTConvert NSString:options[@"format"] ?: @"png"];

    // Capture image
    if (size.width < 0.1 || size.height < 0.1) {
      size = view.bounds.size;
    }

    UIGraphicsImageRendererFormat *const rendererFormat = [UIGraphicsImageRendererFormat defaultFormat];
    UIGraphicsImageRenderer *const renderer = [[UIGraphicsImageRenderer alloc] initWithSize:size format:rendererFormat];

    __block BOOL success = NO;
    UIImage *image = [renderer imageWithActions:^(UIGraphicsImageRendererContext *_Nonnull context) {
      success = [view drawViewHierarchyInRect:(CGRect){CGPointZero, size} afterScreenUpdates:YES];
    }];

    if (!success || !image) {
      reject(RCTErrorUnspecified, @"Failed to capture view snapshot.", nil);
      return;
    }

    // Convert image to data (on a background thread)
    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
      NSData *data;
      if ([format isEqualToString:@"png"]) {
        data = UIImagePNGRepresentation(image);
      } else if ([format isEqualToString:@"jpeg"]) {
        CGFloat quality = [RCTConvert CGFloat:options[@"quality"] ?: @1];
        data = UIImageJPEGRepresentation(image, quality);
      } else {
        RCTLogError(@"Unsupported image format: %@", format);
        return;
      }

      // Save to a temp file
      NSError *error = nil;
      NSString *tempFilePath = RCTTempFilePath(format, &error);
      if (tempFilePath) {
        if ([data writeToFile:tempFilePath options:(NSDataWritingOptions)0 error:&error]) {
          resolve(tempFilePath);
          return;
        }
      }

      // If we reached here, something went wrong
      reject(RCTErrorUnspecified, error.localizedDescription, error);
    });
  }];
}

/**
 * Reads the key window's pixels at `points` (`[x, y]` in window points) as
 * premultiplied extended linear sRGB floats, which a PNG screenshot, 8-bit
 * sRGB, can't: a Display P3 red reads about 1.22, -0.04, -0.02.
 */
RCT_EXPORT_METHOD(
    sample : (NSArray *)points resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    UIWindow *window = RCTKeyWindow();
    if (window == nil) {
      reject(RCTErrorUnspecified, @"There is no key window to sample.", nil);
      return;
    }
    CGFloat scale = window.traitCollection.displayScale;
    size_t width = (size_t)ceil(window.bounds.size.width * scale);
    size_t height = (size_t)ceil(window.bounds.size.height * scale);
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceExtendedLinearSRGB);
    CGContextRef context = CGBitmapContextCreate(
        nullptr,
        width,
        height,
        32,
        width * 16,
        space,
        (CGBitmapInfo)kCGImageAlphaPremultipliedLast | kCGBitmapFloatComponents | kCGBitmapByteOrder32Host);
    CGColorSpaceRelease(space);
    if (context == nullptr) {
      reject(RCTErrorUnspecified, @"Could not create an extended-range context to sample into.", nil);
      return;
    }
    // UIKit's origin is top-left; `renderInContext:` color-matches into the
    // context's space
    CGContextTranslateCTM(context, 0, height);
    CGContextScaleCTM(context, scale, -scale);
    [window.layer renderInContext:context];

    const float *pixels = (const float *)CGBitmapContextGetData(context);
    NSMutableArray *values = [NSMutableArray arrayWithCapacity:points.count];
    for (id item in points) {
      // The module's argument conversion empties an `NSArray<NSArray<NSNumber *> *>`
      NSArray *point = [item isKindOfClass:[NSArray class]] ? item : nil;
      long x = point.count < 2 ? -1 : lround([point[0] doubleValue] * scale);
      long y = point.count < 2 ? -1 : lround([point[1] doubleValue] * scale);
      if (x < 0 || y < 0 || x >= (long)width || y >= (long)height) {
        [values addObject:[NSNull null]];
        continue;
      }
      const float *pixel = pixels + ((size_t)y * width + (size_t)x) * 4;
      [values addObject:@[ @(pixel[0]), @(pixel[1]), @(pixel[2]), @(pixel[3]) ]];
    }
    CGContextRelease(context);
    resolve(@{
      @"space" : @"srgb-linear",
      @"values" : values,
      @"window" : @{
        @"width" : @(window.bounds.size.width),
        @"height" : @(window.bounds.size.height),
        @"scale" : @(scale),
      },
    });
  });
}

@end
