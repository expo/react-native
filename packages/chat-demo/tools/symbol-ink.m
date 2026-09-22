// Measures the ink (dark pixels) an SF Symbol draws at a given configuration, in points. This
// differs from the image size, and it is what a screenshot measures.
//
//   xcrun --sdk iphonesimulator clang -target arm64-apple-ios17.0-simulator \
//     -framework UIKit -framework CoreGraphics -fobjc-arc tools/symbol-ink.m -o /tmp/sfm
//   xcrun simctl spawn <udid> /tmp/sfm plus 19 regular medium
//
//    plus 19pt regular  image 20.0000 x 18.0000
//      ink 15.3333 x 15.3333 at (2.3333, 1.3333)
//      vertical bar 1.5833 wide   full height 15.3333
//      shaft 1.5833 (2pt above the tail)   head 1.5833 (2pt below the tip)
//
// The iOS value of `PLUS_ICON` in Composer.js is the ink size of `plus 19 regular`, above.
#import <UIKit/UIKit.h>

int main(int argc, char **argv)
{
  @autoreleasepool {
    NSString *name = argc > 1 ? @(argv[1]) : @"plus";
    CGFloat point = argc > 2 ? atof(argv[2]) : 16;
    UIImageSymbolWeight weight = UIImageSymbolWeightMedium;
    if (argc > 3) {
      NSString *w = @(argv[3]);
      if ([w isEqual:@"light"]) weight = UIImageSymbolWeightLight;
      else if ([w isEqual:@"regular"]) weight = UIImageSymbolWeightRegular;
      else if ([w isEqual:@"semibold"]) weight = UIImageSymbolWeightSemibold;
      else if ([w isEqual:@"bold"]) weight = UIImageSymbolWeightBold;
    }
    UIImageSymbolScale scale = UIImageSymbolScaleMedium;
    if (argc > 4) {
      NSString *sc = @(argv[4]);
      if ([sc isEqual:@"small"]) scale = UIImageSymbolScaleSmall;
      else if ([sc isEqual:@"large"]) scale = UIImageSymbolScaleLarge;
    }
    UIImageSymbolConfiguration *config =
        [UIImageSymbolConfiguration configurationWithPointSize:point
                                                       weight:weight
                                                        scale:scale];
    UIImage *image = [[UIImage systemImageNamed:name withConfiguration:config]
        imageWithTintColor:UIColor.blackColor renderingMode:UIImageRenderingModeAlwaysOriginal];
    if (image == nil) { fprintf(stderr, "no symbol %s\n", name.UTF8String); return 1; }
    printf("%s %gpt %s  image %.4f x %.4f\n", name.UTF8String, point,
           argc > 3 ? argv[3] : "medium", image.size.width, image.size.height);

    const CGFloat s = 12;  // render at 12x, so results are in twelfths of a point
    size_t w = (size_t)ceil(image.size.width * s), h = (size_t)ceil(image.size.height * s);
    uint8_t *bits = calloc(w * h, 1);
    CGColorSpaceRef gray = CGColorSpaceCreateDeviceGray();
    CGContextRef ctx = CGBitmapContextCreate(bits, w, h, 8, w, gray, kCGImageAlphaNone);
    CGContextSetGrayFillColor(ctx, 1, 1);
    CGContextFillRect(ctx, CGRectMake(0, 0, w, h));
    UIGraphicsPushContext(ctx);
    CGContextScaleCTM(ctx, s, -s);
    CGContextTranslateCTM(ctx, 0, -image.size.height);
    [image drawInRect:CGRectMake(0, 0, image.size.width, image.size.height)];
    UIGraphicsPopContext();

    size_t minX = w, maxX = 0, minY = h, maxY = 0;
    for (size_t y = 0; y < h; y++)
      for (size_t x = 0; x < w; x++)
        if (bits[y * w + x] < 128) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
    if (minX > maxX) { printf("  no ink\n"); return 0; }
    printf("  ink %.4f x %.4f at (%.4f, %.4f)\n",
           (maxX - minX + 1) / s, (maxY - minY + 1) / s, minX / s, minY / s);

    size_t midX = (minX + maxX) / 2;
    size_t runY = 0;
    for (size_t y = 0; y < h; y++) if (bits[y * w + midX] < 128) runY++;
    // The stroke, measured on a row a sixth of the way down, away from the horizontal bar.
    size_t clearY = minY + (maxY - minY) / 6, run = 0;
    for (size_t x = 0; x < w; x++) if (bits[clearY * w + x] < 128) run++;
    printf("  vertical bar %.4f wide   full height %.4f\n", run / s, runY / s);
    size_t tailRow = maxY - (size_t)(2 * s), tailRun = 0;
    for (size_t x = 0; x < w; x++) if (bits[tailRow * w + x] < 128) tailRun++;
    size_t tipRow = minY + (size_t)(2 * s), tipRun = 0;
    for (size_t x = 0; x < w; x++) if (bits[tipRow * w + x] < 128) tipRun++;
    printf("  shaft %.4f (2pt above the tail)   head %.4f (2pt below the tip)\n",
           tailRun / s, tipRun / s);
    return 0;
  }
}
