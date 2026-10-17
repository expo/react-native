/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "StyleProperties.h"
#include "StyleSheet.h"
#include "StyleTokenizer.h"
#include "StyleValues.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <string_view>
#include <unordered_set>

namespace facebook::react::cssengine {

namespace {

std::string lowercase(std::string_view text) {
  std::string out(text);
  for (char& c : out) {
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  return out;
}

bool equalsIgnoringCase(std::string_view a, std::string_view b) {
  if (a.size() != b.size()) {
    return false;
  }
  for (size_t i = 0; i < a.size(); i++) {
    if (std::tolower(static_cast<unsigned char>(a[i])) !=
        std::tolower(static_cast<unsigned char>(b[i]))) {
      return false;
    }
  }
  return true;
}

constexpr uint32_t kSpecificityA = 1u << 20;
constexpr uint32_t kSpecificityB = 1u << 10;
constexpr uint32_t kSpecificityC = 1u;

/*
 * Reads a run of tokens. Blocks are skipped whole, so a search for a
 * separator only ever finds one at the level it starts at.
 */
class TokenStream {
 public:
  TokenStream(std::string_view source, const std::vector<Token>& tokens)
      : source_(source), tokens_(tokens) {}

  const Token& at(size_t index) const {
    return tokens_[index];
  }

  size_t size() const {
    return tokens_.size();
  }

  std::string_view source() const {
    return source_;
  }

  const std::vector<Token>& tokens() const {
    return tokens_;
  }

  // The index of the token closing the block that opens at `open`, or
  // `limit` when it never closes
  size_t blockEnd(size_t open, size_t limit) const {
    std::vector<TokenType> expected;
    for (size_t i = open; i < limit; i++) {
      TokenType type = tokens_[i].type;
      if (type == TokenType::OpenCurly) {
        expected.push_back(TokenType::CloseCurly);
      } else if (type == TokenType::OpenParen || type == TokenType::Function) {
        expected.push_back(TokenType::CloseParen);
      } else if (type == TokenType::OpenSquare) {
        expected.push_back(TokenType::CloseSquare);
      } else if (
          !expected.empty() &&
          (type == TokenType::CloseCurly || type == TokenType::CloseParen ||
           type == TokenType::CloseSquare)) {
        if (type == expected.back()) {
          expected.pop_back();
          if (expected.empty()) {
            return i;
          }
        }
      }
    }
    return limit;
  }

  // The index of the first `type` token at the level `first` is at, or
  // `limit`
  size_t find(TokenType type, size_t first, size_t limit) const {
    for (size_t i = first; i < limit; i++) {
      TokenType current = tokens_[i].type;
      if (current == type) {
        return i;
      }
      if (current == TokenType::OpenCurly || current == TokenType::OpenParen ||
          current == TokenType::Function || current == TokenType::OpenSquare) {
        i = blockEnd(i, limit);
      }
    }
    return limit;
  }

  std::string text(size_t first, size_t last) const {
    return serializeTokens(source_, tokens_, first, last);
  }

 private:
  std::string_view source_;
  const std::vector<Token>& tokens_;
};

// -- Selectors (selectors-4) --

class SelectorParser {
 public:
  SelectorParser(const TokenStream& stream, size_t first, size_t last)
      : stream_(stream), position_(first), last_(last) {}

  // A selector list; nullopt when any selector in it is invalid, which
  // invalidates the whole list (§3.2) unless `forgiving` (§3.3)
  std::optional<SelectorList> parseList(bool forgiving) {
    SelectorList list;
    size_t start = position_;
    while (true) {
      size_t comma = stream_.find(TokenType::Comma, start, last_);
      SelectorParser part(stream_, start, comma);
      auto selector = part.parseComplex();
      readsSiblings_ = readsSiblings_ || part.readsSiblings();
      if (selector) {
        list.push_back(std::move(*selector));
      } else if (!forgiving) {
        return std::nullopt;
      }
      if (comma >= last_) {
        break;
      }
      start = comma + 1;
    }
    return list;
  }

  std::optional<ComplexSelector> parseComplex() {
    ComplexSelector selector;
    skipWhitespace();
    if (atEnd()) {
      return std::nullopt;
    }
    while (true) {
      auto compound = parseCompound(selector);
      if (!compound) {
        return std::nullopt;
      }
      selector.compounds.push_back(std::move(*compound));
      bool sawWhitespace = skipWhitespace();
      if (atEnd()) {
        break;
      }
      Combinator combinator = Combinator::Descendant;
      const Token& token = current();
      if (token.type == TokenType::Delim &&
          (token.value == ">" || token.value == "+" || token.value == "~")) {
        combinator = token.value == ">" ? Combinator::Child
            : token.value == "+"        ? Combinator::NextSibling
                                        : Combinator::SubsequentSibling;
        position_++;
        skipWhitespace();
        if (atEnd()) {
          return std::nullopt;
        }
      } else if (!sawWhitespace) {
        return std::nullopt;
      }
      selector.combinators.push_back(combinator);
    }
    for (Combinator combinator : selector.combinators) {
      if (combinator == Combinator::NextSibling ||
          combinator == Combinator::SubsequentSibling) {
        readsSiblings_ = true;
      }
    }
    selector.specificity = specificityOf(selector);
    return selector;
  }

  bool readsSiblings() const {
    return readsSiblings_;
  }

 private:
  bool atEnd() const {
    return position_ >= last_;
  }

  const Token& current() const {
    return stream_.at(position_);
  }

  bool skipWhitespace() {
    bool skipped = false;
    while (!atEnd() && current().type == TokenType::Whitespace) {
      position_++;
      skipped = true;
    }
    return skipped;
  }

  bool isDelim(std::string_view value) const {
    return !atEnd() && current().type == TokenType::Delim &&
        current().value == value;
  }

  std::optional<CompoundSelector> parseCompound(ComplexSelector& selector) {
    CompoundSelector compound;
    bool any = false;
    // A type or universal selector comes first, if at all
    if (!atEnd() && current().type == TokenType::Ident) {
      compound.tag = lowercase(current().value);
      position_++;
      any = true;
    } else if (isDelim("*")) {
      position_++;
      any = true;
    }
    while (!atEnd()) {
      const Token& token = current();
      if (token.type == TokenType::Hash) {
        if (!token.idHash) {
          return std::nullopt;
        }
        compound.ids.push_back(token.value);
        position_++;
      } else if (token.type == TokenType::Delim && token.value == ".") {
        position_++;
        if (atEnd() || current().type != TokenType::Ident) {
          return std::nullopt;
        }
        compound.classes.push_back(current().value);
        position_++;
      } else if (token.type == TokenType::OpenSquare) {
        size_t close = stream_.blockEnd(position_, last_);
        auto attribute = parseAttribute(position_ + 1, close);
        if (!attribute) {
          return std::nullopt;
        }
        compound.attributes.push_back(std::move(*attribute));
        position_ = close + 1;
      } else if (token.type == TokenType::Colon) {
        position_++;
        if (!atEnd() && current().type == TokenType::Colon) {
          // A pseudo-element generates a box the engine does not
          position_++;
          if (atEnd()) {
            return std::nullopt;
          }
          if (current().type == TokenType::Function) {
            position_ = stream_.blockEnd(position_, last_) + 1;
          } else if (current().type == TokenType::Ident) {
            position_++;
          } else {
            return std::nullopt;
          }
          compound.pseudoElement = true;
          selector.matchable = false;
        } else {
          auto pseudo = parsePseudoClass(compound, selector);
          if (!pseudo) {
            return std::nullopt;
          }
        }
      } else {
        break;
      }
      any = true;
    }
    if (!any) {
      return std::nullopt;
    }
    return compound;
  }

  std::optional<AttributeSelector> parseAttribute(size_t first, size_t last) {
    AttributeSelector attribute;
    size_t i = first;
    auto skip = [&]() {
      while (i < last && stream_.at(i).type == TokenType::Whitespace) {
        i++;
      }
    };
    skip();
    if (i >= last || stream_.at(i).type != TokenType::Ident) {
      return std::nullopt;
    }
    attribute.name = lowercase(stream_.at(i).value);
    i++;
    skip();
    if (i >= last) {
      return attribute;
    }
    const Token& op = stream_.at(i);
    if (op.type != TokenType::Delim) {
      return std::nullopt;
    }
    if (op.value == "=") {
      attribute.op = AttributeSelector::Operator::Equals;
      i++;
    } else {
      if (i + 1 >= last || stream_.at(i + 1).type != TokenType::Delim ||
          stream_.at(i + 1).value != "=") {
        return std::nullopt;
      }
      if (op.value == "~") {
        attribute.op = AttributeSelector::Operator::Includes;
      } else if (op.value == "|") {
        attribute.op = AttributeSelector::Operator::DashMatch;
      } else if (op.value == "^") {
        attribute.op = AttributeSelector::Operator::Prefix;
      } else if (op.value == "$") {
        attribute.op = AttributeSelector::Operator::Suffix;
      } else if (op.value == "*") {
        attribute.op = AttributeSelector::Operator::Substring;
      } else {
        return std::nullopt;
      }
      i += 2;
    }
    skip();
    if (i >= last) {
      return std::nullopt;
    }
    const Token& value = stream_.at(i);
    if (value.type != TokenType::Ident && value.type != TokenType::String) {
      return std::nullopt;
    }
    attribute.value = value.value;
    i++;
    skip();
    if (i < last && stream_.at(i).type == TokenType::Ident) {
      std::string flag = lowercase(stream_.at(i).value);
      if (flag == "i") {
        attribute.caseInsensitive = true;
      } else if (flag != "s") {
        return std::nullopt;
      }
      i++;
      skip();
    }
    if (i != last) {
      return std::nullopt;
    }
    return attribute;
  }

  bool parsePseudoClass(CompoundSelector& compound, ComplexSelector& selector) {
    if (atEnd()) {
      return false;
    }
    const Token& token = current();
    PseudoClassSelector pseudo;
    if (token.type == TokenType::Ident) {
      std::string name = lowercase(token.value);
      position_++;
      if (name == "hover") {
        pseudo.kind = PseudoClass::Hover;
      } else if (name == "active") {
        pseudo.kind = PseudoClass::Active;
      } else if (name == "focus") {
        pseudo.kind = PseudoClass::Focus;
      } else if (name == "focus-visible") {
        pseudo.kind = PseudoClass::FocusVisible;
      } else if (name == "disabled") {
        pseudo.kind = PseudoClass::Disabled;
      } else if (name == "enabled") {
        pseudo.kind = PseudoClass::Enabled;
      } else if (name == "checked") {
        pseudo.kind = PseudoClass::Checked;
      } else if (name == "popover-open") {
        pseudo.kind = PseudoClass::PopoverOpen;
      } else if (name == "root") {
        pseudo.kind = PseudoClass::Root;
      } else if (name == "scope") {
        pseudo.kind = PseudoClass::Scope;
      } else if (name == "first-child") {
        pseudo.kind = PseudoClass::FirstChild;
        readsSiblings_ = true;
      } else if (name == "last-child") {
        pseudo.kind = PseudoClass::LastChild;
        readsSiblings_ = true;
      } else if (name == "only-child") {
        pseudo.kind = PseudoClass::OnlyChild;
        readsSiblings_ = true;
      } else if (name == "link" || name == "any-link") {
        pseudo.kind = PseudoClass::AnyLink;
      } else if (isKnownPseudoClass(name)) {
        // DOM-CSS-LIMITATION(unanswered-pseudo-classes): a pseudo-class the
        // engine knows and cannot answer never matches
        pseudo.kind = PseudoClass::Unsupported;
        selector.matchable = false;
      } else {
        // An unknown pseudo-class is invalid (selectors-4 §3.2), and with it
        // the selector; `:is()` and `:where()` forgive it as an argument
        return false;
      }
      compound.pseudoClasses.push_back(std::move(pseudo));
      return true;
    }
    if (token.type != TokenType::Function) {
      return false;
    }
    std::string name = lowercase(token.value);
    size_t close = stream_.blockEnd(position_, last_);
    size_t first = position_ + 1;
    position_ = close + 1;
    if (name == "is" || name == "where" || name == "not") {
      SelectorParser inner(stream_, first, close);
      // :is() and :where() take a forgiving list; :not() does not
      auto list = inner.parseList(name != "not");
      if (!list) {
        return false;
      }
      readsSiblings_ = readsSiblings_ || inner.readsSiblings();
      pseudo.kind = name == "is" ? PseudoClass::Is
          : name == "where"      ? PseudoClass::Where
                                 : PseudoClass::Not;
      pseudo.arguments = std::make_shared<const SelectorList>(std::move(*list));
      compound.pseudoClasses.push_back(std::move(pseudo));
      return true;
    }
    if (name == "nth-child" || name == "nth-last-child") {
      std::string argument = stream_.text(first, close);
      std::string anb = lowercase(argument);
      size_t of = anb.find(" of ");
      if (of != std::string::npos) {
        // Class names are case-sensitive, so the selector is read as written
        std::string ofSource = argument.substr(of + 4);
        auto tokens = tokenize(ofSource);
        TokenStream ofStream(ofSource, tokens);
        SelectorParser inner(ofStream, 0, tokens.size());
        auto list = inner.parseList(false);
        if (!list) {
          return false;
        }
        pseudo.arguments =
            std::make_shared<const SelectorList>(std::move(*list));
        anb = anb.substr(0, of);
      }
      if (!parseAnPlusB(anb, pseudo.a, pseudo.b)) {
        return false;
      }
      pseudo.kind = name == "nth-child" ? PseudoClass::NthChild
                                        : PseudoClass::NthLastChild;
      readsSiblings_ = true;
      compound.pseudoClasses.push_back(std::move(pseudo));
      return true;
    }
    // `:has()`, `:lang()`, `:dir()`, … are valid and unanswerable here
    // (DOM-CSS-LIMITATION(unanswered-pseudo-classes)); an unknown function
    // is invalid
    if (!isKnownPseudoClass(name)) {
      return false;
    }
    pseudo.kind = PseudoClass::Unsupported;
    selector.matchable = false;
    compound.pseudoClasses.push_back(std::move(pseudo));
    return true;
  }

  // The pseudo-classes selectors-4 and HTML define beyond the ones the
  // engine answers, and WebKit's prefixed ones: valid in a selector
  static bool isKnownPseudoClass(const std::string& name) {
    static const std::unordered_set<std::string_view> known = {
        "focus-within",
        "has",
        "lang",
        "dir",
        "empty",
        "target",
        "target-within",
        "visited",
        "local-link",
        "placeholder-shown",
        "default",
        "indeterminate",
        "valid",
        "invalid",
        "in-range",
        "out-of-range",
        "required",
        "optional",
        "read-only",
        "read-write",
        "autofill",
        "user-valid",
        "user-invalid",
        "first-of-type",
        "last-of-type",
        "only-of-type",
        "nth-of-type",
        "nth-last-of-type",
        "modal",
        "fullscreen",
        "picture-in-picture",
        "open",
        "closed",
        "playing",
        "paused",
        "seeking",
        "buffering",
        "stalled",
        "muted",
        "volume-locked",
        "current",
        "past",
        "future",
        "defined",
        "host",
        "host-context",
        "state",
        "blank",
        "popover-open",
        "user-select-none",
    };
    return known.count(name) != 0 || name.rfind("-webkit-", 0) == 0;
  }

  // css-syntax-3 §6
  static bool parseAnPlusB(std::string text, int& a, int& b) {
    text.erase(
        std::remove_if(
            text.begin(),
            text.end(),
            [](char c) { return std::isspace(static_cast<unsigned char>(c)); }),
        text.end());
    if (text == "odd") {
      a = 2;
      b = 1;
      return true;
    }
    if (text == "even") {
      a = 2;
      b = 0;
      return true;
    }
    size_t n = text.find('n');
    if (n == std::string::npos) {
      char* end = nullptr;
      long value = std::strtol(text.c_str(), &end, 10);
      if (end == text.c_str() || *end != '\0') {
        return false;
      }
      a = 0;
      b = static_cast<int>(value);
      return true;
    }
    std::string coefficient = text.substr(0, n);
    if (coefficient.empty() || coefficient == "+") {
      a = 1;
    } else if (coefficient == "-") {
      a = -1;
    } else {
      char* end = nullptr;
      long value = std::strtol(coefficient.c_str(), &end, 10);
      if (end == coefficient.c_str() || *end != '\0') {
        return false;
      }
      a = static_cast<int>(value);
    }
    std::string offset = text.substr(n + 1);
    if (offset.empty()) {
      b = 0;
      return true;
    }
    char* end = nullptr;
    long value = std::strtol(offset.c_str(), &end, 10);
    if (end == offset.c_str() || *end != '\0' ||
        (offset[0] != '+' && offset[0] != '-')) {
      return false;
    }
    b = static_cast<int>(value);
    return true;
  }

  const TokenStream& stream_;
  size_t position_;
  size_t last_;
  bool readsSiblings_{false};
};

uint32_t maxSpecificity(const SelectorList& list) {
  uint32_t highest = 0;
  for (const auto& selector : list) {
    highest = std::max(highest, selector.specificity);
  }
  return highest;
}

} // namespace

// selectors-4 §17
uint32_t specificityOf(const ComplexSelector& selector) {
  uint32_t specificity = 0;
  for (const auto& compound : selector.compounds) {
    specificity += kSpecificityA * compound.ids.size();
    specificity +=
        kSpecificityB * (compound.classes.size() + compound.attributes.size());
    if (!compound.tag.empty()) {
      specificity += kSpecificityC;
    }
    if (compound.pseudoElement) {
      specificity += kSpecificityC;
    }
    for (const auto& pseudo : compound.pseudoClasses) {
      switch (pseudo.kind) {
        case PseudoClass::Where:
          break;
        case PseudoClass::Is:
        case PseudoClass::Not:
          specificity += maxSpecificity(*pseudo.arguments);
          break;
        case PseudoClass::NthChild:
        case PseudoClass::NthLastChild:
          specificity += kSpecificityB;
          if (pseudo.arguments != nullptr) {
            specificity += maxSpecificity(*pseudo.arguments);
          }
          break;
        default:
          specificity += kSpecificityB;
          break;
      }
    }
  }
  return specificity;
}

namespace {

struct ParseContext {
  std::vector<std::shared_ptr<const MediaQueryList>> media;
  std::vector<ContainerQuery> containers;
  // The roots of the enclosing @scope blocks, innermost last, and the
  // innermost one's roots and limits
  std::vector<SelectorList> scopeRoots;
  std::shared_ptr<const ScopeInfo> scope;
  std::string layer;
  bool layered{false};
};

/*
 * A selector inside `@scope (<root>)` (css-cascade-6 §2.5), written out
 * against the root: `:scope` is the root itself, any other selector a
 * descendant of it. Specificity is the selector's own, `:scope` counting as
 * the pseudo-class it is and the implied root not at all.
 */
SelectorList scopeSelectors(
    const SelectorList& selectors,
    const SelectorList& roots,
    const std::shared_ptr<const ScopeInfo>& scope = nullptr) {
  SelectorList scoped;
  for (const auto& selector : selectors) {
    for (const auto& root : roots) {
      ComplexSelector result = root;
      result.matchable = root.matchable && selector.matchable;
      const CompoundSelector& head = selector.compounds.front();
      bool startsAtScope = std::any_of(
          head.pseudoClasses.begin(),
          head.pseudoClasses.end(),
          [](const PseudoClassSelector& pseudo) {
            return pseudo.kind == PseudoClass::Scope;
          });
      size_t rest = 0;
      if (startsAtScope) {
        CompoundSelector& subject = result.compounds.back();
        if (!head.tag.empty()) {
          subject.tag = head.tag;
        }
        subject.ids.insert(subject.ids.end(), head.ids.begin(), head.ids.end());
        subject.classes.insert(
            subject.classes.end(), head.classes.begin(), head.classes.end());
        subject.attributes.insert(
            subject.attributes.end(),
            head.attributes.begin(),
            head.attributes.end());
        for (const auto& pseudo : head.pseudoClasses) {
          if (pseudo.kind != PseudoClass::Scope) {
            subject.pseudoClasses.push_back(pseudo);
          }
        }
        subject.pseudoElement = subject.pseudoElement || head.pseudoElement;
        rest = 1;
      } else {
        result.combinators.push_back(Combinator::Descendant);
      }
      for (size_t i = rest; i < selector.compounds.size(); i++) {
        if (i > 0) {
          result.combinators.push_back(selector.combinators[i - 1]);
        }
        result.compounds.push_back(selector.compounds[i]);
      }
      result.specificity = selector.specificity;
      result.scope = scope;
      scoped.push_back(std::move(result));
    }
  }
  return scoped;
}

class StyleSheetParser {
 public:
  explicit StyleSheetParser(std::string_view source)
      : source_(source), tokens_(tokenize(source)), stream_(source_, tokens_) {}

  std::shared_ptr<const StyleSheet> run() {
    consumeRules(0, tokens_.size(), ParseContext{});
    return std::make_shared<const StyleSheet>(std::move(sheet_));
  }

 private:
  // §5.4.1
  void consumeRules(size_t first, size_t last, const ParseContext& context) {
    size_t i = first;
    while (i < last) {
      TokenType type = tokens_[i].type;
      if (type == TokenType::Whitespace || type == TokenType::CDO ||
          type == TokenType::CDC || type == TokenType::Semicolon) {
        i++;
        continue;
      }
      if (type == TokenType::AtKeyword) {
        i = consumeAtRule(i, last, context);
        continue;
      }
      i = consumeQualifiedRule(i, last, context);
    }
  }

  // Returns the index after the rule
  size_t
  consumeQualifiedRule(size_t first, size_t last, const ParseContext& context) {
    size_t open = stream_.find(TokenType::OpenCurly, first, last);
    if (open >= last) {
      return last;
    }
    size_t close = stream_.blockEnd(open, last);
    SelectorParser parser(stream_, first, open);
    auto selectors = parser.parseList(false);
    if (selectors && !selectors->empty()) {
      if (!context.scopeRoots.empty()) {
        selectors = scopeSelectors(
            *selectors, context.scopeRoots.back(), context.scope);
      }
      sheet_.readsSiblings = sheet_.readsSiblings || parser.readsSiblings();
      auto declarations = consumeDeclarations(open + 1, close);
      if (!declarations.empty()) {
        StyleRule rule;
        rule.selectors = std::move(*selectors);
        rule.declarations = std::move(declarations);
        rule.media = context.media;
        rule.containers = context.containers;
        rule.layer = context.layer;
        rule.layered = context.layered;
        rule.order = order_++;
        sheet_.rules.push_back(std::move(rule));
      }
    }
    return close + 1;
  }

  // §5.4.5. A nested rule (CSS Nesting) is skipped whole.
  std::vector<Declaration> consumeDeclarations(size_t first, size_t last) {
    std::vector<Declaration> declarations;
    size_t i = first;
    while (i < last) {
      size_t end = stream_.find(TokenType::Semicolon, i, last);
      size_t nested = stream_.find(TokenType::OpenCurly, i, end);
      if (nested < end) {
        i = stream_.blockEnd(nested, last) + 1;
        continue;
      }
      auto declaration = parseDeclaration(i, end);
      if (declaration) {
        declarations.push_back(std::move(*declaration));
      }
      i = end + 1;
    }
    return declarations;
  }

  std::optional<Declaration> parseDeclaration(size_t first, size_t last) {
    while (first < last && tokens_[first].type == TokenType::Whitespace) {
      first++;
    }
    if (first >= last || tokens_[first].type != TokenType::Ident) {
      return std::nullopt;
    }
    std::string name = tokens_[first].value;
    size_t colon = first + 1;
    while (colon < last && tokens_[colon].type == TokenType::Whitespace) {
      colon++;
    }
    if (colon >= last || tokens_[colon].type != TokenType::Colon) {
      return std::nullopt;
    }
    size_t valueEnd = last;
    while (valueEnd > colon + 1 &&
           tokens_[valueEnd - 1].type == TokenType::Whitespace) {
      valueEnd--;
    }
    bool important = false;
    // `!important` (§5.4.6)
    if (valueEnd >= colon + 3 &&
        tokens_[valueEnd - 1].type == TokenType::Ident &&
        equalsIgnoringCase(tokens_[valueEnd - 1].value, "important")) {
      size_t bang = valueEnd - 2;
      while (bang > colon && tokens_[bang].type == TokenType::Whitespace) {
        bang--;
      }
      if (tokens_[bang].type == TokenType::Delim &&
          tokens_[bang].value == "!") {
        important = true;
        valueEnd = bang;
      }
    }
    std::string value = stream_.text(colon + 1, valueEnd);
    bool custom = name.size() > 2 && name[0] == '-' && name[1] == '-';
    if (value.empty() && !custom) {
      return std::nullopt;
    }
    Declaration declaration;
    declaration.property =
        custom ? name : camelCasePropertyName(lowercase(name));
    declaration.value = std::move(value);
    declaration.important = important;
    return declaration;
  }

  size_t consumeAtRule(size_t first, size_t last, const ParseContext& context) {
    std::string name = lowercase(tokens_[first].value);
    size_t semicolon = stream_.find(TokenType::Semicolon, first + 1, last);
    size_t open = stream_.find(TokenType::OpenCurly, first + 1, last);
    if (semicolon < open) {
      // Statement form: `@layer a, b;`, `@import …;`, `@charset …;`
      if (name == "layer") {
        std::string names = stream_.text(first + 1, semicolon);
        size_t start = 0;
        while (start <= names.size()) {
          size_t comma = names.find(',', start);
          std::string part = names.substr(
              start,
              comma == std::string::npos ? std::string::npos : comma - start);
          part.erase(0, part.find_first_not_of(' '));
          part.erase(part.find_last_not_of(' ') + 1);
          if (!part.empty()) {
            registerLayer(qualifyLayer(context, part));
          }
          if (comma == std::string::npos) {
            break;
          }
          start = comma + 1;
        }
      }
      return semicolon + 1;
    }
    if (open >= last) {
      return last;
    }
    size_t close = stream_.blockEnd(open, last);
    std::string prelude = stream_.text(first + 1, open);
    if (name == "media") {
      ParseContext inner = context;
      inner.media.push_back(MediaQueryList::parse(prelude));
      consumeRules(open + 1, close, inner);
    } else if (name == "container") {
      ParseContext inner = context;
      ContainerQuery query;
      size_t paren = prelude.find('(');
      std::string head =
          paren == std::string::npos ? prelude : prelude.substr(0, paren);
      head.erase(head.find_last_not_of(' ') + 1);
      if (!head.empty() && head != "not") {
        query.name = head;
      }
      query.condition = MediaQueryList::parseCondition(
          paren == std::string::npos ? std::string_view{}
                                     : std::string_view(prelude).substr(paren));
      inner.containers.push_back(std::move(query));
      consumeRules(open + 1, close, inner);
    } else if (name == "supports") {
      // A block applies when its condition holds (css-conditional-3 §6): a
      // declaration the engine can style with, a selector it can match
      if (evaluateSupports(first + 1, open)) {
        consumeRules(open + 1, close, context);
      }
    } else if (name == "layer") {
      std::string layerName = prelude.empty()
          ? "<anonymous-" + std::to_string(anonymousLayers_++) + ">"
          : prelude;
      ParseContext inner = context;
      inner.layer = qualifyLayer(context, layerName);
      inner.layered = true;
      registerLayer(inner.layer);
      consumeRules(open + 1, close, inner);
    } else if (name == "scope") {
      // `@scope (<root>) to (<limit>)`: the rules apply under a root and stop
      // at a limit under it (css-cascade-6 §2.5)
      ParseContext inner = context;
      SelectorList roots;
      SelectorList limits;
      size_t rootOpen = stream_.find(TokenType::OpenParen, first + 1, open);
      size_t rootClose = rootOpen;
      if (rootOpen < open) {
        rootClose = stream_.blockEnd(rootOpen, open);
        SelectorParser parser(stream_, rootOpen + 1, rootClose);
        auto parsed = parser.parseList(false);
        if (parsed) {
          roots = std::move(*parsed);
          if (!context.scopeRoots.empty()) {
            roots = scopeSelectors(roots, context.scopeRoots.back());
          }
        }
        size_t to = rootClose + 1;
        while (to < open && tokens_[to].type == TokenType::Whitespace) {
          to++;
        }
        if (to < open && tokens_[to].type == TokenType::Ident &&
            lowercase(tokens_[to].value) == "to") {
          size_t limitOpen = stream_.find(TokenType::OpenParen, to + 1, open);
          if (limitOpen < open) {
            size_t limitClose = stream_.blockEnd(limitOpen, open);
            SelectorParser limitParser(stream_, limitOpen + 1, limitClose);
            auto parsedLimits = limitParser.parseList(false);
            if (parsedLimits) {
              limits = std::move(*parsedLimits);
            }
          }
        }
      }
      if (roots.empty()) {
        // A scope with no root is rooted at the element whose sheet it is;
        // a page's sheets have none, so it is the document
        ComplexSelector root;
        CompoundSelector compound;
        PseudoClassSelector pseudo;
        pseudo.kind = PseudoClass::Root;
        compound.pseudoClasses.push_back(pseudo);
        root.compounds.push_back(std::move(compound));
        roots.push_back(std::move(root));
      }
      auto scope = std::make_shared<ScopeInfo>();
      scope->roots = roots;
      scope->limits = std::move(limits);
      inner.scope = std::move(scope);
      inner.scopeRoots.push_back(std::move(roots));
      consumeRules(open + 1, close, inner);
    } else if (name == "keyframes" || name == "-webkit-keyframes") {
      consumeKeyframes(prelude, open + 1, close);
    }
    // Every other at-rule (@font-face, @property, @page, @position-try,
    // @starting-style, …) is skipped whole
    return close + 1;
  }

  // -- @supports (css-conditional-3 §6) --

  // A condition over tokens `[first, last)`: `not`, `and`, `or` and the
  // parenthesized terms
  bool evaluateSupports(size_t first, size_t last) {
    size_t i = skipSpace(first, last);
    if (i < last && tokens_[i].type == TokenType::Ident &&
        lowercase(tokens_[i].value) == "not") {
      size_t term = skipSpace(i + 1, last);
      return !supportsTerm(term, last, term);
    }
    size_t next = i;
    bool result = supportsTerm(i, last, next);
    while (true) {
      size_t at = skipSpace(next, last);
      if (at >= last || tokens_[at].type != TokenType::Ident) {
        break;
      }
      std::string keyword = lowercase(tokens_[at].value);
      size_t term = skipSpace(at + 1, last);
      if (keyword == "and") {
        bool value = supportsTerm(term, last, next);
        result = result && value;
      } else if (keyword == "or") {
        bool value = supportsTerm(term, last, next);
        result = result || value;
      } else {
        return false;
      }
    }
    return result;
  }

  // One term at `i`: `(<condition>)`, `(<declaration>)`, `selector(…)`, or
  // anything else, which is false; `next` is the token after it
  bool supportsTerm(size_t i, size_t last, size_t& next) {
    next = last;
    if (i >= last) {
      return false;
    }
    const Token& token = tokens_[i];
    if (token.type == TokenType::Function) {
      size_t close = stream_.blockEnd(i, last);
      next = close + 1;
      if (lowercase(token.value) == "selector") {
        SelectorList list = parseSelectorList(stream_.text(i + 1, close));
        return !list.empty() &&
            std::all_of(list.begin(), list.end(), [](const auto& selector) {
              return selector.matchable;
            });
      }
      return false;
    }
    if (token.type != TokenType::OpenParen) {
      return false;
    }
    size_t close = stream_.blockEnd(i, last);
    next = close + 1;
    size_t inner = skipSpace(i + 1, close);
    if (inner < close && tokens_[inner].type == TokenType::Ident) {
      size_t colon = skipSpace(inner + 1, close);
      if (colon < close && tokens_[colon].type == TokenType::Colon) {
        return supportsDeclaration(
            tokens_[inner].value,
            std::string(trimmed(stream_.text(colon + 1, close))));
      }
    }
    return evaluateSupports(i + 1, close);
  }

  // Whether the engine styles with `property: value`: a custom property
  // always, any other when the value comes to a prop
  static bool supportsDeclaration(
      const std::string& property,
      std::string value) {
    std::string name = camelCasePropertyName(property);
    if (name.rfind("--", 0) == 0) {
      return true;
    }
    size_t bang = value.rfind("!important");
    if (bang != std::string::npos) {
      value = std::string(trimmed(value.substr(0, bang)));
    }
    if (value.empty() || isDroppedProperty(name)) {
      return false;
    }
    if (value.find("var(") != std::string::npos) {
      return true;
    }
    std::vector<Longhand> longhands;
    expandDeclaration(name, value, false, longhands);
    folly::dynamic props = folly::dynamic::object();
    ConversionContext context;
    convertLonghands(longhands, context, props);
    return !props.empty();
  }

  size_t skipSpace(size_t i, size_t last) const {
    while (i < last && tokens_[i].type == TokenType::Whitespace) {
      i++;
    }
    return i;
  }

  void consumeKeyframes(const std::string& name, size_t first, size_t last) {
    if (name.empty()) {
      return;
    }
    KeyframesRule keyframes;
    keyframes.name = name;
    size_t i = first;
    while (i < last) {
      while (i < last && tokens_[i].type == TokenType::Whitespace) {
        i++;
      }
      if (i >= last) {
        break;
      }
      size_t open = stream_.find(TokenType::OpenCurly, i, last);
      if (open >= last) {
        break;
      }
      size_t close = stream_.blockEnd(open, last);
      auto declarations = consumeDeclarations(open + 1, close);
      size_t start = i;
      while (start < open) {
        size_t comma = stream_.find(TokenType::Comma, start, open);
        std::string selector = lowercase(stream_.text(start, comma));
        std::optional<double> offset;
        if (selector == "from") {
          offset = 0;
        } else if (selector == "to") {
          offset = 1;
        } else if (!selector.empty() && selector.back() == '%') {
          char* end = nullptr;
          double percent = std::strtod(selector.c_str(), &end);
          if (end != selector.c_str()) {
            offset = percent / 100;
          }
        }
        if (offset) {
          keyframes.stops.emplace_back(*offset, declarations);
        }
        start = comma + 1;
      }
      i = close + 1;
    }
    std::stable_sort(
        keyframes.stops.begin(),
        keyframes.stops.end(),
        [](const auto& a, const auto& b) { return a.first < b.first; });
    sheet_.keyframes.push_back(std::move(keyframes));
  }

  static std::string qualifyLayer(
      const ParseContext& context,
      const std::string& name) {
    return context.layered ? context.layer + "." + name : name;
  }

  void registerLayer(const std::string& name) {
    if (std::find(sheet_.layerOrder.begin(), sheet_.layerOrder.end(), name) ==
        sheet_.layerOrder.end()) {
      sheet_.layerOrder.push_back(name);
    }
  }

  std::string_view source_;
  std::vector<Token> tokens_;
  TokenStream stream_;
  StyleSheet sheet_;
  uint32_t order_{0};
  uint32_t anonymousLayers_{0};
};

} // namespace

std::shared_ptr<const StyleSheet> parseStyleSheet(std::string_view source) {
  return StyleSheetParser(source).run();
}

SelectorList parseSelectorList(std::string_view source) {
  auto tokens = tokenize(source);
  TokenStream stream(source, tokens);
  SelectorParser parser(stream, 0, tokens.size());
  auto list = parser.parseList(false);
  return list ? std::move(*list) : SelectorList{};
}

std::string camelCasePropertyName(std::string_view name) {
  if (name.size() > 2 && name[0] == '-' && name[1] == '-') {
    return std::string(name);
  }
  std::string out;
  out.reserve(name.size());
  bool upper = false;
  for (char c : name) {
    if (c == '-') {
      upper = true;
      continue;
    }
    out.push_back(
        upper ? static_cast<char>(std::toupper(static_cast<unsigned char>(c)))
              : c);
    upper = false;
  }
  return out;
}

} // namespace facebook::react::cssengine
