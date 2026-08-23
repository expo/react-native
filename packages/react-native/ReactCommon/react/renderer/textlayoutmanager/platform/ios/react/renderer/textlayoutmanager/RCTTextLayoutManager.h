/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <UIKit/UIKit.h>

#import <react/renderer/attributedstring/AttributedString.h>
#import <react/renderer/attributedstring/ParagraphAttributes.h>
#import <react/renderer/core/LayoutConstraints.h>
#import <react/renderer/textlayoutmanager/TextLayoutContext.h>
#import <react/renderer/textlayoutmanager/TextMeasureCache.h>

NS_ASSUME_NONNULL_BEGIN

/**
 @abstract Enumeration block for text fragments.
*/

using RCTTextLayoutFragmentEnumerationBlock =
    void (^)(CGRect fragmentRect, NSString *_Nonnull fragmentText, NSString *value);

/**
 * The layout manager every RCTTextLayoutManager text storage uses. It gives
 * wrapped ranges CSS background semantics: TextKit extends a wrapped range's
 * background to the line's wrap edge (the selection convention), while a CSS
 * background hugs the glyphs — the space collapsed at a soft wrap paints
 * nothing. See -fillBackgroundRectArray: in the implementation.
 */
@interface RCTGlyphHuggingLayoutManager : NSLayoutManager
@end

/**
 * iOS-specific TextLayoutManager
 */
@interface RCTTextLayoutManager : NSObject

/*
 * Returns the laid-out rect of each fragment of `attributedString`, parallel
 * to its fragment list and relative to the text frame's origin, for the given
 * container size.
 *
 * This is what lets an inline element (`<b>`, `<span>`, a nested `<Text>`)
 * report a real box from `getBoundingClientRect()`: the containing
 * Paragraph/View unions the rects of the fragments belonging to an element
 * and stamps the result onto it. A fragment that wraps reports the union of
 * its line pieces, matching the web.
 */
- (std::vector<facebook::react::Rect>)
    getFragmentRectsWithAttributedString:(facebook::react::AttributedString)attributedString
                     paragraphAttributes:(facebook::react::ParagraphAttributes)paragraphAttributes
                                    size:(CGSize)size;

- (facebook::react::TextMeasurement)measureAttributedString:(facebook::react::AttributedString)attributedString
                                        paragraphAttributes:(facebook::react::ParagraphAttributes)paragraphAttributes
                                              layoutContext:(facebook::react::TextLayoutContext)layoutContext
                                          layoutConstraints:(facebook::react::LayoutConstraints)layoutConstraints;

- (facebook::react::TextMeasurement)measureNSAttributedString:(NSAttributedString *)attributedString
                                          paragraphAttributes:(facebook::react::ParagraphAttributes)paragraphAttributes
                                                layoutContext:(facebook::react::TextLayoutContext)layoutContext
                                            layoutConstraints:(facebook::react::LayoutConstraints)layoutConstraints;

- (void)drawAttributedString:(facebook::react::AttributedString)attributedString
         paragraphAttributes:(facebook::react::ParagraphAttributes)paragraphAttributes
                       frame:(CGRect)frame
           drawHighlightPath:(void (^_Nullable)(UIBezierPath *highlightPath))block;

/*
 * The run TextKit storage cache (ios-run-draw-reuse-plan.md). Measuring a
 * run already builds and fully lays out its NSTextStorage stack on the
 * layout thread; caching it by content + container width lets the run view
 * draw from it instead of converting, building, and re-shaping the
 * identical stack on the main thread. Content keying mirrors the caching
 * policy the C++ text measure cache already applies to the same inputs, so
 * measure-cache-hit re-mounts still find their storage. Returns nil on a
 * miss (the draw falls back to the rebuild path).
 */
- (nullable NSTextStorage *)cachedRunTextStorageForAttributedString:
                                (const facebook::react::AttributedString &)attributedString
                                                              width:(CGFloat)width;

/*
 * Draws a laid-out text storage (from the handoff above) exactly as
 * `drawAttributedString` would: background, inline box decorations, glyphs,
 * custom decorations, highlight path. The storage must already have a
 * layout manager and container attached.
 */
- (void)drawTextStorage:(NSTextStorage *)textStorage
       attributedString:(const facebook::react::AttributedString &)attributedString
                  frame:(CGRect)frame
      drawHighlightPath:(void (^_Nullable)(UIBezierPath *highlightPath))block;

- (facebook::react::LinesMeasurements)getLinesForAttributedString:(facebook::react::AttributedString)attributedString
                                              paragraphAttributes:
                                                  (facebook::react::ParagraphAttributes)paragraphAttributes
                                                             size:(CGSize)size;

- (std::shared_ptr<const facebook::react::EventEmitter>)
    getEventEmitterWithAttributeString:(facebook::react::AttributedString)attributedString
                   paragraphAttributes:(facebook::react::ParagraphAttributes)paragraphAttributes
                                 frame:(CGRect)frame
                               atPoint:(CGPoint)point;

- (void)getRectWithAttributedString:(facebook::react::AttributedString)attributedString
                paragraphAttributes:(facebook::react::ParagraphAttributes)paragraphAttributes
                 enumerateAttribute:(NSString *)enumerateAttribute
                              frame:(CGRect)frame
                         usingBlock:(RCTTextLayoutFragmentEnumerationBlock)block;

@end

NS_ASSUME_NONNULL_END
