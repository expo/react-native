/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "RCTParagraphComponentView.h"
#import "RCTParagraphComponentAccessibilityProvider.h"

#import <CoreImage/CoreImage.h>
#import <MobileCoreServices/UTCoreTypes.h>

#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/renderer/components/text/DomElementsRegistry.h>
#import <react/renderer/components/text/ParagraphComponentDescriptor.h>
#import <react/renderer/components/text/ParagraphProps.h>
#import <react/renderer/components/text/ParagraphState.h>
#import <react/renderer/components/text/TextComponentDescriptor.h>
#import <react/renderer/components/text/TextNodeComponentDescriptor.h>
#import <react/renderer/graphics/HostPlatformColor.h>
#import <react/renderer/textlayoutmanager/RCTAttributedTextUtils.h>
#import <react/renderer/textlayoutmanager/RCTTextLayoutManager.h>
#import <react/renderer/textlayoutmanager/TextLayoutManager.h>
#import <react/utils/ManagedObjectWrapper.h>
#include <algorithm>

#import "RCTConversions.h"
#import "RCTFabricComponentsPlugins.h"

using namespace facebook::react;

@interface RCTTextLayoutManager (RCTParagraphComponentViewPrivate)

- (CGRect)drawingFrameForAttributedString:(facebook::react::AttributedString)attributedString
                      paragraphAttributes:(facebook::react::ParagraphAttributes)paragraphAttributes
                                    frame:(CGRect)frame
                           containerFrame:(CGRect *)containerFrame;

@end

// ParagraphTextView is an auxiliary view we set as contentView so the drawing
// can happen on top of the layers manipulated by RCTViewComponentView (the parent view)
@interface RCTParagraphTextView : UIView

@property (nonatomic) ParagraphShadowNode::ConcreteState::Shared state;
@property (nonatomic) ParagraphAttributes paragraphAttributes;
@property (nonatomic) LayoutMetrics layoutMetrics;
@property (nonatomic) CGRect drawingFrame;
/** The limit the paragraph resolved, for the shadow it casts apart. */
@property (nonatomic) DynamicRangeLimit dynamicRangeLimit;
/** The component view, which asks layers for their range. */
@property (nonatomic, weak) RCTViewComponentView *rangeOwner;

@end

#if !TARGET_OS_TV
@interface RCTParagraphComponentView () <UIEditMenuInteractionDelegate>

@property (nonatomic, nullable) UIEditMenuInteraction *editMenuInteraction API_AVAILABLE(ios(16.0));

@end
#else
@interface RCTParagraphComponentView ()
@end
#endif

@implementation RCTParagraphComponentView {
  ParagraphAttributes _paragraphAttributes;
  RCTParagraphComponentAccessibilityProvider *_accessibilityProvider;
  UILongPressGestureRecognizer *_longPressGestureRecognizer;
  RCTParagraphTextView *_textView;
  CGRect _textLayoutFrame;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ParagraphShadowNode::defaultSharedProps();

    self.opaque = NO;
    _textView = [RCTParagraphTextView new];
    _textView.backgroundColor = UIColor.clearColor;
    _textView.drawingFrame = self.bounds;
    self.contentView = _textView;
  }

  return self;
}

- (NSString *)description
{
  NSString *superDescription = [super description];

  // Cutting the last `>` character.
  if (superDescription.length > 0 && [superDescription characterAtIndex:superDescription.length - 1] == '>') {
    superDescription = [superDescription substringToIndex:superDescription.length - 1];
  }

  return [NSString stringWithFormat:@"%@; attributedText = %@>", superDescription, self.attributedText];
}

- (NSAttributedString *_Nullable)attributedText
{
  if (!_textView.state) {
    return nil;
  }

  return RCTNSAttributedStringFromAttributedString(_textView.state->getData().attributedString);
}

#pragma mark - RCTComponentViewProtocol

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ParagraphComponentDescriptor>();
}

+ (std::vector<facebook::react::ComponentDescriptorProvider>)supplementalComponentDescriptorProviders
{
  std::vector<facebook::react::ComponentDescriptorProvider> providers = {
      concreteComponentDescriptorProvider<TextNodeComponentDescriptor>(),
      concreteComponentDescriptorProvider<TextComponentDescriptor>()};
  auto elements = facebook::react::dom::inlineTextElementProviders();
  providers.insert(providers.end(), elements.begin(), elements.end());
  return providers;
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldParagraphProps = static_cast<const ParagraphProps &>(*_props);
  const auto &newParagraphProps = static_cast<const ParagraphProps &>(*props);

  _paragraphAttributes = newParagraphProps.paragraphAttributes;
  _textView.paragraphAttributes = _paragraphAttributes;

  if (newParagraphProps.isSelectable != oldParagraphProps.isSelectable) {
    if (newParagraphProps.isSelectable) {
      [self enableContextMenu];
    } else {
      [self disableContextMenu];
    }
  }

  [super updateProps:props oldProps:oldProps];
}

// The peak over SDR white of what the paragraph's store draws (its text and run backgrounds; a text shadow past
// white is cast apart), and the tightest `dynamic-range-limit` among the runs that draw past white
static std::pair<CGFloat, DynamicRangeLimit> RCTAttributedStringHeadroom(const AttributedString &attributedString)
{
  CGFloat headroom = 0;
  auto limit = DynamicRangeLimit::NoLimit;
  for (const auto &fragment : attributedString.getFragments()) {
    const auto &attributes = fragment.textAttributes;
    for (const auto &color : {attributes.foregroundColor, attributes.backgroundColor}) {
      if (!color || !isHighDynamicRangeColor(*color)) {
        continue;
      }
      headroom = std::max(headroom, CGColorHeadroom(RCTUIColorFromSharedColor(color).CGColor));
      const auto runLimit = attributes.dynamicRangeLimit.value_or(DynamicRangeLimit::NoLimit);
      if (runLimit == DynamicRangeLimit::Standard ||
          (runLimit == DynamicRangeLimit::Constrained && limit == DynamicRangeLimit::NoLimit)) {
        limit = runLimit;
      }
    }
  }
  return {headroom, limit};
}

- (void)updateState:(const State::Shared &)state oldState:(const State::Shared &)oldState
{
  _textView.state = std::static_pointer_cast<const ParagraphShadowNode::ConcreteState>(state);
  if (ReactNativeFeatureFlags::enableColorSpaces() && _textView.state) {
    // The text is drawn into the layer's store, which has to be half float for a color past white to survive
    const auto [headroom, runLimit] = RCTAttributedStringHeadroom(_textView.state->getData().attributedString);
    // The paragraph's own declaration first; a run's limit, where one is set, otherwise
    const auto limit = _props->inheritedDynamicRangeLimit.value_or(runLimit);
    _textView.dynamicRangeLimit = limit;
    _textView.rangeOwner = self;
    [self rct_applyDynamicRange:headroom > 1 headroom:headroom limit:limit toLayer:_textView.layer drawn:YES];
  }
  [_textView setNeedsDisplay];
  [self setNeedsLayout];

  // If the attributed string has changed, we need to notify the accessibility system that something changed,
  // otherwise it may hold on to stale values (this happens most often when an element is updated async)
  // https://github.com/react/react-native/issues/58145
  if (state && oldState) {
    const auto &newData = std::static_pointer_cast<const ParagraphShadowNode::ConcreteState>(state)->getData();
    const auto &oldData = std::static_pointer_cast<const ParagraphShadowNode::ConcreteState>(oldState)->getData();
    if (!newData.attributedString.isContentEqual(oldData.attributedString)) {
      UIAccessibilityPostNotification(UIAccessibilityLayoutChangedNotification, nil);
    }
  }
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics
           oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  // Using stored `_layoutMetrics` as `oldLayoutMetrics` here to avoid
  // re-applying individual sub-values which weren't changed.
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:_layoutMetrics];
  _textView.layoutMetrics = _layoutMetrics;
  _textLayoutFrame = RCTCGRectFromRect(_layoutMetrics.getContentFrame());
  [_textView setNeedsDisplay];
  [self setNeedsLayout];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _textView.state = nullptr;
  _accessibilityProvider = nil;
}

- (void)layoutSubviews
{
  [super layoutSubviews];

  CGRect textViewFrame = self.bounds;
  CGRect drawingFrame = RCTCGRectFromRect(_layoutMetrics.getContentFrame());

  if (ReactNativeFeatureFlags::enableIOSCompressedTextFrameAdjustment() && _textView.state &&
      drawingFrame.size.height > 0) {
    const auto &stateData = _textView.state->getData();
    auto textLayoutManager = stateData.layoutManager.lock();
    if (textLayoutManager) {
      RCTTextLayoutManager *nativeTextLayoutManager =
          (RCTTextLayoutManager *)unwrapManagedObject(textLayoutManager->getNativeTextLayoutManager());
      CGRect drawingContainerFrame = drawingFrame;
      drawingFrame = [nativeTextLayoutManager drawingFrameForAttributedString:stateData.attributedString
                                                          paragraphAttributes:_paragraphAttributes
                                                                        frame:drawingFrame
                                                               containerFrame:&drawingContainerFrame];
      textViewFrame = CGRectUnion(textViewFrame, drawingContainerFrame);
    }
  }

  // Inline elements' block-axis padding/border/outline overflow the line box
  // instead of growing it, so the measured text frame is too small to draw
  // them into and `drawRect:` would clip them away. Widen only the drawing
  // surface — the layout frame is deliberately untouched.
  if (_textView.state) {
    auto overflow = _textView.state->getData().attributedString.inlineBoxBlockAxisOverflow();
    if (overflow.top > 0 || overflow.bottom > 0) {
      textViewFrame = CGRectUnion(
          textViewFrame,
          CGRectMake(
              drawingFrame.origin.x,
              drawingFrame.origin.y - overflow.top,
              drawingFrame.size.width,
              drawingFrame.size.height + overflow.top + overflow.bottom));
    }
  }

  _textLayoutFrame = drawingFrame;
  _textView.frame = textViewFrame;
  _textView.drawingFrame = CGRectOffset(drawingFrame, -textViewFrame.origin.x, -textViewFrame.origin.y);
}

#pragma mark - Accessibility

- (NSString *)accessibilityLabel
{
  NSString *label = super.accessibilityLabel;
  if ([label length] > 0) {
    return label;
  }
  return self.attributedText.string;
}

- (NSString *)accessibilityLabelForCoopting
{
  return self.accessibilityLabel;
}

- (BOOL)isAccessibilityElement
{
  // All accessibility functionality of the component is implemented in `accessibilityElements` method below.
  // Hence to avoid calling all other methods from `UIAccessibilityContainer` protocol (most of them have default
  // implementations), we return here `NO`.
  return NO;
}

- (NSArray *)accessibilityElements
{
  const auto &paragraphProps = static_cast<const ParagraphProps &>(*_props);

  // If the component is not `accessible`, we return an empty array.
  // We do this because logically all nested <Text> components represent the content of the <Paragraph> component;
  // in other words, all nested <Text> components individually have no sense without the <Paragraph>.
  if (!_textView.state || !paragraphProps.accessible) {
    return [NSArray new];
  }

  auto &data = _textView.state->getData();

  if (![_accessibilityProvider isUpToDate:data.attributedString]) {
    auto textLayoutManager = data.layoutManager.lock();
    if (textLayoutManager) {
      RCTTextLayoutManager *nativeTextLayoutManager =
          (RCTTextLayoutManager *)unwrapManagedObject(textLayoutManager->getNativeTextLayoutManager());
      CGRect frame = _textLayoutFrame;
      _accessibilityProvider =
          [[RCTParagraphComponentAccessibilityProvider alloc] initWithString:data.attributedString
                                                               layoutManager:nativeTextLayoutManager
                                                         paragraphAttributes:data.paragraphAttributes
                                                                       frame:frame
                                                                        view:self];
    }
  }

  NSArray<UIAccessibilityElement *> *elements = _accessibilityProvider.accessibilityElements;
  if ([elements count] > 0) {
    elements[0].isAccessibilityElement =
        elements[0].accessibilityTraits & UIAccessibilityTraitLink || ![self isAccessibilityCoopted];
  }
  return elements;
}

- (BOOL)isAccessibilityCoopted
{
  UIView *ancestor = self.superview;
  NSMutableSet<UIView *> *cooptingCandidates = [NSMutableSet new];
  while (ancestor) {
    if ([ancestor isKindOfClass:[RCTViewComponentView class]]) {
      if ([((RCTViewComponentView *)ancestor) accessibilityLabelForCoopting]) {
        // We found a label above us. That would be coopted before we would be
        return NO;
      } else if ([((RCTViewComponentView *)ancestor) wantsToCooptLabel]) {
        // We found an view that is looking to coopt a label below it
        [cooptingCandidates addObject:ancestor];
      }

      NSArray *elements = ancestor.accessibilityElements;
      if ([elements count] > 0 && [cooptingCandidates count] > 0) {
        for (NSObject *element in elements) {
          if ([element isKindOfClass:[UIView class]] && [cooptingCandidates containsObject:((UIView *)element)]) {
            return YES;
          }
        }
      }
    } else if (![ancestor isKindOfClass:[RCTViewComponentView class]] && ancestor.accessibilityLabel) {
      // Same as above, for UIView case. Cannot call this on RCTViewComponentView
      // as it is recursive and quite expensive.
      return NO;
    }
    ancestor = ancestor.superview;
  }

  return NO;
}

- (UIAccessibilityTraits)accessibilityTraits
{
  return [super accessibilityTraits] | UIAccessibilityTraitStaticText;
}

#pragma mark - RCTTouchableComponentViewProtocol

- (SharedTouchEventEmitter)touchEventEmitterAtPoint:(CGPoint)point
{
  const auto &state = _textView.state;
  if (!state) {
    return _eventEmitter;
  }

  const auto &stateData = state->getData();
  auto textLayoutManager = stateData.layoutManager.lock();

  if (!textLayoutManager) {
    return _eventEmitter;
  }

  RCTTextLayoutManager *nativeTextLayoutManager =
      (RCTTextLayoutManager *)unwrapManagedObject(textLayoutManager->getNativeTextLayoutManager());
  CGRect frame = _textLayoutFrame;

  auto eventEmitter = [nativeTextLayoutManager getEventEmitterWithAttributeString:stateData.attributedString
                                                              paragraphAttributes:_paragraphAttributes
                                                                            frame:frame
                                                                          atPoint:point];

  if (!eventEmitter) {
    return _eventEmitter;
  }

  assert(std::dynamic_pointer_cast<const TouchEventEmitter>(eventEmitter));
  return std::static_pointer_cast<const TouchEventEmitter>(eventEmitter);
}

#pragma mark - Context Menu

#if !TARGET_OS_TV
- (void)enableContextMenu
{
  _longPressGestureRecognizer = [[UILongPressGestureRecognizer alloc] initWithTarget:self
                                                                              action:@selector(handleLongPress:)];

  if (@available(iOS 16.0, *)) {
    _editMenuInteraction = [[UIEditMenuInteraction alloc] initWithDelegate:self];
    [self addInteraction:_editMenuInteraction];
  }
  [self addGestureRecognizer:_longPressGestureRecognizer];
}

- (void)disableContextMenu
{
  [self removeGestureRecognizer:_longPressGestureRecognizer];
  if (@available(iOS 16.0, *)) {
    [self removeInteraction:_editMenuInteraction];
    _editMenuInteraction = nil;
  }
  _longPressGestureRecognizer = nil;
}

- (void)handleLongPress:(UILongPressGestureRecognizer *)gesture
{
  if (@available(iOS 16.0, macCatalyst 16.0, *)) {
    CGPoint location = [gesture locationInView:self];
    UIEditMenuConfiguration *config = [UIEditMenuConfiguration configurationWithIdentifier:nil sourcePoint:location];
    if (_editMenuInteraction) {
      [_editMenuInteraction presentEditMenuWithConfiguration:config];
    }
  } else {
    UIMenuController *menuController = [UIMenuController sharedMenuController];

    if (menuController.isMenuVisible) {
      return;
    }

    [menuController showMenuFromView:self rect:self.bounds];
  }
}

- (BOOL)canBecomeFirstResponder
{
  const auto &paragraphProps = static_cast<const ParagraphProps &>(*_props);
  return paragraphProps.isSelectable;
}

- (BOOL)canPerformAction:(SEL)action withSender:(id)sender
{
  const auto &paragraphProps = static_cast<const ParagraphProps &>(*_props);

  if (paragraphProps.isSelectable && action == @selector(copy:)) {
    return YES;
  }

  return [self.nextResponder canPerformAction:action withSender:sender];
}

- (void)copy:(id)sender
{
  NSAttributedString *attributedText = self.attributedText;

  NSMutableDictionary *item = [NSMutableDictionary new];

  NSData *rtf = [attributedText dataFromRange:NSMakeRange(0, attributedText.length)
                           documentAttributes:@{NSDocumentTypeDocumentAttribute : NSRTFDTextDocumentType}
                                        error:nil];

  if (rtf) {
    [item setObject:rtf forKey:(id)kUTTypeFlatRTFD];
  }

  [item setObject:attributedText.string forKey:(id)kUTTypeUTF8PlainText];

  UIPasteboard *pasteboard = [UIPasteboard generalPasteboard];
  pasteboard.items = @[ item ];
}
#else
- (void)enableContextMenu
{
}

- (void)disableContextMenu
{
}
#endif

@end

Class<RCTComponentViewProtocol> RCTParagraphCls(void)
{
  return RCTParagraphComponentView.class;
}

@implementation RCTParagraphTextView {
  CAShapeLayer *_highlightLayer;
  CALayer *_shadowCastLayer;
}

// The text shadow past SDR white, if any, with its offset and blur: the paragraph draws it apart from its ink
static bool RCTAttributedStringCastShadow(
    const AttributedString &attributedString,
    CGSize &offset,
    CGFloat &blur,
    CGFloat &headroom)
{
  bool found = false;
  for (const auto &fragment : attributedString.getFragments()) {
    const auto &attributes = fragment.textAttributes;
    if (!attributes.textShadowColor || !isHighDynamicRangeColor(*attributes.textShadowColor)) {
      continue;
    }
    found = true;
    headroom = std::max(headroom, CGColorHeadroom(RCTUIColorFromSharedColor(attributes.textShadowColor).CGColor));
    if (attributes.textShadowOffset.has_value()) {
      offset = CGSizeMake(attributes.textShadowOffset->width, attributes.textShadowOffset->height);
    }
    if (!isnan(attributes.textShadowRadius)) {
      blur = std::max<CGFloat>(blur, attributes.textShadowRadius);
    }
  }
  return found;
}

// The same text with every run's ink replaced by its shadow color (runs without an HDR shadow go transparent),
// so the layout manager lays the shadow out exactly as it lays out the text
static AttributedString RCTShadowOnlyAttributedString(const AttributedString &attributedString)
{
  AttributedString shadowString = attributedString;
  for (auto &fragment : shadowString.getFragments()) {
    auto &attributes = fragment.textAttributes;
    const bool cast = attributes.textShadowColor && isHighDynamicRangeColor(*attributes.textShadowColor);
    attributes.foregroundColor = cast ? attributes.textShadowColor : clearColor();
    attributes.backgroundColor = SharedColor{};
    attributes.textDecorationLineType = TextDecorationLineType::None;
    attributes.textShadowColor = SharedColor{};
    attributes.textShadowOffset = std::nullopt;
  }
  return shadowString;
}

- (void)castShadowWithLayoutManager:(RCTTextLayoutManager *)layoutManager
                   attributedString:(const AttributedString &)attributedString
                              frame:(CGRect)frame
{
  CGSize offset = CGSizeZero;
  CGFloat blur = 0;
  CGFloat headroom = 0;
  if (!ReactNativeFeatureFlags::enableColorSpaces() ||
      !RCTAttributedStringCastShadow(attributedString, offset, blur, headroom)) {
    [_shadowCastLayer removeFromSuperlayer];
    _shadowCastLayer = nil;
    return;
  }
  const CGFloat reach = ceil(fmax(fabs(offset.width), fabs(offset.height)) + 3 * blur + 1);
  const CGRect extent = CGRectInset(self.bounds, -reach, -reach);
  const CGFloat scale = self.layer.contentsScale > 0 ? self.layer.contentsScale : [UIScreen mainScreen].scale;
  const size_t width = (size_t)ceil(extent.size.width * scale);
  const size_t height = (size_t)ceil(extent.size.height * scale);
  if (width == 0 || height == 0) {
    return;
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
    return;
  }
  CGContextScaleCTM(context, scale, scale);
  CGContextTranslateCTM(context, 0, extent.size.height);
  CGContextScaleCTM(context, 1, -1);
  CGContextTranslateCTM(context, reach + offset.width, reach + offset.height);
  UIGraphicsPushContext(context);
  [layoutManager drawAttributedString:RCTShadowOnlyAttributedString(attributedString)
                  paragraphAttributes:_paragraphAttributes
                                frame:frame
                    drawHighlightPath:^(UIBezierPath *){
                    }];
  UIGraphicsPopContext();
  CGImageRef image = CGBitmapContextCreateImage(context);
  CGContextRelease(context);
  if (blur > 0) {
    // A Core Image blur keeps the half-float values; a Core Graphics shadow would not
    static CIContext *blurContext = [CIContext contextWithOptions:@{
      kCIContextWorkingFormat : @(kCIFormatRGBAh),
      kCIContextWorkingColorSpace : (__bridge id)extendedLinear,
    }];
    CIImage *source = [CIImage imageWithCGImage:image];
    CIImage *blurred = [[source imageByClampingToExtent] imageByApplyingGaussianBlurWithSigma:blur / 2];
    CGImageRef blurredImage = [blurContext createCGImage:[blurred imageByCroppingToRect:source.extent]
                                                fromRect:source.extent
                                                  format:kCIFormatRGBAh
                                              colorSpace:extendedLinear];
    if (blurredImage != nullptr) {
      CGImageRelease(image);
      image = blurredImage;
    }
  }
  // Under the ink: a sublayer would draw over this layer's own store, so the cast sits beside this view's layer
  // in the parent, below it
  CALayer *host = self.superview.layer;
  if (host == nil) {
    return;
  }
  if (_shadowCastLayer == nil) {
    _shadowCastLayer = [CALayer layer];
  }
  if (_shadowCastLayer.superlayer != host) {
    [_shadowCastLayer removeFromSuperlayer];
    [host insertSublayer:_shadowCastLayer below:self.layer];
  }
  _shadowCastLayer.frame = CGRectOffset(extent, self.frame.origin.x, self.frame.origin.y);
  _shadowCastLayer.contentsScale = scale;
  _shadowCastLayer.contents = (__bridge id)image;
  CGImageRelease(image);
  [self.rangeOwner rct_applyDynamicRange:YES
                                headroom:headroom
                                   limit:self.dynamicRangeLimit
                                 toLayer:_shadowCastLayer
                                   drawn:YES];
}

- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event
{
  return nil;
}

- (void)drawRect:(CGRect)rect
{
  if (!_state) {
    return;
  }

  const auto &stateData = _state->getData();
  auto textLayoutManager = stateData.layoutManager.lock();
  if (!textLayoutManager) {
    return;
  }

  RCTTextLayoutManager *nativeTextLayoutManager =
      (RCTTextLayoutManager *)unwrapManagedObject(textLayoutManager->getNativeTextLayoutManager());

  CGRect frame = _drawingFrame;

  [self castShadowWithLayoutManager:nativeTextLayoutManager attributedString:stateData.attributedString frame:frame];
  [nativeTextLayoutManager drawAttributedString:stateData.attributedString
                            paragraphAttributes:_paragraphAttributes
                                          frame:frame
                              drawHighlightPath:^(UIBezierPath *highlightPath) {
                                if (highlightPath) {
                                  if (!self->_highlightLayer) {
                                    self->_highlightLayer = [CAShapeLayer layer];
                                    self->_highlightLayer.fillColor = [UIColor colorWithWhite:0 alpha:0.25].CGColor;
                                    [self.layer addSublayer:self->_highlightLayer];
                                  }
                                  self->_highlightLayer.position = frame.origin;
                                  self->_highlightLayer.path = highlightPath.CGPath;
                                } else {
                                  [self->_highlightLayer removeFromSuperlayer];
                                  self->_highlightLayer = nil;
                                }
                              }];
}

@end
