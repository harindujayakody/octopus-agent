/// Whitespace the way the backend's Rust tokenizer sees it (settings.rs
/// parse_extra_args, `char::is_whitespace`): JS `\s` plus U+0085 (NEL).
/// U+FEFF (BOM/ZWNBSP) is in JS `\s` but is not Unicode White_Space, so Rust
/// does not split on it either; it must not split here (review finding).
function isArgWhitespace(ch: string): boolean {
  return ch !== "﻿" && (/\s/.test(ch) || ch === "\u0085");
}

/// Splits extra launch arguments the way the backend does (settings.rs
/// parse_extra_args): whitespace separates, single or double quotes group.
export function parseLaunchArgs(raw: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of raw) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (isArgWhitespace(ch)) {
      if (cur) { out.push(cur); cur = ""; }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

export type LaunchArgRisk = "proxy" | "exec" | "debug" | "unsafe" | "profile" | "extension" | "cert";

/// Chromium accepts `-`, `--` or (Windows only) `/` as a switch prefix; a
/// single `-no-sandbox` or a Windows `/proxy-server=...` is the same switch
/// as `--no-sandbox` / `--proxy-server=...` and must be recognized the same
/// way (review finding). Anything that isn't prefixed as a switch is left
/// alone: it will simply never match `RISKY` below.
function normalizeSwitch(token: string): string {
  if (token.startsWith("--")) return token;
  if (token.startsWith("-") || token.startsWith("/")) return `--${token.slice(1)}`;
  return token;
}

const RISKY: [RegExp, LaunchArgRisk][] = [
  [/^--(?:no-)?proxy-server$/, "proxy"],
  [/^--proxy-(?:pac-url|bypass-list)$/, "proxy"],
  [/^--[a-z-]*-cmd-prefix$/, "exec"],
  [/^--gpu-launcher$/, "exec"],
  [/^--browser-subprocess-path$/, "exec"],
  [/^--remote-debugging-[a-z-]+$/, "debug"],
  [/^--disable-web-security$/, "unsafe"],
  [/^--no-sandbox$/, "unsafe"],
  [/^--user-data-dir$/, "profile"],
  [/^--load-extension$/, "extension"],
  [/^--ignore-certificate-errors$/, "cert"],
];

/// The switches in `raw` that drop every profile's proxy, run programs,
/// open the browser to remote control, turn off its protections, put every
/// profile in one data folder, load unreviewed code into every profile, or
/// hide a bad certificate (SEC-10; the backend should refuse them too,
/// B27). Each once, in order.
export function riskyLaunchArgs(raw: string): { flag: string; risk: LaunchArgRisk }[] {
  const seen = new Set<string>();
  const out: { flag: string; risk: LaunchArgRisk }[] = [];
  for (const arg of parseLaunchArgs(raw)) {
    const flag = normalizeSwitch(arg).split("=")[0].toLowerCase();
    if (seen.has(flag)) continue;
    const hit = RISKY.find(([re]) => re.test(flag));
    if (hit) { seen.add(flag); out.push({ flag, risk: hit[1] }); }
  }
  return out;
}
