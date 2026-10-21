/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "RCTImageManagerBackgroundImageProvider.h"

#import <React/RCTImageResponseDelegate.h>
#import <React/RCTImageResponseObserverProxy.h>
#import <react/renderer/imagemanager/ImageManager.h>
#import <react/renderer/imagemanager/ImageRequest.h>

using namespace facebook::react;

// A loaded image, drawn as a layer's contents
@interface RCTUIImageBackgroundImage : NSObject <RCTBackgroundImage>
- (instancetype)initWithImage:(UIImage *)image;
@end

@implementation RCTUIImageBackgroundImage {
  UIImage *_image;
}

- (instancetype)initWithImage:(UIImage *)image
{
  if (self = [super init]) {
    _image = image;
  }
  return self;
}

- (CGSize)naturalSize
{
  return _image.size;
}

- (CALayer *)makeLayer
{
  CALayer *layer = [CALayer layer];
  layer.contents = (id)_image.CGImage;
  layer.contentsScale = _image.scale;
  layer.contentsGravity = kCAGravityResize;
  return layer;
}

@end

/*
 * One load. The image manager's request cancels when it is destroyed, so it
 * lives here, as long as the view keeps this object.
 */
@interface RCTImageManagerBackgroundImageRequest : NSObject <RCTImageResponseDelegate>
@end

@implementation RCTImageManagerBackgroundImageRequest {
  std::unique_ptr<ImageRequest> _request;
  std::shared_ptr<RCTImageResponseObserverProxy> _observer;
  void (^_completion)(id<RCTBackgroundImage> _Nullable);
}

- (instancetype)initWithRequest:(ImageRequest)request
                     completion:(void (^)(id<RCTBackgroundImage> _Nullable))completion
{
  if (self = [super init]) {
    _request = std::make_unique<ImageRequest>(std::move(request));
    _completion = completion;
    _observer = std::make_shared<RCTImageResponseObserverProxy>(self);
    _request->getObserverCoordinator().addObserver(_observer);
  }
  return self;
}

- (void)dealloc
{
  _request->getObserverCoordinator().removeObserver(_observer);
}

- (void)didReceiveImage:(UIImage *)image metadata:(id)metadata fromObserver:(const void *)observer
{
  [self finishWithImage:[[RCTUIImageBackgroundImage alloc] initWithImage:image]];
}

- (void)didReceiveProgress:(float)progress
                    loaded:(int64_t)loaded
                     total:(int64_t)total
              fromObserver:(const void *)observer
{
}

- (void)didReceiveFailure:(NSError *)error fromObserver:(const void *)observer
{
  [self finishWithImage:nil];
}

- (void)finishWithImage:(nullable id<RCTBackgroundImage>)image
{
  auto completion = _completion;
  _completion = nil;
  if (completion != nil) {
    completion(image);
  }
}

@end

@implementation RCTImageManagerBackgroundImageProvider {
  std::shared_ptr<ImageManager> _imageManager;
}

- (nullable instancetype)initWithContextContainer:(const std::shared_ptr<const ContextContainer> &)contextContainer
{
  if (contextContainer == nullptr || !contextContainer->find<std::shared_ptr<void>>("RCTImageLoader")) {
    return nil;
  }
  if (self = [super init]) {
    _imageManager = std::make_shared<ImageManager>(contextContainer);
  }
  return self;
}

- (id)requestImageWithURI:(NSString *)uri completion:(void (^)(id<RCTBackgroundImage> _Nullable))completion
{
  ImageSource source;
  source.type = ImageSource::Type::Remote;
  source.uri = uri.UTF8String ?: "";
  // A CSS image's natural size is its size in pixels, as on the web: an
  // `@2x` file named by `url()` is not read at two pixels to the point
  source.scale = 1;
  return [[RCTImageManagerBackgroundImageRequest alloc]
      initWithRequest:_imageManager->requestImage(source, /* surfaceId */ -1)
           completion:completion];
}

@end
