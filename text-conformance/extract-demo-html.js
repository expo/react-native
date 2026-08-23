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
 * Turns the HTML demo screens into an HTML page so a browser renders the same
 * markup the device does. Lifting the markup out of the demo, rather than
 * keeping a hand-written reference, means the two sides disagree only where
 * the engines disagree.
 *
 * The `<Case>` bodies are almost pure markup, so this is a text transform:
 * `{' '}` becomes a space, string escapes and entities pass through, and
 * `style={NAME}` resolves to inline CSS from the file's own `const` objects.
 * A body with a capitalised (component) tag or an unrecognised `{expression}`
 * is skipped and counted, never guessed at.
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
 * `lineHeight` is not here: CSS reads a bare `line-height: 24` as a multiplier
 * of the font size, RN as 24 points.
 */
const UNITLESS = new Set(['fontWeight', 'opacity', 'zIndex', 'flex']);

/*
 * Stands in for a space that came from a string literal rather than from JSX
 * whitespace. It must survive `normaliseJSXWhitespace` and act as a chunk
 * boundary there: `{' '}` is a separate JSX child, so the text after it is
 * trimmed on its own.
 */
const SENTINEL = '\u0000';

/*
 * React Native draws a border whenever a width is set (implicitly solid);
 * CSS's initial `border-style` is `none`, so the translation adds the style.
 * Same rule for outlines.
 */
function impliedStyles(decls) {
  const has = prop => decls.some(d => d.startsWith(prop));
  // Only a border width earns the implied style; `border-radius` must not,
  // or CSS's initial `medium` width would draw a border RN does not
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
 * RN's array-valued `fontVariant`, as CSS: `small-caps` belongs to
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
 * The style consts a demo declares at module scope, parsed with a brace
 * matcher because the objects nest.
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
    // Only literal `key: value` pairs; an identifier value is a themed colour
    // with no browser equivalent
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
     * Find the end of the opening tag, respecting braces and quotes: titles
     * name the element they demonstrate, so `title="<em> and <strong>"` is the
     * normal case.
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
      // Match the closing </Case>, allowing nested <Case>
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
 * Which example each case belongs to. The device is photographed one example
 * at a time (the unit a deep link addresses), so the browser page is grouped
 * the same way: a case sits inside a component function, and the examples
 * array (an explicit `{name, render}` list or a `SECTIONS` table) names which
 * component each example renders.
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
 * The element each screen's `Case` component wraps its children in. It sets
 * the type the cases are read at, so without it the two sides wrap every line
 * differently. Each screen wraps differently, so it is read per file.
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
 * rule, which would otherwise collapse them inside `<pre>`
 */
const NEWLINE_SENTINEL = '\u0011';
/*
 * Braces that are content (a code sample's `{`/`}` inside a string or template
 * literal), encoded so the "anything left in braces is logic" refusal below
 * does not see them
 */
const OPEN_BRACE_SENTINEL = '\u0012';
const CLOSE_BRACE_SENTINEL = '\u0013';

/** Convert a JSX body to HTML, or return null if it is not pure markup. */
function bodyToHTML(body, styles, strings) {
  let s = body;

  /*
   * String-literal children become a sentinel rather than a space: the
   * whitespace rule applied further down would delete a literal space exactly
   * where `{' '}` was written to keep one.
   */

  s = s.replace(/\{'([^'{}]*)'\}/g, (full, text) =>
    /*
     * Escaped: a string literal is text, and in these demos it is often a tag
     * name such as `{'<kbd>'}`, which must render as characters
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
   * A template literal with nothing interpolated is text; `<pre>` demos write
   * their content that way to keep JSX from collapsing it. `${...}` is logic
   * and refuses.
   */
  s = s.replace(/\{`((?:\\.|[^`\\])*)`\}/g, (full, text) => {
    // An escaped interpolation (`\${name}`) is literal text the demo shows;
    // an unescaped `${` is logic and refuses. Test before unescaping.
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

  // `src={LOGO}` and other module-scope string constants
  if (strings) {
    s = s.replace(/[=]\{([A-Z][A-Z0-9_]*)\}/g, (full, name) =>
      strings[name] != null ? `="${strings[name]}"` : full,
    );
  }

  /*
   * `<View>` is RN's generic box, used where HTML would use a `<div>`. It is a
   * flex container (`flex-direction: column`) by default, so the marker
   * survives until after the style conversions below, where that default is
   * merged in front of the authored declarations and an authored
   * `flexDirection` or `display` still wins.
   */
  s = s.replace(/<View\b/g, '<div data-rn-view').replace(/<\/View>/g, '</div>');
  /*
   * `<Text>` maps to `<span>`: a flex item (blockified) under a translated
   * View, inline when nested in other text, as in RN
   */
  s = s.replace(/<Text\b/g, '<span').replace(/<\/Text>/g, '</span>');

  /*
   * Expand self-closing tags HTML does not allow to self-close: an HTML parser
   * reads `<div/>` as an opening tag and makes what follows its children. Only
   * the spec's void elements keep the slash.
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

  // style={NAME} -> inline CSS, before the bail-out check so a styled element
  // does not read as an unsupported expression
  s = s.replace(/style=\{([A-Z][A-Z0-9_]*)\}/g, (full, name) =>
    styles[name] ? `style="${styles[name]}"` : '',
  );
  // style={{...}} with literal values
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

  // The RN View default, merged ahead of the authored declarations so a later
  // `flex-direction` or `display` wins
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
   * Event handlers do not draw; `onClick={...}` and friends are stripped with
   * a brace matcher since arrow bodies nest braces. A handler that fed state
   * back into the markup leaves `{expr}` behind for the refusal below.
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

  // Numeric and boolean JSX attribute literals
  s = s.replace(/[=]\{(-?\d+(?:\.\d+)?)\}/g, '="$1"');
  s = s.replace(/[=]\{true\}/g, '');
  s = s.replace(/\s[a-zA-Z]+=\{false\}/g, '');

  // Fragments disappear on the web too
  s = s.replace(/<\/?React\.Fragment>/g, '').replace(/<\/?>/g, '');

  // Anything left in braces is logic; refuse rather than guess
  if (/\{[^}]*\}/.test(s)) {
    if (process.env.EXTRACT_DEBUG)
      console.error('REFUSE-brace:', /\{[^}]*\}/.exec(s)[0].slice(0, 80));
    return null;
  }
  // A capitalised tag is a component, not an element
  if (/<\/?[A-Z]/.test(s)) {
    if (process.env.EXTRACT_DEBUG)
      console.error('REFUSE-cap:', /<\/?[A-Z][^>]{0,60}/.exec(s)[0]);
    return null;
  }

  // Restore the literal spaces and newlines JSX kept, now that the rule has run
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
 * Apply JSX's whitespace rule to the text between tags. Babel's rule, per text
 * chunk: strip trailing whitespace from every line but the last and leading
 * whitespace from every line but the first, drop the first and last lines if
 * blank, then join with single spaces; a chunk that is only whitespace with a
 * newline disappears. Collapsing newline runs to one space instead would leave
 * spaces JSX deletes.
 */
function normaliseJSXWhitespace(s) {
  // Split into tags and the text between them; only the text is touched
  const parts = s.split(new RegExp('(<[^>]*>|' + SENTINEL + ')'));
  const out = parts.map((part, i) => {
    if (i % 2 === 1) {
      // A tag or the sentinel: its text is kept, but the indentation of
      // attributes spread over several lines is collapsed for readability
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
