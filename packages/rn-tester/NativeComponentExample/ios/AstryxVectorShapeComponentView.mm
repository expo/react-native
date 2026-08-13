/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "AstryxVectorShapeComponentView.h"

#import <react/renderer/components/AppSpecs/ComponentDescriptors.h>
#import <react/renderer/components/AppSpecs/EventEmitters.h>
#import <react/renderer/components/AppSpecs/Props.h>
#import <react/renderer/components/AppSpecs/RCTComponentViewHelpers.h>

#import "RCTFabricComponentsPlugins.h"

using namespace facebook::react;

// Opcodes, matching js/astryx/svg/pathData.js.
static const CGFloat kOpMove = 0;
static const CGFloat kOpLine = 1;
static const CGFloat kOpCubic = 2;
static const CGFloat kOpClose = 3;

@interface AstryxVectorShapeComponentView () <RCTAstryxVectorShapeViewProtocol>
@end

@implementation AstryxVectorShapeComponentView {
  CAShapeLayer *_shapeLayer;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<AstryxVectorShapeComponentDescriptor>();
}

+ (void)load
{
  [super load];
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const AstryxVectorShapeProps>();
    _props = defaultProps;

    // A shape layer rather than -drawRect: so the path is rasterised by Core
    // Animation at the layer's own scale — an icon stays crisp when the view
    // is resized, and there is no redraw on every layout pass.
    _shapeLayer = [CAShapeLayer layer];
    _shapeLayer.fillColor = nil;
    _shapeLayer.strokeColor = nil;
    [self.layer addSublayer:_shapeLayer];
  }
  return self;
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  // The geometry arrives already scaled to the view's size, so the layer
  // simply covers the view; nothing is transformed here.
  _shapeLayer.frame = self.bounds;
}

/**
 * Rebuilds the path from the flat command list.
 *
 * Malformed input truncates rather than reads past the end: the argument count
 * is checked before every read, because a path that draws partially is a far
 * better failure than one that walks off the array.
 */
static CGPathRef AstryxCreatePath(const std::vector<Float> &commands)
{
  CGMutablePathRef path = CGPathCreateMutable();
  size_t i = 0;
  const size_t count = commands.size();
  while (i < count) {
    const CGFloat op = (CGFloat)commands[i];
    if (op == kOpClose) {
      CGPathCloseSubpath(path);
      i += 1;
    } else if (op == kOpMove) {
      if (i + 2 >= count) {
        break;
      }
      CGPathMoveToPoint(path, NULL, (CGFloat)commands[i + 1], (CGFloat)commands[i + 2]);
      i += 3;
    } else if (op == kOpLine) {
      if (i + 2 >= count) {
        break;
      }
      CGPathAddLineToPoint(path, NULL, (CGFloat)commands[i + 1], (CGFloat)commands[i + 2]);
      i += 3;
    } else if (op == kOpCubic) {
      if (i + 6 >= count) {
        break;
      }
      CGPathAddCurveToPoint(
          path,
          NULL,
          (CGFloat)commands[i + 1],
          (CGFloat)commands[i + 2],
          (CGFloat)commands[i + 3],
          (CGFloat)commands[i + 4],
          (CGFloat)commands[i + 5],
          (CGFloat)commands[i + 6]);
      i += 7;
    } else {
      break; // unrecognised opcode: keep what has been built
    }
  }
  return path;
}

static CGColorRef AstryxColorFromInt(int32_t argb)
{
  if (argb == 0) {
    return NULL; // fully transparent means "do not paint this"
  }
  const CGFloat alpha = ((argb >> 24) & 0xFF) / 255.0;
  const CGFloat red = ((argb >> 16) & 0xFF) / 255.0;
  const CGFloat green = ((argb >> 8) & 0xFF) / 255.0;
  const CGFloat blue = (argb & 0xFF) / 255.0;
  return [UIColor colorWithRed:red green:green blue:blue alpha:alpha].CGColor;
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &newProps = *std::static_pointer_cast<const AstryxVectorShapeProps>(props);

  CGPathRef path = AstryxCreatePath(newProps.commands);
  _shapeLayer.path = path;
  CGPathRelease(path);

  _shapeLayer.fillColor = AstryxColorFromInt(newProps.fillColor);
  _shapeLayer.strokeColor = AstryxColorFromInt(newProps.strokeColor);
  _shapeLayer.lineWidth = (CGFloat)newProps.strokeWidth;

  const std::string &cap = newProps.strokeLinecap;
  _shapeLayer.lineCap = cap == "round"  ? kCALineCapRound
      : cap == "square"                 ? kCALineCapSquare
                                        : kCALineCapButt;

  const std::string &join = newProps.strokeLinejoin;
  _shapeLayer.lineJoin = join == "round" ? kCALineJoinRound
      : join == "bevel"                  ? kCALineJoinBevel
                                         : kCALineJoinMiter;

  _shapeLayer.fillRule = newProps.fillRule == "evenodd" ? kCAFillRuleEvenOdd : kCAFillRuleNonZero;

  [super updateProps:props oldProps:oldProps];
}

@end

Class<RCTComponentViewProtocol> AstryxVectorShapeCls(void)
{
  return AstryxVectorShapeComponentView.class;
}
