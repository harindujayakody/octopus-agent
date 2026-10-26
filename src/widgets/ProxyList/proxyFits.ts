import type { ColumnFits, Measure } from "../../shared/lib/tableColumns";
import { t } from "../../shared/i18n";
import { proxyStatus, type ProxyColumnId, type ProxyEntry, type ProxyTestSnapshot } from "../../entities/proxy";

// The px ProxyListRow's cells draw beside their text. Keep in step with it.
/** A country flag (17 px tall, 4:3) and the gap after it (`gap-1.5`). */
const FLAG = 23 + 6;
/** A Badge pill's sides with no lead (`px-[7px]`): ProxyTestPill. */
const TEST_PILL = 7 + 7;
/** ProtocolPill's sides (`px-1.5`). */
const PROTOCOL_PILL = 6 + 6;
/** The test cell's gap between its pill and the IP (`gap-1.5`). */
const GAP = 6;
/** A pill's 1 px system edge each side, drawn only in forced colors (`forced-edge`). */
const edge = () => (typeof matchMedia === "function" && matchMedia("(forced-colors: active)").matches ? 2 : 0);
/** The pill's word takes tabular digits: each as wide as a 0. */
const tabular = (text: string) => text.replace(/[0-9]/g, "0");

/// What each Proxies cell shows, for sizing its column to its content
/// (owner, 2026-09-30): the text ProxyListRow draws, in the same type role,
/// plus its fixed parts. Test result reads as it settles ("Testing…" is
/// brief): with no Notes here, the spare room no longer goes to the last
/// column, so it sizes to its results like the rest (controller ruling).
/// Type and Test result are pills since the Live layer (Task 6): a pill's
/// width is its word plus its sides (merge point 3, Live review B-I2).
/// `short` is the Test result without its IP: short of room, the IP moves
/// into the pill's tooltip before any column is cut (controller ruling,
/// merge point 3; `layoutColumns`).
export function proxyFits({ snapshotOf, countOf }: {
  snapshotOf: (id: string) => ProxyTestSnapshot | undefined;
  countOf: (id: string) => number;
}): { fits: ColumnFits<ProxyColumnId, ProxyEntry>; short: ColumnFits<ProxyColumnId, ProxyEntry> } {
  const failed = t("proxyTestResult.failed");
  const notTested = t("proxyTestResult.notTested");
  const pill = (p: ProxyEntry, m: Measure) => {
    const snap = snapshotOf(p.id);
    const status = proxyStatus(snap);
    const word = status === "ok" ? t("proxyTestResult.ok", { ms: snap!.tcp_ms ?? 0 }) : status === "failed" ? failed : notTested;
    return TEST_PILL + edge() + m(tabular(word), "medium");
  };
  const fits: ColumnFits<ProxyColumnId, ProxyEntry> = {
    name: (p, m) => m(p.name || `${p.host}:${p.port}`, "ui"),
    type: (p, m) => PROTOCOL_PILL + edge() + m(p.kind.toUpperCase(), "medium"),
    address: (p, m) => m(`${p.host}:${p.port}`, "mono"),
    country: (p, m) => {
      const snap = snapshotOf(p.id);
      const cc = snap?.country_code || p.country;
      if (!cc) return m("—", "secondary");
      // CountryFlag draws only a two-letter code.
      return (/^[a-zA-Z]{2}$/.test(cc) ? FLAG : 0) + m(snap?.city || cc, "secondary");
    },
    profiles: (p, m) => m(String(countOf(p.id)), "tabular"),
    // The pill ("OK 164 ms", "Failed", "Not tested"), then the IP in the
    // mono face after the cell's gap.
    test: (p, m) => {
      const snap = snapshotOf(p.id);
      return proxyStatus(snap) === "ok" && snap!.ip ? pill(p, m) + GAP + m(snap!.ip, "mono") : pill(p, m);
    },
  };
  return { fits, short: { test: pill } };
}
