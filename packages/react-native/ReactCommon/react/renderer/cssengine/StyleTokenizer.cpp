/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "StyleTokenizer.h"

#include <algorithm>
#include <cstdlib>

namespace facebook::react::cssengine {

namespace {

bool isWhitespace(char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f';
}

bool isDigit(char c) {
  return c >= '0' && c <= '9';
}

bool isHexDigit(char c) {
  return isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

// A non-ASCII byte belongs to a non-ASCII code point, which is an ident code
// point (§4.2); UTF-8 needs no decoding to tell
bool isNameStart(char c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' ||
      static_cast<unsigned char>(c) >= 0x80;
}

bool isName(char c) {
  return isNameStart(c) || isDigit(c) || c == '-';
}

uint32_t hexValue(char c) {
  if (c >= '0' && c <= '9') {
    return static_cast<uint32_t>(c - '0');
  }
  if (c >= 'a' && c <= 'f') {
    return static_cast<uint32_t>(c - 'a' + 10);
  }
  return static_cast<uint32_t>(c - 'A' + 10);
}

// The length of the UTF-8 sequence a byte leads
size_t utf8Length(char lead) {
  auto byte = static_cast<unsigned char>(lead);
  if (byte >= 0xF0) {
    return 4;
  }
  if (byte >= 0xE0) {
    return 3;
  }
  if (byte >= 0xC0) {
    return 2;
  }
  return 1;
}

void appendUtf8(std::string& out, uint32_t codePoint) {
  if (codePoint == 0 || codePoint > 0x10FFFF ||
      (codePoint >= 0xD800 && codePoint <= 0xDFFF)) {
    codePoint = 0xFFFD;
  }
  if (codePoint < 0x80) {
    out.push_back(static_cast<char>(codePoint));
  } else if (codePoint < 0x800) {
    out.push_back(static_cast<char>(0xC0 | (codePoint >> 6)));
    out.push_back(static_cast<char>(0x80 | (codePoint & 0x3F)));
  } else if (codePoint < 0x10000) {
    out.push_back(static_cast<char>(0xE0 | (codePoint >> 12)));
    out.push_back(static_cast<char>(0x80 | ((codePoint >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (codePoint & 0x3F)));
  } else {
    out.push_back(static_cast<char>(0xF0 | (codePoint >> 18)));
    out.push_back(static_cast<char>(0x80 | ((codePoint >> 12) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | ((codePoint >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (codePoint & 0x3F)));
  }
}

class Tokenizer {
 public:
  explicit Tokenizer(std::string_view source) : source_(source) {}

  std::vector<Token> run() {
    std::vector<Token> tokens;
    while (true) {
      skipComments();
      if (atEnd()) {
        break;
      }
      size_t begin = position_;
      Token token = consumeToken();
      token.begin = static_cast<uint32_t>(begin);
      token.end = static_cast<uint32_t>(position_);
      tokens.push_back(std::move(token));
    }
    return tokens;
  }

 private:
  bool atEnd() const {
    return position_ >= source_.size();
  }

  char peek(size_t offset = 0) const {
    size_t index = position_ + offset;
    return index < source_.size() ? source_[index] : '\0';
  }

  // §4.3.2: comments separate tokens and produce none
  void skipComments() {
    while (peek() == '/' && peek(1) == '*') {
      size_t close = source_.find("*/", position_ + 2);
      position_ = close == std::string_view::npos ? source_.size() : close + 2;
    }
  }

  // §4.3.8
  static bool validEscape(char first, char second) {
    return first == '\\' && second != '\n' && second != '\r' &&
        second != '\f' && second != '\0';
  }

  bool startsIdentifier(size_t offset = 0) const {
    char first = peek(offset);
    if (first == '-') {
      char second = peek(offset + 1);
      return isNameStart(second) || second == '-' ||
          validEscape(second, peek(offset + 2));
    }
    if (isNameStart(first)) {
      return true;
    }
    return validEscape(first, peek(offset + 1));
  }

  bool startsNumber() const {
    char first = peek();
    if (first == '+' || first == '-') {
      return isDigit(peek(1)) || (peek(1) == '.' && isDigit(peek(2)));
    }
    if (first == '.') {
      return isDigit(peek(1));
    }
    return isDigit(first);
  }

  // §4.3.7, after the backslash: appends the code point the escape stands for
  void consumeEscape(std::string& out) {
    if (atEnd()) {
      appendUtf8(out, 0xFFFD);
      return;
    }
    char c = source_[position_];
    if (isHexDigit(c)) {
      uint32_t value = 0;
      size_t digits = 0;
      while (digits < 6 && !atEnd() && isHexDigit(source_[position_])) {
        value = value * 16 + hexValue(source_[position_]);
        position_++;
        digits++;
      }
      if (!atEnd() && isWhitespace(source_[position_])) {
        position_++;
      }
      appendUtf8(out, value);
      return;
    }
    // Any other code point stands for itself, all of its UTF-8 bytes
    size_t length = utf8Length(c);
    out.append(source_.substr(position_, length));
    position_ = std::min(source_.size(), position_ + length);
  }

  // §4.3.11
  std::string consumeName() {
    std::string name;
    while (!atEnd()) {
      char c = source_[position_];
      if (isName(c)) {
        name.push_back(c);
        position_++;
      } else if (validEscape(c, peek(1))) {
        position_++;
        consumeEscape(name);
      } else {
        break;
      }
    }
    return name;
  }

  // §4.3.12
  double consumeNumber() {
    size_t start = position_;
    if (peek() == '+' || peek() == '-') {
      position_++;
    }
    while (isDigit(peek())) {
      position_++;
    }
    if (peek() == '.' && isDigit(peek(1))) {
      position_ += 2;
      while (isDigit(peek())) {
        position_++;
      }
    }
    if ((peek() == 'e' || peek() == 'E') &&
        (isDigit(peek(1)) ||
         ((peek(1) == '+' || peek(1) == '-') && isDigit(peek(2))))) {
      position_ += 2;
      while (isDigit(peek())) {
        position_++;
      }
    }
    std::string text(source_.substr(start, position_ - start));
    return std::strtod(text.c_str(), nullptr);
  }

  Token consumeNumeric() {
    Token token;
    token.number = consumeNumber();
    if (startsIdentifier()) {
      token.type = TokenType::Dimension;
      token.value = consumeName();
    } else if (peek() == '%') {
      position_++;
      token.type = TokenType::Percentage;
    } else {
      token.type = TokenType::Number;
    }
    return token;
  }

  // §4.3.5
  Token consumeString(char ending) {
    Token token;
    token.type = TokenType::String;
    position_++;
    while (true) {
      if (atEnd()) {
        return token;
      }
      char c = source_[position_];
      if (c == ending) {
        position_++;
        return token;
      }
      if (c == '\n' || c == '\r' || c == '\f') {
        token.type = TokenType::BadString;
        return token;
      }
      if (c == '\\') {
        char next = peek(1);
        if (next == '\0') {
          position_++;
          continue;
        }
        if (next == '\n' || next == '\r' || next == '\f') {
          position_ += 2;
          continue;
        }
        position_++;
        consumeEscape(token.value);
        continue;
      }
      token.value.push_back(c);
      position_++;
    }
  }

  // §4.3.6, after `url(` and any whitespace
  Token consumeUrl() {
    Token token;
    token.type = TokenType::Url;
    while (!atEnd() && isWhitespace(source_[position_])) {
      position_++;
    }
    while (true) {
      if (atEnd()) {
        return token;
      }
      char c = source_[position_];
      if (c == ')') {
        position_++;
        return token;
      }
      if (isWhitespace(c)) {
        while (!atEnd() && isWhitespace(source_[position_])) {
          position_++;
        }
        if (peek() == ')') {
          position_++;
          return token;
        }
        consumeBadUrlRemnants();
        token.type = TokenType::BadUrl;
        return token;
      }
      if (c == '"' || c == '\'' || c == '(') {
        consumeBadUrlRemnants();
        token.type = TokenType::BadUrl;
        return token;
      }
      if (c == '\\') {
        if (validEscape(c, peek(1))) {
          position_++;
          consumeEscape(token.value);
          continue;
        }
        consumeBadUrlRemnants();
        token.type = TokenType::BadUrl;
        return token;
      }
      token.value.push_back(c);
      position_++;
    }
  }

  void consumeBadUrlRemnants() {
    while (!atEnd()) {
      char c = source_[position_];
      if (c == ')') {
        position_++;
        return;
      }
      if (validEscape(c, peek(1))) {
        position_++;
        std::string ignored;
        consumeEscape(ignored);
        continue;
      }
      position_++;
    }
  }

  // §4.3.4
  Token consumeIdentLike() {
    std::string name = consumeName();
    Token token;
    if (peek() == '(') {
      position_++;
      bool isUrl = name.size() == 3 && (name[0] == 'u' || name[0] == 'U') &&
          (name[1] == 'r' || name[1] == 'R') &&
          (name[2] == 'l' || name[2] == 'L');
      if (isUrl) {
        size_t lookahead = position_;
        while (lookahead < source_.size() && isWhitespace(source_[lookahead])) {
          lookahead++;
        }
        char next = lookahead < source_.size() ? source_[lookahead] : '\0';
        if (next != '"' && next != '\'') {
          return consumeUrl();
        }
      }
      token.type = TokenType::Function;
      token.value = std::move(name);
      return token;
    }
    token.type = TokenType::Ident;
    token.value = std::move(name);
    return token;
  }

  Token delim(char c) {
    Token token;
    token.type = TokenType::Delim;
    token.value = std::string(1, c);
    position_++;
    return token;
  }

  Token simple(TokenType type) {
    Token token;
    token.type = type;
    position_++;
    return token;
  }

  // §4.3.1
  Token consumeToken() {
    char c = source_[position_];
    if (isWhitespace(c)) {
      while (!atEnd() && isWhitespace(source_[position_])) {
        position_++;
      }
      Token token;
      token.type = TokenType::Whitespace;
      return token;
    }
    switch (c) {
      case '"':
      case '\'':
        return consumeString(c);
      case '#':
        if (isName(peek(1)) || validEscape(peek(1), peek(2))) {
          position_++;
          Token token;
          token.type = TokenType::Hash;
          token.idHash = startsIdentifier();
          token.value = consumeName();
          return token;
        }
        return delim(c);
      case '(':
        return simple(TokenType::OpenParen);
      case ')':
        return simple(TokenType::CloseParen);
      case '+':
        return startsNumber() ? consumeNumeric() : delim(c);
      case ',':
        return simple(TokenType::Comma);
      case '-':
        if (startsNumber()) {
          return consumeNumeric();
        }
        if (peek(1) == '-' && peek(2) == '>') {
          position_ += 3;
          Token token;
          token.type = TokenType::CDC;
          return token;
        }
        if (startsIdentifier()) {
          return consumeIdentLike();
        }
        return delim(c);
      case '.':
        return startsNumber() ? consumeNumeric() : delim(c);
      case ':':
        return simple(TokenType::Colon);
      case ';':
        return simple(TokenType::Semicolon);
      case '<':
        if (peek(1) == '!' && peek(2) == '-' && peek(3) == '-') {
          position_ += 4;
          Token token;
          token.type = TokenType::CDO;
          return token;
        }
        return delim(c);
      case '@':
        if (startsIdentifier(1)) {
          position_++;
          Token token;
          token.type = TokenType::AtKeyword;
          token.value = consumeName();
          return token;
        }
        return delim(c);
      case '[':
        return simple(TokenType::OpenSquare);
      case ']':
        return simple(TokenType::CloseSquare);
      case '{':
        return simple(TokenType::OpenCurly);
      case '}':
        return simple(TokenType::CloseCurly);
      case '\\':
        if (validEscape(c, peek(1))) {
          return consumeIdentLike();
        }
        return delim(c);
      default:
        break;
    }
    if (isDigit(c)) {
      return consumeNumeric();
    }
    if (isNameStart(c)) {
      return consumeIdentLike();
    }
    return delim(c);
  }

  std::string_view source_;
  size_t position_{0};
};

} // namespace

std::vector<Token> tokenize(std::string_view source) {
  return Tokenizer(source).run();
}

std::string serializeTokens(
    std::string_view source,
    const std::vector<Token>& tokens,
    size_t first,
    size_t last) {
  while (first < last && tokens[first].type == TokenType::Whitespace) {
    first++;
  }
  while (last > first && tokens[last - 1].type == TokenType::Whitespace) {
    last--;
  }
  std::string out;
  for (size_t i = first; i < last; i++) {
    const Token& token = tokens[i];
    if (token.type == TokenType::Whitespace) {
      out.push_back(' ');
      continue;
    }
    // Two tokens with a comment between them and no whitespace stay apart
    if (i > first && tokens[i - 1].end < token.begin &&
        tokens[i - 1].type != TokenType::Whitespace) {
      out.push_back(' ');
    }
    out.append(source.substr(token.begin, token.end - token.begin));
  }
  return out;
}

} // namespace facebook::react::cssengine
