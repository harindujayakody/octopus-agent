import type { TrafficAction, TrafficHeaderOp, TrafficMatch, TrafficRule } from "../../entities/automation";
import type { useT } from "../../shared/i18n";

type T = ReturnType<typeof useT>;

/** What a rule does, in the four plain choices the form offers. The stored
 *  types map onto them with nothing lost: continue is Let through, modify and
 *  redirect are Change (redirect is a choice inside it), block is Block and
 *  fulfill is Answer. */
export type DoKind = "through" | "change" | "block" | "answer";

/** Every field a Change uses, at the request and the response stage. */
export const CHANGE_FIELDS = [
  "setHeaders", "removeHeaders", "setMethod", "setUrl", "setBody", "delayMs",
  "setResponseHeaders", "removeResponseHeaders", "setStatus", "setResponseBody",
] as const satisfies readonly (keyof TrafficAction)[];

const given = (v: unknown) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);

/** A continue rule can carry changes (the old panel offered them there too):
 *  it shows as Change, so nothing it does is hidden. */
export function doOf(a: TrafficAction): DoKind {
  switch (a.type) {
    case "block": return "block";
    case "fulfill": return "answer";
    case "modify":
    case "redirect": return "change";
    default: return CHANGE_FIELDS.some((k) => given(a[k])) ? "change" : "through";
  }
}

export function doLabel(t: T, d: DoKind): string {
  switch (d) {
    case "through": return t("trafficPanel.doThrough");
    case "change": return t("trafficPanel.doChange");
    case "block": return t("trafficPanel.doBlock");
    default: return t("trafficPanel.doAnswer");
  }
}

export const METHODS = ["", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
export const KINDS = ["", "document", "xhr", "script", "stylesheet", "image", "font", "media", "websocket", "other"];

/** A resource type in sentence case, as a select or a row shows it. */
export function kindLabel(t: T, kind: string | undefined): string {
  switch (kind ?? "") {
    case "":
    case "any": return t("trafficPanel.anyType");
    case "document": return t("trafficPanel.kindDocument");
    case "xhr": return t("trafficPanel.kindXhr");
    case "script": return t("trafficPanel.kindScript");
    case "stylesheet": return t("trafficPanel.kindStylesheet");
    case "image": return t("trafficPanel.kindImage");
    case "font": return t("trafficPanel.kindFont");
    case "media": return t("trafficPanel.kindMedia");
    case "websocket": return t("trafficPanel.kindWebsocket");
    case "other": return t("trafficPanel.kindOther");
    default: return kind!;
  }
}

/** The net errors a blocked request can fail with ("" is the core's own). */
export const BLOCK_REASONS = [
  "", "BlockedByClient", "BlockedByResponse", "AccessDenied", "Failed", "Aborted", "TimedOut",
  "ConnectionClosed", "ConnectionReset", "ConnectionRefused", "ConnectionAborted", "ConnectionFailed",
  "NameNotResolved", "InternetDisconnected", "AddressUnreachable",
];

export function reasonLabel(t: T, reason: string): string {
  switch (reason) {
    case "": return t("trafficPanel.reasonDefault");
    case "BlockedByClient": return t("trafficPanel.reasonBlockedByClient");
    case "BlockedByResponse": return t("trafficPanel.reasonBlockedByResponse");
    case "AccessDenied": return t("trafficPanel.reasonAccessDenied");
    case "Failed": return t("trafficPanel.reasonFailed");
    case "Aborted": return t("trafficPanel.reasonAborted");
    case "TimedOut": return t("trafficPanel.reasonTimedOut");
    case "ConnectionClosed": return t("trafficPanel.reasonConnectionClosed");
    case "ConnectionReset": return t("trafficPanel.reasonConnectionReset");
    case "ConnectionRefused": return t("trafficPanel.reasonConnectionRefused");
    case "ConnectionAborted": return t("trafficPanel.reasonConnectionAborted");
    case "ConnectionFailed": return t("trafficPanel.reasonConnectionFailed");
    case "NameNotResolved": return t("trafficPanel.reasonNameNotResolved");
    case "InternetDisconnected": return t("trafficPanel.reasonInternetDisconnected");
    case "AddressUnreachable": return t("trafficPanel.reasonAddressUnreachable");
    // A reason typed by hand before the select existed stays as written.
    default: return reason;
  }
}

/** The address a rule matches, as its row shows it. */
export function ruleAddress(t: T, m: TrafficMatch): string {
  return m.urlRegex || m.url || m.hostRegex || m.host || t("trafficPanel.anyAddress");
}

/** The method and type a rule matches: "GET, Stylesheets", or "Any method, any type". */
export function ruleScope(t: T, m: TrafficMatch): string {
  const parts = [m.method, m.resource ? kindLabel(t, m.resource) : ""].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : t("trafficPanel.anyScope");
}

export function emptyRule(): TrafficRule {
  return { match: { url: "" }, action: { type: "block" } };
}

/** An observed request, as the panels pass it around. */
export type Observed = {
  id: string;
  url: string;
  method: string;
  resource: string;
  capture?: boolean;
  status?: number;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseBodyTruncated?: boolean;
};

const headersToOps = (h?: Record<string, string>): TrafficHeaderOp[] =>
  Object.entries(h ?? {}).map(([name, value]) => ({ name, value }));

/** A rule built from one request: its address, method and type, and for a
 *  Change or an Answer what came back, so it starts from the real thing. */
export function ruleFromRequest(o: Observed, type: TrafficAction["type"]): TrafficRule {
  const match = {
    url: o.url,
    ...(o.method ? { method: o.method } : {}),
    ...(o.resource && o.resource !== "any" ? { resource: o.resource } : {}),
  };
  let action: TrafficAction = { type };
  if (type === "modify") {
    action = {
      type: "modify",
      ...(o.responseHeaders ? { setResponseHeaders: headersToOps(o.responseHeaders) } : {}),
      ...(o.status ? { setStatus: o.status } : {}),
    };
  } else if (type === "fulfill") {
    action = {
      type: "fulfill",
      status: o.status ?? 200,
      ...(o.responseHeaders ? { responseHeaders: headersToOps(o.responseHeaders) } : {}),
      responseBody: o.responseBody ?? "",
    };
  }
  return { match, action };
}
