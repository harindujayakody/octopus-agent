import { createElement, Fragment, type ReactNode } from "react";

// One key per sentence, with inline tags for the words a sentence sets apart
// (WRITE-06): "<b>From fingerprint</b> uses the screen size the profile
// claims." Translators get the whole sentence and move the tags with the
// words. One level of tags; a tag with no closing pair stays text.

export type RichTags = Record<string, (chunk: string) => ReactNode>;
export type RichPart = { tag?: string; text: string };

export function parseRich(template: string): RichPart[] {
  const parts: RichPart[] = [];
  let last = 0;
  for (const m of template.matchAll(/<([a-z][a-z0-9]*)>([\s\S]*?)<\/\1>/gi)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: template.slice(last, at) });
    parts.push({ tag: m[1], text: m[2] });
    last = at + m[0].length;
  }
  if (last < template.length) parts.push({ text: template.slice(last) });
  return parts;
}

const fill = (s: string, vars?: Record<string, string | number>) => {
  if (!vars) return s;
  let out = s;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
};

/// Tags the caller names wrap their text; an unknown tag renders its text
/// plain. Variables are filled after the template is parsed, so a profile
/// named "<b>x</b>" stays text (plan ruling 8).
export function renderRich(template: string, tags: RichTags, vars?: Record<string, string | number>): ReactNode {
  return parseRich(template).map((p, i) =>
    createElement(Fragment, { key: i }, p.tag && tags[p.tag] ? tags[p.tag](fill(p.text, vars)) : fill(p.text, vars)),
  );
}
