/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

'use strict';

/**
 * Turns the HTML demo screens into a real HTML page, so a browser can render
 * the *same markup* the device does.
 *
 * The point of this project is that `<em>`, `<kbd>`, `<blockquote>` and the
 * rest mean the same thing on a phone as they do in a browser. That claim is
 * only testable if both sides are given the same input, and the honest way to
 * get that is to lift the markup out of the demo rather than to re-type it
 * into a reference page by hand: a hand-written reference drifts from the demo
 * silently, and every drift shows up as a rendering difference that is really
 * a transcription error. Extracting means the browser and the device disagree
 * only where the engines disagree.
 *
 * ## What it can and cannot lift
 *
 * The `<Case>` bodies in these screens are almost pure markup, which is why
 * this is a text transform and not a compiler. What it handles:
 *
 * - `{' '}` — JSX's explicit space, which exists only because JSX eats the
 *   newline that would otherwise be one. In HTML the space is just a space.
 * - `{'é'}`-style escapes and `&mdash;`-style entities, left alone.
 * - `style={NAME}` where NAME is a `const` object in the same file — resolved
 *   to inline CSS, because the demo's own spacing is part of what is being
 *   compared.
 *
 * What it refuses: any body containing a capitalised (component) tag or a
 * `{expression}` it does not recognise. Those cases are *skipped and counted*,
 * never guessed at — a case silently rendered from a half-understood body is
 * worse than a case that says it was not extracted, because the first one
 * still produces a screenshot that looks like evidence.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEMO_DIR = path.join(
  __dirname,
  '..',
  'packages',
  'rn-tester',
  'js',
  'examples',
  'HTMLElements',
);

/*
 * RN style objects use camelCase and unitless numbers; CSS wants neither.
 *
 * `lineHeight` is deliberately NOT here, and that is the whole subtlety: CSS
 * reads a bare `line-height: 24` as a *multiplier* — 24 times the font size —
 * while RN means 24 points. Translating it unitlessly gives the browser a
 * 384px line height, and because the demo prose is short the page still looks
 * plausible while every vertical measurement in it is wrong.
 */
const UNITLESS = new Set(['fontWeight', 'opacity', 'zIndex', 'flex']);

/*
 * Stands in for a space that came from a string literal rather than from JSX
 * whitespace. It has to survive `normaliseJSXWhitespace`, and — just as
 * importantly — it has to be a *boundary* there rather than part of a text
 * chunk: `{' '}` is a separate JSX child, so the text after it is trimmed on
 * its own. Folded into the neighbouring chunk it takes part in line-joining
 * and picks up a second space, which is how `</kbd> to copy` became
 * `</kbd>  to copy`.
 */
const SENTINEL = '\u0000';


/*
 * React Native draws a border whenever a width is set — the style is
 * implicitly solid. CSS's initial `border-style` is NONE, so a translated
 * `border-width; border-color` pair drew nothing and the sections demo's
 * coloured nesting boxes silently vanished from the browser column only.
 * Same rule for outlines.
 */
function impliedStyles(decls) {
  const has = prop => decls.some(d => d.startsWith(prop));
  // Only a border WIDTH earns the implied style. Matching any `border-`
  // prefix also matched `border-radius`, so every rounded box with only a
  // background gained `border-style: solid` — and with it CSS's initial
  // `medium` (3px) width: phantom dark borders on the web column only, on
  // boxes that draw none anywhere else. RN's own rule is width-triggered
  // (a width draws, implicitly solid), so the translation's must be too.
  const hasWidth = prop =>
    decls.some(d => d.startsWith(prop) && d.includes('width'));
  if (hasWidth('border-') && !has('border-style')) {
    decls.push('border-style: solid');
  }
  if (hasWidth('outline-') && !has('outline-style')) {
    decls.push('outline-style: solid');
  }
  return decls;
}

function cssProp(k) {
  return k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
}

/**
 * RN's array-valued font features, as CSS.
 *
 * `fontVariant: ['small-caps']` is an array, and a value parser that only
 * understands strings and numbers drops it silently — leaving the browser with
 * no `font-variant` at all. The device then renders small caps and the browser
 * does not, which looks like the native engine doing something WebKit cannot,
 * and is in fact the harness failing to pass the declaration along. The
 * flattering direction of a false finding is not a reason to trust it.
 *
 * CSS splits these across two properties: `small-caps` belongs to
 * `font-variant`, the figure styles to `font-variant-numeric`.
 */
const NUMERIC_VARIANTS = new Set([
  'oldstyle-nums',
  'lining-nums',
  'tabular-nums',
  'proportional-nums',
]);

function fontVariantCSS(values) {
  const numeric = values.filter(v => NUMERIC_VARIANTS.has(v));
  const plain = values.filter(v => !NUMERIC_VARIANTS.has(v));
  const out = [];
  if (plain.length) out.push(`font-variant: ${plain.join(' ')}`);
  if (numeric.length) out.push(`font-variant-numeric: ${numeric.join(' ')}`);
  return out;
}

function cssValue(k, v) {
  if (typeof v === 'number') {
    return UNITLESS.has(k) ? String(v) : `${v}px`;
  }
  return String(v);
}

/**
 * The style consts a demo declares at module scope. Parsed with a brace
 * matcher rather than a regex: these objects nest, and a regex that stops at
 * the first `}` silently truncates them into something that still looks like a
 * valid style.
 */
function parseStyleConsts(src) {
  const out = {};
  const re = /^const ([A-Z][A-Z0-9_]*)\s*=\s*\{/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    const body = src.slice(re.lastIndex, i - 1);
    const decls = [];
    // Only literal `key: value` pairs. A value that is an identifier is a
    // themed colour, which has no browser equivalent and is left out rather
    // than invented.
    const pre = /([a-zA-Z]+):\s*(\[[^\]]*\]|'([^']*)'|-?[\d.]+)\s*,/g;
    let p;
    while ((p = pre.exec(body)) !== null) {
      const key = p[1];
      if (p[2].startsWith('[')) {
        const items = [...p[2].matchAll(/'([^']*)'/g)].map(x => x[1]);
        if (key === 'fontVariant') decls.push(...fontVariantCSS(items));
        continue;
      }
      const raw = p[3] !== undefined ? p[3] : Number(p[2]);
      decls.push(`${cssProp(key)}: ${cssValue(key, raw)}`);
    }
    if (decls.length) out[m[1]] = impliedStyles(decls).join('; ');
  }
  return out;
}

/** Pull `<Case title=".." note="..">BODY</Case>` blocks, nesting-aware. */
function extractCases(src) {
  const cases = [];
  const open = /<Case\b/g;
  let m;
  while ((m = open.exec(src)) !== null) {
    /*
     * Find the end of the opening tag, respecting braces AND quotes.
     *
     * The quotes are not defensive: every title here names the element it
     * demonstrates, so `title="<em> and <strong> — stress"` is the normal
     * case, not the exotic one. A scan that stops at the first `>` ends the
     * tag inside the title, which leaves a body starting mid-sentence and a
     * title that fails to match — and because the case is then *skipped*
     * rather than reported, the whole failure looks like "that case wasn't
     * pure markup" instead of "the parser cannot read its own input".
     */
    let i = m.index + m[0].length;
    let depth = 0;
    let quote = null;
    let selfClosing = false;
    while (i < src.length) {
      const c = src[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) {
        selfClosing = src[i - 1] === '/';
        break;
      }
      i++;
    }
    const openTag = src.slice(m.index, i + 1);
    const title = /title="([^"]*)"/.exec(openTag);
    const note = /note="([^"]*)"/.exec(openTag);
    let body = '';
    if (!selfClosing) {
      // Match the closing </Case>, allowing nested <Case> (there are none
      // today, but a nesting-blind scan would fail silently if one appeared).
      let j = i + 1;
      let nest = 1;
      while (j < src.length && nest > 0) {
        if (src.startsWith('<Case', j)) nest++;
        else if (src.startsWith('</Case>', j)) {
          nest--;
          if (nest === 0) break;
        }
        j++;
      }
      body = src.slice(i + 1, j);
    }
    cases.push({
      title: title ? title[1] : '',
      note: note ? note[1] : null,
      body,
      at: m.index,
    });
  }
  return cases;
}

/**
 * Which example each case belongs to.
 *
 * The device is photographed one *example* at a time — that is the unit a deep
 * link addresses — so a browser page that is one long list of cases cannot be
 * placed beside it. Recovering the grouping means walking two hops: a case sits
 * inside a component function, and the examples array names which component
 * each example renders.
 *
 * Both spellings of that array are in use: an explicit `{name, render}` list,
 * and a `SECTIONS` table mapped over. Neither is more correct, so both are read
 * rather than one being normalised away.
 */
function parseExampleGroups(src) {
  // component name -> example name
  const byComponent = {};

  const sections = /^const SECTIONS[^=]*=\s*\[(.*?)\n\];/ms.exec(src);
  if (sections) {
    const row =
      /\[\s*'([a-zA-Z0-9_-]+)'\s*,\s*'[^']*'\s*,\s*([A-Z][A-Za-z0-9_]*)/g;
    let r;
    while ((r = row.exec(sections[1])) !== null) byComponent[r[2]] = r[1];
  }

  const entry =
    /name: '([a-zA-Z0-9_-]+)',[\s\S]{0,400}?<([A-Z][A-Za-z0-9_]*)\s*\/>/g;
  let e;
  while ((e = entry.exec(src)) !== null) {
    if (byComponent[e[2]] == null) byComponent[e[2]] = e[1];
  }

  // Where each component function starts, so a case can be attributed by offset.
  const fns = [];
  const fnRe = /^function ([A-Z][A-Za-z0-9_]*)\s*\(/gm;
  let f;
  while ((f = fnRe.exec(src)) !== null) {
    fns.push({name: f[1], at: f.index});
  }
  fns.sort((a, b) => a.at - b.at);

  return offset => {
    let owner = null;
    for (const fn of fns) {
      if (fn.at < offset) owner = fn.name;
      else break;
    }
    return owner == null ? null : (byComponent[owner] ?? null);
  };
}

/**
 * The element each screen's `Case` component wraps its children in.
 *
 * This is not decoration. `HTMLTextLevel` renders every body inside
 * `<div style={PROSE}>`, which sets the 16pt/24pt type the cases are read at;
 * drop it and the browser falls back to its own default, so the two sides are
 * set in different type and *every* line wraps somewhere else. That reads as a
 * font-metrics disagreement between WebKit and CoreText — a plausible and
 * completely wrong conclusion — when the real difference is that one side was
 * handed the demo's styling and the other was not.
 *
 * Each screen wraps differently (`PROSE` here, `FRAME` there, nothing at all
 * in the forms screen), so it is read per file rather than assumed.
 */
function parseCaseWrapper(src, styles) {
  const fn = /^function Case\([\s\S]*?\n}/m.exec(src);
  if (!fn) return null;
  const m =
    /<(div|View|Text)\s+style=\{([A-Z][A-Z0-9_]*)\}>\{children\}<\/\1>/.exec(
      fn[0],
    );
  if (!m) return null;
  const css = styles[m[2]];
  if (!css) return null;
  return {tag: m[1] === 'View' ? 'div' : m[1] === 'Text' ? 'span' : 'div', css};
}

/** Module-scope `const NAME = 'string'` values, for `src={LOGO}` and friends. */
function parseStringConsts(src) {
  const out = {};
  const re = /^const ([A-Z][A-Z0-9_]*)\s*=\s*'([^']*)';/gm;
  let m;
  while ((m = re.exec(src)) !== null) out[m[1]] = m[2];
  return out;
}

/*
 * Preserved newlines from template literals, restored after the whitespace
 * rule (which would otherwise collapse them — fatal inside `<pre>`).
 */
const NEWLINE_SENTINEL = '\u0011';
/*
 * Braces that are CONTENT — a code sample's `{`/`}` inside a string or
 * template literal — encoded so the "anything left in braces is logic"
 * refusal below cannot mistake prose for programs.
 */
const OPEN_BRACE_SENTINEL = '\u0012';
const CLOSE_BRACE_SENTINEL = '\u0013';

/** Convert a JSX body to HTML, or return null if it is not pure markup. */
function bodyToHTML(body, styles, strings) {
  let s = body;

  /*
   * JSX's explicit space, and other string literals used to smuggle text past
   * JSX's whitespace rule.
   *
   * These become a sentinel rather than a space, because that rule is applied
   * further down and would eat them: `{' '}` exists *precisely* where the
   * newline after it would otherwise be stripped, so a literal space there is
   * the one space guaranteed to be deleted. Restoring the sentinel afterwards
   * keeps the character JSX kept — writing `with{' '}<strong>` and getting
   * `with<strong>` back is the failure this avoids.
   */

  s = s.replace(/\{'([^'{}]*)'\}/g, (full, text) =>
    /*
     * Escaped, because a string literal is *text* — and the text these demos
     * put in string literals is very often a tag name. `a nested {'<kbd>'} is
     * how the spec writes a chord` renders the characters `<kbd>` on the
     * device; passed through unescaped it becomes a real, empty `<kbd>`
     * element in the browser and the words simply vanish from the page. The
     * reader then sees a sentence that is missing a word on one side only,
     * which looks like the native engine dropping content.
     */
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .split('{')
      .join(OPEN_BRACE_SENTINEL)
      .split('}')
      .join(CLOSE_BRACE_SENTINEL)
      .split(' ')
      .join(SENTINEL),
  );

  /*
   * A template literal with nothing interpolated is just text. `<pre>` is the
   * one element whose whole point is that its whitespace survives, so the demo
   * has to write it as a literal to stop JSX collapsing it — which means
   * refusing template literals would skip exactly the case that matters most.
   * Only the no-substitution form is accepted; `${...}` is real logic.
   */
  s = s.replace(/\{`((?:\\.|[^`\\])*)`\}/g, (full, text) => {
    // An ESCAPED interpolation (`\${name}`) is literal text the demo is
    // showing — a code sample, most often — so it unescapes; a real `${` is
    // logic and refuses as before.
    // A REAL interpolation is an unescaped `${` in the source; `\${` is the
    // demo showing the two characters. Test before unescaping — testing after
    // refused exactly the code samples the escape was protecting.
    if (/(?<!\\)\$\{/.test(text)) {
      return full;
    }
    const unescaped = text.replace(/\\`/g, '`').replace(/\\\$/g, '$');
    return unescaped
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .split('{')
      .join(OPEN_BRACE_SENTINEL)
      .split('}')
      .join(CLOSE_BRACE_SENTINEL)
      .split(' ')
      .join(SENTINEL)
      .split('\n')
      .join(NEWLINE_SENTINEL);
  });

  // `src={LOGO}` and other module-scope string constants.
  if (strings) {
    s = s.replace(/[=]\{([A-Z][A-Z0-9_]*)\}/g, (full, name) =>
      strings[name] != null ? `="${strings[name]}"` : full,
    );
  }

  /*
   * `<View>` is RN's generic box, and the demos use it where HTML would use a
   * `<div>` — the `<figure>` case stands a plain coloured box in for an image.
   * Rewriting it is not a liberty: the two are the same box, and the case is
   * about `<figure>`/`<figcaption>`, not about what sits inside them.
   */
  /*
   * A `<View>` is not a plain block: React Native's generic box is a FLEX
   * CONTAINER, `flex-direction: column`, by default. Dropping that in the
   * translation made the browser column silently ignore every `gap`,
   * `alignItems` and `flexDirection` in the demos — a row of images rendered
   * as inline flow with baseline alignment and no gaps, and read as the
   * devices disagreeing with the web when it was this extractor disagreeing
   * with itself. The marker survives until after the style conversions below,
   * where the default is merged in FRONT of the authored declarations so an
   * authored `flexDirection` (or this fork's `display: 'block'`) still wins.
   */
  s = s.replace(/<View\b/g, '<div data-rn-view').replace(/<\/View>/g, '</div>');
  /*
   * `<Text>` maps to `<span>`. As a child of a translated View it is a flex
   * item — blockified, exactly as the paragraph-like box RN gives it — and
   * nested inside other text it stays inline, which is also RN's behaviour.
   */
  s = s.replace(/<Text\b/g, '<span').replace(/<\/Text>/g, '</span>');

  /*
   * Expand self-closing tags that HTML does not allow to self-close.
   *
   * JSX lets any element write `<div … />`; HTML does not. An HTML parser reads
   * `<div/>` as an OPENING tag and makes everything after it a child, so a
   * demo like
   *
   *     <figure><View style={{height: 60, background: blue}} /><figcaption>…
   *
   * came out with the caption INSIDE the blue box in the browser column and
   * beside it on the devices — which reads as a product difference and is
   * nothing of the kind. The devices were right; the browser was rendering
   * markup this extractor invented.
   *
   * Only the void elements may keep the slash, and they are the whole list from
   * the HTML spec rather than the ones the demos happen to use today.
   */
  const VOID = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
  ]);
  s = s.replace(
    /<([a-zA-Z][a-zA-Z0-9-]*)((?:[^<>"']|"[^"]*"|'[^']*')*?)\/>/g,
    (full, tag, attrs) =>
      VOID.has(tag.toLowerCase()) ? full : `<${tag}${attrs}></${tag}>`,
  );

  // style={NAME} -> inline CSS. Done before the bail-out check so a styled
  // element does not read as an unsupported expression.
  s = s.replace(/style=\{([A-Z][A-Z0-9_]*)\}/g, (full, name) =>
    styles[name] ? `style="${styles[name]}"` : '',
  );
  // style={{...}} with literal values.
  s = s.replace(/style=\{\{([^{}]*)\}\}/g, (full, inner) => {
    const decls = [];
    const re = /([a-zA-Z]+):\s*(\[[^\]]*\]|'([^']*)'|-?[\d.]+)/g;
    let p;
    while ((p = re.exec(inner)) !== null) {
      const key = p[1];
      if (p[2].startsWith('[')) {
        const items = [...p[2].matchAll(/'([^']*)'/g)].map(x => x[1]);
        if (key === 'fontVariant') decls.push(...fontVariantCSS(items));
        continue;
      }
      const raw = p[3] !== undefined ? p[3] : Number(p[2]);
      decls.push(`${cssProp(key)}: ${cssValue(key, raw)}`);
    }
    return decls.length ? `style="${impliedStyles(decls).join('; ')}"` : '';
  });

  // The RN-View default, merged ahead of the authored declarations (see the
  // marker above). Later inline declarations win in CSS, so an authored
  // `flex-direction` or `display` overrides these two.
  s = s.replace(
    /<div data-rn-view([^>]*?) style="([^"]*)"/g,
    (full, attrs, css) =>
      `<div${attrs} style="display: flex; flex-direction: column; ${css}"`,
  );
  s = s.replace(
    /<div data-rn-view/g,
    '<div style="display: flex; flex-direction: column"',
  );

  /*
   * Event handlers do not draw. `onClick={...}` and friends are stripped —
   * with a brace matcher, since arrow bodies nest braces — so a demo whose
   * only "logic" is reporting interactions still gets a browser column. A
   * handler that FED state back into the markup leaves `{expr}` text behind,
   * and the refusal below still catches that case honestly.
   */
  for (
    let at = s.search(/ on[A-Z][a-zA-Z]*=\{/);
    at !== -1;
    at = s.search(/ on[A-Z][a-zA-Z]*=\{/)
  ) {
    const open = s.indexOf('{', at);
    let depth = 1;
    let i = open + 1;
    while (i < s.length && depth > 0) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}') depth--;
      i++;
    }
    s = s.slice(0, at) + s.slice(i);
  }

  // Numeric and boolean JSX attribute literals.
  s = s.replace(/[=]\{(-?\d+(?:\.\d+)?)\}/g, '="$1"');
  s = s.replace(/[=]\{true\}/g, '');
  s = s.replace(/\s[a-zA-Z]+=\{false\}/g, '');

  // Fragments disappear on the web too.
  s = s.replace(/<\/?React\.Fragment>/g, '').replace(/<\/?>/g, '');

  // Anything left in braces is real logic. Refuse rather than guess.
  if (/\{[^}]*\}/.test(s)) {
    if (process.env.EXTRACT_DEBUG)
      console.error('REFUSE-brace:', /\{[^}]*\}/.exec(s)[0].slice(0, 80));
    return null;
  }
  // A capitalised tag is a component, not an element.
  if (/<\/?[A-Z]/.test(s)) {
    if (process.env.EXTRACT_DEBUG)
      console.error('REFUSE-cap:', /<\/?[A-Z][^>]{0,60}/.exec(s)[0]);
    return null;
  }

  // Restore the literal spaces and newlines JSX kept, now that the rule has
  // run.
  return normaliseJSXWhitespace(s)
    .split(SENTINEL)
    .join(' ')
    .split(NEWLINE_SENTINEL)
    .join('\n')
    .split(OPEN_BRACE_SENTINEL)
    .join('{')
    .split(CLOSE_BRACE_SENTINEL)
    .join('}');
}

/**
 * Apply JSX's whitespace rule to the text between tags.
 *
 * This has to be exact, and the obvious shortcut is wrong in a way that is
 * hard to see and easy to publish. Collapsing every newline-run to one space
 * turns
 *
 *     <strong>
 *       importance <strong>nested</strong>
 *     </strong>
 *     , all flowing
 *
 * into `…nested</strong> </strong> , all flowing` — a space before the comma
 * that the device does not have, because JSX *deletes* a whitespace run that
 * touches a line break at the edge of a text chunk rather than collapsing it.
 * Rendered side by side that reads as the browser spacing punctuation
 * differently from the native engine, which would be a striking finding and an
 * entirely fictional one.
 *
 * Babel's rule, per text chunk: strip trailing whitespace from every line but
 * the last and leading whitespace from every line but the first, drop the
 * first and last lines if they are blank, then join what remains with single
 * spaces. A chunk that is only whitespace-with-a-newline disappears.
 */
function normaliseJSXWhitespace(s) {
  // Split into tags and the text between them; only the text is touched.
  const parts = s.split(new RegExp('(<[^>]*>|' + SENTINEL + ')'));
  const out = parts.map((part, i) => {
    if (i % 2 === 1) {
      // A tag (or the sentinel). Its *text* is not touched, but JSX spreads
      // attributes over several lines and that indentation would otherwise be
      // carried into the generated markup verbatim. HTML collapses it anyway;
      // collapsing it here just keeps the page readable when someone opens it.
      return part.startsWith('<') ? part.replace(/\s+/g, ' ') : part;
    }
    const lines = part.split('\n');
    if (lines.length === 1) return part; // no newline: JSX keeps it verbatim
    const kept = lines
      .map((line, j) => {
        let l = line;
        if (j !== 0) l = l.replace(/^[ \t]+/, '');
        if (j !== lines.length - 1) l = l.replace(/[ \t]+$/, '');
        return l;
      })
      .filter((line, j) => line !== '' || (j !== 0 && j !== lines.length - 1));
    return kept.join(' ');
  });
  return out.join('');
}

function build() {
  const files = fs
    .readdirSync(DEMO_DIR)
    .filter(f => /^HTML.*Example\.js$/.test(f))
    .sort();

  const screens = [];
  let skipped = 0;
  let total = 0;

  for (const file of files) {
    const src = fs.readFileSync(path.join(DEMO_DIR, file), 'utf8');
    const styles = parseStyleConsts(src);
    const strings = parseStringConsts(src);
    const groupOf = parseExampleGroups(src);
    const wrapper = parseCaseWrapper(src, styles);
    const cases = [];
    for (const c of extractCases(src)) {
      total++;
      const html = bodyToHTML(c.body, styles, strings);
      if (html === null || html === '') {
        skipped++;
        continue;
      }
      cases.push({
        title: c.title,
        note: c.note,
        html,
        group: groupOf(c.at),
      });
    }
    if (cases.length) {
      screens.push({
        file,
        name: file.replace(/Example\.js$/, ''),
        cases,
        wrapper,
      });
    }
  }
  return {screens, skipped, total};
}

module.exports = {
  build,
  parseExampleGroups,
  parseCaseWrapper,
  parseStyleConsts,
  parseStringConsts,
  extractCases,
  bodyToHTML,
};

if (require.main === module) {
  const {screens, skipped, total} = build();
  for (const s of screens) {
    console.log(`${s.name.padEnd(20)} ${s.cases.length} cases`);
  }
  console.log(`extracted ${total - skipped}/${total}, skipped ${skipped}`);
}
