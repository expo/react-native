/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/element/ComponentBuilder.h>

#include <gtest/gtest.h>
#include <react/renderer/attributedstring/conversions.h>
#include <react/renderer/core/RawValue.h>
#include <react/renderer/components/text/InlineContentShadowNode.h>
#include <react/renderer/components/text/InlineTextTagShadowNodes.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/element/Element.h>
#include <react/renderer/element/testUtils.h>

namespace facebook::react {

namespace {

Element<TextNodeShadowNode> rawTextElement(const char* text) {
  auto rawTextProps = std::make_shared<TextNodeProps>();
  rawTextProps->text = text;
  return Element<TextNodeShadowNode>().props(rawTextProps);
}

std::string roundTripTextAlignment(const char* textAlignment) {
  ContextContainer contextContainer{};
  PropsParserContext parserContext{-1, contextContainer};
  TextAlignment result = TextAlignment::Natural;
  fromRawValue(parserContext, RawValue{folly::dynamic{textAlignment}}, result);
  return toString(result);
}

} // namespace

TEST(BaseTextShadowNodeTest, textAlignmentStartAndEndRoundTrip) {
  EXPECT_EQ(roundTripTextAlignment("start"), "start");
  EXPECT_EQ(roundTripTextAlignment("end"), "end");
}

TEST(BaseTextShadowNodeTest, fragmentsWithDifferentAttributes) {
  ContextContainer contextContainer{};
  PropsParserContext parserContext{-1, contextContainer};

  auto builder = simpleComponentBuilder();
  auto shadowNode = builder.build(
      Element<ParagraphShadowNode>().children({
          Element<TextShadowNode>()
              .props([]() {
                auto props = std::make_shared<TextProps>();
                props->textAttributes.fontSize = 12;
                return props;
              })
              .children({
                  rawTextElement("First fragment. "),
              }),
          Element<TextShadowNode>()
              .props([]() {
                auto props = std::make_shared<TextProps>();
                props->textAttributes.fontSize = 24;
                return props;
              })
              .children({
                  rawTextElement("Second fragment"),
              }),
      }));

  auto baseTextAttributes = TextAttributes::defaultTextAttributes();
  AttributedString output;
  BaseTextShadowNode::Attachments attachments;
  BaseTextShadowNode::buildAttributedString(
      baseTextAttributes, *shadowNode, output, attachments);

  EXPECT_EQ(output.getString(), "First fragment. Second fragment");

  const auto& fragments = output.getFragments();
  EXPECT_EQ(fragments.size(), 2);
  EXPECT_EQ(fragments[0].textAttributes.fontSize, 12);
  EXPECT_EQ(
      fragments[0].parentShadowView.tag,
      shadowNode->getChildren()[0]->getTag());
  EXPECT_EQ(fragments[1].textAttributes.fontSize, 24);
  EXPECT_EQ(
      fragments[1].parentShadowView.tag,
      shadowNode->getChildren()[1]->getTag());
}

TEST(BaseTextShadowNodeTest, rawTextIsMerged) {
  ContextContainer contextContainer{};
  PropsParserContext parserContext{-1, contextContainer};

  auto builder = simpleComponentBuilder();
  auto shadowNode = builder.build(
      Element<TextShadowNode>().children({
          rawTextElement("Hello "),
          rawTextElement("World"),
      }));

  auto baseTextAttributes = TextAttributes::defaultTextAttributes();
  AttributedString output;
  BaseTextShadowNode::Attachments attachments;
  BaseTextShadowNode::buildAttributedString(
      baseTextAttributes, *shadowNode, output, attachments);

  EXPECT_EQ(output.getString(), "Hello World");
  EXPECT_EQ(output.getFragments().size(), 1);
}

namespace {

// Builds anonymous inline content directly. In the app the View's layout
// synthesizes these boxes (AnonymousTextContent.cpp); here the model is
// computed from the same content string the run publishes.
ComponentBuilder inlineContentComponentBuilder() {
  ComponentDescriptorProviderRegistry componentDescriptorProviderRegistry{};
  auto componentDescriptorRegistry =
      componentDescriptorProviderRegistry.createComponentDescriptorRegistry(
          ComponentDescriptorParameters{
              .eventDispatcher = EventDispatcher::Shared{},
              .contextContainer = nullptr,
              .flavor = nullptr});
  componentDescriptorProviderRegistry.add(
      concreteComponentDescriptorProvider<
          ConcreteComponentDescriptor<InlineContentShadowNode>>());
  componentDescriptorProviderRegistry.add(
      concreteComponentDescriptorProvider<InlineTextComponentDescriptor>());
  componentDescriptorProviderRegistry.add(
      concreteComponentDescriptorProvider<TextNodeComponentDescriptor>());
  return ComponentBuilder{componentDescriptorRegistry};
}

InlineAccessibilityContent accessibilityContentOf(
    const InlineContentShadowNode& shadowNode) {
  return shadowNode.getInlineAccessibilityContent(
      shadowNode.getContentAttributedString(1));
}

} // namespace

TEST(BaseTextShadowNodeTest, inlineAccessibilityFlattensPresentationalTags) {
  auto builder = inlineContentComponentBuilder();
  auto shadowNode = builder.build(
      Element<InlineContentShadowNode>().children({
          rawTextElement("Read "),
          Element<InlineTextShadowNode>()
              .props([]() {
                auto props = std::make_shared<InlineTextProps>();
                props->nodeName = "b";
                return props;
              })
              .children({rawTextElement("carefully")}),
          rawTextElement("."),
      }));

  const auto content = accessibilityContentOf(*shadowNode);

  ASSERT_EQ(content.elements.size(), 1);
  EXPECT_EQ(
      content.elements[0].kind, InlineAccessibilityElement::Kind::StaticText);
  EXPECT_EQ(content.elements[0].label, "Read carefully.");
}

TEST(BaseTextShadowNodeTest, inlineAccessibilityPreservesSemanticOrder) {
  auto builder = inlineContentComponentBuilder();
  auto shadowNode = builder.build(
      Element<InlineContentShadowNode>().children({
          rawTextElement("Read "),
          Element<InlineTextShadowNode>()
              .props([]() {
                auto props = std::make_shared<InlineTextProps>();
                props->nodeName = "a";
                props->textAttributes.href = "https://example.com/terms";
                props->accessibilityLabel = "terms and conditions";
                return props;
              })
              .children({rawTextElement("terms")}),
          rawTextElement(" first."),
      }));

  const auto content = accessibilityContentOf(*shadowNode);

  ASSERT_EQ(content.elements.size(), 3);
  EXPECT_EQ(content.elements[0].label, "Read ");
  EXPECT_EQ(content.elements[1].label, "terms and conditions");
  EXPECT_EQ(content.elements[1].role, "link");
  EXPECT_EQ(
      content.elements[1].kind, InlineAccessibilityElement::Kind::Element);
  EXPECT_NE(content.elements[1].tag, 0);
  EXPECT_EQ(content.elements[2].label, " first.");
}

TEST(BaseTextShadowNodeTest, inlineAccessibilityAnchorWithoutHrefIsNotALink) {
  auto builder = inlineContentComponentBuilder();
  auto shadowNode = builder.build(
      Element<InlineContentShadowNode>().children({
          rawTextElement("Jump "),
          Element<InlineTextShadowNode>()
              .props([]() {
                auto props = std::make_shared<InlineTextProps>();
                props->nodeName = "a";
                return props;
              })
              .children({rawTextElement("here")}),
      }));

  const auto content = accessibilityContentOf(*shadowNode);

  ASSERT_EQ(content.elements.size(), 1);
  EXPECT_EQ(
      content.elements[0].kind, InlineAccessibilityElement::Kind::StaticText);
  EXPECT_EQ(content.elements[0].label, "Jump here");
}

TEST(BaseTextShadowNodeTest, inlineAccessibilityOmitsHiddenSemanticContent) {
  auto builder = inlineContentComponentBuilder();
  auto shadowNode = builder.build(
      Element<InlineContentShadowNode>().children({
          rawTextElement("Visible "),
          Element<InlineTextShadowNode>()
              .props([]() {
                auto props = std::make_shared<InlineTextProps>();
                props->accessible = true;
                props->accessibilityElementsHidden = true;
                return props;
              })
              .children({rawTextElement("secret")}),
          rawTextElement(" text"),
      }));

  const auto content = accessibilityContentOf(*shadowNode);

  ASSERT_EQ(content.elements.size(), 1);
  EXPECT_EQ(content.elements[0].label, "Visible  text");
}

TEST(BaseTextShadowNodeTest, inlineAccessibilityLanguageAndLiveRegionAreBoundaries) {
  // A span with semantics of its own is a leaf of its own on every platform: the language a
  // reader speaks it in, and the updates it announces, belong to exactly its text
  auto builder = inlineContentComponentBuilder();
  auto shadowNode = builder.build(
      Element<InlineContentShadowNode>().children({
          rawTextElement("Status: "),
          Element<InlineTextShadowNode>()
              .props([]() {
                auto props = std::make_shared<InlineTextProps>();
                props->nodeName = "span";
                props->accessibilityLiveRegion = AccessibilityLiveRegion::Polite;
                return props;
              })
              .children({rawTextElement("0 updates")}),
          rawTextElement(" and "),
          Element<InlineTextShadowNode>()
              .props([]() {
                auto props = std::make_shared<InlineTextProps>();
                props->nodeName = "span";
                props->accessibilityLanguage = "ar-SA";
                return props;
              })
              .children({rawTextElement("marhaba")}),
      }));

  const auto content = accessibilityContentOf(*shadowNode);

  ASSERT_EQ(content.elements.size(), 4);
  EXPECT_EQ(content.elements[0].label, "Status: ");
  EXPECT_EQ(
      content.elements[1].kind, InlineAccessibilityElement::Kind::Element);
  EXPECT_EQ(content.elements[1].label, "0 updates");
  EXPECT_EQ(content.elements[1].liveRegion, AccessibilityLiveRegion::Polite);
  EXPECT_EQ(content.elements[2].label, " and ");
  EXPECT_EQ(
      content.elements[3].kind, InlineAccessibilityElement::Kind::Element);
  EXPECT_EQ(content.elements[3].label, "marhaba");
  EXPECT_EQ(content.elements[3].language, "ar-SA");
  EXPECT_TRUE(content.attachmentTags.empty());
  for (const auto& element : content.elements) {
    EXPECT_TRUE(element.attachmentTags.empty());
  }
}

} // namespace facebook::react
