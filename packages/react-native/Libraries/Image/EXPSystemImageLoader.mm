/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPSystemImageLoader.h"

#import <React/RCTLog.h>
#import <ReactCommon/RCTTurboModule.h>

#import "RCTImagePlugins.h"

@interface EXPSystemImageLoader () <RCTTurboModule>
@end

/**
 * The symbol's name, from either spelling of the URL.
 *
 * `system:pencil` puts it in `resourceSpecifier` and `system://pencil` puts it
 * in `host`. A dotted name — `arrow.up.circle.fill`, which is most of them —
 * survives both, and the query is stripped either way.
 */
static NSString *_Nullable EXPSystemImageNameFromURL(NSURL *url)
{
  NSURLComponents *components = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];
  NSString *name = components.host.length > 0 ? components.host : components.path;
  if (name.length == 0) {
    // `symbol:pencil` has no host and no path — the whole thing is opaque.
    name = url.resourceSpecifier;
    const NSRange query = [name rangeOfString:@"?"];
    if (query.location != NSNotFound) {
      name = [name substringToIndex:query.location];
    }
  }
  // `system://arrow.up/` and friends: a path arrives with its leading slash.
  while ([name hasPrefix:@"/"]) {
    name = [name substringFromIndex:1];
  }
  return name.length > 0 ? name : nil;
}

static UIImageSymbolWeight EXPSymbolWeightNamed(NSString *_Nullable name)
{
  static NSDictionary<NSString *, NSNumber *> *weights = @{
    @"ultralight" : @(UIImageSymbolWeightUltraLight),
    @"thin" : @(UIImageSymbolWeightThin),
    @"light" : @(UIImageSymbolWeightLight),
    @"regular" : @(UIImageSymbolWeightRegular),
    @"medium" : @(UIImageSymbolWeightMedium),
    @"semibold" : @(UIImageSymbolWeightSemibold),
    @"bold" : @(UIImageSymbolWeightBold),
    @"heavy" : @(UIImageSymbolWeightHeavy),
    @"black" : @(UIImageSymbolWeightBlack),
  };
  NSNumber *found = name == nil ? nil : weights[name.lowercaseString];
  return found == nil ? UIImageSymbolWeightRegular : (UIImageSymbolWeight)found.integerValue;
}

static UIImageSymbolScale EXPSymbolScaleNamed(NSString *_Nullable name)
{
  if ([name.lowercaseString isEqualToString:@"small"]) {
    return UIImageSymbolScaleSmall;
  }
  if ([name.lowercaseString isEqualToString:@"large"]) {
    return UIImageSymbolScaleLarge;
  }
  return UIImageSymbolScaleMedium;
}

@implementation EXPSystemImageLoader

RCT_EXPORT_MODULE()

- (BOOL)canLoadImageURL:(NSURL *)requestURL
{
  return [requestURL.scheme.lowercaseString isEqualToString:@"system"];
}

/**
 * Not on the URL queue: `+systemImageNamed:` reads from a system cache and
 * returns immediately, and scheduling it would put a frame between the layout
 * and the icon for no work saved. The same reason `RCTBundleAssetImageLoader`
 * gives.
 */
- (BOOL)requiresScheduling
{
  return NO;
}

/**
 * UIKit caches symbol images itself, and the image loader's cache is keyed by
 * URL and SIZE — which would hold a copy per tile size for artwork that is
 * already shared.
 */
- (BOOL)shouldCacheLoadedImages
{
  return NO;
}

- (nullable RCTImageLoaderCancellationBlock)loadImageForURL:(NSURL *)imageURL
                                                       size:(CGSize)size
                                                      scale:(CGFloat)scale
                                                 resizeMode:(RCTResizeMode)resizeMode
                                            progressHandler:(RCTImageLoaderProgressBlock)progressHandler
                                         partialLoadHandler:(RCTImageLoaderPartialLoadBlock)partialLoadHandler
                                          completionHandler:(RCTImageLoaderCompletionBlock)completionHandler
{
  NSString *name = EXPSystemImageNameFromURL(imageURL);
  if (name == nil) {
    completionHandler(RCTErrorWithMessage(@"A `system:` source needs a name"), nil);
    return nil;
  }

  NSURLComponents *components = [NSURLComponents componentsWithURL:imageURL resolvingAgainstBaseURL:NO];
  NSString *weight = nil;
  NSString *symbolScale = nil;
  for (NSURLQueryItem *item in components.queryItems) {
    if ([item.name isEqualToString:@"weight"]) {
      weight = item.value;
    } else if ([item.name isEqualToString:@"scale"]) {
      symbolScale = item.value;
    }
  }

  /*
   * Sized from the box the image is going into, when there is one.
   *
   * A symbol is drawn at a POINT SIZE rather than scaled from a bitmap, so
   * handing it the layout's own height is what makes it crisp at any tile size —
   * and `size` is exactly that, already resolved by the image machinery. Zero
   * means nobody has laid out yet; UIKit's default point size is the honest
   * answer there, and the next layout asks again.
   */
  UIImageSymbolConfiguration *configuration =
      size.height > 0 ? [UIImageSymbolConfiguration configurationWithPointSize:size.height
                                                                        weight:EXPSymbolWeightNamed(weight)
                                                                         scale:EXPSymbolScaleNamed(symbolScale)]
                      : [UIImageSymbolConfiguration configurationWithWeight:EXPSymbolWeightNamed(weight)];

  UIImage *image = [UIImage systemImageNamed:name withConfiguration:configuration];
  if (image == nil) {
    completionHandler(
        RCTErrorWithMessage([NSString stringWithFormat:@"No SF Symbol named %@", name]), nil);
    return nil;
  }

  /*
   * A TEMPLATE, always. A symbol's colour is the caller's — `tintColor` on the
   * element — and an image that carried its own would ignore it, which is the
   * one thing the emoji this replaces already did wrong.
   */
  image = [image imageWithRenderingMode:UIImageRenderingModeAlwaysTemplate];

  if (progressHandler != nullptr) {
    progressHandler(1, 1);
  }
  completionHandler(nil, image);
  return nil;
}

@end

Class EXPSystemImageLoaderCls(void)
{
  return EXPSystemImageLoader.class;
}
