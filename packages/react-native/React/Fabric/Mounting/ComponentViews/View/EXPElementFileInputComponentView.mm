/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementFileInputComponentView.h"

#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#import <React/RCTConversions.h>
#import <react/renderer/components/view/ElementFileInputShadowNode.h>

#import "RCTComponentViewFactory.h"

using namespace facebook::react;

@interface EXPElementFileInputComponentView () <UIDocumentPickerDelegate>
@end

@implementation EXPElementFileInputComponentView {
  UIButton *_button;
  BOOL _isInitialValueSet;
  NSInteger _chosenCount;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ElementFileInputShadowNode::defaultSharedProps();

    UIButtonConfiguration *configuration = [UIButtonConfiguration grayButtonConfiguration];
    configuration.title = @"Choose File";
    _button = [UIButton buttonWithConfiguration:configuration primaryAction:nil];
    [_button addTarget:self action:@selector(buttonTapped) forControlEvents:UIControlEventTouchUpInside];

    self.elementControl = _button;
  }
  return self;
}

/*
 * HTML's `accept` translated into uniform type identifiers.
 *
 * Both spellings the attribute allows are handled: a MIME type (`image/png`,
 * or a wildcard like `image/*`) and a bare extension (`.pdf`). Anything that
 * does not resolve is dropped rather than guessed at, and an `accept` that
 * resolves to nothing leaves the picker showing every file — the same thing a
 * browser does with an accept it cannot honour.
 */
- (NSArray<UTType *> *)contentTypesForAccept:(const std::string &)accept
{
  if (accept.empty()) {
    return @[ UTTypeItem ];
  }

  NSMutableArray<UTType *> *types = [NSMutableArray array];
  NSString *value = RCTNSStringFromString(accept);
  for (NSString *rawEntry in [value componentsSeparatedByString:@","]) {
    NSString *entry = [rawEntry stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
    if (entry.length == 0) {
      continue;
    }

    if ([entry hasPrefix:@"."]) {
      UTType *type = [UTType typeWithFilenameExtension:[entry substringFromIndex:1]];
      if (type != nil) {
        [types addObject:type];
      }
      continue;
    }

    // `image/*` and friends: the wildcard names a whole family, and UTType has
    // a supertype for each of the ones HTML defines.
    if ([entry hasSuffix:@"/*"]) {
      NSString *family = [entry substringToIndex:entry.length - 2];
      UTType *type = nil;
      if ([family isEqualToString:@"image"]) {
        type = UTTypeImage;
      } else if ([family isEqualToString:@"video"]) {
        type = UTTypeMovie;
      } else if ([family isEqualToString:@"audio"]) {
        type = UTTypeAudio;
      } else if ([family isEqualToString:@"text"]) {
        type = UTTypeText;
      }
      if (type != nil) {
        [types addObject:type];
      }
      continue;
    }

    UTType *type = [UTType typeWithMIMEType:entry];
    if (type != nil) {
      [types addObject:type];
    }
  }

  return types.count > 0 ? types : @[ UTTypeItem ];
}

- (void)buttonTapped
{
  const auto &props = static_cast<const ElementFileInputProps &>(*_props);

  UIDocumentPickerViewController *picker =
      [[UIDocumentPickerViewController alloc] initForOpeningContentTypes:[self contentTypesForAccept:props.accept]
                                                                 asCopy:YES];
  picker.delegate = self;
  picker.allowsMultipleSelection = props.multiple;

  UIViewController *presenter = self.window.rootViewController;
  while (presenter.presentedViewController != nil) {
    presenter = presenter.presentedViewController;
  }
  [presenter presentViewController:picker animated:YES completion:nil];
}

#pragma mark - UIDocumentPickerDelegate

- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls
{
  std::vector<ElementFileDescriptor> files;
  files.reserve(urls.count);

  for (NSURL *url in urls) {
    ElementFileDescriptor file;
    file.name = RCTStringFromNSString(url.lastPathComponent);
    file.uri = RCTStringFromNSString(url.absoluteString);

    NSNumber *size = nil;
    [url getResourceValue:&size forKey:NSURLFileSizeKey error:nil];
    file.size = size != nil ? size.doubleValue : 0;

    UTType *type = nil;
    [url getResourceValue:&type forKey:NSURLContentTypeKey error:nil];
    // The MIME type, because that is what `File.type` is on the web. A type
    // with no MIME mapping reports empty, which is also what a browser does.
    file.type = type.preferredMIMEType != nil ? RCTStringFromNSString(type.preferredMIMEType) : "";

    files.push_back(std::move(file));
  }

  _chosenCount = (NSInteger)files.size();
  [self updateButtonTitle];

  if (_eventEmitter) {
    std::static_pointer_cast<const ElementFileInputEventEmitter>(_eventEmitter)->onElementChange(files);
  }
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller
{
  // Nothing is reported. In a browser, cancelling a file picker leaves the
  // input untouched and fires no event — it does not clear a previous choice.
}

#pragma mark - RCTComponentViewProtocol

/*
 * The button says what is chosen, the way a file input reads in a browser:
 * "No file chosen" until one is, then its name or a count.
 */
- (void)updateButtonTitle
{
  NSString *title;
  if (_chosenCount == 0) {
    title = @"Choose File";
  } else if (_chosenCount == 1) {
    title = @"1 file chosen";
  } else {
    title = [NSString stringWithFormat:@"%ld files chosen", (long)_chosenCount];
  }
  UIButtonConfiguration *configuration = _button.configuration;
  configuration.title = title;
  _button.configuration = configuration;
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldFileProps = static_cast<const ElementFileInputProps &>(*_props);
  const auto &newFileProps = static_cast<const ElementFileInputProps &>(*props);

  if (!_isInitialValueSet || oldFileProps.disabled != newFileProps.disabled) {
    _button.enabled = !newFileProps.disabled;
    self.userInteractionEnabled = !newFileProps.disabled;
  }

  _isInitialValueSet = YES;

  [super updateProps:props oldProps:oldProps];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _props = ElementFileInputShadowNode::defaultSharedProps();
  _isInitialValueSet = NO;
  _chosenCount = 0;
  [self updateButtonTitle];
  _button.enabled = YES;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ElementFileInputComponentDescriptor>();
}

+ (void)load
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:self];
}

@end
