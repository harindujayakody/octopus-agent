import type { Block, TrafficAction, TrafficRule } from "../../../entities/automation";
import { t } from "../../../shared/i18n";

/** One thing a project does beyond the pages it drives, with its literal value. */
export type ReviewLine = { step: string; what: string };

/** Bidi and invisible direction-control characters: a value could otherwise
 *  read differently than it is (SEC-02 review). */
const BIDI = /[‎‏؜‪-‮⁦-⁩]/g;

/** Strips bidi overrides and shows the value exactly as written: parsing is
 *  never used to rewrite it (a regex or a literal backslash must come through
 *  unchanged, SEC-02 review). */
function clean(s: string): string {
  const stripped = s.replace(BIDI, "").trim();
  return stripped || t("automationReview.empty");
}

const text = (v: unknown) => (typeof v === "string" ? clean(v) : t("automationReview.empty"));

/** The host as written in a URL: after any userinfo, before any port, path,
 *  query or fragment. */
const WRITTEN_HOST = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/i;

/** A value the runner reaches as a URL. When the host it really reaches (in
 *  punycode) differs from the host as written, the real one is appended, so a
 *  homoglyph host reads in its true form; a copy of the punycode elsewhere in
 *  the value (the query, say) can't hide it (SEC-02 review). */
function urlText(v: unknown): string {
  const shown = text(v);
  if (typeof v !== "string") return shown;
  const stripped = v.replace(BIDI, "").trim();
  try {
    const real = new URL(stripped).hostname;
    const written = (WRITTEN_HOST.exec(stripped)?.[1] ?? "").toLowerCase();
    return real && real !== written ? `${shown} (${real})` : shown;
  } catch {
    return shown;
  }
}

/** A bare host the runner matches (a rule's or a traffic block's `host`),
 *  with its punycode form appended when that differs. Converted label by
 *  label, so a wildcard label ("*.bank.example") stays as written. */
function hostText(v: unknown): string {
  const shown = text(v);
  if (typeof v !== "string") return shown;
  const stripped = v.replace(BIDI, "").trim().toLowerCase();
  const real = stripped.split(".").map((label) => {
    if (!label || label.includes("*")) return label;
    try { return new URL(`http://${label}`).hostname; } catch { return label; }
  }).join(".");
  return real !== stripped ? `${shown} (${real})` : shown;
}

/** A blank field is the same as an absent one, the way the runner treats it
 *  (runner.rs `param` and `traffic_match`). */
const given = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** The match a traffic rule or block names in its review line: the first
 *  given of url, host, urlRegex or hostRegex, each shown its own way (a regex
 *  is never parsed as a URL). */
function matchOf(m: { url?: unknown; host?: unknown; urlRegex?: unknown; hostRegex?: unknown } | undefined): string {
  if (given(m?.url)) return urlText(m.url);
  if (given(m?.host)) return hostText(m.host);
  if (given(m?.urlRegex)) return text(m.urlRegex);
  if (given(m?.hostRegex)) return text(m.hostRegex);
  return t("automationReview.empty");
}

/** A traffic block's url and host params, where the runner also treats "any"
 *  as absent (runner.rs `traffic_match`). */
const blockMatch = (p: Record<string, unknown>) => {
  const field = (v: unknown) => (given(v) && v.trim() !== "any" ? v : undefined);
  return matchOf({ url: field(p.url), host: field(p.host) });
};

/** A rule's action, in words — never the raw type id (SEC-02 review, and no
 *  English leaking into the zh translation). A "modify" action edits the
 *  response when it carries response-stage fields, otherwise it changes the
 *  request's own headers or body. */
function ruleAction(a: TrafficAction | undefined): string {
  switch (a?.type) {
    case "redirect": return t("automationReview.actionRedirect");
    case "fulfill": return t("automationReview.actionFulfill");
    case "block": return t("automationReview.actionBlock");
    case "modify": {
      const editsResponse =
        a.setResponseHeaders !== undefined || a.removeResponseHeaders !== undefined ||
        a.setStatus !== undefined || a.setResponseBody !== undefined;
      return editsResponse ? t("automationReview.actionEditResponse") : t("automationReview.actionSetHeaders");
    }
    default: return t("automationReview.actionContinue");
  }
}

/// What a project's steps and traffic rules can do outside the page: write or
/// read files, reach the network, open a database, run a script, redirect,
/// edit or answer requests, change a profile's proxy or delete a profile,
/// take a screenshot, install modules (SEC-02). Empty when it does none of
/// that.
export function reviewLines(blocks: Block[], rules: TrafficRule[] = [], modules: string[] = []): ReviewLine[] {
  const out: ReviewLine[] = [];
  for (const b of blocks) {
    const p = b.params ?? {};
    const step = text(b.label || b.kind);
    if (b.kind === "file.append") {
      out.push({ step, what: t("automationReview.fileAppend", { path: text(p.path) }) });
    } else if (b.kind === "file.readLine") {
      out.push({ step, what: p.take === "keep" ? t("automationReview.fileRead", { path: text(p.path) }) : t("automationReview.fileTake", { path: text(p.path) }) });
    } else if (b.kind.startsWith("http.") && b.kind !== "http.endSession") {
      const method = text(p.method ?? "GET");
      const url = urlText(p.url);
      // "profile" (the default, and what an absent or "" via means) says
      // nothing extra. "host", or a blank value the runner passes on as an
      // empty proxy, leaves from this computer's own address (the O10
      // identity leak). Anything else is a proxy URL the request goes through
      // (runner.rs:1432-1449). The runner compares untrimmed, so this does too.
      const via = typeof p.via === "string" && p.via !== "" ? p.via : "profile";
      const what =
        via === "profile" ? t("automationReview.http", { method, url }) :
        via === "host" || via.trim() === "" ? t("automationReview.httpViaHost", { method, url }) :
        t("automationReview.httpViaProxy", { method, url, via: text(via) });
      out.push({ step, what });
    } else if (b.kind === "db.open") {
      // SQLite is a file (path); the others take a connection string
      // (target). The runner accepts either field, so the review must too.
      const target = typeof p.target === "string" && p.target.trim() ? p.target : p.path;
      out.push({ step, what: t("automationReview.db", { driver: text(p.driver ?? "sqlite"), target: text(target) }) });
    } else if (b.kind === "script.run") {
      const file = typeof p.file === "string" ? p.file.trim() : "";
      out.push({
        step,
        what: file
          ? t("automationReview.scriptFile", { file: text(file), world: text(p.world ?? "isolated") })
          : t("automationReview.script", { world: text(p.world ?? "isolated") }),
      });
    } else if (b.kind === "traffic.redirect") {
      out.push({ step, what: t("automationReview.redirect", { url: blockMatch(p), to: urlText(p.to) }) });
    } else if (b.kind === "traffic.fulfill") {
      out.push({ step, what: t("automationReview.fulfill", { url: blockMatch(p) }) });
    } else if (b.kind === "traffic.editResponse") {
      out.push({ step, what: t("automationReview.editResponse", { url: blockMatch(p) }) });
    } else if (b.kind === "traffic.setHeaders") {
      out.push({ step, what: t("automationReview.setHeaders", { url: blockMatch(p) }) });
    } else if (b.kind === "screenshot") {
      // No path: the runner saves it beside the run log, not somewhere the
      // operator chose — not worth reviewing.
      const path = typeof p.path === "string" ? p.path.trim() : "";
      if (path) out.push({ step, what: t("automationReview.screenshot", { path: text(path) }) });
    } else if (b.kind === "proxy.set") {
      out.push({ step, what: t("automationReview.proxyChange") });
    } else if (b.kind === "proxy.swap") {
      // Hot-swaps the running browser's proxy for this run only — it saves
      // nothing to the profile (runner.rs:1687-1697), unlike proxy.set/
      // generate/residential above. An empty proxy means a direct connection
      // from this computer's own address.
      const proxy = typeof p.proxy === "string" ? p.proxy.trim() : "";
      out.push({ step, what: proxy ? t("automationReview.proxySwap") : t("automationReview.proxySwapDirect") });
    } else if (b.kind === "profile.delete") {
      // No id: the runner deletes the profile the project itself runs on,
      // data folder included (runner.rs:1220).
      const id = typeof p.id === "string" ? p.id.trim() : "";
      out.push({ step, what: id ? t("automationReview.profileDelete", { id: text(id) }) : t("automationReview.profileDeleteSelf") });
    }
  }
  for (const r of rules) {
    const match = matchOf(r?.match);
    // Any action that sets a URL sends the request elsewhere, whatever its
    // type says: the Traffic panel offers a URL rewrite on modify and
    // continue rules too (TrafficPanel.tsx).
    const to = given(r?.action?.setUrl) ? r.action.setUrl : "";
    out.push({
      step: t("automationReview.ruleStep"),
      what: to
        ? t("automationReview.ruleRedirect", { action: t("automationReview.actionRedirect"), match, to: urlText(to) })
        : t("automationReview.rule", { action: ruleAction(r?.action), match }),
    });
  }
  for (const id of modules) {
    const cleanId = text(id);
    out.push({ step: cleanId, what: t("automationReview.module", { id: cleanId }) });
  }
  return out;
}
