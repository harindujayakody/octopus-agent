// Reads and rewrites custom properties in token stylesheets, by block:
// a top-level `:root { }`, `[data-theme="dark"] { }` or `@theme { }`, or the
// same selector inside an `@media (…)` block. Comments are kept.

const COMMENT = /\/\*[\s\S]*?\*\//g;

/** The index just past the comment or string that starts at `j`, or `j` when none does. */
function skip(css, j) {
  if (css.startsWith("/*", j)) {
    const end = css.indexOf("*/", j + 2);
    return end < 0 ? css.length : end + 2;
  }
  if (css[j] === '"' || css[j] === "'") {
    const end = css.indexOf(css[j], j + 1);
    return end < 0 ? css.length : end + 1;
  }
  return j;
}

/** Every block as { head, media, start, end } where start/end bound its body. */
function blocks(css) {
  const out = [];
  const scan = (from, to, media) => {
    let i = from;
    while (i < to) {
      // The next `{` outside comments and strings opens a block.
      let open = i;
      while (open < to && css[open] !== "{") {
        const k = skip(css, open);
        open = k === open ? open + 1 : k;
      }
      if (open >= to) return;
      // The head is the text since the last `;` (after a statement such as
      // `@import …;`) or the last block before this brace, without comments.
      const head = css.slice(i, open).replace(COMMENT, "").split(";").pop().trim();
      let depth = 1, j = open + 1;
      while (depth > 0 && j < to) {
        const k = skip(css, j);
        if (k !== j) { j = k; continue; }
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        j++;
      }
      if (head.startsWith("@media")) scan(open + 1, j - 1, head);
      else out.push({ head, media, start: open + 1, end: j - 1 });
      i = j;
    }
  };
  scan(0, css.length, null);
  return out;
}

const matches = (b, sel, media) => b.head === sel && (media ? b.media?.includes(media) : b.media === null);

/** Custom properties of every `sel` block (merged in order); `media` picks blocks inside that @media. */
export function declarations(css, sel, media = null) {
  const out = {};
  for (const b of blocks(css).filter((x) => matches(x, sel, media))) {
    const body = css.slice(b.start, b.end).replace(COMMENT, "");
    // The last declaration of a block may leave out its `;`.
    for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)(?:;|$)/g)) out[m[1]] = m[2].trim();
  }
  return out;
}

/** `css` with `token`'s value in the last matching block set to `value`. Throws if the token is not there. */
export function setDeclaration(css, sel, media, token, value) {
  const hits = blocks(css).filter((x) => matches(x, sel, media));
  // Comments are blanked to spaces (same length), so a match maps back to `css` and they are kept.
  const re = new RegExp(`(?<![\\w-])(${token.replace(/[-]/g, "\\-")}\\s*:\\s*)[^;]*?(?=\\s*(?:;|$))`);
  for (const b of hits.reverse()) {
    const bare = css.slice(b.start, b.end).replace(COMMENT, (c) => " ".repeat(c.length));
    const m = re.exec(bare);
    if (m) {
      const at = b.start + m.index + m[1].length;
      return css.slice(0, at) + value + css.slice(b.start + m.index + m[0].length);
    }
  }
  throw new Error(`${token} is not declared in ${sel}${media ? ` inside @media ${media}` : ""}`);
}
