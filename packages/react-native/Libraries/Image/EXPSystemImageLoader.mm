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

// The symbol's name from either spelling: `system:pencil` puts it in
// `resourceSpecifier`, `system://pencil` in `host`; the query is stripped
static NSString *_Nullable EXPSystemImageNameFromURL(NSURL *url)
{
  NSURLComponents *components = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];
  NSString *name = components.host.length > 0 ? components.host : components.path;
  if (name.length == 0) {
    // `system:pencil` has no host and no path; the whole thing is opaque
    name = url.resourceSpecifier;
    const NSRange query = [name rangeOfString:@"?"];
    if (query.location != NSNotFound) {
      name = [name substringToIndex:query.location];
    }
  }
  // A path arrives with its leading slash
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

// Not on the URL queue: `+systemImageNamed:` reads from a system cache and
// returns immediately, as `RCTBundleAssetImageLoader` also assumes
- (BOOL)requiresScheduling
{
  return NO;
}

// UIKit caches symbol images itself; the loader's cache is keyed by URL and
// size and would hold a copy per tile size
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

  // A symbol is drawn at a point size rather than scaled from a bitmap, so the
  // layout's own height keeps it crisp; zero means nothing has laid out yet and
  // UIKit's default applies until the next layout asks again
  UIImageSymbolConfiguration *configuration = size.height > 0
      ? [UIImageSymbolConfiguration configurationWithPointSize:size.height
                                                        weight:EXPSymbolWeightNamed(weight)
                                                         scale:EXPSymbolScaleNamed(symbolScale)]
      : [UIImageSymbolConfiguration configurationWithWeight:EXPSymbolWeightNamed(weight)];

  UIImage *image = [UIImage systemImageNamed:name withConfiguration:configuration];
  if (image == nil) {
    completionHandler(RCTErrorWithMessage([NSString stringWithFormat:@"No SF Symbol named %@", name]), nil);
    return nil;
  }

  // Always a template, so the element's `tintColor` colours it
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
