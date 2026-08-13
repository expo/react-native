// Cross-CPU equivalence fuzz for the SWAR white-space fast path.
// The FAST implementation mirrors InlineContentShadowNode.cpp's collapse
// loop (SWAR block advance + lazy COW machine); the REFERENCE is the naive
// per-byte state machine. They must agree byte-for-byte on any input, on
// any CPU. Built and run for BOTH arm64 and x86_64.
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <random>
#include <string>

static bool isWs(char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f';
}
static bool isBreak(char c) { return c == '\n' || c == '\r'; }

// Naive reference: the original machine, no COW, no SWAR.
static std::string reference(const std::string& src, bool keepNl, bool& pending) {
  std::string out;
  for (char c : src) {
    if (keepNl && isBreak(c)) {
      if (!out.empty() && out.back() == ' ') out.pop_back();
      out.push_back('\n');
      pending = true;
      continue;
    }
    if (isWs(c)) {
      if (!pending) { out.push_back(' '); pending = true; }
    } else { out.push_back(c); pending = false; }
  }
  return out;
}

static inline uint64_t swarEq(uint64_t x, char c) {
  const uint64_t ones = 0x0101010101010101ULL;
  const uint64_t highs = 0x8080808080808080ULL;
  const uint64_t t = x ^ (ones * (uint8_t)c);
  return (t - ones) & ~t & highs;
}

// Mirror of the shipped loop, operating on a mutable copy like the engine.
static std::string fast(std::string source, bool keepNl, bool& pendingCollapse) {
  const size_t size = source.size();
  std::string collapsed;
  size_t matched = 0;
  bool materialized = false;
  size_t index = 0;
  while (index < size) {
    if (!materialized && matched == index && size - index >= 8) {
      uint64_t word;
      std::memcpy(&word, source.data() + index, 8);
      const uint64_t spaces = swarEq(word, ' ');
      const uint64_t newlines = swarEq(word, '\n');
      const uint64_t always = swarEq(word, '\t') | swarEq(word, '\r') | swarEq(word, '\f');
      const uint64_t whitespace = keepNl ? (spaces | newlines) : spaces;
      const uint64_t adjacent = whitespace & (whitespace >> 8);
      const bool benign = always == 0 && (keepNl || newlines == 0) &&
          adjacent == 0 && !(pendingCollapse && isWs(source[index]));
      if (benign) {
        matched += 8; index += 8;
        const char last = source[index - 1];
        pendingCollapse = last == ' ' || (keepNl && last == '\n');
        continue;
      }
    }
    const char character = source[index]; index++;
    if (keepNl && isBreak(character)) {
      const bool emittedEmpty = materialized ? collapsed.empty() : matched == 0;
      if (!emittedEmpty) {
        const char back = materialized ? collapsed.back() : source[matched - 1];
        if (back == ' ') { if (materialized) collapsed.pop_back(); else matched--; }
      }
      if (!materialized) {
        if (matched < size && source[matched] == '\n') matched++;
        else { collapsed.reserve(size); collapsed.assign(source, 0, matched); collapsed.push_back('\n'); materialized = true; }
      } else collapsed.push_back('\n');
      pendingCollapse = true;
      continue;
    }
    if (isWs(character)) {
      if (!pendingCollapse) {
        if (!materialized) {
          if (matched < size && source[matched] == ' ') matched++;
          else { collapsed.reserve(size); collapsed.assign(source, 0, matched); collapsed.push_back(' '); materialized = true; }
        } else collapsed.push_back(' ');
        pendingCollapse = true;
      }
    } else {
      if (!materialized) {
        if (matched < size && source[matched] == character) matched++;
        else { collapsed.reserve(size); collapsed.assign(source, 0, matched); collapsed.push_back(character); materialized = true; }
      } else collapsed.push_back(character);
      pendingCollapse = false;
    }
  }
  if (materialized) return collapsed;
  return source.substr(0, matched);
}

int main() {
  std::mt19937 rng(42);
  const char alphabet[] = " \t\n\r\fab \n c"; // whitespace-heavy
  const char* multi[] = {"\xE2\x80\xA0", "\xE6\xBC\xA2", "\xF0\x9F\x98\x80", "e\xCC\x81"};
  for (int iter = 0; iter < 300000; iter++) {
    std::string s;
    const int len = rng() % 40;
    for (int i = 0; i < len; i++) {
      if (rng() % 7 == 0) s += multi[rng() % 4];
      else s += alphabet[rng() % (sizeof(alphabet) - 1)];
    }
    const bool keepNl = (rng() % 2) != 0;
    const bool pending0 = (rng() % 2) != 0;
    bool pr = pending0, pf = pending0;
    const std::string r = reference(s, keepNl, pr);
    const std::string f = fast(s, keepNl, pf);
    if (r != f || pr != pf) {
      printf("MISMATCH iter=%d keepNl=%d pending0=%d\nin :", iter, keepNl, pending0);
      for (unsigned char c : s) printf(" %02x", c);
      printf("\nref:");
      for (unsigned char c : r) printf(" %02x", c);
      printf("\nfast:");
      for (unsigned char c : f) printf(" %02x", c);
      printf("\n");
      return 1;
    }
  }
  printf("OK 300000 cases\n");
  return 0;
}
