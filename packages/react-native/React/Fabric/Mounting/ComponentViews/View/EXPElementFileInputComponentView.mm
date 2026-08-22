/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "EXPElementFileInputComponentView.h"

#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#import <React/RCTAssert.h>
#import <React/RCTConversions.h>

#import "EXPElementControlMetricsProbe.h"
#import "EXPElementControlSizeReporting.h"
#import <react/renderer/components/view/ElementFileInputShadowNode.h>

#import "RCTComponentViewFactory.h"

using namespace facebook::react;

@interface EXPElementFileInputComponentView () <UIDocumentPickerDelegate>
@end

@implementation EXPElementFileInputComponentView {
  facebook::react::ElementFileInputShadowNode::ConcreteState::Shared _state;
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
  [self reportIntrinsicSize];
}

/*
 * What the control wants to be, told to layout.
 *
 * Asked of the real button rather than rebuilt from the title's font: the
 * button knows its own chrome, its own content insets and its own title
 * treatment, and reproducing any of those here would be a second opinion about
 * a control standing right there.
 *
 * `layoutIfNeeded` first, because a configuration is applied asynchronously —
 * `intrinsicContentSize` read in the same turn as the title was set still
 * describes the OLD title, so the button would report one string's width while
 * drawing another's.
 */
- (void)reportIntrinsicSize
{
  // Laid out first: a configuration is applied asynchronously, so an
  // intrinsic size read in the same turn as the title was set still describes
  // the old title. See EXPReportControlSize for the rest of the hazards.
  [_button layoutIfNeeded];
  EXPReportControlSize(_state, _button.intrinsicContentSize);
}

- (void)updateState:(const facebook::react::State::Shared &)state
           oldState:(const facebook::react::State::Shared &)oldState
{
  _state = std::static_pointer_cast<const facebook::react::ElementFileInputShadowNode::ConcreteState>(state);
  [self reportIntrinsicSize];
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
  _state.reset();
  [super prepareForRecycle];
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

/*
 * `<input type=file>`: what a real button measures for the title it starts
 * with.
 *
 * Only the first frame needs this — after that the mounted control reports its
 * own size for whatever title it is showing. The SAME title the element will
 * show, so the button does not resize the instant it appears.
 */
void EXPProbeFileInputMetrics(facebook::react::ElementControlMetrics &metrics)
{
  RCTAssertMainQueue();
  UIButtonConfiguration *configuration = [UIButtonConfiguration grayButtonConfiguration];
  configuration.title = [NSString stringWithUTF8String:facebook::react::elementFileInputDefaultTitle().c_str()];
  UIButton *button = [UIButton buttonWithConfiguration:configuration primaryAction:nil];

  UIWindow *window = [[UIWindow alloc] initWithFrame:CGRectMake(0, 0, 400, 200)];
  [window addSubview:button];
  [window layoutIfNeeded];
  const CGSize intrinsic = button.intrinsicContentSize;
  [button removeFromSuperview];

  if (intrinsic.width > 0 && intrinsic.height > 0) {
    metrics.fileDefaultWidth = static_cast<facebook::react::Float>(intrinsic.width);
    metrics.fileDefaultHeight = static_cast<facebook::react::Float>(intrinsic.height);
  }
}
